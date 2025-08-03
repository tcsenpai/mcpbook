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
import { ResponseUtils } from './responseUtils.js';

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
                continuation_token: {
                  type: 'string',
                  description: 'Continuation token for paginated results',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 20, max: 50)',
                  minimum: 1,
                  maximum: 50,
                },
                offset: {
                  type: 'number',
                  description: 'Number of results to skip for pagination (default: 0)',
                  minimum: 0,
                },
              },
              required: [],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_page_section`,
            description: `Get a specific section from a page in ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Page path (e.g., "/sdk/websdk")',
                },
                section: {
                  type: 'string',
                  description: 'Section identifier or heading text',
                },
              },
              required: ['path'],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_page_outline`,
            description: `Get the structure and outline of a specific page in ${this.domainInfo.description}`,
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
            name: `${this.domainInfo.toolPrefix}search_code`,
            description: `Search for code blocks and programming examples in ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for code (language, function, keyword, etc.)',
                },
                language: {
                  type: 'string',
                  description: 'Filter by programming language (e.g., "javascript", "python")',
                },
                path: {
                  type: 'string',
                  description: 'Optional: search within specific page path',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of code blocks to return (default: 10, max: 30)',
                  minimum: 1,
                  maximum: 30,
                },
              },
              required: ['query'],
            },
          },
          {
            name: `${this.domainInfo.toolPrefix}get_related_pages`,
            description: `Find pages related to a specific page or topic in ${this.domainInfo.description}`,
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Page path to find related pages for',
                },
                topic: {
                  type: 'string',
                  description: 'Topic or keyword to find related pages for',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of related pages to return (default: 5, max: 15)',
                  minimum: 1,
                  maximum: 15,
                },
              },
              required: [],
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
            return await this.handleSearchContent(args as { query?: string; continuation_token?: string; limit?: number; offset?: number });
          case 'get_page_section':
            return await this.handleGetPageSection(args as { path: string; section?: string });
          case 'get_page_outline':
            return await this.handleGetPageOutline(args as { path: string });
          case 'get_page':
            return await this.handleGetPage(args as { path: string });
          case 'search_code':
            return await this.handleSearchCode(args as { query: string; language?: string; path?: string; limit?: number });
          case 'get_related_pages':
            return await this.handleGetRelatedPages(args as { path?: string; topic?: string; limit?: number });
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

  private async handleSearchContent(args: { query?: string; continuation_token?: string; limit?: number; offset?: number }) {
    let query: string;
    let limit = Math.min(args.limit || 20, 50); // Reduced default for token safety
    let offset = args.offset || 0;

    // Handle continuation token
    if (args.continuation_token) {
      try {
        const tokenData = ResponseUtils.parseContinuationToken(args.continuation_token);
        query = tokenData.q;
        offset = tokenData.o;
        // Keep the original limit if not overridden
        if (!args.limit) limit = 20;
      } catch (error) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid continuation token: ${error}`);
      }
    } else if (args.query) {
      query = args.query;
    } else {
      throw new McpError(ErrorCode.InvalidRequest, 'Either query or continuation_token is required');
    }
    
    // Use efficient database-level pagination
    const results = await (this.store as any).searchContent(query, limit, offset);
    const totalResults = await (this.store as any).searchContentCount ? 
      await (this.store as any).searchContentCount(query) : 
      results.length; // Fallback for stores without count method
    
    const tokenSafeResponse = ResponseUtils.createSearchResponse(
      results, 
      query, 
      limit, 
      offset, 
      totalResults, 
      this.domainInfo.toolPrefix
    );
    
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
  }

  private async handleGetPageSection(args: { path: string; section?: string }) {
    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }

    let extractedContent: string | undefined;
    
    if (args.section) {
      // Extract specific section from markdown
      extractedContent = this.extractSection(page.markdown || page.content, args.section);
      if (!extractedContent) {
        throw new McpError(ErrorCode.InvalidRequest, `Section not found in page: ${args.section}`);
      }
    }

    const tokenSafeResponse = ResponseUtils.createPageSectionResponse(page, args.section, extractedContent);
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
  }

  private extractSection(content: string, sectionId: string): string | undefined {
    if (!content) return undefined;
    
    // Try to match by heading text or ID
    const lines = content.split('\n');
    let startIndex = -1;
    let endIndex = lines.length;
    let currentLevel = 0;
    
    // Find section start
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        
        // Check if this matches our section
        if (text.toLowerCase().includes(sectionId.toLowerCase()) || 
            id === sectionId.toLowerCase() ||
            sectionId.toLowerCase().includes(text.toLowerCase())) {
          startIndex = i;
          currentLevel = level;
          break;
        }
      }
    }
    
    if (startIndex === -1) return undefined;
    
    // Find section end (next heading of same or higher level)
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+/);
      
      if (headingMatch && headingMatch[1].length <= currentLevel) {
        endIndex = i;
        break;
      }
    }
    
    return lines.slice(startIndex, endIndex).join('\n');
  }

  private async handleGetPageOutline(args: { path: string }) {
    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }

    const tokenSafeResponse = ResponseUtils.createPageOutlineResponse(page);
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
  }

  private async handleGetPage(args: { path: string }) {
    const page = await this.store.getPage(args.path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
    }

    // Use token-safe response formatting
    const tokenSafeResponse = ResponseUtils.createPageSectionResponse(page);
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
  }

  private async handleSearchCode(args: { query: string; language?: string; path?: string; limit?: number }) {
    const limit = Math.min(args.limit || 10, 30);
    let codeResults: any[] = [];

    if (args.path) {
      // Search within specific page
      const page = await this.store.getPage(args.path);
      if (!page) {
        throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
      }
      codeResults = this.searchCodeInPage(page, args.query, args.language);
    } else {
      // Search across all pages
      codeResults = await this.searchCodeGlobally(args.query, limit, args.language);
    }
    
    const limitedResults = codeResults.slice(0, limit);
    
    const response = {
      query: args.query,
      language: args.language,
      path: args.path,
      results: limitedResults,
      summary: {
        total: codeResults.length,
        showing: limitedResults.length,
        languages: [...new Set(limitedResults.map(r => r.language))],
        pages: [...new Set(limitedResults.map(r => r.page.path))]
      }
    };

    const jsonString = JSON.stringify(response, null, 2);
    const estimatedTokens = ResponseUtils.estimateTokens(jsonString);

    return ResponseUtils.formatMcpResponse({
      content: response,
      tokenInfo: {
        estimated: estimatedTokens,
        safe: estimatedTokens < 20000,
        truncated: false
      }
    });
  }

  private searchCodeInPage(page: any, query: string, language?: string): any[] {
    if (!page.codeBlocks || page.codeBlocks.length === 0) return [];
    
    const results: any[] = [];
    const queryLower = query.toLowerCase();
    
    page.codeBlocks.forEach((block: any, index: number) => {
      // Filter by language if specified
      if (language && block.language.toLowerCase() !== language.toLowerCase()) {
        return;
      }
      
      // Search in code content
      const codeLines = block.code.split('\n');
      const matchingLines: { lineNumber: number; line: string }[] = [];
      
      codeLines.forEach((line: string, lineIndex: number) => {
        if (line.toLowerCase().includes(queryLower)) {
          matchingLines.push({
            lineNumber: lineIndex + 1,
            line: line.trim()
          });
        }
      });
      
      // Also check title and language
      const titleMatch = block.title && block.title.toLowerCase().includes(queryLower);
      const languageMatch = block.language.toLowerCase().includes(queryLower);
      
      if (matchingLines.length > 0 || titleMatch || languageMatch) {
        results.push({
          page: {
            title: page.title,
            path: page.path,
            section: page.section
          },
          codeBlock: {
            index: index + 1,
            language: block.language,
            title: block.title,
            lineCount: codeLines.length,
            matches: matchingLines.slice(0, 5), // Limit matches shown
            matchType: titleMatch ? 'title' : languageMatch ? 'language' : 'content',
            preview: codeLines.slice(0, 3).join('\n') + (codeLines.length > 3 ? '\n...' : '')
          }
        });
      }
    });
    
    return results;
  }

  private async searchCodeGlobally(query: string, limit: number, language?: string): Promise<any[]> {
    // This would need to be implemented based on your store's capabilities
    // For now, we'll do a simplified search by getting all pages and searching their code blocks
    const allResults: any[] = [];
    
    try {
      // Get a sample of pages to search (to avoid overwhelming the system)
      const samplePages = await (this.store as any).getSamplePages ? 
        await (this.store as any).getSamplePages(50) : 
        [];
      
      for (const page of samplePages) {
        const pageResults = this.searchCodeInPage(page, query, language);
        allResults.push(...pageResults);
        
        // Early exit if we have enough results
        if (allResults.length >= limit * 2) break;
      }
    } catch (error) {
      console.error('Error in global code search:', error);
    }
    
    // Sort by relevance (matches in title first, then content matches)
    return allResults.sort((a, b) => {
      if (a.codeBlock.matchType === 'title' && b.codeBlock.matchType !== 'title') return -1;
      if (b.codeBlock.matchType === 'title' && a.codeBlock.matchType !== 'title') return 1;
      return b.codeBlock.matches.length - a.codeBlock.matches.length;
    });
  }

  private async handleGetRelatedPages(args: { path?: string; topic?: string; limit?: number }) {
    const limit = Math.min(args.limit || 5, 15);
    let relatedPages: any[] = [];

    if (args.path) {
      // Find pages related to a specific page
      const page = await this.store.getPage(args.path);
      if (!page) {
        throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${args.path}`);
      }
      relatedPages = await this.findRelatedToPage(page, limit);
    } else if (args.topic) {
      // Find pages related to a topic
      relatedPages = await this.findRelatedToTopic(args.topic, limit);
    } else {
      throw new McpError(ErrorCode.InvalidRequest, 'Either path or topic is required');
    }

    const response = {
      relatedTo: args.path ? { type: 'page', path: args.path } : { type: 'topic', topic: args.topic },
      results: relatedPages,
      summary: {
        total: relatedPages.length,
        sections: [...new Set(relatedPages.map(p => p.section))],
        avgRelevanceScore: relatedPages.length > 0 ? 
          relatedPages.reduce((sum, p) => sum + (p.relevanceScore || 0), 0) / relatedPages.length : 0
      }
    };

    const jsonString = JSON.stringify(response, null, 2);
    const estimatedTokens = ResponseUtils.estimateTokens(jsonString);

    return ResponseUtils.formatMcpResponse({
      content: response,
      tokenInfo: {
        estimated: estimatedTokens,
        safe: estimatedTokens < 20000,
        truncated: false
      }
    });
  }

  private async findRelatedToPage(page: any, limit: number): Promise<any[]> {
    const relatedPages: any[] = [];
    
    try {
      // Strategy 1: Pages in the same section
      if (page.section) {
        const sectionPages = await this.store.getSectionPages(page.section);
        sectionPages.forEach(p => {
          if (p.path !== page.path) {
            relatedPages.push({
              ...p,
              relevanceScore: 0.8,
              relationshipType: 'same_section'
            });
          }
        });
      }

      // Strategy 2: Pages with similar titles or content
      const keywords = this.extractKeywords(page.title + ' ' + (page.content || '').substring(0, 500));
      if (keywords.length > 0) {
        const searchResults = await (this.store as any).searchContent ? 
          await (this.store as any).searchContent(keywords.slice(0, 3).join(' '), limit * 2) : [];
        
        searchResults.forEach((result: any) => {
          if (result.page.path !== page.path && !relatedPages.find(p => p.path === result.page.path)) {
            relatedPages.push({
              ...result.page,
              relevanceScore: 0.6,
              relationshipType: 'content_similarity',
              snippet: result.snippet
            });
          }
        });
      }

      // Strategy 3: Pages with similar code languages (if applicable)
      if (page.codeBlocks && page.codeBlocks.length > 0) {
        const languages = [...new Set(page.codeBlocks.map((cb: any) => cb.language))];
        // This would require a more sophisticated search - simplified for now
      }

    } catch (error) {
      console.error('Error finding related pages:', error);
    }

    // Sort by relevance score and limit results
    return relatedPages
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, limit);
  }

  private async findRelatedToTopic(topic: string, limit: number): Promise<any[]> {
    try {
      const searchResults = await (this.store as any).searchContent ? 
        await (this.store as any).searchContent(topic, limit * 2) : [];
      
      return searchResults.slice(0, limit).map((result: any) => ({
        ...result.page,
        relevanceScore: 0.7,
        relationshipType: 'topic_match',
        snippet: result.snippet
      }));
    } catch (error) {
      console.error('Error finding pages for topic:', error);
      return [];
    }
  }

  private extractKeywords(text: string): string[] {
    if (!text) return [];
    
    // Simple keyword extraction - remove common words and get important terms
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those']);
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !commonWords.has(word))
      .slice(0, 10); // Limit to top 10 keywords
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