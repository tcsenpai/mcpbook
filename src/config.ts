import { config } from 'dotenv';
import os from 'os';
import path from 'path';

// Load environment variables
config();

export interface GitBookConfig {
  gitbookUrl: string;
  cacheTtlHours: number;
  cacheFile: string;
  scrapingDelayMs: number;
  maxRetries: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  serverName: string;
  serverDescription: string;
  domainKeywords: string[];
  toolPrefix: string;
  autoDetectDomain: boolean;
  autoDetectKeywords: boolean;
  serverVersion: string;
  debug: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function getEnvVar(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseInt(value, 10) : defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  return value ? value.toLowerCase() === 'true' : defaultValue;
}

function getEnvArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  return value ? value.split(',').map(s => s.trim()) : defaultValue;
}

function generateCacheFileName(gitbookUrl: string): string {
  // Create a safe filename from the GitBook URL
  const urlObject = new URL(gitbookUrl);
  const hostname = urlObject.hostname.replace(/[^a-zA-Z0-9-]/g, '-');
  const pathname = urlObject.pathname.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'root';
  return `gitbook-cache-${hostname}-${pathname}.json`;
}

function getCacheDirectory(): string {
  // Use XDG_CONFIG_HOME if set, otherwise use ~/.config on Unix or AppData on Windows
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'mcpbooks');
  }
  
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'mcpbooks');
  } else {
    return path.join(homeDir, '.config', 'mcpbooks');
  }
}

export const gitBookConfig: GitBookConfig = {
  gitbookUrl: getEnvVar('GITBOOK_URL', 'https://docs.kynesys.xyz'),
  cacheTtlHours: getEnvNumber('CACHE_TTL_HOURS', 1),
  cacheFile: getEnvVar('CACHE_FILE', ''), // Will be generated based on GitBook URL
  scrapingDelayMs: getEnvNumber('SCRAPING_DELAY_MS', 100),
  maxRetries: getEnvNumber('MAX_RETRIES', 3),
  requestTimeoutMs: getEnvNumber('REQUEST_TIMEOUT_MS', 30000),
  maxConcurrentRequests: getEnvNumber('MAX_CONCURRENT_REQUESTS', 5),
  serverName: getEnvVar('SERVER_NAME', 'demos-network-docs'),
  serverDescription: getEnvVar('SERVER_DESCRIPTION', 'Demos Network and Kynesys blockchain documentation'),
  domainKeywords: getEnvArray('DOMAIN_KEYWORDS', ['demos', 'kynesys', 'blockchain', 'sdk', 'cross-chain', 'authentication']),
  toolPrefix: getEnvVar('TOOL_PREFIX', 'demos_'),
  autoDetectDomain: getEnvBoolean('AUTO_DETECT_DOMAIN', true),
  autoDetectKeywords: getEnvBoolean('AUTO_DETECT_KEYWORDS', true),
  serverVersion: getEnvVar('SERVER_VERSION', '1.0.0'),
  debug: getEnvBoolean('DEBUG', false),
  logLevel: (getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error'),
};

// Validate configuration
export function validateConfig(): void {
  if (!gitBookConfig.gitbookUrl) {
    throw new Error('GITBOOK_URL is required');
  }

  try {
    new URL(gitBookConfig.gitbookUrl);
  } catch (error) {
    throw new Error(`Invalid GITBOOK_URL: ${gitBookConfig.gitbookUrl}`);
  }

  if (gitBookConfig.cacheTtlHours < 0) {
    throw new Error('CACHE_TTL_HOURS must be non-negative');
  }

  if (gitBookConfig.scrapingDelayMs < 0) {
    throw new Error('SCRAPING_DELAY_MS must be non-negative');
  }

  if (gitBookConfig.maxRetries < 0) {
    throw new Error('MAX_RETRIES must be non-negative');
  }

  if (gitBookConfig.requestTimeoutMs < 1000) {
    throw new Error('REQUEST_TIMEOUT_MS must be at least 1000ms');
  }

  if (gitBookConfig.maxConcurrentRequests < 1) {
    throw new Error('MAX_CONCURRENT_REQUESTS must be at least 1');
  }
}

export function getCacheFilePath(gitbookUrl?: string): string {
  const url = gitbookUrl || gitBookConfig.gitbookUrl;
  
  // If CACHE_FILE is explicitly set, use it as-is
  if (gitBookConfig.cacheFile) {
    return gitBookConfig.cacheFile;
  }
  
  const cacheDir = getCacheDirectory();
  const cacheFileName = generateCacheFileName(url);
  return path.join(cacheDir, cacheFileName);
}

// Log configuration on startup
export function logConfig(): void {
  if (gitBookConfig.debug) {
    console.error('GitBook MCP Server Configuration:');
    console.error('- GitBook URL:', gitBookConfig.gitbookUrl);
    console.error('- Cache TTL:', gitBookConfig.cacheTtlHours, 'hours');
    console.error('- Cache File:', getCacheFilePath());
    console.error('- Scraping Delay:', gitBookConfig.scrapingDelayMs, 'ms');
    console.error('- Max Retries:', gitBookConfig.maxRetries);
    console.error('- Request Timeout:', gitBookConfig.requestTimeoutMs, 'ms');
    console.error('- Max Concurrent Requests:', gitBookConfig.maxConcurrentRequests);
    console.error('- Debug Mode:', gitBookConfig.debug);
    console.error('- Log Level:', gitBookConfig.logLevel);
  }
}