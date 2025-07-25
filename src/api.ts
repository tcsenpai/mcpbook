#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { GitBookScraper } from './scraper.js';
import { ContentStore } from './store.js';
import { gitBookConfig, validateConfig } from './config.js';
import { DomainDetector, DomainInfo } from './domainDetector.js';

export class GitBookRestAPI {
  private app: express.Application;
  private scraper: GitBookScraper;
  private store: ContentStore;
  private domainInfo: DomainInfo;
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();
    this.scraper = new GitBookScraper(gitBookConfig.gitbookUrl);
    this.store = new ContentStore();
    
    // Initialize with default domain info
    this.domainInfo = {
      name: gitBookConfig.serverName,
      description: gitBookConfig.serverDescription,
      keywords: gitBookConfig.domainKeywords,
      toolPrefix: gitBookConfig.toolPrefix
    };
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // API info
    this.app.get('/api', (req, res) => {
      res.json({
        name: this.domainInfo.name,
        description: this.domainInfo.description,
        version: gitBookConfig.serverVersion,
        endpoints: {
          search: '/api/search?q=query',
          page: '/api/page/:path',
          sections: '/api/sections',
          sectionPages: '/api/sections/:section/pages',
          codeBlocks: '/api/page/:path/code',
          markdown: '/api/page/:path/markdown',
          refresh: '/api/refresh',
          status: '/api/status'
        }
      });
    });

