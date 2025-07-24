#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
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

class MCPCreator {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.config = {
      gitbookUrl: '',
      serverName: '',
      description: '',
      targetDir: '',
      installGlobally: false,
      addToClaudeDesktop: false
    };
  }

  async ask(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
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

  async run() {
    try {
      console.log(`${bold}${cyan}🚀 GitBook MCP Server Creator${reset}\n`);
      console.log(`${blue}This tool will help you create a personalized MCP server for any GitBook.${reset}\n`);
      
      await this.gatherConfiguration();
      await this.confirmConfiguration();
      await this.createServer();
      await this.optionalInstallation();
      
      console.log(`${bold}${green}✅ Your MCP server is ready!${reset}\n`);
      this.showUsageInstructions();
      
    } catch (error) {
      console.error(`${red}❌ Error: ${error.message}${reset}`);
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  async gatherConfiguration() {
    console.log(`${bold}📝 Configuration${reset}\n`);
    
    // GitBook URL
    this.config.gitbookUrl = await this.ask(`${cyan}🌐 GitBook URL (e.g. https://docs.kynesys.xyz): ${reset}`);
    if (!this.config.gitbookUrl.startsWith('http')) {
      throw new Error('Please provide a valid URL starting with http:// or https://');
    }

    // Auto-generate server name from URL
    const urlObj = new URL(this.config.gitbookUrl);
    const hostname = urlObj.hostname.replace(/^(www\.|docs\.)/, '');
    const suggestedName = hostname.split('.')[0] + '-docs-mcp';
    
    const nameInput = await this.ask(`${cyan}📦 Server name [${suggestedName}]: ${reset}`);
    let serverName = nameInput.trim() || suggestedName;
    
    // Ensure name ends with -mcp
    if (!serverName.endsWith('-mcp')) {
      serverName += '-mcp';
      console.log(`${blue}   → Auto-added '-mcp' suffix: ${serverName}${reset}`);
    }
    
    this.config.serverName = serverName;
    
    // Validate server name
    if (!/^[a-z0-9-]+$/.test(this.config.serverName)) {
      throw new Error('Server name must contain only lowercase letters, numbers, and hyphens');
    }

    // Description (clean up -mcp suffix for description)
    const cleanName = this.config.serverName.replace('-mcp', '').replace(/-/g, ' ');
    const suggestedDesc = `${cleanName} documentation and guides`;
    const descInput = await this.ask(`${cyan}📝 Description [${suggestedDesc}]: ${reset}`);
    this.config.description = descInput.trim() || suggestedDesc;

    // Target directory (follow platform conventions like cache system)
    const defaultDir = this.getDefaultServerDirectory(this.config.serverName);
    const dirInput = await this.ask(`${cyan}📁 Installation directory [${defaultDir}]: ${reset}`);
    this.config.targetDir = dirInput.trim() || defaultDir;

    console.log(); // Empty line for spacing
  }

  async confirmConfiguration() {
    console.log(`${bold}📋 Configuration Summary${reset}\n`);
    console.log(`${blue}GitBook URL:${reset} ${this.config.gitbookUrl}`);
    console.log(`${blue}Server Name:${reset} ${this.config.serverName}`);
    console.log(`${blue}Description:${reset} ${this.config.description}`);
    console.log(`${blue}Directory:${reset} ${this.config.targetDir}`);
    console.log();

    const confirm = await this.ask(`${cyan}✅ Create MCP server with this configuration? [Y/n]: ${reset}`);
    if (confirm.toLowerCase() === 'n') {
      console.log(`${yellow}⏹️  Operation cancelled${reset}`);
      process.exit(0);
    }
  }

  async createServer() {
    console.log(`${bold}🔧 Creating MCP Server${reset}\n`);
    
    // Create target directory
    console.log(`${blue}📁 Creating directory: ${this.config.targetDir}${reset}`);
    await fs.mkdir(this.config.targetDir, { recursive: true });
    
    // Get current script directory to copy from
    const sourceDir = path.dirname(path.dirname(__filename));
    
    // Copy essential files
    console.log(`${blue}📄 Copying project files...${reset}`);
    await this.copyProjectFiles(sourceDir, this.config.targetDir);
    
    // Create .env file
    console.log(`${blue}⚙️  Creating configuration...${reset}`);
    await this.createEnvFile();
    
    // Update package.json
    console.log(`${blue}📦 Updating package.json...${reset}`);
    await this.updatePackageJson();
    
    // Install dependencies
    console.log(`${blue}📥 Installing dependencies...${reset}`);
    await this.installDependencies();
    
    // Build and initialize
    console.log(`${blue}🔨 Building and initializing cache...${reset}`);
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
    const envContent = `# GitBook MCP Server Configuration
# Generated by MCP Creator

GITBOOK_URL=${this.config.gitbookUrl}
SERVER_NAME=${this.config.serverName}
SERVER_DESCRIPTION=${this.config.description}

# Auto-detection settings
AUTO_DETECT_DOMAIN=true
AUTO_DETECT_KEYWORDS=true

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
    console.log(`\n${bold}🔧 Installation Options${reset}\n`);
    
    const globalInstall = await this.ask(`${cyan}🌍 Install globally (accessible from anywhere)? [y/N]: ${reset}`);
    if (globalInstall.toLowerCase() === 'y') {
      console.log(`${blue}📦 Installing globally...${reset}`);
      try {
        execSync('npm install -g .', { 
          cwd: this.config.targetDir,
          stdio: 'pipe'
        });
        this.config.installGlobally = true;
        console.log(`${green}✅ Installed globally as: ${this.config.serverName}${reset}`);
      } catch (error) {
        console.log(`${yellow}⚠️  Global install failed (may need sudo). You can install manually later.${reset}`);
      }
    }

    const claudeDesktop = await this.ask(`${cyan}🤖 Add to Claude Desktop configuration? [y/N]: ${reset}`);
    if (claudeDesktop.toLowerCase() === 'y') {
      this.config.addToClaudeDesktop = true;
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
      console.log(`${yellow}⚠️  Unsupported platform for automatic Claude Desktop configuration${reset}`);
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
      console.log(`${green}✅ Added to Claude Desktop configuration${reset}`);
      console.log(`${blue}📍 Config file: ${configPath}${reset}`);
      
    } catch (error) {
      console.log(`${yellow}⚠️  Failed to add to Claude Desktop config: ${error.message}${reset}`);
      console.log(`${blue}💡 You can add it manually later using the configuration shown below.${reset}`);
    }
  }

  showUsageInstructions() {
    console.log(`${bold}🎯 Usage Instructions${reset}\n`);
    
    if (this.config.installGlobally) {
      console.log(`${green}Global Usage:${reset}`);
      console.log(`   ${this.config.serverName}                    # Start MCP server`);
      console.log(`   ${this.config.serverName} --streamable-http  # Start HTTP server`);
      console.log();
    }

    console.log(`${green}Local Usage:${reset}`);
    console.log(`   cd ${this.config.targetDir}`);
    console.log(`   npm start                    # Start MCP server`);
    console.log(`   npm run start:http          # Start HTTP server`);
    console.log(`   npm run start:api           # Start REST API`);
    console.log();

    if (this.config.addToClaudeDesktop) {
      console.log(`${green}Claude Desktop:${reset}`);
      console.log(`   🤖 Already configured! Restart Claude Desktop to use.`);
      console.log();
    } else {
      console.log(`${green}Claude Desktop Configuration:${reset}`);
      console.log(`   Add this to your claude_desktop_config.json:`);
      console.log(`   ${blue}{${reset}`);
      console.log(`   ${blue}  "mcpServers": {${reset}`);
      console.log(`   ${blue}    "${this.config.serverName}": {${reset}`);
      console.log(`   ${blue}      "command": "node",${reset}`);
      console.log(`   ${blue}      "args": ["${this.config.targetDir}/dist/index.js"],${reset}`);
      console.log(`   ${blue}      "env": {${reset}`);
      console.log(`   ${blue}        "GITBOOK_URL": "${this.config.gitbookUrl}"${reset}`);
      console.log(`   ${blue}      }${reset}`);
      console.log(`   ${blue}    }${reset}`);
      console.log(`   ${blue}  }${reset}`);
      console.log(`   ${blue}}${reset}`);
      console.log();
    }

    console.log(`${green}Testing:${reset}`);
    console.log(`   npx @modelcontextprotocol/inspector node ${this.config.targetDir}/dist/index.js`);
    console.log();

    console.log(`${cyan}📁 Server Location: ${this.config.targetDir}${reset}`);
    console.log(`${cyan}🌐 GitBook URL: ${this.config.gitbookUrl}${reset}`);
    console.log(`${cyan}📦 Server Name: ${this.config.serverName}${reset}`);
  }
}

// Run the creator
if (require.main === module) {
  const creator = new MCPCreator();
  creator.run().catch(console.error);
}

module.exports = { MCPCreator };