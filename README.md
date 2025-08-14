[![MSeeP.ai Security Assessment Badge](https://mseep.net/pr/tcsenpai-mcpbook-badge.png)](https://mseep.ai/app/tcsenpai-mcpbook)

# Universal Documentation MCP Server

[![MCP Badge](https://lobehub.com/badge/mcp-full/tcsenpai-mcpbook)](https://lobehub.com/mcp/tcsenpai-mcpbook)

A high-performance MCP (Model Context Protocol) server that transforms **any documentation website** into an AI-accessible knowledge base. Originally built for GitBook but works with **Vercel docs, Next.js sites, Docusaurus, and many other documentation platforms**. Features instant startup, intelligent caching, and automatic domain detection.

## ✨ Key Features

- **⚡ Instant Startup** - SQLite storage with sub-second server initialization
- **🔍 Advanced Search** - FTS5 full-text search with fuzzy matching and ranking  
- **🧠 Smart Auto-Detection** - Automatically detects domain, keywords, and branding
- **📝 Markdown Perfect** - Preserves formatting with syntax-highlighted code blocks
- **🔄 Background Updates** - Non-blocking change detection and cache refresh
- **🌐 Universal Support** - Works with GitBook, Vercel docs, Next.js sites, and many other documentation platforms
- **📡 Dual Interface** - Both MCP tools and REST API endpoints
- **🚀 Production Ready** - Rate limiting, error handling, and robust caching

## 🚀 Quick Start

> **💡 Recommended: Use the interactive creator for the best experience!**

### 🎨 **Web UI Management Dashboard**
```bash
# Clone this repo (once)
git clone https://github.com/tcsenpai/mcpbook/
cd mcpbook

# Build the UI
npm run ui:build

# Start the web interface
npm run ui
```

The Web UI provides:
- **🚀 Visual Server Creation** - Step-by-step wizard with live URL validation
- **📊 Server Management** - Start/stop/delete servers with real-time status
- **📋 Claude Desktop Integration** - One-click copy config or add via CLI
- **🖥️ Live Terminal** - Real-time feedback and command execution
- **⚠️ Safety Features** - Confirmation dialogs and cancel functionality

### ⭐ **One-Command Setup**
```bash
# Clone this repo (once)
git clone https://github.com/tcsenpai/mcpbook/
cd mcpbook

# Create MCP server for any documentation site instantly
npm exec create-gitbook-mcp
```

**That's it!** 🎉 The interactive wizard will:
- ✨ **Guide you through setup** with smart defaults
- 🔍 **Auto-detect domain/keywords** from your documentation site
- 📦 **Install in organized directories** (`~/.config/mcpbooks/servers/[name]`)
- 🌍 **Optionally install globally** (accessible as `your-server-name` command)
- 🤖 **Auto-configure Claude Desktop** (optional)
- 🚀 **Pre-cache everything** for instant server startup

### 🛠️ Manual Setup (Advanced Users)
1. **Install and Configure**
   ```bash
   npm install
   echo "GITBOOK_URL=https://docs.yoursite.com" > .env
   ```

2. **Build with Auto-Detection**
   ```bash
   npm run build  # Automatically detects and configures your domain
   ```

3. **Start Server**
   ```bash
   npm start  # Instant startup with SQLite cache
   ```

4. **Test with MCP Inspector**
   ```bash
   npx @modelcontextprotocol/inspector node dist/index.js
   ```

## 📦 Installation Options

### Option 1: Local Development
```bash
git clone <repository>
cd mcpbook
npm install
npm run build
npm start
```

### Option 2: Global Installation
```bash
npm install -g .
# Then use the binary name from package.json
your-mcp-server-name
```

### Option 3: Claude Desktop Integration
```json
{
  "mcpServers": {
    "gitbook": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "GITBOOK_URL": "https://docs.yoursite.com"
      }
    }
  }
}
```

**Config file locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\\Claude\\claude_desktop_config.json`

### Option 4: StreamableHTTP Transport
```bash
npm run start:http  # StreamableHTTP on port 3001
node dist/index.js --streamable-http --port=3002  # Custom port
```

### Option 5: REST API Server
```bash
npm run start:api  # HTTP server on port 3000
PORT=8080 npm run start:api  # Custom port
```

## 🌐 Platform Compatibility

While originally designed for GitBook, this MCP server has **proven compatibility** with many documentation platforms:

### ✅ **Guaranteed to Work**
- **GitBook** (original target platform)
- **Custom GitBook instances** 

### 🎯 **Successfully Tested**  
- **Vercel-hosted docs** (`docs.vercel.com`, `aptos.dev`)
- **Next.js documentation sites**
- **Static site generators** with consistent navigation
- **Most HTML-based documentation platforms**

### 🔧 **How It Works**
The scraper intelligently:
- **Discovers navigation** through link crawling
- **Extracts content** from any HTML structure  
- **Adapts to different layouts** automatically
- **Handles various authentication** and routing patterns

> **💡 Pro Tip**: If a site has consistent navigation and accessible content, our scraper will likely work! The auto-detection feature adapts to different site structures automatically.

## ⚙️ Configuration

### Auto-Detection (Recommended)
```env
GITBOOK_URL=https://docs.yoursite.com
AUTO_DETECT_DOMAIN=true
AUTO_DETECT_KEYWORDS=true
```

The server will automatically:
- Generate domain-specific tool names (`stripe_docs_search`, `api_docs_get_page`)
- Extract relevant keywords from content
- Create contextual descriptions for better AI integration

### Manual Configuration
```env
# Target GitBook (required)
GITBOOK_URL=https://docs.yoursite.com

# Custom branding (optional)
SERVER_NAME=my-api-docs
SERVER_DESCRIPTION=API documentation and guides
DOMAIN_KEYWORDS=api,rest,graphql,endpoints
TOOL_PREFIX=api_

# Performance tuning
CACHE_TTL_HOURS=1
MAX_CONCURRENT_REQUESTS=5
SCRAPING_DELAY_MS=100
```

### Configuration Examples

**API Documentation:**
```env
GITBOOK_URL=https://api-docs.yourservice.com
TOOL_PREFIX=api_
DOMAIN_KEYWORDS=api,rest,endpoints,authentication
```
→ Results in: `api_search_content`, `api_get_page`, etc.

**Product Documentation:**
```env
GITBOOK_URL=https://help.yourproduct.com  
TOOL_PREFIX=help_
DOMAIN_KEYWORDS=tutorial,guide,troubleshooting
```
→ Results in: `help_search_content`, `help_get_page`, etc.

## 🛠️ Available Tools

The server exposes 7 MCP tools with automatic prefixing:

### Core Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `{prefix}_search_content` | Advanced search with ranking | `query`: Search terms |
| `{prefix}_get_page` | Get specific page content | `path`: Page path (e.g., "/api/auth") |
| `{prefix}_list_sections` | Get table of contents | None |
| `{prefix}_get_section_pages` | Get all pages in section | `section`: Section name |
| `{prefix}_refresh_content` | Force cache refresh | None |
| `{prefix}_get_code_blocks` | Extract code with syntax highlighting | `path`: Page path |
| `{prefix}_get_markdown` | Get formatted markdown | `path`: Page path |

### MCP Prompts
- `explain_section` - Generate comprehensive tutorials
- `summarize_page` - Create concise summaries
- `compare_sections` - Compare documentation sections
- `api_reference` - Format as API documentation
- `quick_start_guide` - Generate quick start guides

## 🌐 HTTP Interfaces

The server supports both MCP StreamableHTTP and traditional REST API:

**StreamableHTTP MCP Protocol:**
```bash
# Health check
curl http://localhost:3001/health

# MCP requests (requires MCP client)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'
```

**REST API (separate server):**
```bash
# Search content
curl "http://localhost:3000/api/search?q=authentication"

# Get specific page
curl "http://localhost:3000/api/page/api/authentication"

# Get page as markdown
curl "http://localhost:3000/api/page/api/authentication/markdown"

# Get code blocks
curl "http://localhost:3000/api/page/api/authentication/code"

# List sections
curl "http://localhost:3000/api/sections"

# Get section pages
curl "http://localhost:3000/api/sections/API/pages"

# Server status
curl "http://localhost:3000/api/status"

# Refresh cache
curl -X POST "http://localhost:3000/api/refresh"
```

## 🎯 Usage Examples

### Auto-Detection Results
- `docs.stripe.com` → `stripe_search_content`, `stripe_get_page`
- `docs.react.dev` → `react_search_content`, `react_get_page`  
- `api.yourcompany.com` → `api_search_content`, `api_get_page`
- Generic sites → `docs_search_content`, `docs_get_page`

### MCP Tool Usage
```bash
# Search for authentication docs
{"tool": "api_search_content", "arguments": {"query": "oauth authentication"}}

# Get specific page
{"tool": "api_get_page", "arguments": {"path": "/auth/oauth"}}

# Get code examples
{"tool": "api_get_code_blocks", "arguments": {"path": "/sdk/quickstart"}}

# Refresh content
{"tool": "api_refresh_content", "arguments": {}}
```

## 🏗️ Architecture

- **SQLite Storage** - Fast startup with FTS5 full-text search
- **Background Updates** - Non-blocking change detection
- **Auto-Detection** - Domain and keyword extraction
- **Parallel Scraping** - Configurable concurrency
- **Smart Caching** - Only updates changed content

### Key Components
- `GitBookScraper` - Web scraping and content extraction
- `SQLiteStore` - High-performance storage with FTS5 search
- `DomainDetector` - Automatic domain and keyword detection
- `GitBookMCPServer` - MCP server with tool handlers
- `GitBookRestAPI` - HTTP endpoints for web integration

## 🔧 Development

```bash
# Development mode with auto-reload
npm run dev

# Build with auto-detection
npm run build

# Run manual auto-detection
npm run auto-detect

# Clean build (no auto-detection)
npm run build:clean

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## 🌍 Universal GitBook Support

Works with any public GitBook, including:

- **API Documentation** - Stripe, Twilio, etc.
- **Framework Docs** - React, Vue, Angular
- **Product Guides** - Help centers and tutorials  
- **Developer Resources** - SDKs and references
- **Company Wikis** - Internal documentation

## ⚡ Performance

- **Instant Startup**: Sub-second initialization with SQLite cache
- **Background Updates**: Non-blocking change detection
- **Smart Indexing**: FTS5 full-text search with ranking
- **Efficient Storage**: SQLite replaces slow JSON parsing
- **Memory Optimized**: On-demand loading instead of full memory cache

## 🚧 Limitations

- **Public GitBooks Only** - Requires publicly accessible sites
- **Static Content** - Scrapes published HTML, not API-based
- **Manual Refresh** - No real-time updates (use refresh tool)
- **Text-Focused** - Extracts text content, not interactive elements

## 📄 License

MIT

---

**Need help?** Check the [MCP documentation](https://modelcontextprotocol.io) or open an issue.
