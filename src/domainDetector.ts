import { GitBookContent, GitBookPage } from './scraper.js';
import { gitBookConfig } from './config.js';

export interface DomainInfo {
  name: string;
  description: string;
  keywords: string[];
  toolPrefix: string;
}

export class DomainDetector {
  private static readonly DOMAIN_PATTERNS = new Map([
    // Demos Network patterns
    [/demos.*network|kynesys|demos.*sdk/i, {
      name: 'demos-network-docs',
      description: 'Demos Network and Kynesys blockchain documentation',
      keywords: ['demos', 'kynesys', 'blockchain', 'sdk', 'cross-chain', 'authentication', 'transactions'],
      toolPrefix: 'demos_'
    }],
    
    // Generic blockchain patterns
    [/blockchain|crypto|defi|web3/i, {
      name: 'blockchain-docs',
      description: 'Blockchain and cryptocurrency documentation',
      keywords: ['blockchain', 'crypto', 'defi', 'web3', 'smart-contracts'],
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

  static detectDomain(content: GitBookContent): DomainInfo {
    // If auto-detection is disabled, use config values
    if (!gitBookConfig.autoDetectDomain) {
      return {
        name: gitBookConfig.serverName,
        description: gitBookConfig.serverDescription,
        keywords: gitBookConfig.domainKeywords,
        toolPrefix: gitBookConfig.toolPrefix
      };
    }

    // Collect text for analysis
    const pages = Object.values(content);
    const sampleSize = Math.min(10, pages.length); // Analyze first 10 pages
    const textSample = pages
      .slice(0, sampleSize)
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

    // Fallback: extract keywords from content
    const detectedKeywords = this.extractKeywords(textSample);
    const siteName = this.extractSiteName(pages);

    return {
      name: siteName || gitBookConfig.serverName,
      description: `${siteName || 'Documentation'} - ${detectedKeywords.slice(0, 3).join(', ')} documentation`,
      keywords: gitBookConfig.autoDetectKeywords 
        ? [...new Set([...detectedKeywords, ...gitBookConfig.domainKeywords])]
        : gitBookConfig.domainKeywords,
      toolPrefix: gitBookConfig.toolPrefix
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