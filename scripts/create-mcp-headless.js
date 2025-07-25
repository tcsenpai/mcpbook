#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

// ANSI colors for better UX
const colors = {
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

const { green, blue, yellow, red, cyan, bold, reset } = colors;

class MCPCreatorHeadless {
  constructor(config) {
    this.config = {
      gitbookUrl: config.gitbookUrl || '',
      serverName: config.serverName || '',
      description: config.description || '',
      targetDir: config.targetDir || '',
      installGlobally: config.installGlobally || false,
      addToClaudeDesktop: config.addToClaudeDesktop || false
    };
  }

  getDefaultServerDirectory(serverName) {
    // Follow same platform conventions as cache system
    const xdgConfigHome = process.env.XDG_CONFIG_HOME;
    if (xdgConfigHome) {
      return path.join(xdgConfigHome, 'mcpbooks', 'servers', serverName);
    }
    
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
      return path.join(homeDir, 'AppData', 'Roaming', 'mcpbooks', 'servers', serverName);
    } else {
      return path.join(homeDir, '.config', 'mcpbooks', 'servers', serverName);
    }
  }

  async directoryExists(dirPath) {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async removeDirectory(dirPath) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }

  async run() {
    try {
      process.stdout.write(`${bold}${cyan}🚀 GitBook MCP Server Creator (Headless)${reset}\n`);
      
      this.validateConfiguration();
      await this.createServer();
      await this.optionalInstallation();
      
      process.stdout.write(`${bold}${green}✅ Your MCP server is ready!${reset}\n`);
      this.showUsageInstructions();
      
      return {
        success: true,
        serverName: this.config.serverName,
        targetDir: this.config.targetDir
      };
      
    } catch (error) {
      console.error(`${red}❌ Error: ${error.message}${reset}`);
      
      // Clean up on failure if target directory was created
      if (this.config.targetDir && await this.directoryExists(this.config.targetDir)) {
        process.stdout.write(`${yellow}🧹 Cleaning up failed installation...${reset}`);
        try {
          await this.removeDirectory(this.config.targetDir);
          process.stdout.write(`${blue}✅ Removed directory: ${this.config.targetDir}${reset}`);
        } catch (cleanupError) {
          process.stdout.write(`${yellow}⚠️  Could not clean up directory: ${cleanupError.message}${reset}`);
        }
      }
      
      throw error;
    }
  }

  validateConfiguration() {
    if (!this.config.gitbookUrl.startsWith('http')) {
      throw new Error('Please provide a valid URL starting with http:// or https://');
    }

    if (!/^[a-z0-9-]+$/.test(this.config.serverName)) {
      throw new Error('Server name must contain only lowercase letters, numbers, and hyphens');
    }

    if (!this.config.targetDir) {
      this.config.targetDir = this.getDefaultServerDirectory(this.config.serverName);
    } else {
      // Expand ~ to home directory if present
      this.config.targetDir = this.config.targetDir.replace(/^~/, os.homedir());
    }

    process.stdout.write(`${bold}📋 Configuration${reset}\n`);
    process.stdout.write(`${blue}GitBook URL:${reset} ${this.config.gitbookUrl}\n`);
    process.stdout.write(`${blue}Server Name:${reset} ${this.config.serverName}\n`);
    process.stdout.write(`${blue}Description:${reset} ${this.config.description}\n`);
    process.stdout.write(`${blue}Directory:${reset} ${this.config.targetDir}\n`);
    process.stdout.write('\n');
  }

  async createServer() {
    process.stdout.write(`${bold}🔧 Creating MCP Server${reset}\n\n`);
    
    // Create target directory
    process.stdout.write(`${blue}📁 Creating directory: ${this.config.targetDir}${reset}`);
    await fs.mkdir(this.config.targetDir, { recursive: true });
    
    // Get current script directory to copy from
    const sourceDir = path.dirname(path.dirname(__filename));
    
    // Copy essential files
    process.stdout.write(`${blue}📄 Copying project files...${reset}`);
    await this.copyProjectFiles(sourceDir, this.config.targetDir);
    
    // Create .env file
    process.stdout.write(`${blue}⚙️  Creating configuration...${reset}`);
    await this.createEnvFile();
    
    // Update package.json
    process.stdout.write(`${blue}📦 Updating package.json...${reset}`);
    await this.updatePackageJson();
    
    // Install dependencies
    process.stdout.write(`${blue}📥 Installing dependencies...${reset}`);
    await this.installDependencies();
    
    // Build and initialize
    process.stdout.write(`${blue}🔨 Building and initializing cache...${reset}`);
    await this.buildAndInitialize();
  }

  async copyProjectFiles(sourceDir, targetDir) {
    const filesToCopy = [
      'src/',
      'scripts/',
      'package.json',
      'tsconfig.json',
      'test.js'
    ];

    for (const file of filesToCopy) {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);
      
      try {
        const stat = await fs.lstat(sourcePath);
        if (stat.isDirectory()) {
          await this.copyDirectory(sourcePath, targetPath);
        } else {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(sourcePath, targetPath);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  async copyDirectory(source, target) {
    await fs.mkdir(target, { recursive: true });
    const files = await fs.readdir(source);
    
    for (const file of files) {
      const sourcePath = path.join(source, file);
      const targetPath = path.join(target, file);
      const stat = await fs.lstat(sourcePath);
      
      if (stat.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }

  async createEnvFile() {
    // Generate tool prefix from server name (remove -mcp suffix for prefix)
    const toolPrefix = this.config.serverName.replace('-mcp', '').replace(/-/g, '_') + '_';
    
    // Generate domain keywords from server name for better defaults
    const serverKeywords = this.config.serverName
      .replace('-mcp', '')
      .split('-')
      .filter(word => word.length > 2 && !['docs', 'api'].includes(word))
      .join(',');
    
    const envContent = `# GitBook MCP Server Configuration
# Generated by MCP Creator (Headless)

GITBOOK_URL=${this.config.gitbookUrl}
SERVER_NAME=${this.config.serverName}
SERVER_DESCRIPTION=${this.config.description}
TOOL_PREFIX=${toolPrefix}
DOMAIN_KEYWORDS=${serverKeywords || 'documentation,guides'}

# Auto-detection settings (disabled after manual setup)
AUTO_DETECT_DOMAIN=false
AUTO_DETECT_KEYWORDS=false

# Performance settings
CACHE_TTL_HOURS=1
MAX_CONCURRENT_REQUESTS=5
SCRAPING_DELAY_MS=100
`;

    await fs.writeFile(path.join(this.config.targetDir, '.env'), envContent);
  }

  async updatePackageJson() {
    const packageJsonPath = path.join(this.config.targetDir, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    
    // Update package details
    packageJson.name = this.config.serverName;
    packageJson.description = this.config.description;
    packageJson.bin = {
      [this.config.serverName]: 'dist/index.js'
    };
    
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  async installDependencies() {
    return new Promise((resolve, reject) => {
      const npm = spawn('npm', ['install'], {
        cwd: this.config.targetDir,
        stdio: 'pipe'
      });

      let output = '';
      npm.stdout.on('data', (data) => {
        output += data.toString();
      });

      npm.stderr.on('data', (data) => {
        output += data.toString();
      });

      npm.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed: ${output}`));
        }
      });
    });
  }

  async buildAndInitialize() {
    return new Promise((resolve, reject) => {
      const npm = spawn('npm', ['run', 'build:init'], {
        cwd: this.config.targetDir,
        stdio: 'pipe'
      });

      let output = '';
      npm.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        // Show progress indicators
        if (text.includes('📖') || text.includes('🧠') || text.includes('💾')) {
          process.stdout.write(`${blue}   ${text.trim()}${reset}\n`);
        }
      });

      npm.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        if (text.includes('📖') || text.includes('🧠') || text.includes('💾')) {
          process.stdout.write(`${blue}   ${text.trim()}${reset}\n`);
        }
      });

      npm.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build failed: ${output}`));
        }
      });
    });
  }

  async optionalInstallation() {
    if (this.config.installGlobally) {
      process.stdout.write(`${blue}📦 Installing globally...${reset}`);
      try {
        execSync('npm install -g .', { 
          cwd: this.config.targetDir,
          stdio: 'pipe'
        });
        process.stdout.write(`${green}✅ Installed globally as: ${this.config.serverName}${reset}`);
      } catch (error) {
        process.stdout.write(`${yellow}⚠️  Global install failed (may need sudo). You can install manually later.${reset}`);
      }
    }

    if (this.config.addToClaudeDesktop) {
      await this.addToClaudeDesktop();
    }
  }

  async addToClaudeDesktop() {
    const configPaths = {
      darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      win32: path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      linux: path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json')
    };

    const configPath = configPaths[os.platform()];
    if (!configPath) {
      process.stdout.write(`${yellow}⚠️  Unsupported platform for automatic Claude Desktop configuration${reset}`);
      return;
    }

    try {
      // Ensure config directory exists
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      
      let config = {};
      try {
        const content = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(content);
      } catch (error) {
        // File doesn't exist, start with empty config
      }

      // Initialize mcpServers if it doesn't exist
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Add our server
      config.mcpServers[this.config.serverName] = {
        command: 'node',
        args: [path.join(this.config.targetDir, 'dist', 'index.js')],
        env: {
          GITBOOK_URL: this.config.gitbookUrl
        }
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      process.stdout.write(`${green}✅ Added to Claude Desktop configuration${reset}`);
      process.stdout.write(`${blue}📍 Config file: ${configPath}${reset}`);
      
    } catch (error) {
      process.stdout.write(`${yellow}⚠️  Failed to add to Claude Desktop config: ${error.message}${reset}`);
      process.stdout.write(`${blue}💡 You can add it manually later using the configuration shown below.${reset}`);
    }
  }

  showUsageInstructions() {
    process.stdout.write(`${bold}🎯 Usage Instructions${reset}\n`);
    
    process.stdout.write(`${green}Local Usage:${reset}`);
    process.stdout.write(`   cd ${this.config.targetDir}`);
    process.stdout.write(`   npm start                    # Start MCP server`);
    process.stdout.write(`   npm run start:http          # Start HTTP server`);
    process.stdout.write(`   npm run start:api           # Start REST API`);
    process.stdout.write();

    if (this.config.addToClaudeDesktop) {
      process.stdout.write(`${green}Claude Desktop:${reset}`);
      process.stdout.write(`   🤖 Already configured! Restart Claude Desktop to use.`);
      process.stdout.write();
    }

    process.stdout.write(`${cyan}📁 Server Location: ${this.config.targetDir}${reset}`);
    process.stdout.write(`${cyan}🌐 GitBook URL: ${this.config.gitbookUrl}${reset}`);
    process.stdout.write(`${cyan}📦 Server Name: ${this.config.serverName}${reset}`);
  }
}

// Main execution
if (require.main === module) {
  // Parse command line arguments for headless mode
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node create-mcp-headless.js <config-json>');
    console.error('Example: node create-mcp-headless.js \'{"gitbookUrl":"https://docs.example.com","serverName":"example-docs-mcp","description":"Example docs","targetDir":"/path/to/dir"}\'');
    process.exit(1);
  }

  try {
    const config = JSON.parse(args[0]);
    const creator = new MCPCreatorHeadless(config);
    creator.run().then(result => {
      process.stdout.write(JSON.stringify(result));
    }).catch(error => {
      console.error(JSON.stringify({ success: false, error: error.message }));
      process.exit(1);
    });
  } catch (error) {
    console.error('Invalid JSON configuration:', error.message);
    process.exit(1);
  }
}

module.exports = { MCPCreatorHeadless };