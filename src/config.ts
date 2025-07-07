import { config } from 'dotenv';

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

export const gitBookConfig: GitBookConfig = {
  gitbookUrl: getEnvVar('GITBOOK_URL', 'https://docs.kynesys.xyz'),
  cacheTtlHours: getEnvNumber('CACHE_TTL_HOURS', 1),
  cacheFile: getEnvVar('CACHE_FILE', '.gitbook-cache.json'),
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

// Log configuration on startup
export function logConfig(): void {
  if (gitBookConfig.debug) {
    console.error('GitBook MCP Server Configuration:');
    console.error('- GitBook URL:', gitBookConfig.gitbookUrl);
    console.error('- Cache TTL:', gitBookConfig.cacheTtlHours, 'hours');
    console.error('- Cache File:', gitBookConfig.cacheFile);
    console.error('- Scraping Delay:', gitBookConfig.scrapingDelayMs, 'ms');
    console.error('- Max Retries:', gitBookConfig.maxRetries);
    console.error('- Request Timeout:', gitBookConfig.requestTimeoutMs, 'ms');
    console.error('- Max Concurrent Requests:', gitBookConfig.maxConcurrentRequests);
    console.error('- Debug Mode:', gitBookConfig.debug);
    console.error('- Log Level:', gitBookConfig.logLevel);
  }
}