#!/usr/bin/env node

import axios from 'axios';
import readline from 'readline';

/**
 * Simple MCP Server Tester (HTTP-based)
 * 
 * This tool helps test MCP servers manually by:
 * 1. Connecting to an MCP server via HTTP
 * 2. Listing available endpoints
 * 3. Making API calls interactively
 * 4. Showing token counts and response sizes
 */
export class MCPTester {
  private baseUrl: string;
  private rl: readline.Interface;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async connect(): Promise<void> {
    console.log(`🔗 Connecting to MCP server: ${this.baseUrl}`);
    
    try {
      // Test connection
      const response = await axios.get(`${this.baseUrl}/api`);
      console.log('✅ Connected successfully!');
      console.log(`📋 Server: ${response.data.name} v${response.data.version}`);
      console.log(`📖 Description: ${response.data.description}`);
      
      // Show available endpoints
      console.log('\n🔗 Available endpoints:');
      Object.entries(response.data.endpoints).forEach(([name, endpoint]) => {
        console.log(`  ${name}: ${endpoint}`);
      });
      
    } catch (error) {
      console.error('❌ Failed to connect:', error);
      throw error;
    }
  }

  async searchContent(query: string, limit: number = 20, offset: number = 0): Promise<any> {
    try {
      console.log(`🔍 Searching for: "${query}" (limit: ${limit}, offset: ${offset})`);
      
      const startTime = Date.now();
      const response = await axios.get(`${this.baseUrl}/api/search`, {
        params: { q: query, limit, offset }
      });
      const duration = Date.now() - startTime;
      
      return this.analyzeResponse(response.data, duration);
    } catch (error) {
      console.error('❌ Search failed:', error);
      throw error;
    }
  }

  async getPage(path: string): Promise<any> {
    try {
      console.log(`📄 Getting page: ${path}`);
      
      const startTime = Date.now();
      const response = await axios.get(`${this.baseUrl}/api/page${path}`);
      const duration = Date.now() - startTime;
      
      return this.analyzeResponse(response.data, duration);
    } catch (error) {
      console.error('❌ Get page failed:', error);
      throw error;
    }
  }

  async listSections(): Promise<any> {
    try {
      console.log(`📚 Listing sections...`);
      
      const startTime = Date.now();
      const response = await axios.get(`${this.baseUrl}/api/sections`);
      const duration = Date.now() - startTime;
      
      return this.analyzeResponse(response.data, duration);
    } catch (error) {
      console.error('❌ List sections failed:', error);
      throw error;
    }
  }

  async getStatus(): Promise<any> {
    try {
      console.log(`📊 Getting server status...`);
      
      const startTime = Date.now();
      const response = await axios.get(`${this.baseUrl}/api/status`);
      const duration = Date.now() - startTime;
      
      return this.analyzeResponse(response.data, duration);
    } catch (error) {
      console.error('❌ Get status failed:', error);
      throw error;
    }
  }

  private analyzeResponse(data: any, duration: number): any {
    // Calculate response size and estimated tokens
    const responseText = JSON.stringify(data, null, 2);
    const responseSize = Buffer.byteLength(responseText, 'utf8');
    const estimatedTokens = Math.ceil(responseText.length / 4); // Rough estimate
    
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`📊 Response size: ${responseSize} bytes`);
    console.log(`🔢 Estimated tokens: ${estimatedTokens}`);
    console.log(`⚠️  ${estimatedTokens > 25000 ? 'WARNING: Exceeds 25k token limit!' : 'Within token limit'}`);
    
    // Show first part of response
    console.log(`\n📋 Response preview:`);
    if (responseText.length > 2000) {
      console.log(responseText.substring(0, 2000) + '\n... [truncated for display]');
    } else {
      console.log(responseText);
    }
    
    return data;
  }

  async interactive(): Promise<void> {
    console.log('\n🎮 Interactive mode - Type commands:');
    console.log('Commands:');
    console.log('  search <query> [limit] [offset] - Search content');
    console.log('  page <path> - Get a specific page');
    console.log('  sections - List all sections');
    console.log('  status - Get server status');
    console.log('  test-pagination - Test pagination with search');
    console.log('  test-tokens - Test token limits');
    console.log('  quit - Exit');
    console.log();

    while (true) {
      const input = await this.prompt('mcp-tester> ');
      const [command, ...args] = input.trim().split(' ');

      try {
        switch (command.toLowerCase()) {
          case 'search':
            if (args.length === 0) {
              console.log('Usage: search <query> [limit] [offset]');
              break;
            }
            const query = args[0];
            const limit = args[1] ? parseInt(args[1]) : 20;
            const offset = args[2] ? parseInt(args[2]) : 0;
            await this.searchContent(query, limit, offset);
            break;
            
          case 'page':
            if (args.length === 0) {
              console.log('Usage: page <path>');
              break;
            }
            await this.getPage(args[0]);
            break;
            
          case 'sections':
            await this.listSections();
            break;
            
          case 'status':
            await this.getStatus();
            break;
            
          case 'test-pagination':
            await this.testPagination();
            break;
            
          case 'test-tokens':
            await this.testTokenLimits();
            break;
            
          case 'quit':
          case 'exit':
            console.log('👋 Goodbye!');
            return;
            
          default:
            console.log('Unknown command. Type "quit" to exit.');
        }
      } catch (error) {
        console.error('❌ Command failed:', error);
      }
      
      console.log(); // Add spacing
    }
  }

  private async testPagination(): Promise<void> {
    console.log('🧪 Testing pagination...');
    
    try {
      // First call with small limit
      console.log('\n1️⃣  Making initial search call...');
      const result1 = await this.searchContent('api', 5, 0);
      
      if (result1.pagination?.hasMore) {
        console.log('\n2️⃣  Found more results, making second call...');
        await this.searchContent('api', 5, result1.pagination.nextOffset);
      } else {
        console.log('ℹ️  No more results found (all results fit in first page)');
      }
    } catch (error) {
      console.error('❌ Pagination test failed:', error);
    }
  }

  private async testTokenLimits(): Promise<void> {
    console.log('🧪 Testing token limits...');
    
    const testCases = [
      { name: 'Small search', fn: () => this.searchContent('test', 5) },
      { name: 'Large search', fn: () => this.searchContent('documentation', 50) },
      { name: 'List sections', fn: () => this.listSections() },
      { name: 'Server status', fn: () => this.getStatus() }
    ];

    for (const testCase of testCases) {
      try {
        console.log(`\n🔍 Testing: ${testCase.name}`);
        await testCase.fn();
      } catch (error) {
        console.error(`❌ ${testCase.name} failed:`, error);
      }
    }
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  async disconnect(): Promise<void> {
    this.rl.close();
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  const baseUrl = args[0] || 'http://localhost:3001';
  
  console.log('🧪 MCP Server Tester (HTTP-based)');
  console.log('Usage: node mcpTester.js [server_url]');
  console.log('Default URL: http://localhost:3001');
  console.log();

  const tester = new MCPTester(baseUrl);
  
  try {
    await tester.connect();
    await tester.interactive();
  } catch (error) {
    console.error('💥 Tester failed:', error);
    process.exit(1);
  } finally {
    await tester.disconnect();
  }
}

if (require.main === module) {
  main().catch(console.error);
}