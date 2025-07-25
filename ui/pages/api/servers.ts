import { NextApiRequest, NextApiResponse } from 'next'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

interface Server {
  name: string
  url: string
  status: 'running' | 'stopped' | 'error'
  path: string
  lastUpdated: string
  pageCount?: number
}

// Get the servers directory path (same logic as create-mcp.js)
function getServersDirectory(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'mcpbooks', 'servers');
  }
  
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'mcpbooks', 'servers');
  } else {
    return path.join(homeDir, '.config', 'mcpbooks', 'servers');
  }
}

async function getServerInfo(serverPath: string, serverName: string): Promise<Server | null> {
  try {
    // Read .env file for URL
    const envPath = path.join(serverPath, '.env')
    let url = 'Unknown'
    let pageCount: number | undefined
    
    try {
      const envContent = await fs.readFile(envPath, 'utf8')
      const urlMatch = envContent.match(/GITBOOK_URL=(.+)/)
      if (urlMatch) {
        url = urlMatch[1]
      }
    } catch (error) {
      // .env file might not exist
    }

    // Check if SQLite cache exists and get page count
    try {
      const { SQLiteStore } = await import('../../../dist/sqliteStore.js')
      const store = new SQLiteStore(url)
      pageCount = await store.getPageCount()
      store.close()
    } catch (error) {
      // SQLite might not be available yet
    }

    // Get last modified time
    const stat = await fs.stat(serverPath)
    const lastUpdated = stat.mtime.toLocaleDateString()

    // Determine status (simplified - just check if directory exists)
    const status: 'running' | 'stopped' | 'error' = 'stopped' // TODO: Implement actual status check

    return {
      name: serverName,
      url,
      status,
      path: serverPath,
      lastUpdated,
      pageCount
    }
  } catch (error) {
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const serversDir = getServersDirectory()
    
    // Check if servers directory exists
    try {
      await fs.access(serversDir)
    } catch (error) {
      // Directory doesn't exist, return empty array
      return res.status(200).json({ servers: [] })
    }

    // Read all server directories
    const entries = await fs.readdir(serversDir, { withFileTypes: true })
    const serverDirs = entries.filter(entry => entry.isDirectory())

    // Get info for each server
    const servers: Server[] = []
    for (const dir of serverDirs) {
      const serverPath = path.join(serversDir, dir.name)
      const serverInfo = await getServerInfo(serverPath, dir.name)
      if (serverInfo) {
        servers.push(serverInfo)
      }
    }

    // Sort by last updated (newest first)
    servers.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

    res.status(200).json({ servers })
  } catch (error) {
    console.error('Error loading servers:', error)
    res.status(500).json({ error: 'Failed to load servers' })
  }
}