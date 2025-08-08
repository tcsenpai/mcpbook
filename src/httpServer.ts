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
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { GitBookScraper } from './scraper.js';
import { SQLiteStore } from './sqliteStore.js';
import { gitBookConfig, validateConfig, logConfig, getCacheFilePath } from './config.js';
import { DomainDetector, DomainInfo } from './domainDetector.js';
import { ResponseUtils } from './responseUtils.js';

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
          case `${this.domainInfo.toolPrefix}get_page_section`:
            return await this.handleGetPageSection(args);
          case `${this.domainInfo.toolPrefix}get_page_outline`:
            return await this.handleGetPageOutline(args);
          case `${this.domainInfo.toolPrefix}get_page`:
            return await this.handleGetPage(args);
          case `${this.domainInfo.toolPrefix}search_code`:
            return await this.handleSearchCode(args);
          case `${this.domainInfo.toolPrefix}get_related_pages`:
            return await this.handleGetRelatedPages(args);
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

  // Tool handler methods - using dynamic token-aware pagination
  private async handleSearchContent(args: any) {
    let query: string;
    let requestedLimit = Math.min(args.limit || 20, 50);
    let offset = args.offset || 0;

    // Handle continuation token
    if (args.continuation_token) {
      try {
        const tokenData = ResponseUtils.parseContinuationToken(args.continuation_token);
        query = tokenData.q;
        offset = tokenData.o;
        // Keep the original limit if not overridden
        if (!args.limit) requestedLimit = 20;
      } catch (error) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid continuation token: ${error}`);
      }
    } else if (args.query) {
      query = args.query;
    } else {
      throw new McpError(ErrorCode.InvalidRequest, 'Either query or continuation_token is required');
    }
    
    // Get total count first
    const totalResults = await (this.store as any).searchContentCount ? 
      await (this.store as any).searchContentCount(query) : null;
    
    // For dynamic pagination, we need to get more results than requested to calculate proper limits
    const batchSize = Math.min(requestedLimit * 3, 150); // Get up to 3x requested or max 150
    const results = await (this.store as any).searchContent(query, batchSize, offset);
    
    // Use actual result count if we don't have a count method
    const actualTotal = totalResults !== null ? totalResults : (offset + results.length + (results.length === batchSize ? 1 : 0));
    
    // Create dynamic paginated response that respects 22K token limit
    const tokenSafeResponse = ResponseUtils.createDynamicPaginatedResponse(
      results, 
      query, 
      requestedLimit,
      offset, 
      actualTotal, 
      this.domainInfo.toolPrefix,
      'search_content'
    );
    
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
  }

  private async handleGetPageSection(args: any) {
    const { path, section } = args;
    if (!path || typeof path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Path is required and must be a string');
    }

    const page = await this.store.getPage(path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${path}`);
    }

    let extractedContent: string | undefined;
    
    if (section) {
      // Extract specific section from markdown
      extractedContent = this.extractSection(page.markdown || page.content, section);
      if (!extractedContent) {
        throw new McpError(ErrorCode.InvalidRequest, `Section not found in page: ${section}`);
      }
    }

    const tokenSafeResponse = ResponseUtils.createPageSectionResponse(page, section, extractedContent);
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

  private async handleGetPageOutline(args: any) {
    const { path } = args;
    if (!path || typeof path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Path is required and must be a string');
    }

    const page = await this.store.getPage(path);
    if (!page) {
      throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${path}`);
    }

    const tokenSafeResponse = ResponseUtils.createPageOutlineResponse(page);
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
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

    // Use token-safe response formatting
    const tokenSafeResponse = ResponseUtils.createPageSectionResponse(page);
    return ResponseUtils.formatMcpResponse(tokenSafeResponse);
  }

  private async handleSearchCode(args: any) {
    const { query, language, path, limit = 10 } = args;
    if (!query || typeof query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required and must be a string');
    }

    const requestedLimit = Math.min(limit, 30);
    let codeResults: any[] = [];

    if (path) {
      // Search within specific page
      const page = await this.store.getPage(path);
      if (!page) {
        throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${path}`);
      }
      codeResults = this.searchCodeInPage(page, query, language);
    } else {
      // Search across all pages
      codeResults = await this.searchCodeGlobally(query, requestedLimit * 2, language);
    }
    
    // Use dynamic pagination to respect token limits
    const dynamicLimit = ResponseUtils.calculateDynamicLimit(codeResults);
    const limitedResults = codeResults.slice(0, dynamicLimit);
    
    const response = {
      query,
      language,
      path,
      results: limitedResults,
      tokenManagement: {
        requestedLimit,
        actualLimit: dynamicLimit,
        reason: dynamicLimit < requestedLimit ? 'Reduced to stay within 22K token limit' : 'Within token limits',
        totalAvailable: codeResults.length
      },
      summary: {
        total: codeResults.length,
        showing: limitedResults.length,
        languages: [...new Set(limitedResults.map((r: any) => r.codeBlock?.language || 'unknown'))],
        pages: [...new Set(limitedResults.map((r: any) => r.page?.path || 'unknown'))]
      }
    };

    const jsonString = JSON.stringify(response, null, 2);
    const estimatedTokens = ResponseUtils.estimateTokens(jsonString);

    return ResponseUtils.formatMcpResponse({
      content: response,
      tokenInfo: {
        estimated: estimatedTokens,
        safe: estimatedTokens < 22000,
        truncated: dynamicLimit < codeResults.length
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
    // Simplified global search for HTTP version
    const allResults: any[] = [];
    
    try {
      // Get a limited set of pages to search
      const pages = await (this.store as any).getSamplePages ? 
        await (this.store as any).getSamplePages(20) : 
        [];
      
      for (const page of pages) {
        const pageResults = this.searchCodeInPage(page, query, language);
        allResults.push(...pageResults);
        
        // Early exit if we have enough results
        if (allResults.length >= limit * 2) break;
      }
    } catch (error) {
      console.error('Error in global code search:', error);
    }
    
    // Sort by relevance
    return allResults.sort((a, b) => {
      if (a.codeBlock.matchType === 'title' && b.codeBlock.matchType !== 'title') return -1;
      if (b.codeBlock.matchType === 'title' && a.codeBlock.matchType !== 'title') return 1;
      return b.codeBlock.matches.length - a.codeBlock.matches.length;
    });
  }

  private async handleGetRelatedPages(args: any) {
    const { path, topic, limit = 5 } = args;
    const maxLimit = Math.min(limit, 15);
    let relatedPages: any[] = [];

    if (path) {
      // Find pages related to a specific page
      const page = await this.store.getPage(path);
      if (!page) {
        throw new McpError(ErrorCode.InvalidRequest, `Page not found: ${path}`);
      }
      relatedPages = await this.findRelatedToPage(page, maxLimit);
    } else if (topic) {
      // Find pages related to a topic
      relatedPages = await this.findRelatedToTopic(topic, maxLimit);
    } else {
      throw new McpError(ErrorCode.InvalidRequest, 'Either path or topic is required');
    }

    const response = {
      relatedTo: path ? { type: 'page', path } : { type: 'topic', topic },
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
        const sectionPages = await (this.store as any).getSectionPages ? 
          await (this.store as any).getSectionPages(page.section) : [];
        sectionPages.forEach((p: any) => {
          if (p.path !== page.path) {
            relatedPages.push({
              ...p,
              relevanceScore: 0.8,
              relationshipType: 'same_section'
            });
          }
        });
      }

      // Strategy 2: Simple search-based similarity
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

  // Helper method to create a new server instance
  private createServerInstance(): Server {
    const server = new Server(
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
    
    // Set up all the handlers (copy from constructor)
    this.setupHandlersForServer(server);
    return server;
  }

  private setupHandlersForServer(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
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

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case `${this.domainInfo.toolPrefix}search_content`:
            return await this.handleSearchContent(args);
          case `${this.domainInfo.toolPrefix}get_page_section`:
            return await this.handleGetPageSection(args);
          case `${this.domainInfo.toolPrefix}get_page_outline`:
            return await this.handleGetPageOutline(args);
          case `${this.domainInfo.toolPrefix}get_page`:
            return await this.handleGetPage(args);
          case `${this.domainInfo.toolPrefix}search_code`:
            return await this.handleSearchCode(args);
          case `${this.domainInfo.toolPrefix}get_related_pages`:
            return await this.handleGetRelatedPages(args);
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

    // Add prompt handlers
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
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

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
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

  async run(port: number = 3001) {
    // Initialize content first
    await this.initializeContent();

    // Create Express app
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));

    // MCP StreamableHTTP handler following SDK example pattern
    const mcpHandler = async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      
      try {
        let transport: StreamableHTTPServerTransport;
        
        if (sessionId && this.transports[sessionId]) {
          // Reuse existing transport for this session
          transport = this.transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request - create new transport and server
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId: string) => {
              console.error(`StreamableHTTP session initialized: ${sessionId}`);
              this.transports[sessionId] = transport;
            },
            onsessionclosed: (sessionId: string) => {
              console.error(`StreamableHTTP session closed: ${sessionId}`);
              delete this.transports[sessionId];
            }
          });

          // Set up cleanup when transport closes
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && this.transports[sid]) {
              console.error(`Transport closed for session ${sid}`);
              delete this.transports[sid];
            }
          };

          // Create a new server instance and connect it to the transport
          const serverInstance = this.createServerInstance();
          await serverInstance.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        } else {
          // Invalid request - no session ID or not initialization request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // Handle request with existing transport
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('StreamableHTTP error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    };

    // Support both root path and /mcp for compatibility
    app.post('/', mcpHandler);
    app.delete('/', mcpHandler);
    app.get('/', mcpHandler);
    app.post('/mcp', mcpHandler);
    app.delete('/mcp', mcpHandler);
    app.get('/mcp', mcpHandler);

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