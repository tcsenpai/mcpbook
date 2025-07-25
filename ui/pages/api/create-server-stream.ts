import { NextApiRequest, NextApiResponse } from 'next'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

interface CreateServerRequest {
  gitbookUrl: string
  serverName: string
  description: string
  targetDir: string
  installGlobally: boolean
  addToClaudeDesktop: boolean
}

// SECURITY: Comprehensive validation function
function validateCreateServerConfig(config: CreateServerRequest): string[] {
  const errors: string[] = []
  
  // Server name validation
  if (!config.serverName) {
    errors.push('Server name is required')
  } else {
    if (config.serverName.length < 3 || config.serverName.length > 50) {
      errors.push('Server name must be 3-50 characters')
    }
    
    if (!/^[a-z0-9-]+$/.test(config.serverName)) {
      errors.push('Server name must contain only lowercase letters, numbers, and hyphens')
    }
    
    // Reserved names check
    const reservedNames = ['admin', 'root', 'system', 'config', 'api', 'www', 'mail', 'ftp']
    if (reservedNames.includes(config.serverName)) {
      errors.push('Server name is reserved')
    }
  }
  
  // URL validation
  if (!config.gitbookUrl) {
    errors.push('GitBook URL is required')
  } else {
    try {
      const url = new URL(config.gitbookUrl)
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push('Only HTTP/HTTPS URLs are allowed')
      }
      // Additional URL length check
      if (config.gitbookUrl.length > 2048) {
        errors.push('URL is too long (max 2048 characters)')
      }
    } catch {
      errors.push('Invalid URL format')
    }
  }
  
  // Description validation
  if (!config.description) {
    errors.push('Description is required')
  } else if (config.description.length > 500) {
    errors.push('Description is too long (max 500 characters)')
  }
  
  // Target directory validation (if provided)
  if (config.targetDir && (config.targetDir.includes('..') || config.targetDir.includes('\0'))) {
    errors.push('Invalid target directory path')
  }
  
  return errors
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const config: CreateServerRequest = req.body

  // SECURITY: Comprehensive input validation
  const validationErrors = validateCreateServerConfig(config)
  if (validationErrors.length > 0) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: validationErrors 
    })
  }

  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  })

  // Send initial connection message
  res.write('data: {"type":"connected","message":"Connected to creation stream"}\n\n')

  const sendSSE = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // Get the project root directory - go up from ui/pages/api to the main project
    const projectRoot = path.join(__dirname, '../../../../../')
    
    // Check if the headless script exists
    const scriptPath = path.join(projectRoot, 'scripts', 'create-mcp-headless.js')
    sendSSE({ type: 'info', message: `Looking for script at: ${scriptPath}` })
    
    try {
      await fs.access(scriptPath)
      sendSSE({ type: 'info', message: 'Headless script found' })
    } catch (error) {
      sendSSE({ type: 'error', message: `Headless script not found at: ${scriptPath}` })
      res.end()
      return
    }
    
    sendSSE({ type: 'info', message: 'Starting server creation...' })
    
    // Stream the creation process
    await streamServerCreation(projectRoot, config, sendSSE)
    
  } catch (error) {
    console.error('Error creating MCP server:', error)
    sendSSE({ 
      type: 'error', 
      message: error instanceof Error ? error.message : 'Failed to create MCP server' 
    })
  } finally {
    res.end()
  }
}

async function streamServerCreation(
  projectRoot: string, 
  config: CreateServerRequest, 
  sendSSE: (data: any) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const configJson = JSON.stringify(config)
    
    sendSSE({ type: 'info', message: `Creating server: ${config.serverName}` })
    sendSSE({ type: 'info', message: `Working directory: ${projectRoot}` })
    sendSSE({ type: 'info', message: `Command: node scripts/create-mcp-headless.js` })
    
    const child = spawn('node', ['scripts/create-mcp-headless.js', configJson], {
      cwd: projectRoot,
      stdio: 'pipe'
    })

    let allOutput = ''
    let errorOutput = ''

    child.stdout?.on('data', (data) => {
      const text = data.toString()
      allOutput += text
      
      // Send each line as a separate message
      const lines = text.split('\n').filter((line: string) => line.trim())
      lines.forEach((line: string) => {
        // Clean up ANSI codes for better display
        const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '')
        if (cleanLine.trim()) {
          sendSSE({ 
            type: 'output', 
            message: cleanLine.trim(),
            timestamp: new Date().toLocaleTimeString()
          })
        }
      })
    })

    child.stderr?.on('data', (data) => {
      const text = data.toString()
      errorOutput += text
      
      // Send error output as well
      const lines = text.split('\n').filter((line: string) => line.trim())
      lines.forEach((line: string) => {
        const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '')
        if (cleanLine.trim()) {
          sendSSE({ 
            type: 'error', 
            message: cleanLine.trim(),
            timestamp: new Date().toLocaleTimeString()
          })
        }
      })
    })

    child.on('close', (code) => {
      if (code === 0) {
        try {
          // Try to parse the last line as JSON (the result)
          const lines = allOutput.trim().split('\n')
          const lastLine = lines[lines.length - 1]
          const result = JSON.parse(lastLine)
          
          sendSSE({ 
            type: 'success', 
            message: `✅ Server '${result.serverName}' created successfully!`,
            result: result
          })
          
          resolve()
        } catch (parseError) {
          // If parsing fails, assume success with basic info
          sendSSE({ 
            type: 'success', 
            message: `✅ Server '${config.serverName}' created successfully!`,
            result: {
              success: true,
              serverName: config.serverName,
              targetDir: config.targetDir
            }
          })
          resolve()
        }
      } else {
        // Try to parse error output as JSON
        try {
          const errorResult = JSON.parse(errorOutput)
          sendSSE({ 
            type: 'error', 
            message: `❌ Failed to create server: ${errorResult.error}`,
            error: errorResult.error
          })
        } catch (parseError) {
          sendSSE({ 
            type: 'error', 
            message: `❌ Process failed with code ${code}`,
            error: errorOutput || `Process failed with code ${code}`
          })
        }
        reject(new Error(errorOutput || `Process failed with code ${code}`))
      }
    })

    child.on('error', (error) => {
      sendSSE({ 
        type: 'error', 
        message: `❌ Process error: ${error.message}`,
        error: error.message
      })
      reject(error)
    })
  })
}