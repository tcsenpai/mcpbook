import { useState, useEffect } from 'react'
import Head from 'next/head'
import ServerWizard from '../components/ServerWizard'

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  },
  header: {
    backgroundColor: 'white',
    padding: '24px',
    borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#111827',
    margin: 0
  },
  subtitle: {
    color: '#6b7280',
    margin: '8px 0 0 0'
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '32px 24px'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: '32px'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    border: '1px solid #e5e7eb'
  },
  button: {
    backgroundColor: '#2563eb',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
    width: '100%',
    marginBottom: '12px'
  },
  buttonSecondary: {
    backgroundColor: '#f3f4f6',
    color: '#374151',
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '14px',
    cursor: 'pointer',
    width: '100%',
    marginBottom: '8px'
  },
  terminal: {
    backgroundColor: '#1a1b26',
    color: '#a9b1d6',
    fontFamily: 'Monaco, Consolas, monospace',
    fontSize: '14px',
    padding: '16px',
    borderRadius: '8px',
    height: '300px',
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const
  },
  serverCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  statusRunning: {
    color: '#059669',
    fontWeight: '500'
  },
  statusStopped: {
    color: '#6b7280',
    fontWeight: '500'
  }
}

interface Server {
  name: string
  url: string
  status: 'running' | 'stopped' | 'error'
  path: string
  lastUpdated: string
  pageCount?: number
}

export default function SimpleUI() {
  const [servers, setServers] = useState<Server[]>([])
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    loadServers()
  }, [])

  const loadServers = async () => {
    try {
      const response = await fetch('/api/servers')
      const data = await response.json()
      setServers(data.servers || [])
      addToTerminal('✅ Servers loaded successfully')
    } catch (error) {
      addToTerminal(`❌ Error loading servers: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  const addToTerminal = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setTerminalOutput(prev => [
      ...prev,
      `[${timestamp}] ${message}`
    ])
  }

  const executeCommand = async (command: string) => {
    if (command === 'create-mcp') {
      setShowWizard(true)
      return
    }

    addToTerminal(`🔄 Executing: ${command}`)
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })

      const result = await response.json()
      if (result.success) {
        addToTerminal(`✅ ${command} completed`)
        loadServers()
      } else {
        addToTerminal(`❌ ${command} failed: ${result.error}`)
      }
    } catch (error) {
      addToTerminal(`❌ Command failed: ${error}`)
    }
  }

  const handleWizardComplete = async (config: any) => {
    addToTerminal('🔄 Creating MCP server...')
    
    try {
      const response = await fetch('/api/create-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      const result = await response.json()
      
      if (result.success) {
        addToTerminal(`✅ Server '${result.serverName}' created successfully!`)
        addToTerminal(`📁 Location: ${result.targetDir}`)
        loadServers()
      } else {
        addToTerminal(`❌ Failed to create server: ${result.error}`)
      }
    } catch (error) {
      addToTerminal(`❌ Error creating server: ${error}`)
    }
  }

  return (
    <>
      <Head>
        <title>Universal Documentation MCP Server - WebUI</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>📚 Universal Documentation MCP</h1>
          <p style={styles.subtitle}>Manage your documentation servers with ease</p>
        </header>

        <div style={styles.main}>
          <div style={styles.grid}>
            {/* Left Column - Servers */}
            <div>
              <h2 style={{ fontSize: '24px', marginBottom: '24px', color: '#111827' }}>
                MCP Servers ({servers.length})
              </h2>

              {loading ? (
                <div style={styles.card}>
                  <p>⏳ Loading servers...</p>
                </div>
              ) : servers.length === 0 ? (
                <div style={styles.card}>
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
                    <h3 style={{ fontSize: '20px', marginBottom: '12px', color: '#111827' }}>
                      No MCP servers found
                    </h3>
                    <p style={{ color: '#6b7280', marginBottom: '20px' }}>
                      Create your first documentation MCP server to get started
                    </p>
                    <button 
                      style={styles.button}
                      onClick={() => executeCommand('create-mcp')}
                    >
                      🚀 Create First Server
                    </button>
                  </div>
                </div>
              ) : (
                servers.map((server) => (
                  <div key={server.name} style={styles.serverCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '18px', margin: 0, color: '#111827' }}>{server.name}</h3>
                      <span style={server.status === 'running' ? styles.statusRunning : styles.statusStopped}>
                        {server.status === 'running' ? '🟢 Running' : '⚪ Stopped'}
                      </span>
                    </div>
                    <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '12px', wordBreak: 'break-all' }}>
                      📍 {server.url}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px', fontSize: '14px' }}>
                      <div>
                        <span style={{ color: '#6b7280' }}>Pages: </span>
                        <span style={{ fontWeight: '500' }}>
                          {server.pageCount ? server.pageCount.toLocaleString() : 'Unknown'}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: '#6b7280' }}>Updated: </span>
                        <span style={{ fontWeight: '500' }}>{server.lastUpdated}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button 
                        style={{ ...styles.buttonSecondary, width: 'auto', padding: '6px 12px' }}
                        onClick={() => executeCommand('refresh-content')}
                      >
                        🔄 Refresh
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Right Column - Actions & Terminal */}
            <div>
              <div style={styles.card}>
                <h3 style={{ fontSize: '20px', marginBottom: '20px', color: '#111827' }}>
                  Quick Actions
                </h3>
                <button
                  style={styles.button}
                  onClick={() => executeCommand('create-mcp')}
                >
                  🚀 Create New Server
                </button>
                <button
                  style={styles.buttonSecondary}
                  onClick={() => executeCommand('rebuild')}
                >
                  🔨 Rebuild
                </button>
                <button
                  style={styles.buttonSecondary}
                  onClick={() => loadServers()}
                >
                  🔄 Refresh All
                </button>
              </div>

              <div style={{ ...styles.card, marginTop: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ width: '12px', height: '12px', backgroundColor: '#ef4444', borderRadius: '50%', marginRight: '8px' }}></div>
                  <div style={{ width: '12px', height: '12px', backgroundColor: '#eab308', borderRadius: '50%', marginRight: '8px' }}></div>
                  <div style={{ width: '12px', height: '12px', backgroundColor: '#22c55e', borderRadius: '50%', marginRight: '12px' }}></div>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#111827' }}>Terminal Output</span>
                </div>
                <div style={styles.terminal}>
                  {terminalOutput.length === 0 ? (
                    <div style={{ opacity: 0.6 }}>
                      Terminal ready. Use the buttons above to execute commands...
                    </div>
                  ) : (
                    terminalOutput.map((line, index) => (
                      <div key={index} style={{ marginBottom: '4px' }}>
                        {line}
                      </div>
                    ))
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', marginTop: '8px' }}>
                    <span style={{ color: '#9ece6a', marginRight: '8px' }}>❯</span>
                    <span style={{ width: '8px', height: '16px', backgroundColor: '#a9b1d6', animation: 'blink 1s infinite' }}></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>

      {/* Server Creation Wizard */}
      <ServerWizard 
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />
    </>
  )
}