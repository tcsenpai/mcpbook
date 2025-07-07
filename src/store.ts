import { GitBookContent, GitBookPage } from './scraper.js';
import Fuse from 'fuse.js';
import { TextProcessor } from './textProcessor.js';

export interface SearchResult {
  page: GitBookPage;
  score: number;
  snippet: string;
  matches: Array<{
    indices: ReadonlyArray<readonly [number, number]>;
    value?: string;
    key?: string;
  }>;
}

export class ContentStore {
  private content: GitBookContent = {};
  private lastUpdated: Date | null = null;
  private fuse: Fuse<GitBookPage> | null = null;
  private textProcessor = new TextProcessor();

  async updateContent(content: GitBookContent): Promise<void> {
    this.content = content;
    this.lastUpdated = new Date();
    this.initializeFuse();
  }

  private initializeFuse(): void {
    const pages = Object.values(this.content);
    
    this.fuse = new Fuse(pages, {
      keys: [
        { name: 'title', weight: 0.8 },
        { name: 'searchableText', weight: 0.6 },
        { name: 'section', weight: 0.5 },
        { name: 'subsection', weight: 0.4 },
        { name: 'content', weight: 0.2 }
      ],
      threshold: 0.2, // More permissive
      includeScore: true,
      includeMatches: true,
      ignoreLocation: true,
      findAllMatches: true,
      minMatchCharLength: 2,
      distance: 1000, // Allow matches further apart
      useExtendedSearch: true
    });
  }

  async getPage(path: string): Promise<GitBookPage | undefined> {
    return this.content[path];
  }

  async searchContent(query: string): Promise<SearchResult[]> {
    if (!this.fuse) {
      return [];
    }

    const searchTerms = this.textProcessor.getSearchTerms(query);
    const allResults = new Map<string, SearchResult>();

    // Check if searching for code-specific terms
    const isCodeSearch = this.isCodeRelatedQuery(query);

    // Strategy 1: Exact phrase search (highest priority)
    const exactResults = this.fuse.search(`"${query}"`);
    exactResults.forEach(result => {
      const key = result.item.path;
      allResults.set(key, {
        page: result.item,
        score: (result.score || 0) * 0.1, // Boost exact matches
        snippet: this.extractSnippet(result.item.content, query, isCodeSearch),
        matches: (result.matches || []).map(match => ({
          indices: match.indices,
          value: match.value,
          key: match.key
        }))
      });
    });

    // Strategy 2: Expanded terms search
    for (const term of searchTerms.expanded) {
      const results = this.fuse.search(term);
      results.forEach(result => {
        const key = result.item.path;
        const existing = allResults.get(key);
        const newScore = (result.score || 0) * 0.3;
        
        if (!existing || newScore < existing.score) {
          allResults.set(key, {
            page: result.item,
            score: newScore,
            snippet: this.extractSnippet(result.item.content, query, isCodeSearch),
            matches: (result.matches || []).map(match => ({
              indices: match.indices,
              value: match.value,
              key: match.key
            }))
          });
        }
      });
    }

    // Strategy 3: Code block search (if code-related query)
    if (isCodeSearch) {
      const codeResults = this.searchCodeBlocks(query);
      codeResults.forEach(result => {
        const key = result.page.path;
        if (!allResults.has(key)) {
          allResults.set(key, {
            page: result.page,
            score: 0.25, // Good score for code matches
            snippet: result.snippet,
            matches: []
          });
        }
      });
    }

    // Strategy 4: Stemmed terms (fallback)
    const stemmedQuery = searchTerms.stemmed.join(' ');
    if (stemmedQuery !== query) {
      const stemResults = this.fuse.search(stemmedQuery);
      stemResults.forEach(result => {
        const key = result.item.path;
        if (!allResults.has(key)) {
          allResults.set(key, {
            page: result.item,
            score: (result.score || 0) * 0.5,
            snippet: this.extractSnippet(result.item.content, query, isCodeSearch),
            matches: (result.matches || []).map(match => ({
              indices: match.indices,
              value: match.value,
              key: match.key
            }))
          });
        }
      });
    }

    // Convert to array and sort by score (lower is better)
    return Array.from(allResults.values())
      .sort((a, b) => a.score - b.score)
      .slice(0, 20); // Limit results
  }

