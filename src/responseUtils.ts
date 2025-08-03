// Token estimation and response utilities for MCP
const CHARS_PER_TOKEN = 4; // Rough estimate
const MAX_SAFE_TOKENS = 20000; // Buffer under 25k limit
const MAX_SAFE_CHARS = MAX_SAFE_TOKENS * CHARS_PER_TOKEN;

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  continuationToken?: string;
  nextInstruction?: string;
}

export interface TokenSafeResponse {
  content: any;
  tokenInfo: {
    estimated: number;
    safe: boolean;
    truncated: boolean;
  };
}

export class ResponseUtils {
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  static createContinuationToken(query: string, offset: number, additionalParams?: any): string {
    const tokenData = {
      q: query,
      o: offset,
      ...additionalParams
    };
    return Buffer.from(JSON.stringify(tokenData)).toString('base64');
  }

  static parseContinuationToken(token: string): any {
    try {
      return JSON.parse(Buffer.from(token, 'base64').toString());
    } catch {
      throw new Error('Invalid continuation token');
    }
  }

  static createSearchResponse(
    results: any[],
    query: string,
    limit: number,
    offset: number,
    total: number,
    toolPrefix: string = ''
  ): TokenSafeResponse {
    const hasMore = offset + limit < total;
    const nextOffset = hasMore ? offset + limit : null;
    
    const pagination: PaginationInfo = {
      total,
      limit,
      offset,
      hasMore,
      continuationToken: hasMore ? this.createContinuationToken(query, nextOffset!) : undefined,
      nextInstruction: hasMore 
        ? `Use ${toolPrefix}search_content with continuation_token="${this.createContinuationToken(query, nextOffset!)}" to get next ${limit} results`
        : undefined
    };

    const response = {
      query,
      results,
      pagination,
      summary: {
        showing: `${offset + 1}-${Math.min(offset + results.length, total)}`,
        of: total,
        pages: Math.ceil(total / limit),
        currentPage: Math.floor(offset / limit) + 1
      }
    };

    const jsonString = JSON.stringify(response, null, 2);
    const estimatedTokens = this.estimateTokens(jsonString);

    return {
      content: response,
      tokenInfo: {
        estimated: estimatedTokens,
        safe: estimatedTokens < MAX_SAFE_TOKENS,
        truncated: false
      }
    };
  }

  static createPageSectionResponse(
    page: any,
    sectionId?: string,
    extractedContent?: string
  ): TokenSafeResponse {
    let content: any;
    
    if (sectionId && extractedContent) {
      // Specific section requested
      content = {
        path: page.path,
        title: page.title,
        section: page.section,
        subsection: page.subsection,
        requestedSection: sectionId,
        content: extractedContent,
        availableActions: [
          `get_page_outline?path=${page.path} - See full page structure`,
          `get_page?path=${page.path} - Get complete page content`
        ]
      };
    } else {
      // Full page but check tokens
      const fullPageJson = JSON.stringify(page, null, 2);
      const tokens = this.estimateTokens(fullPageJson);
      
      if (tokens < MAX_SAFE_TOKENS) {
        content = page;
      } else {
        // Page too large, return summary with sections
        content = {
          path: page.path,
          title: page.title,
          section: page.section,
          subsection: page.subsection,
          summary: this.extractSummary(page.content),
          tokenLimitExceeded: true,
          originalTokens: tokens,
          availableActions: [
            `get_page_outline?path=${page.path} - See page structure`,
            `get_page_section?path=${page.path}&section=<section_id> - Get specific section`
          ]
        };
      }
    }

    const jsonString = JSON.stringify(content, null, 2);
    const estimatedTokens = this.estimateTokens(jsonString);

    return {
      content,
      tokenInfo: {
        estimated: estimatedTokens,
        safe: estimatedTokens < MAX_SAFE_TOKENS,
        truncated: sectionId ? false : estimatedTokens >= MAX_SAFE_TOKENS
      }
    };
  }

  static createPageOutlineResponse(page: any): TokenSafeResponse {
    // Extract structure information - always lightweight
    const outline = {
      path: page.path,
      title: page.title,
      section: page.section,
      subsection: page.subsection,
      url: page.url,
      lastUpdated: page.lastUpdated,
      structure: this.extractStructure(page),
      actions: [
        `get_page_section?path=${page.path}&section=<section_id> - Get specific section`,
        `get_page?path=${page.path} - Get full page (may be truncated if large)`,
        `search_code?query=<term>&path=${page.path} - Search code in this page`
      ]
    };

    const jsonString = JSON.stringify(outline, null, 2);
    const estimatedTokens = this.estimateTokens(jsonString);

    return {
      content: outline,
      tokenInfo: {
        estimated: estimatedTokens,
        safe: true, // Outlines are always designed to be small
        truncated: false
      }
    };
  }

  private static extractSummary(content: string, maxLength: number = 500): string {
    if (!content || content.length <= maxLength) return content;
    
    // Try to break at sentence boundary
    const truncated = content.substring(0, maxLength);
    const lastSentence = truncated.lastIndexOf('.');
    
    if (lastSentence > maxLength * 0.7) {
      return truncated.substring(0, lastSentence + 1) + ` [Truncated - full content available via get_page_section]`;
    }
    
    return truncated + `... [Truncated from ${content.length} chars - use get_page_section for full content]`;
  }

  private static extractStructure(page: any): any {
    const structure: any = {
      wordCount: page.content ? page.content.split(/\s+/).length : 0,
      codeBlocks: page.codeBlocks ? page.codeBlocks.length : 0
    };

    // Extract headings from markdown if available
    if (page.markdown) {
      const headings = page.markdown.match(/^#{1,6}\s+.+$/gm) || [];
      structure.headings = headings.map((h: string) => {
        const level = h.match(/^#+/)?.[0].length || 1;
        const text = h.replace(/^#+\s+/, '').trim();
        const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return { level, text, id };
      });
      structure.sections = structure.headings.filter((h: any) => h.level <= 3);
    }

    // Add code block summary
    if (page.codeBlocks && page.codeBlocks.length > 0) {
      structure.codeLanguages = [...new Set(page.codeBlocks.map((cb: any) => cb.language))];
    }

    return structure;
  }

  static formatMcpResponse(tokenSafeResponse: TokenSafeResponse): any {
    const { content, tokenInfo } = tokenSafeResponse;
    
    // Add token info as metadata comment
    const responseWithMeta = {
      ...content,
      _meta: {
        tokens: tokenInfo.estimated,
        safe: tokenInfo.safe,
        truncated: tokenInfo.truncated
      }
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(responseWithMeta, null, 2),
        },
      ],
    };
  }
}