import { PorterStemmer, WordTokenizer, stopwords } from 'natural';

export class TextProcessor {
  private tokenizer = new WordTokenizer();
  private stopWords = new Set(stopwords);
  
  private normalizationRules = new Map([
    // Common tech abbreviations
    ['txs', 'transactions'],
    ['tx', 'transaction'],
    ['auth', 'authentication'],
    ['config', 'configuration'],
    ['repo', 'repository'],
    ['db', 'database'],
    ['api', 'interface'],
    ['ui', 'interface'],
    ['ux', 'experience'],
    
    // Cross-chain variations
    ['crosschain', 'cross-chain'],
    ['multichain', 'cross-chain'],
    ['xchain', 'cross-chain'],
    ['xm', 'cross-chain'],
    ['bridge', 'cross-chain'],
    
    // Authentication variations
    ['signin', 'sign-in'],
    ['signup', 'sign-up'],
    ['login', 'sign-in'],
    ['logout', 'sign-out'],
    
    // Common word variations
    ['javascript', 'js'],
    ['typescript', 'ts'],
    ['documentation', 'docs'],
    ['application', 'app'],
    ['development', 'dev'],
    ['production', 'prod'],
    ['environment', 'env'],
    ['configuration', 'config'],
    ['implementation', 'impl'],
  ]);

  private compoundWords = new Set([
    'cross-chain',
    'multi-chain', 
    'end-to-end',
    'real-time',
    'client-side',
    'server-side',
    'full-stack',
    'open-source',
    'peer-to-peer',
    'point-to-point',
    'state-of-the-art',
  ]);

  processText(text: string): string[] {
    if (!text) return [];
    
    // Normalize text
    const normalized = this.normalizeText(text);
    
    // Tokenize
    const tokens = this.tokenizer.tokenize(normalized) || [];
    
    // Process tokens
    const processed = tokens
      .map(token => this.normalizeToken(token))
      .filter(token => this.shouldKeepToken(token))
      .map(token => this.stemToken(token));
    
    return [...new Set(processed)]; // Remove duplicates
  }

  processQuery(query: string): string[] {
    // For queries, we want to expand rather than just normalize
    const expanded = this.expandQuery(query);
    return this.processText(expanded);
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ') // Keep hyphens for compound words
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeToken(token: string): string {
    const normalized = this.normalizationRules.get(token);
    return normalized || token;
  }

  private shouldKeepToken(token: string): boolean {
    if (token.length < 2) return false;
    if (this.stopWords.has(token)) return false;
    if (/^\d+$/.test(token)) return false; // Pure numbers
    return true;
  }

  private stemToken(token: string): string {
    // Don't stem compound words or technical terms
    if (this.compoundWords.has(token)) return token;
    if (token.includes('-')) return token;
    if (token.length < 4) return token; // Don't stem short words
    
    return PorterStemmer.stem(token);
  }

  private expandQuery(query: string): string {
    const words = query.toLowerCase().split(/\s+/);
    const expanded: string[] = [];
    
    for (const word of words) {
      expanded.push(word);
      
      // Add normalized version
      const normalized = this.normalizationRules.get(word);
      if (normalized) {
        expanded.push(normalized);
      }
      
      // Add reverse mappings (e.g., if query has "transaction", add "tx")
      for (const [abbrev, full] of this.normalizationRules) {
        if (full === word || full.includes(word)) {
          expanded.push(abbrev);
        }
      }
    }
    
    return expanded.join(' ');
  }

  // Create searchable text for indexing
  createSearchableText(title: string, content: string, section: string, subsection?: string): string {
    const parts = [title, content, section];
    if (subsection) parts.push(subsection);
    
    const processed = parts
      .map(part => this.processText(part).join(' '))
      .filter(Boolean);
    
    return processed.join(' ');
  }

  // Get search terms with different strategies
  getSearchTerms(query: string): {
    exact: string[];
    expanded: string[];
    stemmed: string[];
  } {
    const exact = query.toLowerCase().split(/\s+/).filter(Boolean);
    const expanded = this.expandQuery(query).split(/\s+/).filter(Boolean);
    const stemmed = this.processQuery(query);
    
    return { exact, expanded, stemmed };
  }
}