  private isCodeRelatedQuery(query: string): boolean {
    const codeTerms = [
      'code', 'function', 'method', 'class', 'variable', 'api', 'example',
      'snippet', 'script', 'syntax', 'import', 'export', 'const', 'let',
      'var', 'def', 'return', 'if', 'for', 'while', 'try', 'catch'
    ];
    
    const queryLower = query.toLowerCase();
    return codeTerms.some(term => queryLower.includes(term));
  }

  private searchCodeBlocks(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    
    for (const page of Object.values(this.content)) {
      for (const codeBlock of page.codeBlocks) {
        const codeMatch = codeBlock.code.toLowerCase().includes(queryLower);
        const langMatch = codeBlock.language.toLowerCase().includes(queryLower);
        const titleMatch = codeBlock.title?.toLowerCase().includes(queryLower);
        
        if (codeMatch || langMatch || titleMatch) {
          const snippet = this.extractCodeSnippet(codeBlock, query);
          results.push({
            page,
            score: 0.2, // Good score for code matches
            snippet,
            matches: []
          });
          break; // Only add page once even if multiple code blocks match
        }
      }
    }
    
    return results;
  }

  private extractCodeSnippet(codeBlock: any, query: string): string {
    const lines = codeBlock.code.split('\n');
    const queryLower = query.toLowerCase();
    
    // Find the line that contains the query
    const matchLine = lines.findIndex((line: string) => 
      line.toLowerCase().includes(queryLower)
    );
    
    if (matchLine !== -1) {
      const start = Math.max(0, matchLine - 2);
      const end = Math.min(lines.length, matchLine + 3);
      const context = lines.slice(start, end);
      
      return `Code (${codeBlock.language}${codeBlock.title ? ` - ${codeBlock.title}` : ''}):\n\`\`\`${codeBlock.language}\n${context.join('\n')}\n\`\`\``;
    }
    
    return `Code (${codeBlock.language}): ${codeBlock.code.substring(0, 100)}...`;
  }

  async listSections(): Promise<{ [section: string]: string[] }> {
    const sections: { [section: string]: string[] } = {};
    
    for (const page of Object.values(this.content)) {
      if (!sections[page.section]) {
        sections[page.section] = [];
      }
      sections[page.section].push(page.path);
    }
    
    return sections;
  }

  async getSectionPages(section: string): Promise<GitBookPage[]> {
    if (!section || typeof section !== 'string') {
      return [];
    }
    
    return Object.values(this.content).filter(page => 
      page.section && page.section.toLowerCase() === section.toLowerCase()
    );
  }

  private extractSnippet(content: string, query: string, isCodeSearch: boolean = false, maxLength: number = 200): string {
    const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 0);
    const contentLower = content.toLowerCase();
    
    let bestIndex = -1;
    let bestScore = 0;
    
    for (const word of queryWords) {
      const index = contentLower.indexOf(word);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        bestScore++;
      }
    }
    
    if (bestIndex === -1) {
      return content.substring(0, maxLength);
    }
    
    const start = Math.max(0, bestIndex - 50);
    const end = Math.min(content.length, bestIndex + 150);
    
    let snippet = content.substring(start, end);
    
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    
    return snippet;
  }

  getStats(): { 
    totalPages: number; 
    lastUpdated: Date | null; 
    sections: string[];
    avgContentAge: number;
    oldestPage?: { path: string; lastChecked: Date };
    newestPage?: { path: string; lastChecked: Date };
  } {
    const sections = [...new Set(Object.values(this.content).map(page => page.section))];
    const pages = Object.values(this.content);
    
    if (pages.length === 0) {
      return {
        totalPages: 0,
        lastUpdated: this.lastUpdated,
        sections: [],
        avgContentAge: 0,
      };
    }

    const now = Date.now();
    const ages = pages.map(page => now - new Date(page.lastChecked).getTime());
    const avgContentAge = ages.reduce((sum, age) => sum + age, 0) / ages.length;

    const sortedByAge = pages.sort((a, b) => 
      new Date(a.lastChecked).getTime() - new Date(b.lastChecked).getTime()
    );

    return {
      totalPages: Object.keys(this.content).length,
      lastUpdated: this.lastUpdated,
      sections: sections.sort(),
      avgContentAge: Math.round(avgContentAge / (1000 * 60 * 60)), // Convert to hours
      oldestPage: { 
        path: sortedByAge[0].path, 
        lastChecked: sortedByAge[0].lastChecked 
      },
      newestPage: { 
        path: sortedByAge[sortedByAge.length - 1].path, 
        lastChecked: sortedByAge[sortedByAge.length - 1].lastChecked 
      },
    };
  }
}