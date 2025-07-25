#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { config } = require('dotenv');

// Load environment variables
config();

async function runAutoDetection() {
  try {
    console.log('🔍 Running auto-detection...');
    
    // Import the modules after config is loaded
    const { GitBookScraper } = await import('../dist/scraper.js');
    const { SQLiteStore } = await import('../dist/sqliteStore.js');
    const { DomainDetector } = await import('../dist/domainDetector.js');
    const { gitBookConfig, getCacheFilePath } = await import('../dist/config.js');
    
    // Check if auto-detection is enabled
    if (!gitBookConfig.autoDetectDomain) {
      console.log('⏭️  Auto-detection disabled, skipping...');
      return;
    }
    
    // Check if URL is provided
    if (!gitBookConfig.gitbookUrl) {
      console.log('❌ GITBOOK_URL not provided, cannot run auto-detection');
      process.exit(1);
    }
    
    // Check if configuration is already set
    if (gitBookConfig.serverName && gitBookConfig.serverDescription && gitBookConfig.domainKeywords.length > 0) {
      console.log('✅ Configuration already detected, skipping auto-detection');
      return;
    }
    
    console.log(`📖 Scraping content from: ${gitBookConfig.gitbookUrl}`);
    
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
    
    // Create scraper with progress callback
    const scraper = new GitBookScraper(gitBookConfig.gitbookUrl, progressCallback);
    await scraper.scrapeAll();
    const content = scraper.getContent();
    
    // Clear progress line and show completion
    if (progressLine) {
      process.stdout.write('\r' + ' '.repeat(progressLine.length) + '\r');
    }
    
    // Only proceed if we have content
    if (Object.keys(content).length === 0) {
      console.log('⚠️  No content scraped, cannot run auto-detection');
      return;
    }
    
    // Detect domain information
    console.log('🧠 Analyzing content for auto-detection...');
    const domainInfo = DomainDetector.detectDomain(content, gitBookConfig.gitbookUrl);
    
    console.log('🎯 Detection results:');
    console.log(`   Name: ${domainInfo.name}`);
    console.log(`   Description: ${domainInfo.description}`);
    console.log(`   Keywords: ${domainInfo.keywords.join(', ')}`);
    console.log(`   Tool Prefix: ${domainInfo.toolPrefix}`);
    
    // Update .env file
    await updateEnvFile(domainInfo);
    
    // Store content in SQLite for faster future startups
    const store = new SQLiteStore(gitBookConfig.gitbookUrl);
    await store.updateContent(content);
    store.close();
    console.log('💾 Stored content in SQLite cache for fast startup');
    
    // Clean up JSON cache file if it exists
    const jsonCacheFile = getCacheFilePath(gitBookConfig.gitbookUrl);
    try {
      await fs.unlink(jsonCacheFile);
      console.log('🧹 Cleaned up temporary JSON cache file');
    } catch (error) {
      // Cache file might not exist, ignore
    }
    
    console.log('✅ Auto-detection completed successfully!');
    
  } catch (error) {
    console.error('❌ Auto-detection failed:', error.message);
    process.exit(1);
  }
}

async function updateEnvFile(domainInfo) {
  const envPath = path.join(process.cwd(), '.env');
  
  try {
    // Read current .env file
    const envContent = await fs.readFile(envPath, 'utf8');
    let updatedContent = envContent;
    
    // Update or add configuration values
    const updates = {
      'SERVER_NAME': domainInfo.name,
      'SERVER_DESCRIPTION': domainInfo.description,
      'DOMAIN_KEYWORDS': domainInfo.keywords.join(','),
      'TOOL_PREFIX': domainInfo.toolPrefix,
      'AUTO_DETECT_DOMAIN': 'false' // Disable auto-detection after first run
    };
    
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm');
      const newLine = `${key}=${value}`;
      
      if (regex.test(updatedContent)) {
        // Update existing line
        updatedContent = updatedContent.replace(regex, newLine);
      } else {
        // Add new line
        updatedContent += `\n${newLine}`;
      }
    }
    
    // Write updated .env file
    await fs.writeFile(envPath, updatedContent);
    console.log('📝 Updated .env file with detected configuration');
    
  } catch (error) {
    console.error('❌ Failed to update .env file:', error.message);
    throw error;
  }
}

// Run auto-detection if this script is executed directly
if (require.main === module) {
  runAutoDetection();
}

module.exports = { runAutoDetection };