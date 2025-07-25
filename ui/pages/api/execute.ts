import { NextApiRequest, NextApiResponse } from 'next'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

interface ExecuteRequest {
  command: string
  args?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { command, args }: ExecuteRequest = req.body

  if (!command) {
    return res.status(400).json({ error: 'Command is required' })
  }

  try {
    // Get the project root directory (where package.json is)
    const projectRoot = path.join(__dirname, '../../../../../')
    
    // Handle special commands that need custom logic
    if (command === 'delete' && args) {
      return await handleDeleteServer(res, args)
    }

    if (command === 'claude-add-mcp' && args) {
      return await handleClaudeAddMcp(res, args)
    }

    // Map UI commands to actual CLI commands
    const commandMap: Record<string, { cmd: string; args: string[] }> = {
      'create-mcp-headless': { cmd: 'node', args: ['scripts/create-mcp-headless.js'] },
      'refresh-content': { cmd: 'node', args: ['scripts/init-fetch.js'] },
      'rebuild': { cmd: 'npm', args: ['run', 'build'] },
      'inspect-cache': { cmd: 'node', args: ['scripts/inspect-cache.js'] },
      'start': { cmd: 'npm', args: ['start'] },
      'stop': { cmd: 'pkill', args: ['-f'] },
      'claude-add-mcp': { cmd: 'claude', args: ['mcp', 'add', '-s', 'user'] },
    }

    const commandInfo = commandMap[command]
    if (!commandInfo) {
      return res.status(400).json({ error: `Unknown command: ${command}` })
    }
    
    // For now, just return success for commands we haven't implemented yet
    if (command === 'create-mcp') {
      // The create-mcp command needs to be run interactively, so we'll handle this differently
      return res.status(200).json({ 
        success: true, 
        message: 'Interactive command not yet supported in WebUI. Use CLI for now.',
        output: 'To create a new server, please use: npm run create-mcp'
      })
    }

    // Execute simple commands
    const child = spawn(commandInfo.cmd, commandInfo.args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    let error = ''

    child.stdout?.on('data', (data) => {
      output += data.toString()
    })

    child.stderr?.on('data', (data) => {
      error += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        res.status(200).json({ 
          success: true, 
          output: output || 'Command completed successfully',
          command: `${commandInfo.cmd} ${commandInfo.args.join(' ')}`
        })
      } else {
        res.status(500).json({ 
          success: false, 
          error: error || 'Command failed',
          code 
        })
      }
    })

    // Handle timeout
    setTimeout(() => {
      child.kill()
      res.status(408).json({ error: 'Command timeout' })
    }, 30000) // 30 second timeout

  } catch (error) {
    console.error('Error executing command:', error)
    res.status(500).json({ error: 'Failed to execute command' })
  }
}

// Get the servers directory path (same logic as servers.ts)
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

async function handleDeleteServer(res: NextApiResponse, serverName: string) {
  try {
    // SECURITY: Validate serverName to prevent path traversal
    if (!serverName || serverName.includes('..') || serverName.includes('/') || serverName.includes('\\')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid server name format' 
      })
    }

    // SECURITY: Additional validation for safe characters only
    if (!/^[a-zA-Z0-9-_]+$/.test(serverName)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Server name contains invalid characters' 
      })
    }

    const serversDir = getServersDirectory()
    const serverPath = path.join(serversDir, serverName)
    
    // SECURITY: Ensure resolved path is within servers directory
    const resolvedPath = path.resolve(serverPath)
    const resolvedServersDir = path.resolve(serversDir)
    if (!resolvedPath.startsWith(resolvedServersDir)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid server path' 
      })
    }
    
    // Check if server directory exists
    try {
      await fs.access(serverPath)
    } catch (error) {
      return res.status(404).json({ 
        success: false, 
        error: `Server '${serverName}' not found` 
      })
    }
    
    // Remove the server directory
    await fs.rm(serverPath, { recursive: true, force: true })
    
    return res.status(200).json({ 
      success: true, 
      message: `Server '${serverName}' deleted successfully`,
      output: `Removed directory: ${serverPath}`
    })
    
  } catch (error) {
    console.error('Error deleting server:', error)
    return res.status(500).json({ 
      success: false, 
      error: `Failed to delete server: ${error instanceof Error ? error.message : 'Unknown error'}` 
    })
  }
}

async function handleClaudeAddMcp(res: NextApiResponse, args: string) {
  return new Promise<void>((resolve) => {
    // Parse args: "serverName pathToIndex"
    const [serverName, indexPath] = args.split(' ', 2)
    
    if (!serverName || !indexPath) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid arguments. Expected: serverName pathToIndex' 
      })
      resolve()
      return
    }

    // SECURITY: Validate serverName to prevent command injection
    if (!/^[a-zA-Z0-9-_]+$/.test(serverName)) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid server name format. Only alphanumeric characters, hyphens, and underscores allowed.' 
      })
      resolve()
      return
    }

    // SECURITY: Validate indexPath to prevent command injection and path traversal
    if (indexPath.includes('..') || indexPath.includes(';') || indexPath.includes('|') || indexPath.includes('&') || indexPath.includes('$')) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid index path. Path contains unsafe characters.' 
      })
      resolve()
      return
    }

    // Ensure indexPath ends with expected pattern
    if (!indexPath.endsWith('/dist/index.js')) {
      res.status(400).json({ 
        success: false, 
        error: 'Invalid index path. Must end with /dist/index.js' 
      })
      resolve()
      return
    }

    const { spawn } = require('child_process')
    
    const child = spawn('claude', ['mcp', 'add', '-s', 'user', serverName, indexPath], {
      stdio: 'pipe'
    })

    let output = ''
    let error = ''

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
    })

    child.stderr?.on('data', (data: Buffer) => {
      error += data.toString()
    })

    child.on('close', (code: number) => {
      if (code === 0) {
        res.status(200).json({ 
          success: true, 
          output: output || `Server '${serverName}' added to Claude Desktop successfully`,
          command: `claude mcp add -s user ${serverName} ${indexPath}`
        })
      } else {
        res.status(500).json({ 
          success: false, 
          error: error || `Command failed with code ${code}`,
          code 
        })
      }
      resolve()
    })

    child.on('error', (err: Error) => {
      res.status(500).json({ 
        success: false, 
        error: `Failed to execute claude command: ${err.message}. Make sure Claude CLI is installed.`
      })
      resolve()
    })

    // Handle timeout
    setTimeout(() => {
      child.kill()
      res.status(408).json({ 
        success: false, 
        error: 'Command timeout' 
      })
      resolve()
    }, 30000) // 30 second timeout
  })
}