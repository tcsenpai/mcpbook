import Database from 'better-sqlite3';
import { GitBookContent, GitBookPage } from './scraper.js';
import { TextProcessor } from './textProcessor.js';
import { SearchResult } from './store.js';
import { getCacheFilePath } from './config.js';
import path from 'path';

export class SQLiteStore {
  private db: Database.Database;
  private textProcessor = new TextProcessor();
  private searchCache = new Map<string, SearchResult[]>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(gitbookUrl: string) {
    const cacheDir = path.dirname(getCacheFilePath(gitbookUrl));
    const dbPath = path.join(cacheDir, this.generateDbName(gitbookUrl));
    
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private generateDbName(gitbookUrl: string): string {
    const urlObject = new URL(gitbookUrl);
    const hostname = urlObject.hostname.replace(/[^a-zA-Z0-9-]/g, '-');
    const pathname = urlObject.pathname.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'root';
    return `gitbook-${hostname}-${pathname}.db`;
  }

  private initializeSchema(): void {
    // Main pages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_html TEXT NOT NULL,
        markdown TEXT NOT NULL,
        code_blocks TEXT NOT NULL, -- JSON array
        section TEXT NOT NULL,
        subsection TEXT,
        url TEXT NOT NULL,
        last_updated INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        last_checked INTEGER NOT NULL,
        searchable_text TEXT NOT NULL
      )
    `);

    // Full-text search table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
        path,
        title,
        searchable_text,
        section,
        subsection,
        content='pages',
        content_rowid='rowid'
      )
    `);

