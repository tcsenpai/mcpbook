#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { config } = require('dotenv');

// Load environment variables
config();

async function runInitialFetch() {
  try {
    console.log('🚀 Running initial fetch and cache population...');
    
    // Import the modules after config is loaded
    const { GitBookScraper } = await import('../dist/scraper.js');
    const { SQLiteStore } = await import('../dist/sqliteStore.js');
    const { DomainDetector } = await import('../dist/domainDetector.js');
    const { gitBookConfig, getCacheFilePath } = await import('../dist/config.js');
    
    // Check if URL is provided
    if (!gitBookConfig.gitbookUrl) {
      console.log('❌ GITBOOK_URL not provided, cannot run initial fetch');
      process.exit(1);
    }
    
    // Check if cache already exists and has content
    const store = new SQLiteStore(gitBookConfig.gitbookUrl);
    const pageCount = await store.getPageCount();
    
    if (pageCount > 0) {
      console.log(`✅ Cache already populated with ${pageCount} pages, skipping fetch`);
      console.log('💡 Use refresh_content tool or delete cache file to force re-fetch');
      store.close();
      return;
    }
    
    console.log(`📖 Fetching content from: ${gitBookConfig.gitbookUrl}`);
    
    // Progress tracking
    let lastProgressTime = Date.now();
    let progressLine = '';
    
    // Create progress callback
    const progressCallback = (progress) => {
      const now = Date.now();
      // Update progress line every 5 seconds or on significant changes
      if (now - lastProgressTime > 5000 || progress.completed === 0) {
        const percentage = progress.discovered > 0 ? Math.round((progress.completed / progress.discovered) * 100) : 0;
        const newLine = `   📊 Progress: ${progress.completed}/${progress.discovered} pages (${percentage}%) | ❌ ${progress.failed} failed`;
        
        // Clear previous line and show new progress
        if (progressLine) {
          process.stdout.write('\r' + ' '.repeat(progressLine.length) + '\r');
        }
        process.stdout.write(newLine);
        progressLine = newLine;
        lastProgressTime = now;
      }
    };
    
    // Show initial status
    console.log('🔍 Starting discovery phase...');
    
    // Create scraper with progress callback
    const scraper = new GitBookScraper(gitBookConfig.gitbookUrl, progressCallback);
    await scraper.scrapeAll();
    const content = scraper.getContent();
    
    // Clear progress line and show completion
    if (progressLine) {
      process.stdout.write('\r' + ' '.repeat(progressLine.length) + '\r');
    }
    
    // Check if we got content
    if (Object.keys(content).length === 0) {
      console.log('⚠️  No content scraped, check URL and connectivity');
      store.close();
      process.exit(1);
    }
    
    console.log(`📄 Scraped ${Object.keys(content).length} pages`);
    
    // Store content in SQLite
    await store.updateContent(content);
    
    // Detect and cache domain info
    const domainInfo = DomainDetector.detectDomain(content, gitBookConfig.gitbookUrl);
    store.setDomainInfo(domainInfo);
    
    // Report any failures
    const failureStats = scraper.getFailureStats();
    if (failureStats.failedPages.length > 0) {
      console.log(`⚠️  ${failureStats.failedPages.length} pages failed to scrape:`);
      failureStats.failedPages.slice(0, 5).forEach(path => {
        console.log(`   - ${path}`);
      });
      if (failureStats.failedPages.length > 5) {
        console.log(`   ... and ${failureStats.failedPages.length - 5} more`);
      }
    }
    
    store.close();
    
    // Clean up JSON cache file if it exists
    const jsonCacheFile = getCacheFilePath(gitBookConfig.gitbookUrl);
    try {
      await fs.unlink(jsonCacheFile);
      console.log('🧹 Cleaned up temporary JSON cache file');
    } catch (error) {
      // Cache file might not exist, ignore
    }
    
    console.log('✅ Initial fetch completed successfully!');
    console.log('🚀 Server will now start instantly with cached content');
    
  } catch (error) {
    console.error('❌ Initial fetch failed:', error.message);
    process.exit(1);
  }
}

// Run initial fetch if this script is executed directly
if (require.main === module) {
  runInitialFetch();
}

module.exports = { runInitialFetch };