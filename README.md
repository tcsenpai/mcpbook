# GitBook MCP Server

[![MCP Badge](https://lobehub.com/badge/mcp-full/tcsenpai-mcpbook)](https://lobehub.com/mcp/tcsenpai-mcpbook)

An MCP (Model Context Protocol) server that exposes GitBook content for AI assistants. This server scrapes and indexes GitBook documentation, making it searchable and accessible through MCP tools.

## Features

- **Universal GitBook Support**: Works with any public GitBook site
- **Smart Domain Detection**: Automatically detects and brands for your content
- **Advanced Search**: Fuzzy search with stemming, normalization, and ranking
- **Markdown Preservation**: Converts HTML to clean markdown with formatting preserved
- **Code Block Extraction**: Syntax highlighting and language detection for code examples
- **REST API**: HTTP endpoints alongside MCP for web integration
- **Intelligent Caching**: Only re-scrapes changed content for performance
- **Parallel Processing**: Fast scraping with configurable concurrency
- **MCP Prompts**: Pre-built prompts for documentation workflows
- **Respectful Scraping**: Rate limiting and error handling built-in

## Installation and Usage

### Install dependencies

```bash
npm install
```

### Configuration

#### Quick Start (Auto-Detection)

For most GitBooks, just set the URL and let auto-detection handle the rest:

```bash
cp .env.example .env
# Edit GITBOOK_URL in .env
echo "GITBOOK_URL=https://docs.yoursite.com" > .env
```

The server will automatically:
- Detect your domain and generate appropriate tool names
- Extract relevant keywords from your content
- Create contextual descriptions for better LLM integration

### Advanced Configuration

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

**Essential settings:**
- `GITBOOK_URL` - Target GitBook URL (required)
- `AUTO_DETECT_DOMAIN=true` - Let the server detect your domain (recommended)
- `AUTO_DETECT_KEYWORDS=true` - Extract keywords from content (recommended)

**Performance settings:**
- `CACHE_TTL_HOURS=1` - Cache expiration time
- `MAX_CONCURRENT_REQUESTS=5` - Parallel scraping limit
- `SCRAPING_DELAY_MS=100` - Delay between requests

**Branding (optional - auto-detected if not set):**
- `SERVER_NAME` - Custom server name
- `SERVER_DESCRIPTION` - Custom description
- `DOMAIN_KEYWORDS` - Comma-separated keywords
- `TOOL_PREFIX` - Prefix for tool names (e.g., `api_` → `api_search_content`)

### Examples

**Generic Documentation:**
```env
GITBOOK_URL=https://docs.yourcompany.com
AUTO_DETECT_DOMAIN=true
AUTO_DETECT_KEYWORDS=true
```

**API Documentation:**
```env
GITBOOK_URL=https://api-docs.yourservice.com
SERVER_NAME=yourservice-api-docs
DOMAIN_KEYWORDS=api,rest,graphql,endpoints,reference
TOOL_PREFIX=api_
```

**Product Documentation:**
```env
GITBOOK_URL=https://help.yourproduct.com
SERVER_NAME=yourproduct-help
DOMAIN_KEYWORDS=help,tutorial,guide,troubleshooting
TOOL_PREFIX=help_
```

## Usage

### From source

#### Building the MCP server

```bash
npm run build
chmod +x dist/index.js
```

#### Running the Server

```bash
npm start
```

#### Installing in Claude Desktop

1. Build the project: `npm run build`
2. Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gitbook": {
      "command": "node",
      "args": ["/absolute/path/to/your/mcpbook/dist/index.js"],
      "env": {}
    }
  }
}
```

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Global Installation

## Name your server

Edit `package.json` changing the name of the server to a name you like, for example `my-awesome-mcp`. Remember to edit the `bin` section too.

## Install the server as a binary

```bash
npm install -g .
```

### Then in Claude Desktop config:
```json
{
  "mcpServers": {
    "gitbook": {
      "command": "my-awesome-mcp"
    }
  }
}
```

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Running as REST API

```bash
# Start REST API server on port 3000
npm run start:api

# Or specify custom port
PORT=8080 npm run start:api
```

The REST API provides HTTP endpoints for all MCP functionality:

```bash
# API documentation
curl http://localhost:3000/api

# Search content
curl "http://localhost:3000/api/search?q=authentication"

# Get specific page
curl http://localhost:3000/api/page/sdk/websdk

# Get page as markdown
curl http://localhost:3000/api/page/sdk/websdk/markdown

# Get code blocks from page
curl http://localhost:3000/api/page/api/endpoints/code

# List all sections
curl http://localhost:3000/api/sections

# Get pages in a section
curl http://localhost:3000/api/sections/SDK/pages

# Server status and stats
curl http://localhost:3000/api/status

