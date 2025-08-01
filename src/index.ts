#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GitBookScraper } from './scraper.js';
import { ContentStore } from './store.js';
import { SQLiteStore } from './sqliteStore.js';
import { gitBookConfig, validateConfig, logConfig, getCacheFilePath } from './config.js';
import { DomainDetector, DomainInfo } from './domainDetector.js';

class GitBookMCPServer {
  private server: Server;
  private scraper: GitBookScraper;
  private store: SQLiteStore;
  private domainInfo: DomainInfo;

  constructor() {
    // Validate configuration
    validateConfig();
    
    // Initialize with default domain info (will be updated after scraping)
    this.domainInfo = {
      name: gitBookConfig.serverName,
      description: gitBookConfig.serverDescription,
      keywords: gitBookConfig.domainKeywords,
      toolPrefix: gitBookConfig.toolPrefix
    };
    
    this.server = new Server(
      {
        name: this.domainInfo.name,
        version: gitBookConfig.serverVersion,
      },
      {
        capabilities: {
          tools: {
            listChanged: true
          },
          prompts: {
            listChanged: true
          }
        }
      }
    );

    this.scraper = new GitBookScraper(gitBookConfig.gitbookUrl);
    this.store = new SQLiteStore(gitBookConfig.gitbookUrl);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: `${this.domainInfo.toolPrefix}search_content`,
            description: `Search across all ${this.domainInfo.description} for ${this.domainInfo.keywords.slice(0, 5).join(', ')}`,
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 20, max: 100)',
                  minimum: 1,
                  maximum: 100,
                },
                offset: {
                  type: 'number',
                  description: 'Number of results to skip for pagination (default: 0)',
                  minimum: 0,
                },
              },
              required: ['query'],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_page`,
            description: `Get a specific page from ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Page path (e.g., "/sdk/websdk")',
                },
              },
              required: ['path'],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}list_sections`,
            description: `Get the table of contents for ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_section_pages`,
            description: `Get all pages in a specific section of ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  description: 'Section name (e.g., "SDK", "Backend")',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of pages to return (default: 50, max: 200)',
                  minimum: 1,
                  maximum: 200,
                },
                offset: {
                  type: 'number',
                  description: 'Number of pages to skip for pagination (default: 0)',
                  minimum: 0,
                },
              },
              required: ['section'],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}refresh_content`,
            description: `Refresh cached content from ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_status`,
            description: `Get server status including failed pages and retry statistics`,
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_code_blocks`,
            description: `Extract all code blocks from a specific page with syntax highlighting`,
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Page path (e.g., "/api/authentication")',
                },
              },
              required: ['path'],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_markdown`,
            description: `Get the markdown content of a specific page with preserved formatting`,
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Page path (e.g., "/api/authentication")',
                },
              },
              required: ['path'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: 'explain_section',
            description: 'Explain a GitBook section as a comprehensive tutorial',
            arguments: [
              {
                name: 'section',
                description: 'Section name (e.g., "SDK", "Backend")',
                required: true,
              },
            ],
          },
          {
            name: 'summarize_page',
            description: 'Create a concise summary of a specific GitBook page',
            arguments: [
              {
                name: 'path',
                description: 'Page path (e.g., "/sdk/websdk/authentication")',
                required: true,
              },
            ],
          },
          {
            name: 'compare_sections',
            description: 'Compare and contrast two GitBook sections',
            arguments: [
              {
                name: 'section1',
                description: 'First section name',
                required: true,
              },
              {
                name: 'section2',
                description: 'Second section name',
                required: true,
              },
            ],
          },
          {
            name: 'api_reference',
            description: 'Format GitBook content as API reference documentation',
            arguments: [
              {
                name: 'query',
                description: 'Search query for API-related content',
                required: true,
              },
            ],
          },
          {
            name: 'quick_start_guide',
            description: 'Generate a quick start guide from GitBook content',
            arguments: [
              {
                name: 'topic',
                description: 'Topic to create quick start for',
                required: true,
              },
            ],
          },
        ],
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'explain_section':
            return await this.getExplainSectionPrompt(args as { section: string });
          case 'summarize_page':
            return await this.getSummarizePagePrompt(args as { path: string });
          case 'compare_sections':
            return await this.getCompareSectionsPrompt(args as { section1: string; section2: string });
          case 'api_reference':
            return await this.getApiReferencePrompt(args as { query: string });
          case 'quick_start_guide':
            return await this.getQuickStartPrompt(args as { topic: string });
          default:
            throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error generating prompt ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Remove prefix for internal handling
        const baseName = name.replace(this.domainInfo.toolPrefix, '');
        
        switch (baseName) {
          case 'search_content':
            return await this.handleSearchContent(args as { query: string; limit?: number; offset?: number });
          case 'get_page':
            return await this.handleGetPage(args as { path: string });
          case 'list_sections':
            return await this.handleListSections();
          case 'get_section_pages':
            return await this.handleGetSectionPages(args as { section: string; limit?: number; offset?: number });
          case 'refresh_content':
            return await this.handleRefreshContent();
          case 'get_status':
            return await this.handleGetStatus();
          case 'get_code_blocks':
            return await this.handleGetCodeBlocks(args as { path: string });
          case 'get_markdown':
            return await this.handleGetMarkdown(args as { path: string });
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async handleSearchContent(args: { query: string; limit?: number; offset?: number }) {
    const limit = Math.min(args.limit || 20, 100); // Cap at 100
    const offset = args.offset || 0;
    
    // Use efficient database-level pagination
    const results = await (this.store as any).searchContent(args.query, limit, offset);
    const totalResults = await (this.store as any).searchContentCount ? 
      await (this.store as any).searchContentCount(args.query) : 
      results.length; // Fallback for stores without count method
    
    const response = {
      results,
      pagination: {
        total: totalResults,
        limit,
        offset,
        hasMore: offset + limit < totalResults,
        nextOffset: offset + limit < totalResults ? offset + limit : null
      }
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async handleGetPage(args: { path: string }) {
    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(page, null, 2),
        },
      ],
    };
  }

  private async handleListSections() {
    const sections = await this.store.listSections();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(sections, null, 2),
        },
      ],
    };
  }

  private async handleGetSectionPages(args: { section: string; limit?: number; offset?: number }) {
    const limit = Math.min(args.limit || 50, 200); // Cap at 200
    const offset = args.offset || 0;
    
    const allPages = await this.store.getSectionPages(args.section);
    const totalPages = allPages.length;
    
    // Apply pagination
    const paginatedPages = allPages.slice(offset, offset + limit);
    
    const response = {
      section: args.section,
      pages: paginatedPages,
      pagination: {
        total: totalPages,
        limit,
        offset,
        hasMore: offset + limit < totalPages,
        nextOffset: offset + limit < totalPages ? offset + limit : null
      }
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async handleRefreshContent() {
    await this.scraper.scrapeAll();
    const content = this.scraper.getContent();
    await this.store.updateContent(content);
    
    const failureStats = this.scraper.getFailureStats();
    let message = `Refreshed ${Object.keys(content).length} pages`;
    
    if (failureStats.failedPages.length > 0) {
      message += `\n\nWarning: ${failureStats.failedPages.length} pages failed to scrape:`;
      failureStats.failedPages.forEach(path => {
        message += `\n- ${path}`;
      });
      message += `\n\nTotal retries attempted: ${failureStats.totalRetries}`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
    };
  }

  private async handleGetStatus() {
    const stats = await this.store.getStats();
    const failureStats = this.scraper.getFailureStats();
    
    const status = {
      server: {
        name: this.domainInfo.name,
        description: this.domainInfo.description,
        version: gitBookConfig.serverVersion,
        url: gitBookConfig.gitbookUrl
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
      cache: {
        file: gitBookConfig.cacheFile,
        ttlHours: gitBookConfig.cacheTtlHours
      },
      config: {
        maxRetries: gitBookConfig.maxRetries,
        maxConcurrentRequests: gitBookConfig.maxConcurrentRequests,
        scrapingDelayMs: gitBookConfig.scrapingDelayMs
      }
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  }

  private async handleGetCodeBlocks(args: { path: string }) {
    if (!args.path || typeof args.path !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Path parameter is required and must be a string');
    }

    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }

    const response = {
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
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async handleGetMarkdown(args: { path: string }) {
    if (!args.path || typeof args.path !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Path parameter is required and must be a string');
    }

    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }

    const response = {
      page: {
        title: page.title,
        path: page.path,
        section: page.section,
        subsection: page.subsection,
        url: page.url,
        lastUpdated: page.lastUpdated
      },
      markdown: page.markdown,
      metadata: {
        markdownLength: page.markdown.length,
        markdownLines: page.markdown.split('\n').length,
        hasCodeBlocks: page.codeBlocks.length > 0,
        codeBlockCount: page.codeBlocks.length
      }
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  private async getExplainSectionPrompt(args: { section: string }) {
    if (!args.section || typeof args.section !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Section parameter is required and must be a string');
    }

    const pages = await this.store.getSectionPages(args.section);
    if (pages.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, `Section not found: ${args.section}`);
    }

    const pageList = pages.map(p => `- ${p.title || 'Untitled'} (${p.path})`).join('\n');
    
    return {
      description: `Tutorial explanation for ${args.section} section`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text',
            text: `Please explain the "${args.section}" section of the GitBook as a comprehensive tutorial. This section contains the following pages:

