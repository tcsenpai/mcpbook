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

  // Create abort controller to handle request cancellation
  const abortController = new AbortController()
  
  // Listen for client disconnect
  req.on('close', () => {
    abortController.abort()
  })

  try {
    // Get the project root directory
    const projectRoot = path.join(__dirname, '../../../../..//')
    
    // Check if the headless script exists
    const scriptPath = path.join(projectRoot, 'scripts', 'create-mcp-headless.js')
    try {
      await fs.access(scriptPath)
    } catch (error) {
      return res.status(500).json({ error: 'Headless script not found' })
    }
    
    // Use the headless script to create the server
    const result = await createMCPServerHeadless(projectRoot, config, abortController.signal)
    
    res.status(200).json(result)

  } catch (error) {
    console.error('Error creating MCP server:', error)
    res.status(500).json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create MCP server' 
    })
  }
}

async function createMCPServerHeadless(projectRoot: string, config: CreateServerRequest, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    const configJson = JSON.stringify(config)
    
    const child = spawn('node', ['scripts/create-mcp-headless.js', configJson], {
      cwd: projectRoot,
      stdio: 'pipe'
    })

    let output = ''
    let errorOutput = ''

    // Handle abort signal
    const abortHandler = () => {
      child.kill('SIGTERM')
      reject(new Error('Request aborted'))
    }

    if (signal) {
      if (signal.aborted) {
        child.kill('SIGTERM')
        reject(new Error('Request aborted'))
        return
      }
      signal.addEventListener('abort', abortHandler)
    }

    child.stdout?.on('data', (data) => {
      output += data.toString()
    })

    child.stderr?.on('data', (data) => {
      errorOutput += data.toString()
    })

    child.on('close', (code) => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }

      if (code === 0) {
        try {
          // Try to parse the last line as JSON (the result)
          const lines = output.trim().split('\n')
          const lastLine = lines[lines.length - 1]
          const result = JSON.parse(lastLine)
          resolve(result)
        } catch (parseError) {
          // If parsing fails, assume success with basic info
          resolve({
            success: true,
            message: 'MCP server created successfully',
            serverName: config.serverName,
            targetDir: config.targetDir,
            output: output
          })
        }
      } else {
        // Try to parse error output as JSON
        try {
          const errorResult = JSON.parse(errorOutput)
          reject(new Error(errorResult.error || 'Unknown error'))
        } catch (parseError) {
          reject(new Error(errorOutput || `Process failed with code ${code}`))
        }
      }
    })

    child.on('error', (error) => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }
      reject(error)
    })
  })
}