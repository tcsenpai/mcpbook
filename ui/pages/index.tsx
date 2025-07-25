import { useState, useEffect } from 'react'
import Head from 'next/head'
import Terminal from '../components/Terminal'
import ServerCard from '../components/ServerCard'
import ActionButtons from '../components/ActionButtons'
import ServerWizard from '../components/ServerWizard'

interface Server {
  name: string
  url: string
  status: 'running' | 'stopped' | 'error' | 'pending'
  path: string
  lastUpdated: string
  pageCount?: number
}

export default function Home() {
  const [servers, setServers] = useState<Server[]>([])
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [creatingServerName, setCreatingServerName] = useState<string | null>(null)
  const [creationAbortController, setCreationAbortController] = useState<AbortController | null>(null)

  useEffect(() => {
    // Load servers on mount
    loadServers()
  }, [])

  // Add page refresh/close warning during creation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isCreating) {
        e.preventDefault()
        e.returnValue = 'A server is currently being created. Are you sure you want to leave?'
        return 'A server is currently being created. Are you sure you want to leave?'
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isCreating])

  const loadServers = async () => {
    try {
      const response = await fetch('/api/servers')
      const data = await response.json()
      setServers(data.servers || [])
    } catch (error) {
      addToTerminal(`Error loading servers: ${error}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const addToTerminal = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    const colorClass = type === 'error' ? 'text-terminal-red' : 
                      type === 'success' ? 'text-terminal-green' : 
                      'text-terminal-text'
    
    setTerminalOutput(prev => [
      ...prev,
      `<span class="text-terminal-blue">[${timestamp}]</span> <span class="${colorClass}">${message}</span>`
    ])
  }

  const handleCreateServer = () => {
    setShowWizard(true)
  }

  const handleCancelCreation = async () => {
    if (!creatingServerName || !creationAbortController) return
    
    addToTerminal(`⚠️ Cancelling server creation for '${creatingServerName}'...`, 'info')
    
    // Abort the fetch request
    creationAbortController.abort()
    
    // Clean up any partially created server
    try {
      await fetch('/api/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command: 'delete', args: creatingServerName }),
      })
      addToTerminal(`🧹 Cleaned up partial server creation`, 'info')
    } catch (error) {
      // Cleanup error is not critical, just log it
      console.warn('Failed to cleanup cancelled server:', error)
    }
  }

  const handleCopyMcpConfig = async () => {
    const mcpConfig = {
      mcpServers: servers.reduce((acc, server) => {
        if (server.status !== 'pending') {
          acc[server.name] = {
            command: 'node',
            args: [`${server.path}/dist/index.js`],
            env: {
              GITBOOK_URL: server.url
            }
          }
        }
        return acc
      }, {} as Record<string, any>)
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(mcpConfig, null, 2))
      addToTerminal(`📋 Copied mcpServers config to clipboard!`, 'success')
      addToTerminal(`💡 Paste this into your Claude Desktop config file`, 'info')
    } catch (error) {
      addToTerminal(`❌ Failed to copy to clipboard: ${error}`, 'error')
    }
  }

  const handleAddToClaude = async () => {
    const readyServers = servers.filter(s => s.status !== 'pending')
    if (readyServers.length === 0) {
      addToTerminal(`⚠️ No servers ready to add to Claude`, 'info')
      return
    }

    // Show confirmation with commands that will be executed
    const commands = readyServers.map(server => 
      `claude mcp add -s user ${server.name} ${server.path}/dist/index.js`
    ).join('\n')
    
    const confirmed = confirm(
      `This will execute the following Claude CLI commands:\n\n${commands}\n\nDo you want to continue?`
    )
    
    if (!confirmed) {
      addToTerminal(`⚠️ Bulk add to Claude cancelled by user`, 'info')
      return
    }

    addToTerminal(`🤖 Adding ${readyServers.length} server(s) to Claude Desktop...`, 'info')
    
    let successCount = 0
    for (const server of readyServers) {
      try {
        const response = await fetch('/api/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            command: 'claude-add-mcp', 
            args: `${server.name} ${server.path}/dist/index.js` 
          }),
        })

        if (response.ok) {
          addToTerminal(`✅ Added '${server.name}' to Claude Desktop`, 'success')
          successCount++
        } else {
          addToTerminal(`❌ Failed to add '${server.name}' to Claude Desktop`, 'error')
        }
      } catch (error) {
        addToTerminal(`❌ Error adding '${server.name}': ${error}`, 'error')
      }
    }

    if (successCount > 0) {
      addToTerminal(`🎉 Successfully added ${successCount} server(s) to Claude Desktop!`, 'success')
      addToTerminal(`💡 Restart Claude Desktop to use the new servers`, 'info')
    }
  }

  const handleCopyMcpConfigSingle = async (serverName: string) => {
    const server = servers.find(s => s.name === serverName)
    if (!server || server.status === 'pending') return

    const mcpConfig = {
      mcpServers: {
        [server.name]: {
          command: 'node',
          args: [`${server.path}/dist/index.js`],
          env: {
            GITBOOK_URL: server.url
          }
        }
      }
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(mcpConfig, null, 2))
      addToTerminal(`📋 Copied config for '${server.name}' to clipboard!`, 'success')
    } catch (error) {
      addToTerminal(`❌ Failed to copy config: ${error}`, 'error')
    }
  }

  const handleAddToClaudeSingle = async (serverName: string) => {
    const server = servers.find(s => s.name === serverName)
    if (!server || server.status === 'pending') return

    // Show confirmation with the exact command that will be executed
    const command = `claude mcp add -s user ${server.name} ${server.path}/dist/index.js`
    
    const confirmed = confirm(
      `This will execute the following Claude CLI command:\n\n${command}\n\nDo you want to continue?`
    )
    
    if (!confirmed) {
      addToTerminal(`⚠️ Add '${server.name}' to Claude cancelled by user`, 'info')
      return
    }

    addToTerminal(`🤖 Adding '${server.name}' to Claude Desktop...`, 'info')
    
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          command: 'claude-add-mcp', 
          args: `${server.name} ${server.path}/dist/index.js` 
        }),
      })

      if (response.ok) {
        addToTerminal(`✅ Added '${server.name}' to Claude Desktop`, 'success')
        addToTerminal(`💡 Restart Claude Desktop to use the new server`, 'info')
      } else {
        const result = await response.json()
        addToTerminal(`❌ Failed to add '${server.name}': ${result.error}`, 'error')
      }
    } catch (error) {
      addToTerminal(`❌ Error adding '${server.name}': ${error}`, 'error')
    }
  }

  const handleWizardComplete = async (config: any) => {
    setIsCreating(true)
    setCreatingServerName(config.serverName)
    addToTerminal('Creating MCP server...', 'info')
    
    // Add pending server to UI immediately
    const pendingServer: Server = {
      name: config.serverName,
      url: config.gitbookUrl,
      status: 'pending',
      path: config.targetDir || 'Calculating...',
      lastUpdated: 'Creating...',
      pageCount: 0
    }
    
    setServers(prev => [...prev, pendingServer])
    
    // Create abort controller for cancellation
    const abortController = new AbortController()
    setCreationAbortController(abortController)
    
    try {
      // Use fetch with streaming response for real-time output
      const response = await fetch('/api/create-server-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
        signal: abortController.signal
      })

      if (!response.ok) {
        throw new Error('Failed to start server creation')
      }

      if (!response.body) {
        throw new Error('No response body for streaming')
      }

      // Read the streaming response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      try {
        while (true) {
          const { done, value } = await reader.read()
          
          if (done) break

          // Decode the chunk and process SSE messages
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) // Remove 'data: ' prefix
                
                switch (data.type) {
                  case 'connected':
                    addToTerminal(`🔗 ${data.message}`, 'info')
                    break
                  case 'output':
                    addToTerminal(data.message, 'info')
                    break
                  case 'error':
                    addToTerminal(`❌ ${data.message}`, 'error')
                    break
                  case 'info':
                    addToTerminal(`💡 ${data.message}`, 'info')
                    break
                  case 'success':
                    addToTerminal(`${data.message}`, 'success')
                    if (data.result?.targetDir) {
                      addToTerminal(`📁 Location: ${data.result.targetDir}`, 'info')
                    }
                    // Success - refresh server list
                    loadServers()
                    break
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE data:', parseError)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        addToTerminal(`⚠️ Server creation cancelled`, 'info')
      } else {
        addToTerminal(`❌ Error creating server: ${error}`, 'error')
      }
      // Remove pending server on failure or cancellation
      setServers(prev => prev.filter(s => s.name !== config.serverName))
    } finally {
      setIsCreating(false)
      setCreatingServerName(null)
      setCreationAbortController(null)
    }
  }

  const executeCommand = async (command: string, args: string = '') => {
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command, args }),
      })

      if (!response.ok) {
        throw new Error(`Command failed: ${response.statusText}`)
      }

      // For now, just add success message
      // TODO: Implement WebSocket for real-time output
      addToTerminal(`Command '${command}' executed successfully`, 'success')
      
      // Refresh servers list
      loadServers()
    } catch (error) {
      addToTerminal(`Command failed: ${error}`, 'error')
    }
  }

  return (
    <>
      <Head>
        <title>Universal Documentation MCP Server - WebUI</title>
        <meta name="description" content="Manage your documentation MCP servers" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  📚 Universal Documentation MCP
                </h1>
                <p className="text-gray-600 mt-1">
                  Manage your documentation servers with ease
                </p>
              </div>
              <div className="text-sm text-gray-500">
                WebUI v1.0.0
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column - Servers Overview */}
            <div className="lg:col-span-2">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  MCP Servers
                </h2>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-500">
                    {servers.length} server{servers.length !== 1 ? 's' : ''}
                  </span>
                  {servers.length > 0 && (
                    <div className="flex space-x-2">
                      <button
                        onClick={handleCopyMcpConfig}
                        className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors"
                        title="Copy mcpServers config for Claude Desktop"
                      >
                        📋 Copy Config
                      </button>
                      <button
                        onClick={handleAddToClaude}
                        className="px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors"
                        title="Add all servers to Claude using CLI"
                      >
                        🤖 Add to Claude
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading servers...</p>
                </div>
              ) : servers.length === 0 && !isCreating ? (
                <div className="text-center py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
                  <div className="text-4xl mb-4">📭</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    No MCP servers found
                  </h3>
                  <p className="text-gray-500 mb-4">
                    Create your first documentation MCP server to get started
                  </p>
                  <button 
                    onClick={handleCreateServer}
                    disabled={isCreating}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    🚀 Create First Server
                  </button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {servers.map((server) => (
                    <ServerCard 
                      key={server.name} 
                      server={server}
                      disabled={isCreating}
                      onRefresh={() => loadServers()}
                      onAction={(action, serverName) => {
                        if (action === 'copy-config') {
                          handleCopyMcpConfigSingle(serverName)
                        } else if (action === 'add-to-claude') {
                          handleAddToClaudeSingle(serverName)
                        } else {
                          addToTerminal(`${action} server: ${serverName}`, 'info')
                          executeCommand(action, serverName)
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right Column - Actions & Terminal */}
            <div className="space-y-6">
              
              {/* Quick Actions */}
              <ActionButtons 
                disabled={isCreating}
                isCreating={isCreating}
                creatingServerName={creatingServerName}
                onCreateServer={handleCreateServer}
                onCancelCreation={handleCancelCreation}
                onRefreshAll={() => {
                  addToTerminal('Refreshing content...', 'info')
                  executeCommand('refresh-content')
                }}
                onRebuild={() => {
                  addToTerminal('Rebuilding project...', 'info')
                  executeCommand('rebuild')
                }}
              />

              {/* Virtual Terminal */}
              <div className="bg-white rounded-lg shadow-sm border">
                <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
                  <h3 className="text-sm font-medium text-gray-900 flex items-center">
                    <span className="w-3 h-3 bg-red-500 rounded-full mr-2"></span>
                    <span className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></span>
                    <span className="w-3 h-3 bg-green-500 rounded-full mr-3"></span>
                    Terminal Output
                  </h3>
                </div>
                <Terminal output={terminalOutput} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Server Creation Wizard */}
      <ServerWizard 
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />
    </>
  )
}