${pageList}

Structure your explanation as:
1. Overview of what this section covers
2. Key concepts and terminology
3. Step-by-step walkthrough of main topics
4. Practical examples where applicable
5. Common gotchas or important notes

Make it beginner-friendly but comprehensive. Use the actual content from these pages to provide accurate information.`,
          },
        },
      ],
    };
  }

  private async getSummarizePagePrompt(args: { path: string }) {
    if (!args.path || typeof args.path !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Path parameter is required and must be a string');
    }

    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }

    return {
      description: `Summary of page: ${page.title}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text',
            text: `Please create a concise summary of this GitBook page:

**Title:** ${page.title}
**Section:** ${page.section}
**Path:** ${page.path}

**Content:**
${page.content}

Provide:
1. A 2-3 sentence overview
2. Key points (bullet format)
3. Main takeaways
4. Any important links or references mentioned

Keep it concise but informative.`,
          },
        },
      ],
    };
  }

  private async getCompareSectionsPrompt(args: { section1: string; section2: string }) {
    if (!args.section1 || typeof args.section1 !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Section1 parameter is required and must be a string');
    }
    if (!args.section2 || typeof args.section2 !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Section2 parameter is required and must be a string');
    }

    const section1Pages = await this.store.getSectionPages(args.section1);
    const section2Pages = await this.store.getSectionPages(args.section2);

    if (section1Pages.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, `Section not found: ${args.section1}`);
    }
    if (section2Pages.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, `Section not found: ${args.section2}`);
    }

    const section1List = section1Pages.map(p => `- ${p.title || 'Untitled'}`).join('\n');
    const section2List = section2Pages.map(p => `- ${p.title || 'Untitled'}`).join('\n');

    return {
      description: `Comparison between ${args.section1} and ${args.section2} sections`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text',
            text: `Please compare and contrast these two GitBook sections:

**${args.section1} Section:**
${section1List}

**${args.section2} Section:**
${section2List}

Please provide:
1. Purpose and scope of each section
2. Key similarities between the sections
3. Important differences and unique aspects
4. How they relate to each other (if applicable)
5. When to use information from each section

Use the actual content from both sections to make accurate comparisons.`,
          },
        },
      ],
    };
  }

  private async getApiReferencePrompt(args: { query: string }) {
    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Query parameter is required and must be a string');
    }

    const searchResults = await this.store.searchContent(args.query);
    
    if (searchResults.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, `No content found for query: ${args.query}`);
    }

    const relevantPages = searchResults.slice(0, 5).map(result => 
      `**${result.page.title || 'Untitled'}** (${result.page.path})\n${result.snippet || 'No snippet available'}`
    ).join('\n\n');

    return {
      description: `API reference for: ${args.query}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text',
            text: `Please format the following GitBook content as comprehensive API reference documentation for "${args.query}":

${relevantPages}

Structure as API reference with:
1. Overview/Description
2. Parameters (if applicable)
3. Return values/Response format
4. Usage examples
5. Error codes/handling
6. Related endpoints/methods

If the content isn't strictly API-related, adapt it to be as reference-like as possible with clear, structured information.`,
          },
        },
      ],
    };
  }

  private async getQuickStartPrompt(args: { topic: string }) {
    if (!args.topic || typeof args.topic !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'Topic parameter is required and must be a string');
    }

    const searchResults = await this.store.searchContent(args.topic);
    
    if (searchResults.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, `No content found for topic: ${args.topic}`);
    }

    const relevantContent = searchResults.slice(0, 3).map(result => 
      `From "${result.page.title || 'Untitled'}":\n${result.snippet || 'No snippet available'}`
    ).join('\n\n');

    return {
      description: `Quick start guide for: ${args.topic}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text',
            text: `Create a quick start guide for "${args.topic}" based on this GitBook content:

${relevantContent}

Format as a quick start guide with:
1. Prerequisites
2. Installation/Setup (if applicable)
3. Basic usage in 5 minutes or less
4. Essential commands/steps
5. Next steps/where to learn more

Keep it focused on getting someone up and running quickly. Use actual examples from the content where possible.`,
          },
        },
      ],
    };
  }

  async run() {
    // Log configuration
    logConfig();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Try to migrate from JSON cache first
    const jsonCachePath = getCacheFilePath(gitBookConfig.gitbookUrl).replace('.db', '.json');
    await this.store.importFromJson(jsonCachePath);
    
    // Check if we have content or need to scrape
    const pageCount = await this.store.getPageCount();
    if (pageCount === 0) {
      console.error('No cached content found, running initial scrape...');
      await this.scraper.scrapeAll();
      const content = this.scraper.getContent();
      await this.store.updateContent(content);
      
      // Detect domain after initial scraping
      this.domainInfo = DomainDetector.detectDomain(content, gitBookConfig.gitbookUrl);
      // Cache domain info for future startups
      this.store.setDomainInfo(this.domainInfo);
    } else {
      console.error(`Loaded ${pageCount} pages from SQLite cache`);
      
      // Try to load cached domain info first (fast)
      const cachedDomainInfo = this.store.getDomainInfo();
      if (cachedDomainInfo) {
        this.domainInfo = cachedDomainInfo;
        console.error('Using cached domain info for instant startup');
      } else {
        // Fallback: use sample pages for domain detection (much faster than all pages)
        console.error('No cached domain info, detecting from sample pages...');
        const samplePages = await this.store.getSamplePages(20);
        const sampleContent = samplePages.reduce((acc, page) => {
          acc[page.path] = page;
          return acc;
        }, {} as any);
        this.domainInfo = DomainDetector.detectDomain(sampleContent, gitBookConfig.gitbookUrl);
        // Cache the detected domain info for next startup
        this.store.setDomainInfo(this.domainInfo);
      }
      
      // Run background update check (non-blocking)
      this.checkForUpdatesBackground();
    }
    
    console.error(`${this.domainInfo.name} v${gitBookConfig.serverVersion} running on stdio`);
    console.error(`Loaded content from: ${gitBookConfig.gitbookUrl}`);
    console.error(`Detected domain: ${this.domainInfo.description}`);
    console.error(`Keywords: ${this.domainInfo.keywords.join(', ')}`);
  }

  private async checkForUpdatesBackground(): Promise<void> {
    // Run update check in background, don't block startup
    setTimeout(async () => {
      try {
        console.error('🔄 Running background update check...');
        
        // Check if cache is fresh enough to skip update
        const lastUpdated = this.store.getMetadata('last_updated');
        if (lastUpdated) {
          const hoursSinceUpdate = (Date.now() - parseInt(lastUpdated)) / (1000 * 60 * 60);
          if (hoursSinceUpdate < gitBookConfig.cacheTtlHours) {
            console.error(`✅ Cache is fresh (${hoursSinceUpdate.toFixed(1)}h old), skipping update`);
            return;
          }
        }
        
        console.error('📖 Checking for content updates...');
        await this.scraper.scrapeAll();
        const content = this.scraper.getContent();
        const pageCount = Object.keys(content).length;
        
        if (pageCount > 0) {
          await this.store.updateContent(content);
          const failureStats = this.scraper.getFailureStats();
          
          if (failureStats.failedPages.length > 0) {
            console.error(`✅ Background update completed: ${pageCount} pages updated, ${failureStats.failedPages.length} failures`);
          } else {
            console.error(`✅ Background update completed: ${pageCount} pages updated successfully`);
          }
        } else {
          console.error('⚠️  Background update completed but no content was found');
        }
      } catch (error) {
        console.error(`❌ Background update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 1000); // 1 second delay to ensure server is fully started
  }
}

// Check command line arguments for transport type
const args = process.argv.slice(2);
const useHttp = args.includes('--http') || args.includes('--streamable-http');
const httpPort = args.find(arg => arg.startsWith('--port='))?.split('=')[1];

if (useHttp) {
  // Use StreamableHTTP transport
  import('./httpServer.js').then(({ GitBookMCPHttpServer }) => {
    const port = httpPort ? parseInt(httpPort) : (process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : 3001);
    const httpServer = new GitBookMCPHttpServer();
    httpServer.run(port).catch(console.error);
  });
} else {
  // Use stdio transport (default)
  const server = new GitBookMCPServer();
  server.run().catch(console.error);
}