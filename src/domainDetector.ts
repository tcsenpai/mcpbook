import { GitBookContent, GitBookPage } from './scraper.js';
import { gitBookConfig } from './config.js';

export interface DomainInfo {
  name: string;
  description: string;
  keywords: string[];
  toolPrefix: string;
}

export class DomainDetector {
  private static extractDomainInfo(url: string): { domain: string; keywords: string[] } {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      
      // Extract meaningful parts from domain
      const parts = domain
        .replace(/^www\.|\.com$|\.org$|\.net$|\.io$|\.dev$/g, '')
        .split('.')
        .filter(part => part.length > 2) // Filter out TLDs and very short parts
        .map(part => part.toLowerCase());
      
      // Convert domain parts to keywords
      const keywords = parts
        .flatMap(part => {
          // Split camelCase/PascalCase
          const words = part.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
          // Split by special characters
          return words.flatMap(word => word.split(/[-_]/));
        })
        .filter(word => word.length > 2); // Filter out very short words
      
      return {
        domain,
        keywords: [...new Set(keywords)] // Remove duplicates
      };
    } catch {
      return { domain: '', keywords: [] };
    }
  }

  private static readonly DOMAIN_PATTERNS = new Map([
    // Generic documentation patterns with improved matching
    [/(?:official\s+)?(?:documentation|docs|guide|manual|reference)(?:\s+portal|\s+hub)?/i, {
      name: 'generic-docs',
      description: 'Documentation Portal',
      keywords: ['documentation', 'docs', 'guide', 'manual', 'reference'],
      toolPrefix: 'generic_'
    }],

    // Programming language patterns
    [/python|javascript|java|csharp|ruby|php/i, {
      name: 'programming-docs',
      description: 'Programming language documentation',
      keywords: ['python', 'javascript', 'java', 'csharp', 'ruby', 'php'],
      toolPrefix: 'programming_'
    }],

    // Framework patterns
    [/react|angular|vue|django|flask/i, {
      name: 'framework-docs',
      description: 'Framework documentation',
      keywords: ['react', 'angular', 'vue', 'django', 'flask'],
      toolPrefix: 'framework_'
    }],
    
    // Generic blockchain patterns
    [/blockchain|crypto|defi|web3|solana|ethereum|polygon|avalanche|cardano|binance|validators?|nodes?|consensus|proof.of.stake|smart.contracts?|dapps?/i, {
      name: 'blockchain-docs',
      description: 'Blockchain and cryptocurrency documentation',
      keywords: ['blockchain', 'crypto', 'defi', 'web3', 'smart-contracts', 'validators', 'nodes'],
      toolPrefix: 'blockchain_'
    }],
    
    // API documentation patterns
    [/api.*reference|rest.*api|graphql/i, {
      name: 'api-docs',
      description: 'API reference documentation',
      keywords: ['api', 'rest', 'graphql', 'endpoints', 'reference'],
      toolPrefix: 'api_'
    }],
    
    // SDK patterns
    [/sdk|library|framework/i, {
      name: 'sdk-docs',
      description: 'SDK and development library documentation',
      keywords: ['sdk', 'library', 'framework', 'development'],
      toolPrefix: 'sdk_'
    }]
  ]);

  static detectDomain(content: GitBookContent, baseUrl?: string): DomainInfo {
    // If auto-detection is disabled, use config values
    if (!gitBookConfig.autoDetectDomain) {
      return {
        name: gitBookConfig.serverName,
        description: gitBookConfig.serverDescription,
        keywords: gitBookConfig.domainKeywords,
        toolPrefix: gitBookConfig.toolPrefix
      };
    }

    // Extract domain from URL if available
    const domainInfo = baseUrl ? this.extractDomainInfo(baseUrl) : null;

    // Collect text for analysis with improved sampling
    const pages = Object.values(content);
    const sampleSize = Math.min(15, pages.length); // Analyze more pages for better context
    
    // Sort pages by content length and take a mix of long and short pages for better representation
    const sortedPages = [...pages].sort((a, b) => b.content.length - a.content.length);
    const sampledPages = [
      ...sortedPages.slice(0, Math.floor(sampleSize / 2)), // Top half by length
      ...sortedPages.slice(-Math.floor(sampleSize / 2)) // Bottom half by length
    ];
    
    const textSample = sampledPages
      .map(page => `${page.title} ${page.content} ${page.section}`)
      .join(' ')
      .toLowerCase();

    // Try to match domain patterns
    for (const [pattern, domainInfo] of this.DOMAIN_PATTERNS) {
      if (pattern.test(textSample)) {
        return {
          ...domainInfo,
          // Merge detected keywords with config if auto-detect keywords is enabled
          keywords: gitBookConfig.autoDetectKeywords 
            ? [...new Set([...domainInfo.keywords, ...gitBookConfig.domainKeywords])]
            : gitBookConfig.domainKeywords
        };
      }
    }

    // Smart keyword extraction
    const detectedKeywords = this.extractKeywords(textSample);
    const siteName = this.extractSiteName(pages);
    
    // Incorporate domain information if available
    let combinedKeywords = detectedKeywords;
    let finalSiteName = siteName;
    
    if (domainInfo) {
      combinedKeywords = [
        ...domainInfo.keywords,
        ...detectedKeywords
      ];
      finalSiteName = finalSiteName || domainInfo.domain;
    }

    // Get the most relevant keywords by frequency and position
    const topKeywords = this.rankKeywords(combinedKeywords, textSample);
    
    // Generate tool prefix from domain info and keywords
    const toolPrefix = this.generateToolPrefix(domainInfo, topKeywords, finalSiteName);
    
    // Generate a smarter description using top keywords
    const description = this.generateDescription(domainInfo, topKeywords, finalSiteName);

    return {
      name: finalSiteName || gitBookConfig.serverName,
      description,
      keywords: gitBookConfig.autoDetectKeywords 
        ? [...new Set([...topKeywords, ...gitBookConfig.domainKeywords])]
        : gitBookConfig.domainKeywords,
      toolPrefix
    };
  }

  private static extractKeywords(text: string): string[] {
    const commonTechWords = [
      'api', 'sdk', 'authentication', 'auth', 'config', 'setup', 'installation',
      'guide', 'tutorial', 'reference', 'documentation', 'docs', 'getting-started',
      'blockchain', 'crypto', 'transaction', 'smart-contract', 'defi', 'web3',
      'react', 'javascript', 'typescript', 'node', 'npm', 'yarn', 'webpack',
      'database', 'sql', 'nosql', 'mongodb', 'postgres', 'redis',
      'security', 'encryption', 'oauth', 'jwt', 'ssl', 'https'
    ];

    const wordCounts = new Map<string, number>();
    const words = text.toLowerCase().match(/\b\w{3,}\b/g) || [];

    // Count occurrences of tech words
    words.forEach(word => {
      if (commonTechWords.includes(word)) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    });

    // Return top keywords by frequency
    return Array.from(wordCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8)
      .map(([word]) => word);
  }

  private static extractSiteName(pages: GitBookPage[]): string | null {
    if (pages.length === 0) return null;

    // Try to extract from common title patterns
    const titles = pages.map(page => page.title);
    const commonPrefixes = this.findCommonPrefixes(titles);
    
    if (commonPrefixes.length > 0) {
      const siteName = commonPrefixes[0]
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      
      return siteName ? `${siteName}-docs` : null;
    }

    return null;
  }

  private static rankKeywords(keywords: string[], textSample: string): string[] {
    const wordScores = new Map<string, number>();
    
    keywords.forEach(word => {
      let score = 0;
      
      // Base frequency score
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = textSample.match(regex) || [];
      score += matches.length;
      
      // Boost score if word appears in important positions (start of sentences, after colons)
      const importantPositionRegex = new RegExp(`(?:\\.|:|^)\\s*\\b${word}\\b`, 'gi');
      const importantMatches = textSample.match(importantPositionRegex) || [];
      score += importantMatches.length * 2;
      
      // Boost technical terms
      if (this.isTechnicalTerm(word)) {
        score *= 1.5;
      }
      
      wordScores.set(word, score);
    });
    
    // Return top 10 keywords by score
    return Array.from(wordScores.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  }
  
  private static isTechnicalTerm(word: string): boolean {
    const technicalPatterns = [
      /^(?:api|sdk|cli)$/i,
      /(?:sync|async)$/i,
      /^(?:micro|macro|meta|auto|multi)/i,
      /(?:service|platform|framework|library|module)$/i,
      /(?:config|setup|deploy|build|test|dev)/i
    ];
    
    return technicalPatterns.some(pattern => pattern.test(word));
  }
  
  private static generateToolPrefix(domainInfo: { domain: string; keywords: string[] } | null, keywords: string[], siteName: string | null): string {
    // Use domain keywords first, then detected keywords, prioritizing non-generic terms
    const sourceKeywords = domainInfo?.keywords || keywords;
    
    // Filter out generic terms and pick the most specific keyword
    const genericTerms = ['docs', 'documentation', 'guide', 'manual', 'reference', 'api', 'www'];
    const specificKeywords = sourceKeywords.filter(kw => !genericTerms.includes(kw.toLowerCase()));
    const primaryKeyword = specificKeywords[0] || sourceKeywords[0] || 'docs';
    
    // Clean and format the primary keyword for tool prefix
    const cleanKeyword = primaryKeyword.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    return `${cleanKeyword}_docs_`;
  }
  
  private static generateDescription(domainInfo: { domain: string; keywords: string[] } | null, keywords: string[], siteName: string | null): string {
    // Use domain keywords first, then detected keywords, prioritizing non-generic terms
    const sourceKeywords = domainInfo?.keywords || keywords;
    
    // Filter out generic terms and pick the most specific keyword
    const genericTerms = ['docs', 'documentation', 'guide', 'manual', 'reference', 'api', 'www'];
    const specificKeywords = sourceKeywords.filter(kw => !genericTerms.includes(kw.toLowerCase()));
    const primaryKeyword = specificKeywords[0] || 'Documentation';
    
    // Capitalize first letter
    const capitalizedKeyword = primaryKeyword.charAt(0).toUpperCase() + primaryKeyword.slice(1);
    
    return `${capitalizedKeyword} documentation and development resources`;
  }

  private static findCommonPrefixes(titles: string[]): string[] {
    if (titles.length < 2) return [];

    const prefixes = new Map<string, number>();
    
    titles.forEach(title => {
      const words = title.split(/\s+/);
      for (let i = 1; i <= Math.min(3, words.length); i++) {
        const prefix = words.slice(0, i).join(' ');
        if (prefix.length > 2) {
          prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
        }
      }
    });

    // Return prefixes that appear in at least 30% of titles
    const threshold = Math.max(2, Math.floor(titles.length * 0.3));
    return Array.from(prefixes.entries())
      .filter(([, count]) => count >= threshold)
      .sort(([,a], [,b]) => b - a)
      .map(([prefix]) => prefix);
  }
}