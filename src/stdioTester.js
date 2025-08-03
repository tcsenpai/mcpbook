#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

/**
 * Simple stdio MCP Tester
 * Tests MCP servers that use stdio transport
 */
class StdioMCPTester {
  constructor() {
    this.serverProcess = null;
    this.messageId = 1;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async startServer(command, args = []) {
    console.log(`🔗 Starting MCP server: ${command} ${args.join(' ')}`);
    
    this.serverProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.serverProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => {
        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (error) {
          console.log('📥 Raw output:', line);
        }
      });
    });

    this.serverProcess.on('error', (error) => {
      console.error('❌ Server process error:', error);
    });

    this.serverProcess.on('exit', (code) => {
      console.log(`🔚 Server process exited with code ${code}`);
    });

    // Initialize connection
    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'stdio-tester',
          version: '1.0.0'
        }
      }
    });

    // Wait a bit for initialization
    await this.sleep(1000);
    
    await this.listTools();
  }

  async sendMessage(message) {
    if (!this.serverProcess) {
      console.error('❌ Server not started');
      return;
    }

    const jsonString = JSON.stringify(message);
    console.log(`📤 Sending: ${jsonString}`);
    this.serverProcess.stdin.write(jsonString + '\n');
  }

  handleResponse(response) {
    console.log('📥 Response:', JSON.stringify(response, null, 2));
    
    // Calculate token estimate
    const responseText = JSON.stringify(response);
    const estimatedTokens = Math.ceil(responseText.length / 4);
    const responseSize = Buffer.byteLength(responseText, 'utf8');
    
    console.log(`📊 Response size: ${responseSize} bytes`);
    console.log(`🔢 Estimated tokens: ${estimatedTokens}`);
    console.log(`⚠️  ${estimatedTokens > 25000 ? 'WARNING: Exceeds 25k token limit!' : 'Within token limit'}`);
    console.log('---');
  }

  async listTools() {
    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/list'
    });
  }

  async callTool(name, args = {}) {
    await this.sendMessage({
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });
  }

  async interactive() {
    console.log('\n🎮 Interactive mode - Type commands:');
    console.log('Commands:');
    console.log('  list - List available tools');
    console.log('  call <tool_name> [json_args] - Call a tool');
    console.log('  search <query> - Quick search');
    console.log('  test-pagination - Test pagination');
    console.log('  test-tokens - Test token limits');
    console.log('  quit - Exit');
    console.log();

    while (true) {
      const input = await this.prompt('stdio-tester> ');
      const [command, ...args] = input.trim().split(' ');

      try {
        switch (command.toLowerCase()) {
          case 'list':
            await this.listTools();
            break;
            
          case 'call':
            if (args.length < 1) {
              console.log('Usage: call <tool_name> [json_args]');
              break;
            }
            const toolName = args[0];
            const jsonArgs = args.slice(1).join(' ');
            let parsedArgs = {};
            
            if (jsonArgs) {
              try {
                parsedArgs = JSON.parse(jsonArgs);
              } catch {
                console.log('Invalid JSON arguments. Using empty args.');
              }
            }
            
            await this.callTool(toolName, parsedArgs);
            break;

          case 'search':
            if (args.length === 0) {
              console.log('Usage: search <query>');
              break;
            }
            await this.callTool('search_content', { query: args.join(' ') });
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

  async testPagination() {
    console.log('🧪 Testing pagination...');
    
    // First call with small limit
    console.log('\n1️⃣ Making initial search call...');
    await this.callTool('search_content', { query: 'api', limit: 5 });
    
    // Wait for response, then manually continue
    console.log('\n💡 If you see a continuation_token in the response above,');
    console.log('    copy it and run: call search_content {"continuation_token":"<token>"}');
  }

  async testTokenLimits() {
    console.log('🧪 Testing token limits...');
    
    const testCases = [
      { name: 'Small search', tool: 'search_content', args: { query: 'test', limit: 5 } },
      { name: 'Large search', tool: 'search_content', args: { query: 'documentation', limit: 50 } },
      { name: 'Get page outline', tool: 'get_page_outline', args: { path: '/' } },
      { name: 'List sections', tool: 'list_sections', args: {} }
    ];

    for (const testCase of testCases) {
      console.log(`\n🔍 Testing: ${testCase.name}`);
      await this.callTool(testCase.tool, testCase.args);
      await this.sleep(2000); // Wait between tests
    }
  }

  prompt(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
    this.rl.close();
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('🧪 stdio MCP Tester');
    console.log('Usage: node stdioTester.js <server_command> [server_args...]');
    console.log('Example: node stdioTester.js node dist/index.js');
    console.log('Example: node stdioTester.js npm start');
    process.exit(1);
  }

  const tester = new StdioMCPTester();
  
  // Handle cleanup on exit
  process.on('SIGINT', async () => {
    console.log('\n🛑 Cleaning up...');
    await tester.cleanup();
    process.exit(0);
  });

  try {
    await tester.startServer(args[0], args.slice(1));
    await tester.interactive();
  } catch (error) {
    console.error('💥 Tester failed:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

if (require.main === module) {
  main().catch(console.error);
}