#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GitBookScraper } from './scraper.js';
import { SQLiteStore } from './sqliteStore.js';
import { gitBookConfig, validateConfig, logConfig, getCacheFilePath } from './config.js';
import { DomainDetector, DomainInfo } from './domainDetector.js';

class GitBookMCPHttpServer {
  private server: Server;
  private scraper: GitBookScraper;
  private store: SQLiteStore;
  private domainInfo: DomainInfo;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  constructor() {
    // Validate configuration
    validateConfig();
    
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
            description: `Search across all ${this.domainInfo.name} content with advanced fuzzy matching and ranking`,
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query - supports partial matches, stemming, and fuzzy search"
                }
              },
              required: ["query"]
            }
          },
          {
            name: `${this.domainInfo.toolPrefix}get_page`,
            description: `Get a specific page from ${this.domainInfo.name} by path`,
            inputSchema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Page path (e.g., '/api/authentication' or '/sdk/quickstart')"
                }
              },
              required: ["path"]
            }
          },
          {
            name: `${this.domainInfo.toolPrefix}list_sections`,
            description: `Get the table of contents for ${this.domainInfo.name}`,
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: `${this.domainInfo.toolPrefix}get_section_pages`,
            description: `Get all pages in a specific section of ${this.domainInfo.name}`,
            inputSchema: {
              type: "object",
              properties: {
                section: {
                  type: "string",
                  description: "Section name (e.g., 'API Reference' or 'Getting Started')"
                }
              },
              required: ["section"]
            }
          },
          {
            name: `${this.domainInfo.toolPrefix}refresh_content`,
            description: `Force refresh the cached content from ${this.domainInfo.name}`,
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: `${this.domainInfo.toolPrefix}get_code_blocks`,
            description: `Extract all code blocks from a specific page with syntax highlighting`,
            inputSchema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Page path (e.g., '/api/authentication')"
                }
              },
              required: ["path"]
            }
          },
          {
            name: `${this.domainInfo.toolPrefix}get_markdown`,
            description: `Get a page's content formatted as clean markdown`,
            inputSchema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Page path (e.g., '/api/authentication')"
                }
              },
              required: ["path"]
            }
          }
        ]
      };
    });

    // Add the same tool handlers as the stdio version
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case `${this.domainInfo.toolPrefix}search_content`:
            return await this.handleSearchContent(args);
          case `${this.domainInfo.toolPrefix}get_page`:
            return await this.handleGetPage(args);
          case `${this.domainInfo.toolPrefix}list_sections`:
            return await this.handleListSections();
          case `${this.domainInfo.toolPrefix}get_section_pages`:
            return await this.handleGetSectionPages(args);
          case `${this.domainInfo.toolPrefix}refresh_content`:
            return await this.handleRefreshContent();
          case `${this.domainInfo.toolPrefix}get_code_blocks`:
            return await this.handleGetCodeBlocks(args);
          case `${this.domainInfo.toolPrefix}get_markdown`:
            return await this.handleGetMarkdown(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    // Add prompt handlers (same as stdio version)
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: [
          {
            name: "explain_section",
            description: `Generate a comprehensive explanation or tutorial for a specific section of ${this.domainInfo.name}`,
            arguments: [
              {
                name: "section",
                description: "The section name to explain",
                required: true
              }
            ]
          },
          {
            name: "summarize_page", 
            description: `Create a concise summary of a specific page from ${this.domainInfo.name}`,
            arguments: [
              {
                name: "path",
                description: "The page path to summarize",
                required: true
              }
            ]
          },
          {
            name: "compare_sections",
            description: `Compare and contrast different sections of ${this.domainInfo.name}`,
            arguments: [
              {
                name: "section1",
                description: "First section to compare",
                required: true
              },
              {
                name: "section2", 
                description: "Second section to compare",
                required: true
              }
            ]
          },
          {
            name: "api_reference",
            description: `Format content from ${this.domainInfo.name} as a structured API reference`,
            arguments: [
              {
                name: "path",
                description: "The page path containing API information",
                required: true
              }
            ]
          },
          {
            name: "quick_start_guide",
            description: `Generate a quick start guide based on ${this.domainInfo.name} content`,
            arguments: [
              {
                name: "topic",
                description: "The topic or feature to create a quick start guide for",
                required: true
              }
            ]
          }
        ]
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      switch (name) {
        case "explain_section":
          return await this.handleExplainSection(args);
        case "summarize_page":
          return await this.handleSummarizePage(args);
        case "compare_sections":
          return await this.handleCompareSections(args);
        case "api_reference":
          return await this.handleApiReference(args);
        case "quick_start_guide":
          return await this.handleQuickStartGuide(args);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown prompt: ${name}`
          );
      }
    });
  }

  // Tool handler methods (copy from index.ts but simplified)
  private async handleSearchContent(args: any) {
    const { query } = args;
    if (!query || typeof query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Query is required and must be a string");
    }

    const results = await this.store.search(query, 20);
    const totalResults = results.length;

    return {
      content: [
        {
          type: "text",
          text: `Found ${totalResults} result${totalResults !== 1 ? 's' : ''} for "${query}":\n\n` +
                results.map((result, index) => 
                  `${index + 1}. **${result.page.title}** (Score: ${result.score.toFixed(2)})\n` +
                  `   Path: ${result.page.path}\n` +
                  `   Section: ${result.page.section}\n` +
                  `   Snippet: ${result.snippet}\n`
                ).join('\n')
        }
      ]
    };
  }

  private async handleGetPage(args: any) {
    const { path } = args;
    if (!path || typeof path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Path is required and must be a string");
    }

    const page = await this.store.getPage(path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidParams, `Page not found: ${path}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `# ${page.title}\n\n**Section:** ${page.section}\n**URL:** ${page.url}\n\n${page.content}`
        }
      ]
    };
  }

  private async handleListSections() {
    const sections = await this.store.getSections();
    return {
      content: [
        {
          type: "text",
          text: `Available sections in ${this.domainInfo.name}:\n\n` +
                sections.map((section, index) => `${index + 1}. ${section}`).join('\n')
        }
      ]
    };
  }

  private async handleGetSectionPages(args: any) {
    const { section } = args;
    if (!section || typeof section !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Section is required and must be a string");
    }

    const pages = await this.store.getPagesBySection(section);
    if (pages.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, `No pages found in section: ${section}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `Pages in section "${section}":\n\n` +
                pages.map((page, index) => 
                  `${index + 1}. **${page.title}**\n   Path: ${page.path}\n   URL: ${page.url}\n`
                ).join('\n')
        }
      ]
    };
  }

  private async handleRefreshContent() {
    await this.scraper.scrapeAll();
    const content = this.scraper.getContent();
    await this.store.updateContent(content);
    
    const stats = await this.store.getStats();
    return {
      content: [
        {
          type: "text",
          text: `Content refreshed successfully!\n\nStats:\n- Total pages: ${stats.totalPages}\n- Last updated: ${stats.lastUpdated}`
        }
      ]
    };
  }

  private async handleGetCodeBlocks(args: any) {
    const { path } = args;
    if (!path || typeof path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Path is required and must be a string");
    }

    const page = await this.store.getPage(path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidParams, `Page not found: ${path}`);
    }

    if (page.codeBlocks.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No code blocks found in page: ${path}`
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Code blocks from "${page.title}":\n\n` +
                page.codeBlocks.map((block, index) => 
                  `**Block ${index + 1}** (${block.language})${block.title ? ` - ${block.title}` : ''}:\n\`\`\`${block.language}\n${block.code}\n\`\`\`\n`
                ).join('\n')
        }
      ]
    };
  }

  private async handleGetMarkdown(args: any) {
    const { path } = args;
    if (!path || typeof path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Path is required and must be a string");
    }

    const page = await this.store.getPage(path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidParams, `Page not found: ${path}`);
    }

    return {
      content: [
        {
          type: "text",
          text: page.markdown
        }
      ]
    };
  }

  // Simplified prompt handlers
  private async handleExplainSection(args: any) {
    const { section } = args;
    const pages = await this.store.getPagesBySection(section);
    
    return {
      description: `Comprehensive explanation of the ${section} section`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Based on the ${this.domainInfo.name} documentation, provide a comprehensive explanation and tutorial for the "${section}" section. Here are the pages in this section:\n\n` +
                  pages.map(p => `- ${p.title} (${p.path}): ${p.content.substring(0, 200)}...`).join('\n\n')
          }
        }
      ]
    };
  }

  private async handleSummarizePage(args: any) {
    const { path } = args;
    const page = await this.store.getPage(path);
    
    if (!page) {
      throw new McpError(ErrorCode.InvalidParams, `Page not found: ${path}`);
    }

    return {
      description: `Summary of ${page.title}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a concise summary of this page from ${this.domainInfo.name}:\n\n**${page.title}**\n\n${page.content}`
          }
        }
      ]
    };
  }

  private async handleCompareSections(args: any) {
    const { section1, section2 } = args;
    const pages1 = await this.store.getPagesBySection(section1);
    const pages2 = await this.store.getPagesBySection(section2);

    return {
      description: `Comparison between ${section1} and ${section2} sections`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Compare and contrast these two sections from ${this.domainInfo.name}:\n\n**${section1}:**\n` +
                  pages1.map(p => `- ${p.title}: ${p.content.substring(0, 150)}...`).join('\n') +
                  `\n\n**${section2}:**\n` +
                  pages2.map(p => `- ${p.title}: ${p.content.substring(0, 150)}...`).join('\n')
          }
        }
      ]
    };
  }

  private async handleApiReference(args: any) {
    const { path } = args;
    const page = await this.store.getPage(path);
    
    if (!page) {
      throw new McpError(ErrorCode.InvalidParams, `Page not found: ${path}`);
    }

    return {
      description: `API reference for ${page.title}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Format this content from ${this.domainInfo.name} as a structured API reference with parameters, examples, and usage information:\n\n**${page.title}**\n\n${page.content}`
          }
        }
      ]
    };
  }

  private async handleQuickStartGuide(args: any) {
    const { topic } = args;
    const results = await this.store.search(topic, 10);

    return {
      description: `Quick start guide for ${topic}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Create a quick start guide for "${topic}" based on this content from ${this.domainInfo.name}:\n\n` +
                  results.map(r => `**${r.page.title}**\n${r.page.content.substring(0, 300)}...`).join('\n\n')
          }
        }
      ]
    };
  }

  async run(port: number = 3001) {
    // Initialize content first
    await this.initializeContent();

    // Create Express app
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));

    // MCP StreamableHTTP handler
    const mcpHandler = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      let transport: StreamableHTTPServerTransport;

      try {
        if (sessionId && this.transports[sessionId]) {
          // Existing session
          transport = this.transports[sessionId];
        } else {
          // New session
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId: string) => {
              console.error(`StreamableHTTP session initialized: ${sessionId}`);
              this.transports[sessionId] = transport;
            }
          });

          // Set up cleanup
          transport.onclose = () => {
            const sessionId = Object.keys(this.transports).find(id => this.transports[id] === transport);
            if (sessionId) {
              console.error(`StreamableHTTP session closed: ${sessionId}`);
              delete this.transports[sessionId];
            }
          };

          // Connect to server
          await this.server.connect(transport);
        }

        await transport.handleRequest(req, res);
      } catch (error) {
        console.error('StreamableHTTP error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    };

    app.post('/mcp', mcpHandler);
    app.delete('/mcp', mcpHandler);

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        server: this.domainInfo.name,
        version: gitBookConfig.serverVersion,
        transport: 'StreamableHTTP'
      });
    });

    app.listen(port, () => {
      console.error(`${this.domainInfo.name} v${gitBookConfig.serverVersion} running on StreamableHTTP`);
      console.error(`Server listening on port ${port}`);
      console.error(`Health check: http://localhost:${port}/health`);
      console.error(`MCP endpoint: http://localhost:${port}/mcp`);
      console.error(`Loaded content from: ${gitBookConfig.gitbookUrl}`);
      console.error(`Detected domain: ${this.domainInfo.description}`);
      console.error(`Keywords: ${this.domainInfo.keywords.join(', ')}`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.error('Shutting down StreamableHTTP server...');
      for (const sessionId in this.transports) {
        try {
          await this.transports[sessionId].close();
          delete this.transports[sessionId];
        } catch (error) {
          console.error(`Error closing session ${sessionId}:`, error);
        }
      }
      process.exit(0);
    });
  }

  private async initializeContent(): Promise<void> {
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
    } else {
      console.error(`Loaded ${pageCount} pages from SQLite cache`);
      
      // For cached content, detect domain from stored pages
      const pages = await this.store.getAllPages();
      const content = pages.reduce((acc, page) => {
        acc[page.path] = page;
        return acc;
      }, {} as any);
      this.domainInfo = DomainDetector.detectDomain(content, gitBookConfig.gitbookUrl);
      
      // Run background update check (non-blocking)
      this.checkForUpdatesBackground();
    }
  }

  private async checkForUpdatesBackground(): Promise<void> {
    // Run update check in background, don't block startup
    setTimeout(async () => {
      try {
        console.error('Running background update check...');
        await this.scraper.scrapeAll();
        const content = this.scraper.getContent();
        if (Object.keys(content).length > 0) {
          await this.store.updateContent(content);
          console.error('Background update completed');
        }
      } catch (error) {
        console.error('Background update failed:', error);
      }
    }, 1000);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  const port = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : 3001;
  const server = new GitBookMCPHttpServer();
  server.run(port).catch(console.error);
}

export { GitBookMCPHttpServer };