    // Search content
    this.app.get('/api/search', async (req, res) => {
      try {
        const query = req.query.q as string;
        if (!query) {
          return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = parseInt(req.query.offset as string) || 0;
        
        const results = await (this.store as any).searchContent(query, limit, offset);
        const totalResults = await (this.store as any).searchContentCount ? 
          await (this.store as any).searchContentCount(query) : 
          results.length;

        res.json({
          query,
          results,
          pagination: {
            total: totalResults,
            limit,
            offset,
            hasMore: offset + limit < totalResults,
            nextOffset: offset + limit < totalResults ? offset + limit : null
          }
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Search failed', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get specific page
    this.app.get('/api/page/*', async (req, res) => {
      try {
        const path = '/' + (req.params as any)[0];
        const page = await this.store.getPage(path);
        
        if (!page) {
          return res.status(404).json({ error: 'Page not found', path });
        }

        res.json(page);
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to get page', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get page markdown
    this.app.get('/api/page/*/markdown', async (req, res) => {
      try {
        const path = '/' + (req.params as any)[0].replace('/markdown', '');
        const page = await this.store.getPage(path);
        
        if (!page) {
          return res.status(404).json({ error: 'Page not found', path });
        }

        res.json({
          page: {
            title: page.title,
            path: page.path,
            section: page.section,
            subsection: page.subsection
          },
          markdown: page.markdown,
          metadata: {
            markdownLength: page.markdown.length,
            markdownLines: page.markdown.split('\n').length,
            hasCodeBlocks: page.codeBlocks.length > 0,
            codeBlockCount: page.codeBlocks.length
          }
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to get markdown', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get page code blocks
    this.app.get('/api/page/*/code', async (req, res) => {
      try {
        const path = '/' + (req.params as any)[0].replace('/code', '');
        const page = await this.store.getPage(path);
        
        if (!page) {
          return res.status(404).json({ error: 'Page not found', path });
        }

        res.json({
          page: {
            title: page.title,
            path: page.path,
            section: page.section
          },
          codeBlocks: page.codeBlocks.map((block, index) => ({
            index: index + 1,
            language: block.language,
            title: block.title,
            lineNumbers: block.lineNumbers,
            code: block.code,
            codeLength: block.code.length,
            lineCount: block.code.split('\n').length
          })),
          summary: {
            totalBlocks: page.codeBlocks.length,
            languages: [...new Set(page.codeBlocks.map(b => b.language))],
            totalLines: page.codeBlocks.reduce((sum, b) => sum + b.code.split('\n').length, 0)
          }
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to get code blocks', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // List sections
    this.app.get('/api/sections', async (req, res) => {
      try {
        const sections = await this.store.listSections();
        res.json({
          sections: Object.keys(sections).length,
          data: sections
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to list sections', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get section pages
    this.app.get('/api/sections/:section/pages', async (req, res) => {
      try {
        const section = req.params.section;
        const pages = await this.store.getSectionPages(section);
        
        res.json({
          section,
          pages: pages.length,
          data: pages
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to get section pages', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Refresh content
    this.app.post('/api/refresh', async (req, res) => {
      try {
        await this.scraper.scrapeAll();
        const content = this.scraper.getContent();
        await this.store.updateContent(content);
        
        const failureStats = this.scraper.getFailureStats();
        
        res.json({
          success: true,
          timestamp: new Date().toISOString(),
          refreshed: Object.keys(content).length,
          failures: failureStats.failedPages.length,
          failedPages: failureStats.failedPages,
          totalRetries: failureStats.totalRetries
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to refresh content', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Get status
    this.app.get('/api/status', async (req, res) => {
      try {
        const stats = this.store.getStats();
        const failureStats = this.scraper.getFailureStats();
        
        res.json({
          server: {
            name: this.domainInfo.name,
            description: this.domainInfo.description,
            version: gitBookConfig.serverVersion,
            url: gitBookConfig.gitbookUrl,
            uptime: process.uptime()
          },
          content: {
            totalPages: stats.totalPages,
            sections: stats.sections,
            lastUpdated: stats.lastUpdated,
            avgContentAgeHours: stats.avgContentAge
          },
          failures: {
            failedPages: failureStats.failedPages,
            totalFailures: failureStats.failedPages.length,
            totalRetries: failureStats.totalRetries
          },
          config: {
            cacheFile: gitBookConfig.cacheFile,
            cacheTtlHours: gitBookConfig.cacheTtlHours,
            maxRetries: gitBookConfig.maxRetries,
            maxConcurrentRequests: gitBookConfig.maxConcurrentRequests,
            scrapingDelayMs: gitBookConfig.scrapingDelayMs
          }
        });
      } catch (error) {
        res.status(500).json({ 
          error: 'Failed to get status', 
          details: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ 
        error: 'Endpoint not found', 
        path: req.path,
        availableEndpoints: [
          '/health',
          '/api',
          '/api/search?q=query',
          '/api/page/:path',
          '/api/page/:path/markdown',
          '/api/page/:path/code',
          '/api/sections',
          '/api/sections/:section/pages',
          '/api/refresh',
          '/api/status'
        ]
      });
    });
  }

  async start(): Promise<void> {
    // Validate configuration
    validateConfig();
    
    // Initial content load
    console.log('Loading initial content...');
    await this.scraper.scrapeAll();
    const content = this.scraper.getContent();
    await this.store.updateContent(content);
    
    // Detect domain after content is loaded
    this.domainInfo = DomainDetector.detectDomain(content);
    
    // Start server
    this.app.listen(this.port, () => {
      console.log(`GitBook REST API v${gitBookConfig.serverVersion} running on port ${this.port}`);
      console.log(`Source: ${gitBookConfig.gitbookUrl}`);
      console.log(`Domain: ${this.domainInfo.description}`);
      console.log(`Loaded ${Object.keys(content).length} pages`);
      console.log(`\nAPI endpoints:`);
      console.log(`  Health: http://localhost:${this.port}/health`);
      console.log(`  API info: http://localhost:${this.port}/api`);
      console.log(`  Search: http://localhost:${this.port}/api/search?q=query`);
      console.log(`  Status: http://localhost:${this.port}/api/status`);
    });
  }
}

// CLI usage
if (require.main === module) {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const api = new GitBookRestAPI(port);
  api.start().catch(console.error);
}