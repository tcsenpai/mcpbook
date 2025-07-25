#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { config } = require('dotenv');

// ANSI colors
const colors = {
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

const { green, blue, yellow, cyan, bold, reset } = colors;

async function inspectCache() {
  try {
    // Load environment variables from the binary's directory
    const envPath = path.join(__dirname, '..', '.env');
    config({ path: envPath });
    
    console.log(`${bold}${cyan}🔍 Cache Inspector${reset}\n`);
    
    // Import modules after config is loaded
    const { SQLiteStore } = await import('../dist/sqliteStore.js');
    const { gitBookConfig } = await import('../dist/config.js');
    
    if (!gitBookConfig.gitbookUrl) {
      console.log(`${yellow}⚠️  No GITBOOK_URL configured${reset}`);
      process.exit(1);
    }
    
    console.log(`${blue}📖 GitBook:${reset} ${gitBookConfig.gitbookUrl}`);
    console.log(`${blue}🏷️  Server:${reset} ${gitBookConfig.serverName}`);
    console.log();
    
    // Initialize store
    const store = new SQLiteStore(gitBookConfig.gitbookUrl);
    
    // Get basic stats
    const pageCount = await store.getPageCount();
    const metadata = store.getMetadata('last_updated');
    const domainInfo = store.getDomainInfo();
    
    console.log(`${bold}📊 Cache Statistics${reset}`);
    console.log(`${green}📄 Total Pages:${reset} ${pageCount}`);
    console.log(`${green}🕒 Last Updated:${reset} ${metadata ? new Date(parseInt(metadata)).toLocaleString() : 'Never'}`);
    console.log(`${green}🎯 Domain:${reset} ${domainInfo ? domainInfo.name : 'Not detected'}`);
    console.log(`${green}🔧 Tool Prefix:${reset} ${domainInfo ? domainInfo.toolPrefix : 'generic_'}`);
    console.log();
    
    // Check for --sample flag
    const showSample = process.argv.includes('--sample') || process.argv.includes('-s');
    const sampleSize = parseInt(process.argv.find(arg => arg.startsWith('--size='))?.split('=')[1]) || 5;
    
    if (showSample && pageCount > 0) {
      console.log(`${bold}🎲 Sample Records (${sampleSize} random pages)${reset}`);
      console.log(`${cyan}${'='.repeat(60)}${reset}`);
      
      const samplePages = await store.getSamplePages(sampleSize);
      
      for (const [index, page] of samplePages.entries()) {
        const contentPreview = page.content.slice(0, 100).replace(/\n/g, ' ');
        const lastUpdated = page.lastUpdated ? new Date(page.lastUpdated).toLocaleDateString() : 'Unknown';
        
        console.log(`${bold}${index + 1}. ${page.path}${reset}`);
        console.log(`   ${blue}Title:${reset} ${page.title || 'No title'}`);
        console.log(`   ${blue}Updated:${reset} ${lastUpdated}`);
        console.log(`   ${blue}Content:${reset} ${contentPreview}${page.content.length > 100 ? '...' : ''}`);
        console.log(`   ${blue}Size:${reset} ${page.content.length} chars`);
        console.log();
      }
    }
    
    // Storage info
    const dbPath = store.dbPath;
    try {
      const stats = await fs.stat(dbPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`${bold}💾 Storage Info${reset}`);
      console.log(`${green}📁 Database:${reset} ${dbPath}`);
      console.log(`${green}💿 Size:${reset} ${sizeMB} MB`);
    } catch (error) {
      console.log(`${yellow}⚠️  Database file not found: ${dbPath}${reset}`);
    }
    
    store.close();
    
    console.log(`\n${bold}💡 Usage Tips${reset}`);
    console.log(`${cyan}--sample, -s${reset}     Show sample records`);
    console.log(`${cyan}--size=N${reset}        Number of sample records (default: 5)`);
    console.log(`\n${blue}Examples:${reset}`);
    console.log(`${cyan}npm run inspect-cache --sample${reset}`);
    console.log(`${cyan}npm run inspect-cache --sample --size=10${reset}`);
    
  } catch (error) {
    console.error(`${bold}❌ Error: ${error.message}${reset}`);
    process.exit(1);
  }
}

// Run inspector if this script is executed directly
if (require.main === module) {
  inspectCache();
}

module.exports = { inspectCache };