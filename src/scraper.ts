import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { gitBookConfig, getCacheFilePath } from './config.js';
import { TextProcessor } from './textProcessor.js';
import TurndownService from 'turndown';

export interface CodeBlock {
  language: string;
  code: string;
  title?: string;
  lineNumbers?: boolean;
}

export interface GitBookPage {
  path: string;
  title: string;
  content: string;
  rawHtml: string;
  markdown: string;
  codeBlocks: CodeBlock[];
  section: string;
  subsection?: string;
  url: string;
  lastUpdated: Date;
  contentHash: string;
  lastChecked: Date;
  searchableText: string;
}

export interface GitBookContent {
  [path: string]: GitBookPage;
}

export interface ScrapingProgress {
  discovered: number;
  completed: number;
  failed: number;
  currentUrl?: string;
}

export type ProgressCallback = (progress: ScrapingProgress) => void;

export class GitBookScraper {
  private baseUrl: string;
  private content: GitBookContent = {};
  private visitedUrls = new Set<string>();
  private cacheFile: string;
  private changedPages = new Set<string>();
  private textProcessor = new TextProcessor();
  private discoveredUrls = new Set<string>();
  private processingQueue: string[] = [];
  private failedPages = new Map<string, number>(); // path -> retry count
  private retryQueue: string[] = [];
  private turndownService!: TurndownService;
  private progressCallback?: ProgressCallback;
  private totalDiscovered = 0;
  private totalCompleted = 0;

  constructor(baseUrl: string, progressCallback?: ProgressCallback) {
    console.log(`🏗️  CONSTRUCTOR: GitBookScraper constructor called with baseUrl: ${baseUrl}`);
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    console.log(`🏗️  CONSTRUCTOR: baseUrl cleaned to: ${this.baseUrl}`);
    this.cacheFile = getCacheFilePath(baseUrl);
    console.log(`🏗️  CONSTRUCTOR: cacheFile set to: ${this.cacheFile}`);
    this.progressCallback = progressCallback;
    console.log(`🏗️  CONSTRUCTOR: About to initialize TurndownService...`);
    this.initializeTurndownService();
    console.log(`🏗️  CONSTRUCTOR: GitBookScraper constructor completed`);
  }

  private joinUrls(base: string, path: string): string {
    // Handle absolute URLs
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    
    // Clean base URL (remove trailing slash)
    const cleanBase = base.replace(/\/$/, '');
    
    // Clean path (ensure it starts with /)
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    // Check for path prefix duplication
    const baseUrl = new URL(cleanBase);
    const basePath = baseUrl.pathname;
    
    // If the path already starts with the base path, don't duplicate it
    if (basePath !== '/' && cleanPath.startsWith(basePath)) {
      return `${baseUrl.origin}${cleanPath}`;
    }
    
    return `${cleanBase}${cleanPath}`;
  }

  private async fetchWithHeaders(url: string): Promise<Response> {
    return fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
  }

  private reportProgress(currentUrl?: string): void {
    if (this.progressCallback) {
      this.progressCallback({
        discovered: this.discoveredUrls.size,
        completed: Object.keys(this.content).length,
        failed: this.failedPages.size,
        currentUrl
      });
    }
  }