# Refresh content cache
curl -X POST http://localhost:3000/api/refresh
```

## Available Tools

The server exposes MCP tools with automatic prefixing based on your content:

**Auto-detected examples:**
- For `docs.stripe.com` → `stripe_search_content`, `stripe_get_page`
- For `docs.yourapi.com` → `api_search_content`, `api_get_page`
- For generic sites → `docs_search_content`, `docs_get_page`

**Core Tools:**

1. **`{prefix}_search_content`** - Advanced search across all content
   - `query` (string): Search query with fuzzy matching and stemming

2. **`{prefix}_get_page`** - Get a specific page by path
   - `path` (string): Page path (e.g., "/api/authentication")

3. **`{prefix}_list_sections`** - Get the complete table of contents

4. **`{prefix}_get_section_pages`** - Get all pages in a section
   - `section` (string): Section name (e.g., "API Reference")

5. **`{prefix}_refresh_content`** - Force refresh of cached content

6. **`{prefix}_get_code_blocks`** - Extract code blocks with syntax highlighting
   - `path` (string): Page path (e.g., "/api/authentication")

7. **`{prefix}_get_markdown`** - Get page content as formatted markdown
   - `path` (string): Page path (e.g., "/api/authentication")

**MCP Prompts:**

1. **`explain_section`** - Generate comprehensive section tutorials
2. **`summarize_page`** - Create concise page summaries  
3. **`compare_sections`** - Compare different documentation sections
4. **`api_reference`** - Format content as API documentation
5. **`quick_start_guide`** - Generate quick start guides

## Example Usage

With auto-detection, tool names adapt to your content:

```bash
# For API documentation (auto-detected)
{"tool": "api_search_content", "arguments": {"query": "authentication"}}
{"tool": "api_get_page", "arguments": {"path": "/auth/oauth"}}

# For product docs (auto-detected)  
{"tool": "product_search_content", "arguments": {"query": "billing"}}
{"tool": "product_get_section_pages", "arguments": {"section": "Getting Started"}}

# Generic documentation
{"tool": "docs_search_content", "arguments": {"query": "installation"}}
{"tool": "docs_refresh_content", "arguments": {}}
```

## AI Integration

The server is designed for optimal AI assistant integration:

**When the AI will use your MCP:**
- Questions about your specific product/API (detected from content)
- Searches using keywords found in your documentation
- Requests for tutorials, guides, or references related to your domain

**Smart tool descriptions:**
- Auto-generated descriptions include your domain keywords
- Tool names reflect your content type (API, product docs, etc.)
- Enhanced context helps AI choose the right MCP server

## Architecture

- **`GitBookScraper`**: Handles web scraping, content extraction, and markdown conversion
- **`ContentStore`**: Manages content storage and advanced search functionality
- **`GitBookMCPServer`**: Main MCP server implementation with tool handlers
- **`GitBookRestAPI`**: Express.js REST API server with HTTP endpoints
- **`DomainDetector`**: Auto-detection of domain branding and keywords
- **`TextProcessor`**: Content processing with stemming and normalization

## Development

```bash
# Development mode with auto-reload
npm run dev

# Build
npm run build

# Run built version
npm start
```

## How It Works

1. **Domain Detection**: Analyzes your GitBook content to detect domain and keywords
2. **Parallel Scraping**: Efficiently scrapes all pages using configurable concurrency
3. **Smart Indexing**: Processes content with stemming, normalization, and fuzzy search
4. **Change Detection**: Only re-scrapes modified pages for optimal performance
5. **MCP Integration**: Exposes domain-specific tools and prompts for AI assistants

## Universal GitBook Support

This MCP server works with **any public GitBook**, including:

- **Product Documentation** (Stripe, Twilio, etc.)
- **API References** (REST, GraphQL APIs)
- **Developer Guides** (SDKs, frameworks)
- **Help Centers** (Support documentation)
- **Internal Wikis** (Company knowledge bases)
- **Technical Blogs** (Engineering documentation)

**Auto-detection examples:**
- `docs.stripe.com` → Stripe API documentation tools
- `docs.react.dev` → React development tools  
- `help.github.com` → GitHub support tools
- `api.yourcompany.com` → Your API reference tools

## Limitations

- **Public GitBooks only** - Requires publicly accessible GitBook sites
- **Static content** - Not API-based, scrapes published HTML
- **Manual refresh** - No real-time updates (use `refresh_content` tool)
- **Text-focused** - Extracts text content, not complex interactive elements

## Deployment Options

**Local Development:**
```bash
npm run dev  # Development mode with auto-reload
```

**Production MCP Server:**
```bash
npm run build && npm start
```

**Production REST API:**
```bash
npm run build && npm run start:api
```

**Docker (optional):**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
CMD ["npm", "start"]
```

**Claude Desktop Integration:**
```json
{
  "mcpServers": {
    "your-docs": {
      "command": "node",
      "args": ["/path/to/your/dist/index.js"],
      "env": {
        "GITBOOK_URL": "https://docs.yoursite.com"
      }
    }
  }
}
```

## License

MIT