    // Metadata table for cache info
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create triggers to keep FTS in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts(rowid, path, title, searchable_text, section, subsection)
        VALUES (new.rowid, new.path, new.title, new.searchable_text, new.section, new.subsection);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, path, title, searchable_text, section, subsection)
        VALUES ('delete', old.rowid, old.path, old.title, old.searchable_text, old.section, old.subsection);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, path, title, searchable_text, section, subsection)
        VALUES ('delete', old.rowid, old.path, old.title, old.searchable_text, old.section, old.subsection);
        INSERT INTO pages_fts(rowid, path, title, searchable_text, section, subsection)
        VALUES (new.rowid, new.path, new.title, new.searchable_text, new.section, new.subsection);
      END
    `);
  }

  async updateContent(content: GitBookContent): Promise<void> {
    const pages = Object.values(content);
    
    if (pages.length === 0) {
      return;
    }

    // Use transaction for better performance
    const transaction = this.db.transaction((pages: GitBookPage[]) => {
      const insertStmt = this.db.prepare(`
        INSERT OR REPLACE INTO pages (
          path, title, content, raw_html, markdown, code_blocks,
          section, subsection, url, last_updated, content_hash,
          last_checked, searchable_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const page of pages) {
        insertStmt.run(
          page.path,
          page.title,
          page.content,
          page.rawHtml,
          page.markdown,
          JSON.stringify(page.codeBlocks),
          page.section,
          page.subsection || null,
          page.url,
          page.lastUpdated instanceof Date ? page.lastUpdated.getTime() : new Date(page.lastUpdated).getTime(),
          page.contentHash,
          page.lastChecked instanceof Date ? page.lastChecked.getTime() : new Date(page.lastChecked).getTime(),
          page.searchableText
        );
      }
    });

    transaction(pages);

    // Update metadata
    this.setMetadata('last_updated', new Date().toISOString());
    this.setMetadata('page_count', pages.length.toString());
    
    // Clear search cache
    this.searchCache.clear();
  }

  async getPage(path: string): Promise<GitBookPage | undefined> {
    const stmt = this.db.prepare(`
      SELECT * FROM pages WHERE path = ?
    `);
    
    const row = stmt.get(path) as any;
    if (!row) return undefined;

    return this.rowToPage(row);
  }

  async getAllPages(): Promise<GitBookPage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM pages ORDER BY path
    `);
    
    const rows = stmt.all() as any[];
    return rows.map(row => this.rowToPage(row));
  }

  async getPagesBySection(section: string): Promise<GitBookPage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM pages WHERE section = ? ORDER BY path
    `);
    
    const rows = stmt.all(section) as any[];
    return rows.map(row => this.rowToPage(row));
  }

  async getSections(): Promise<string[]> {
    const stmt = this.db.prepare(`
      SELECT DISTINCT section FROM pages ORDER BY section
    `);
    
    const rows = stmt.all() as { section: string }[];
    return rows.map(row => row.section);
  }

  async search(query: string, limit: number = 20, offset: number = 0): Promise<SearchResult[]> {
    // Check cache first (only cache first page results)
    const cacheKey = `${query}:${limit}:${offset}`;
    if (this.searchCache.has(cacheKey)) {
      const cached = this.searchCache.get(cacheKey)!;
      return cached;
    }

    // Use FTS5 for fast search
    const searchQuery = query.split(' ').map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    
    const stmt = this.db.prepare(`
      SELECT pages.*, pages_fts.rank 
      FROM pages_fts 
      JOIN pages ON pages.rowid = pages_fts.rowid
      WHERE pages_fts MATCH ?
      ORDER BY pages_fts.rank
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(searchQuery, limit, offset) as any[];
    
    const results: SearchResult[] = rows.map(row => {
      const page = this.rowToPage(row);
      const snippet = this.generateSnippet(page.content, query);
      
      return {
        page,
        score: 1 - (row.rank || 0), // Convert rank to score
        snippet,
        matches: [] // FTS5 doesn't provide detailed match info
      };
    });

    // Cache results
    this.searchCache.set(cacheKey, results);
    
    // Clean cache periodically
    setTimeout(() => this.searchCache.delete(cacheKey), this.cacheTimeout);

    return results;
  }

  async getPageCount(): Promise<number> {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM pages`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  async getLastUpdated(): Promise<Date | null> {
    const lastUpdated = this.getMetadata('last_updated');
    return lastUpdated ? new Date(lastUpdated) : null;
  }

  private setMetadata(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(key, value, Date.now());
  }

  getMetadata(key: string): string | null {
    const stmt = this.db.prepare(`
      SELECT value FROM metadata WHERE key = ?
    `);
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value || null;
  }

  private rowToPage(row: any): GitBookPage {
    return {
      path: row.path,
      title: row.title,
      content: row.content,
      rawHtml: row.raw_html,
      markdown: row.markdown,
      codeBlocks: JSON.parse(row.code_blocks || '[]'),
      section: row.section,
      subsection: row.subsection || undefined,
      url: row.url,
      lastUpdated: new Date(row.last_updated),
      contentHash: row.content_hash,
      lastChecked: new Date(row.last_checked),
      searchableText: row.searchable_text
    };
  }

  private generateSnippet(content: string, query: string, maxLength: number = 300): string {
    const words = query.toLowerCase().split(/\s+/);
    const lowerContent = content.toLowerCase();
    
    // Find first occurrence of any query word
    let bestIndex = -1;
    for (const word of words) {
      const index = lowerContent.indexOf(word);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
      }
    }
    
    if (bestIndex === -1) {
      return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
    }
    
    // Create snippet around the found word
    const start = Math.max(0, bestIndex - 50);
    const end = Math.min(content.length, start + maxLength);
    const snippet = content.substring(start, end);
    
    return (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : '');
  }

  // Legacy methods for compatibility with ContentStore interface
  async searchContent(query: string, limit?: number, offset?: number): Promise<any[]> {
    const results = await this.search(query, limit, offset);
    return results.map(r => ({
      page: {
        path: r.page.path,
        title: r.page.title,
        content: r.page.markdown || r.page.content, // Prefer markdown (cleaner), fallback to content
        section: r.page.section,
        subsection: r.page.subsection,
        url: r.page.url,
        lastUpdated: r.page.lastUpdated,
        lastChecked: r.page.lastChecked,
        codeBlocks: r.page.codeBlocks
        // Removed: duplicate content fields, rawHtml (massive), contentHash (internal), searchableText (internal)
      },
      snippet: r.snippet,
      score: r.score
    }));
  }
  
  async searchContentCount(query: string): Promise<number> {
    const searchQuery = query.split(' ').map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM pages_fts 
      WHERE pages_fts MATCH ?
    `);
    
    const result = stmt.get(searchQuery) as { count: number };
    return result.count;
  }

  async listSections(): Promise<string[]> {
    return this.getSections();
  }

  async getSectionPages(section: string): Promise<any[]> {
    return this.getPagesBySection(section);
  }

  async getStats(): Promise<any> {
    const pageCount = await this.getPageCount();
    const lastUpdated = await this.getLastUpdated();
    const sections = await this.getSections();
    
    return {
      totalPages: pageCount,
      sections: sections.length,
      lastUpdated: lastUpdated?.toISOString() || null,
      avgContentAge: 0, // Would need to calculate from lastUpdated times
      cacheSize: 0 // Not applicable for SQLite
    };
  }

  close(): void {
    this.db.close();
  }

  // Migration helper: import from JSON cache
  async importFromJson(jsonPath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(jsonPath, 'utf-8');
      const cached = JSON.parse(data);
      
      if (cached.content) {
        await this.updateContent(cached.content);
        console.error(`Migrated ${Object.keys(cached.content).length} pages from JSON cache to SQLite`);
      }
    } catch (error) {
      // Ignore if JSON cache doesn't exist
    }
  }

  // Domain info caching for fast startup
  setDomainInfo(domainInfo: any): void {
    this.setMetadata('domain_info', JSON.stringify(domainInfo));
  }

  getDomainInfo(): any | null {
    const cached = this.getMetadata('domain_info');
    return cached ? JSON.parse(cached) : null;
  }

  // Get sample pages for domain detection (much faster than getAllPages)
  async getSamplePages(limit: number = 20): Promise<GitBookPage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM pages ORDER BY RANDOM() LIMIT ?
    `);
    
    const rows = stmt.all(limit) as any[];
    return rows.map(row => this.rowToPage(row));
  }
}