  private initializeTurndownService(): void {
    console.log(`🏗️  TURNDOWN: Creating TurndownService...`);
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '_',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
      preformattedCode: true
    });

    this.turndownService.addRule('preserve-code-blocks', {
      filter: ['pre', 'code'],
      replacement: (content, node) => {
        const element = node as any;
        if (element.tagName === 'PRE') {
          const codeElement = element.querySelector('code');
          if (codeElement) {
            const language = this.detectLanguageFromElement(codeElement);
            return `\n\`\`\`${language}\n${codeElement.textContent}\n\`\`\`\n`;
          }
          return `\n\`\`\`\n${element.textContent}\n\`\`\`\n`;
        }
        return `\`${content}\``;
      }
    });

    this.turndownService.addRule('preserve-line-breaks', {
      filter: 'br',
      replacement: () => '\n'
    });
    
    console.log(`🏗️  TURNDOWN: TurndownService initialization completed`);
  }

  private detectLanguageFromElement(element: any): string {
    const classes = element.className || '';
    const langMatch = classes.match(/(?:language-|lang-|highlight-)?([a-zA-Z0-9_+-]+)/);
    if (langMatch && this.isValidLanguage(langMatch[1])) {
      return langMatch[1];
    }
    return '';
  }

  async scrapeAll(): Promise<void> {
    console.log(`🚀 SCRAPER: scrapeAll() started`);
    
    // Try to load from cache first
    console.log(`🚀 SCRAPER: Checking cache...`);
    if (await this.loadFromCache()) {
      console.log(`Loaded ${Object.keys(this.content).length} pages from cache`);
      
      // Check for changes if cache is not expired
      console.log(`🚀 SCRAPER: Detecting changes...`);
      await this.detectChanges();
      
      if (this.changedPages.size > 0) {
        console.log(`Detected ${this.changedPages.size} changed pages, updating...`);
        await this.updateChangedPagesParallel();
        await this.retryFailedPages();
        await this.saveToCache();
      }
      return;
    }
    
    console.log('🚀 SCRAPER: Starting GitBook scraping...');
    console.log('🚀 SCRAPER: About to call scrapeAllPages()');
    await this.scrapeAllPages();
    console.log('🚀 SCRAPER: scrapeAllPages() completed');
    
    // Retry failed pages
    await this.retryFailedPages();
    
    const pageCount = Object.keys(this.content).length;
    console.log(`Scraping completed. Found ${pageCount} pages`);
    
    if (pageCount === 0) {
      console.log('\n⚠️  \x1b[33mWARNING: No pages were scraped successfully!\x1b[0m');
      console.log('   This usually means:');
      console.log('   • The URL is not a valid GitBook site');
      console.log('   • The site structure is different than expected');
      console.log('   • Network issues or access restrictions');
      console.log('   • Please verify the GITBOOK_URL in your .env file\n');
    }
    
    if (this.failedPages.size > 0) {
      console.log(`Warning: ${this.failedPages.size} pages failed to scrape after retries`);
    }
    
    // Save to cache
    await this.saveToCache();
  }

  private async loadFromCache(): Promise<boolean> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const cached = JSON.parse(data);
      
      // Check if cache is still valid and has content
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      const cacheTtlMs = gitBookConfig.cacheTtlHours * 60 * 60 * 1000;
      const hasContent = cached.content && Object.keys(cached.content).length > 0;
      
      if (cacheAge < cacheTtlMs && hasContent) {
        this.content = cached.content;
        return true;
      }
    } catch (error) {
      // Cache file doesn't exist or is invalid
    }
    return false;
  }

  private async saveToCache(): Promise<void> {
    try {
      // Ensure cache directory exists
      const cacheDir = path.dirname(this.cacheFile);
      await fs.mkdir(cacheDir, { recursive: true });
      
      const cacheData = {
        timestamp: new Date().toISOString(),
        content: this.content,
      };
      await fs.writeFile(this.cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      console.log('Failed to save cache:', error);
    }
  }

  private async scrapePage(path: string, forceUpdate: boolean = false): Promise<void> {
    const url = this.joinUrls(this.baseUrl, path);
    
    if (this.visitedUrls.has(url) && !forceUpdate) {
      return;
    }
    
    this.visitedUrls.add(url);

    try {
      if (gitBookConfig.debug) {
        console.log(`Scraping: ${url}`);
      }
      
      const response = await this.fetchWithHeaders(url);
      
      if (!response.ok) {
        console.log(`Failed to fetch ${url}: ${response.status}`);
        return;
      }

      // Check if it's HTML content before processing
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        if (gitBookConfig.debug) {
          console.log(`Skipping non-HTML content: ${url} (${contentType})`);
        }
        return;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract page content
      const title = $('title').text() || $('h1').first().text() || 'Untitled';
      const content = this.extractContent($);
      const rawHtml = this.extractRawContent($);
      const markdown = this.extractMarkdown($);
      const codeBlocks = this.extractCodeBlocks($);
      const section = this.extractSection(path);
      const subsection = this.extractSubsection(path);

      // Calculate content hash
      const contentHash = this.calculateHash(content + title);
      const cleanTitle = title.trim();
      
      // Generate searchable text
      const searchableText = this.textProcessor.createSearchableText(
        cleanTitle, 
        content, 
        section, 
        subsection
      );
      
      // Store the page
      this.content[path] = {
        path,
        title: cleanTitle,
        content,
        rawHtml,
        markdown,
        codeBlocks,
        section,
        subsection,
        url,
        lastUpdated: new Date(),
        contentHash,
        lastChecked: new Date(),
        searchableText,
      };

      // Report progress after storing page
      this.reportProgress(url);

      // Only add delay for parallel processing, not discovery
      if (forceUpdate) {
        await this.delay(gitBookConfig.scrapingDelayMs);
      }
    } catch (error) {
      console.log(`Error scraping ${url}:`, error);
    }
  }

  private extractContent($: cheerio.CheerioAPI): string {
    // Clone for text extraction
    const $clone = $.load($.html());
    
    // Remove navigation, header, footer, and other non-content elements
    $clone('nav, header, footer, .navigation, .sidebar, .toc, .breadcrumb').remove();
    
    // Extract main content area
    const mainContent = $clone('main, .content, .page-content, article, .markdown-body').first();
    
    if (mainContent.length) {
      return mainContent.text().trim();
    }
    
    // Fallback: extract from body, removing common non-content elements
    $clone('script, style, nav, header, footer').remove();
    return $clone('body').text().trim();
  }

  private extractRawContent($: cheerio.CheerioAPI): string {
    // Extract main content area with HTML preserved
    const mainContent = $('main, .content, .page-content, article, .markdown-body').first();
    
    if (mainContent.length) {
      // Remove navigation elements but preserve structure
      mainContent.find('nav, .navigation, .sidebar, .toc, .breadcrumb').remove();
      return mainContent.html() || '';
    }
    
    // Fallback: extract from body
    $('script, style, nav, header, footer, .navigation, .sidebar').remove();
    return $('body').html() || '';
  }

  private extractMarkdown($: cheerio.CheerioAPI): string {
    // Extract main content area for markdown conversion
    const mainContent = $('main, .content, .page-content, article, .markdown-body').first();
    
    if (mainContent.length) {
      // Remove navigation elements but preserve structure
      mainContent.find('nav, .navigation, .sidebar, .toc, .breadcrumb').remove();
      const html = mainContent.html() || '';
      
      if (html) {
        try {
          return this.turndownService.turndown(html);
        } catch (error) {
          console.log('Error converting HTML to markdown:', error);
          return mainContent.text().trim();
        }
      }
    }
    
    // Fallback: extract from body and convert
    const $clone = $.load($.html());
    $clone('script, style, nav, header, footer, .navigation, .sidebar').remove();
    const bodyHtml = $clone('body').html() || '';
    
    if (bodyHtml) {
      try {
        return this.turndownService.turndown(bodyHtml);
      } catch (error) {
        console.log('Error converting HTML to markdown:', error);
        return $clone('body').text().trim();
      }
    }
    
    return '';
  }

  private extractCodeBlocks($: cheerio.CheerioAPI): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    
    // Common code block selectors for GitBook and similar platforms
    const codeSelectors = [
      'pre code',           // Standard markdown code blocks
      '.highlight pre',     // GitHub-style highlights
      '.code-block',        // GitBook code blocks
      '.snippet',           // Code snippets
      '[data-lang]',        // Language-attributed blocks
      '.language-*'         // Language class blocks
    ];
    
    codeSelectors.forEach(selector => {
      $(selector).each((_, element) => {
        const $el = $(element);
        const $pre = $el.closest('pre');
        
        // Extract language information
        let language = this.detectLanguage($el, $pre);
        
        // Extract code content
        const code = $el.text().trim();
        if (!code) return; // Skip empty blocks
        
        // Extract title if present
        const title = this.extractCodeTitle($pre);
        
        // Check for line numbers
        const lineNumbers = $pre.hasClass('line-numbers') || 
                           $pre.find('.line-number').length > 0 ||
                           $pre.attr('data-line-numbers') === 'true';
        
        // Avoid duplicates
        const exists = codeBlocks.some(block => 
          block.code === code && block.language === language
        );
        
        if (!exists) {
          codeBlocks.push({
            language,
            code,
            title,
            lineNumbers
          });
        }
      });
    });
    
    return codeBlocks;
  }

  private detectLanguage($el: cheerio.Cheerio<any>, $pre: cheerio.Cheerio<any>): string {
    // Try various methods to detect language
    
    // 1. Check class attributes for language
    const classes = ($el.attr('class') || '') + ' ' + ($pre.attr('class') || '');
    const langMatch = classes.match(/(?:language-|lang-|highlight-)?([a-zA-Z0-9_+-]+)/);
    if (langMatch && this.isValidLanguage(langMatch[1])) {
      return langMatch[1];
    }
    
    // 2. Check data attributes
    const dataLang = $el.attr('data-lang') || $pre.attr('data-lang') || 
                     $el.attr('data-language') || $pre.attr('data-language');
    if (dataLang && this.isValidLanguage(dataLang)) {
      return dataLang;
    }
    
    // 3. Try to detect from content patterns
    const code = $el.text().trim();
    return this.detectLanguageFromContent(code);
  }

  private extractCodeTitle($pre: cheerio.Cheerio<any>): string | undefined {
    // Look for title in various places
    const titleSources = [
      $pre.attr('title'),
      $pre.attr('data-title'),
      $pre.prev('.code-title, .filename').text(),
      $pre.find('.code-title, .filename').first().text(),
      $pre.parent().find('.code-title, .filename').first().text()
    ];
    
    for (const title of titleSources) {
      if (title && title.trim()) {
        return title.trim();
      }
    }
    
    return undefined;
  }

  private isValidLanguage(lang: string): boolean {
    const validLanguages = new Set([
      'javascript', 'js', 'typescript', 'ts', 'python', 'py', 'java', 'c', 'cpp', 'c++',
      'csharp', 'c#', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'scala',
      'html', 'css', 'scss', 'sass', 'less', 'xml', 'json', 'yaml', 'yml',
      'markdown', 'md', 'sql', 'bash', 'sh', 'shell', 'powershell', 'dockerfile',
      'nginx', 'apache', 'htaccess', 'ini', 'toml', 'env', 'diff', 'patch',
      'regex', 'graphql', 'solidity', 'vim', 'lua', 'perl', 'r', 'matlab',
      'latex', 'tex', 'makefile', 'cmake', 'gradle', 'maven', 'ant'
    ]);
    
    return validLanguages.has(lang.toLowerCase());
  }

  private detectLanguageFromContent(code: string): string {
    // Simple heuristics for common languages
    if (code.includes('function ') && code.includes('{')) {
      if (code.includes('const ') || code.includes('let ') || code.includes('=>')) {
        return 'javascript';
      }
      return 'javascript';
    }
    
    if (code.includes('def ') && code.includes(':')) return 'python';
    if (code.includes('public class ') || code.includes('import java')) return 'java';
    if (code.includes('<?php')) return 'php';
    if (code.includes('#include') || code.includes('int main')) return 'c';
    if (code.includes('<!DOCTYPE') || code.includes('<html')) return 'html';
    if (code.includes('SELECT ') || code.includes('FROM ')) return 'sql';
    if (code.includes('#!/bin/bash') || code.includes('echo ')) return 'bash';
    if (code.startsWith('{') && code.includes('"')) return 'json';
    if (code.includes('---') && code.includes(':')) return 'yaml';
    
    return 'text'; // Default
  }

  private extractSection(path: string): string {
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length === 0) return 'Introduction';
    
    const sectionMap: { [key: string]: string } = {
      'sdk': 'SDK',
      'backend': 'Backend',
      'frontend': 'Frontend',
      'introduction': 'Introduction',
    };
    
    return sectionMap[pathParts[0].toLowerCase()] || pathParts[0];
  }

  private extractSubsection(path: string): string | undefined {
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length < 2) return undefined;
    
    return pathParts[1];
  }

  private extractInternalLinks($: cheerio.CheerioAPI): string[] {
    const links: string[] = [];
    
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && this.isInternalLink(href)) {
        const normalizedPath = this.normalizePath(href);
        if (normalizedPath && !this.visitedUrls.has(`${this.baseUrl}${normalizedPath}`)) {
          links.push(normalizedPath);
        }
      }
    });
    
    return [...new Set(links)]; // Remove duplicates
  }

  private isInternalLink(href: string): boolean {
    // Check if it's an internal link (starts with / or relative)
    return href.startsWith('/') || 
           (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:'));
  }

  private normalizePath(href: string): string | null {
    // Remove query parameters and fragments
    const cleanHref = href.split('?')[0].split('#')[0];
    
    // Skip if it's just a fragment or empty
    if (!cleanHref || cleanHref === '#') return null;
    
    // Filter out static assets and non-content paths
    if (this.isStaticAsset(cleanHref)) return null;
    
    // Ensure it starts with /
    if (!cleanHref.startsWith('/')) {
      return `/${cleanHref}`;
    }
    
    return cleanHref;
  }

  private isStaticAsset(path: string): boolean {
    // Common static asset patterns
    const staticPatterns = [
      // File extensions
      /\.(css|js|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|pdf|zip|tar|gz)$/i,
      // Static directories
      /^\/?(_images|assets|static|_static|_assets|images|img|css|js|fonts|media)\//i,
      // Common non-content paths
      /^\/?(_|\.)/i, // Paths starting with underscore or dot
      /\/search\/?$/i,
      /\/sitemap/i,
      /\/feed/i,
      /\/rss/i,
      /\/robots\.txt$/i,
      /\/favicon/i
    ];
    
    return staticPatterns.some(pattern => pattern.test(path));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async detectChanges(): Promise<void> {
    const pagesToCheck = Object.keys(this.content);
    const batchSize = gitBookConfig.maxConcurrentRequests;
    
    for (let i = 0; i < pagesToCheck.length; i += batchSize) {
      const batch = pagesToCheck.slice(i, i + batchSize);
      const promises = batch.map(path => this.checkPageForChanges(path));
      await Promise.all(promises);
      
      // Small delay between batches
      if (i + batchSize < pagesToCheck.length) {
        await this.delay(gitBookConfig.scrapingDelayMs);
      }
    }
  }

  private async checkPageForChanges(path: string): Promise<void> {
    const existingPage = this.content[path];
    if (!existingPage) return;

    const url = this.joinUrls(this.baseUrl, path);
    let retryCount = 0;
    
    while (retryCount <= 2) { // Quick retry for change detection
      try {
        if (gitBookConfig.debug && retryCount === 0) {
          console.log(`Checking for changes: ${url}`);
        }

        const response = await this.fetchWithHeaders(url);
        
        if (!response.ok) {
          if (response.status >= 500 && retryCount < 2) {
            // Server error - retry
            retryCount++;
            await this.delay(500 * retryCount);
            continue;
          }
          
          console.log(`Failed to check ${url}: ${response.status}`);
          return;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const title = $('title').text() || $('h1').first().text() || 'Untitled';
        const content = this.extractContent($);
        const newHash = this.calculateHash(content + title);

        // Update last checked time
        existingPage.lastChecked = new Date();

        // Check if content changed
        if (newHash !== existingPage.contentHash) {
          this.changedPages.add(path);
        }
        
        return; // Success
        
      } catch (error) {
        if (retryCount < 2) {
          retryCount++;
          if (gitBookConfig.debug) {
            console.log(`Retrying change check for ${url} (attempt ${retryCount + 1})`);
          }
          await this.delay(500 * retryCount);
        } else {
          console.log(`Error checking ${url} after retries:`, error instanceof Error ? error.message : String(error));
          return;
        }
      }
    }
  }

  private async updateChangedPages(): Promise<void> {
    for (const path of this.changedPages) {
      await this.scrapePage(path, true);
    }
    this.changedPages.clear();
  }

  private async updateChangedPagesParallel(): Promise<void> {
    const changedPaths = Array.from(this.changedPages);
    await this.scrapePathsParallel(changedPaths, true);
    this.changedPages.clear();
  }

  private async scrapeAllPages(): Promise<void> {
    // Phase 1: Discover all URLs by scraping root page
    await this.discoverUrls();
    
    // Phase 2: Process all discovered URLs in parallel
    const allUrls = Array.from(this.discoveredUrls);
    console.log(`🔍 Phase 2: Conversion to array complete. Got ${allUrls.length} URLs`);
    
    if (allUrls.length > 0) {
      console.log(`📦 Discovered ${allUrls.length} pages, starting scraping phase...`);
      console.log(`📦 About to call scrapePathsParallel with ${allUrls.length} URLs...`);
      await this.scrapePathsParallel(allUrls);
      console.log(`📦 scrapePathsParallel completed`);
    } else {
      console.log(`⚠️  No pages discovered to scrape!`);
    }
  }

  private async discoverUrls(): Promise<void> {
    // Try to load discovery cache in debug mode
    if (gitBookConfig.debug && await this.loadDiscoveryCache()) {
      console.log(`🔍 Loaded ${this.discoveredUrls.size} URLs from discovery cache`);
      return;
    }

    const queue = ['/'];
    const processed = new Set<string>();
    const discoveryBatchSize = Math.min(8, gitBookConfig.maxConcurrentRequests); // Parallel discovery
    let batchCount = 0;

    // Always include the root page in discovered URLs
    this.discoveredUrls.add('/');

    console.log('🔍 Starting URL discovery...');

    while (queue.length > 0) {
      // Process multiple paths in parallel
      const batch: string[] = [];
      while (batch.length < discoveryBatchSize && queue.length > 0) {
        const path = queue.shift()!;
        if (!processed.has(path)) {
          processed.add(path);
          batch.push(path);
        }
      }

      if (batch.length === 0) break;

      batchCount++;
      // Only show progress every 10 batches to reduce spam
      if (batchCount % 10 === 0 || batchCount === 1) {
        console.log(`📖 Discovery batch ${batchCount}: checking ${batch.length} pages (${this.discoveredUrls.size} found, ${queue.length} queued)`);
      }

      try {
        // Parallel discovery requests
        const discoveryPromises = batch.map(path => this.discoverFromPath(path));
        const batchResults = await Promise.allSettled(discoveryPromises);
        
        // Collect all new links from successful discoveries
        const newLinks: string[] = [];
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            newLinks.push(...result.value);
          } else if (gitBookConfig.debug) {
            // Only show discovery failures in debug mode to avoid breaking progress line
            console.log(`\nDiscovery failed for ${batch[index]}:`, result.reason);
          }
        });

        // Add new links to queue
        for (const link of newLinks) {
          if (!processed.has(link) && !queue.includes(link)) {
            queue.push(link);
            this.discoveredUrls.add(link);
          }
        }

        // Report progress after batch
        this.reportProgress();
        
        // No delay for discovery - maximum speed
      } catch (error) {
        console.log('Batch discovery error:', error);
      }
    }

    console.log(`\n✅ Discovery complete: found ${this.discoveredUrls.size} pages in ${batchCount} batches`);
    
    // Save discovery cache in debug mode
    if (gitBookConfig.debug) {
      await this.saveDiscoveryCache();
    }
    
    console.log(`🔄 Discovery phase finished, returning control to scrapeAllPages...`);
  }

  private async discoverFromPath(path: string): Promise<string[]> {
    try {
      const url = this.joinUrls(this.baseUrl, path);
      const response = await this.fetchWithHeaders(url);
      
      if (response.ok) {
        // Check if it's HTML content
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html')) {
          if (gitBookConfig.debug) {
            console.log(`Skipping non-HTML content: ${url} (${contentType})`);
          }
          return [];
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        return this.extractInternalLinks($);
      }
      
      return [];
    } catch (error) {
      if (gitBookConfig.debug) {
        console.log(`Discovery failed for ${path}:`, error);
      }
      return [];
    }
  }

  private async scrapePathsParallel(paths: string[], forceUpdate: boolean = false): Promise<void> {
    console.log(`🚀 ENTERED scrapePathsParallel function with ${paths.length} paths`);
    
    const batchSize = gitBookConfig.maxConcurrentRequests;
    let processed = 0;
    let successful = 0;
    
    console.log(`🚀 Starting parallel scraping of ${paths.length} pages with batch size ${batchSize}...`);
    
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      
      // Show progress more frequently to ensure visibility
      const currentBatch = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(paths.length / batchSize);
      if (currentBatch % 5 === 0 || currentBatch === 1 || currentBatch === totalBatches) {
        console.log(`🔄 Processing batch ${currentBatch}/${totalBatches} (${batch.length} pages) - ${processed}/${paths.length} completed`);
      }
      
      // Process batch in parallel
      const promises = batch.map(path => this.scrapePageSafe(path, forceUpdate));
      const results = await Promise.allSettled(promises);
      
      // Count successful results
      results.forEach(result => {
        processed++;
        if (result.status === 'fulfilled') {
          successful++;
        }
      });
      
      // Delay between batches
      if (i + batchSize < paths.length) {
        await this.delay(gitBookConfig.scrapingDelayMs);
      }
    }
    
    console.log(`\n✅ Parallel processing complete: ${successful}/${processed} pages successful`);
  }

  private async scrapePageSafe(path: string, forceUpdate: boolean = false): Promise<void> {
    try {
      await this.scrapePageWithRetry(path, forceUpdate);
    } catch (error) {
      this.handlePageFailure(path, error);
    }
  }

  private async scrapePageWithRetry(path: string, forceUpdate: boolean = false, retryCount: number = 0): Promise<void> {
    try {
      await this.scrapePage(path, forceUpdate);
      
      // Success - remove from failed pages if it was there
      this.failedPages.delete(path);
      
    } catch (error) {
      if (retryCount < gitBookConfig.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
        
        if (gitBookConfig.debug) {
          console.log(`Retrying ${path} in ${delay}ms (attempt ${retryCount + 1}/${gitBookConfig.maxRetries})`);
        }
        
        await this.delay(delay);
        return this.scrapePageWithRetry(path, forceUpdate, retryCount + 1);
      } else {
        // Max retries reached
        throw error;
      }
    }
  }

  private handlePageFailure(path: string, error: unknown): void {
    const currentRetries = this.failedPages.get(path) || 0;
    this.failedPages.set(path, currentRetries + 1);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`Failed to scrape ${path} after ${gitBookConfig.maxRetries} retries: ${errorMessage}`);
    
    // Add to retry queue for later processing
    if (!this.retryQueue.includes(path)) {
      this.retryQueue.push(path);
    }
  }

  private async retryFailedPages(): Promise<void> {
    if (this.retryQueue.length === 0) return;
    
    console.log(`Retrying ${this.retryQueue.length} failed pages...`);
    
    // Process failed pages with reduced concurrency to be more conservative
    const retryBatchSize = Math.max(1, Math.floor(gitBookConfig.maxConcurrentRequests / 2));
    
    for (let i = 0; i < this.retryQueue.length; i += retryBatchSize) {
      const batch = this.retryQueue.slice(i, i + retryBatchSize);
      
      const currentRetryBatch = Math.floor(i / retryBatchSize) + 1;
      console.log(`🔄 Retry batch ${currentRetryBatch}/${Math.ceil(this.retryQueue.length / retryBatchSize)} (${batch.length} pages)`);
      
      const promises = batch.map(path => this.scrapePageSafe(path, true));
      await Promise.allSettled(promises);
      
      // Longer delay between retry batches
      if (i + retryBatchSize < this.retryQueue.length) {
        await this.delay(gitBookConfig.scrapingDelayMs * 2);
      }
    }
    
    // Clear retry queue after processing
    if (this.retryQueue.length > 0) {
      console.log(`\n✅ Retry processing complete`);
    }
    this.retryQueue = [];
  }

  getFailureStats(): { failedPages: string[]; totalRetries: number } {
    const failedPages = Array.from(this.failedPages.keys());
    const totalRetries = Array.from(this.failedPages.values()).reduce((sum, count) => sum + count, 0);
    
    return { failedPages, totalRetries };
  }

  private calculateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private getDiscoveryCacheFile(): string {
    return this.cacheFile.replace('.json', '-discovery.json');
  }

  private async loadDiscoveryCache(): Promise<boolean> {
    try {
      const discoveryCacheFile = this.getDiscoveryCacheFile();
      const data = await fs.readFile(discoveryCacheFile, 'utf-8');
      const cached = JSON.parse(data);
      
      // Check if discovery cache is still valid (1 hour TTL for discovery)
      const cacheAge = Date.now() - new Date(cached.timestamp).getTime();
      const discoveryTtlMs = 60 * 60 * 1000; // 1 hour
      
      if (cacheAge < discoveryTtlMs && cached.discoveredUrls && cached.discoveredUrls.length > 0) {
        this.discoveredUrls = new Set(cached.discoveredUrls);
        return true;
      }
    } catch (error) {
      // Cache file doesn't exist or is invalid
    }
    return false;
  }

  private async saveDiscoveryCache(): Promise<void> {
    try {
      const discoveryCacheFile = this.getDiscoveryCacheFile();
      const cacheData = {
        timestamp: new Date().toISOString(),
        discoveredUrls: Array.from(this.discoveredUrls),
        baseUrl: this.baseUrl
      };
      await fs.writeFile(discoveryCacheFile, JSON.stringify(cacheData, null, 2));
      console.log(`💾 Saved discovery cache with ${this.discoveredUrls.size} URLs`);
    } catch (error) {
      console.log('Failed to save discovery cache:', error);
    }
  }

  getContent(): GitBookContent {
    return this.content;
  }

  getPage(path: string): GitBookPage | undefined {
    return this.content[path];
  }

  searchContent(query: string): GitBookPage[] {
    const results: GitBookPage[] = [];
    const queryLower = query.toLowerCase();
    
    for (const page of Object.values(this.content)) {
      const titleMatch = page.title.toLowerCase().includes(queryLower);
      const contentMatch = page.content.toLowerCase().includes(queryLower);
      
      if (titleMatch || contentMatch) {
        results.push(page);
      }
    }
    
    // Sort by relevance (title matches first, then by content length)
    return results.sort((a, b) => {
      const aTitle = a.title.toLowerCase().includes(queryLower);
      const bTitle = b.title.toLowerCase().includes(queryLower);
      
      if (aTitle && !bTitle) return -1;
      if (!aTitle && bTitle) return 1;
      
      return a.title.localeCompare(b.title);
    });
  }
}