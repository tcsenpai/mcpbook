import { useState } from 'react'

interface ServerWizardProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (config: ServerConfig) => void
}

interface ServerConfig {
  gitbookUrl: string
  serverName: string
  description: string
  targetDir: string
  installGlobally: boolean
  addToClaudeDesktop: boolean
}

export default function ServerWizard({ isOpen, onClose, onComplete }: ServerWizardProps) {
  const [step, setStep] = useState(1)
  const [config, setConfig] = useState<ServerConfig>({
    gitbookUrl: '',
    serverName: '',
    description: '',
    targetDir: '',
    installGlobally: false,
    addToClaudeDesktop: false
  })
  const [errors, setErrors] = useState<string[]>([])

  const generateDefaults = (url: string) => {
    if (!url) return

    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname.replace(/^(www\.|docs\.)/, '')
      const suggestedName = hostname.split('.')[0] + '-docs-mcp'
      const cleanName = suggestedName.replace('-mcp', '').replace(/-/g, ' ')
      const suggestedDesc = `${cleanName} documentation and guides`
      
      // Default directory following same convention as CLI
      // Note: This will be properly set by the backend, just show a placeholder
      const defaultDir = `~/.config/mcpbooks/servers/${suggestedName}`

      setConfig(prev => ({
        ...prev,
        serverName: suggestedName,
        description: suggestedDesc,
        targetDir: defaultDir
      }))
    } catch (error) {
      // Invalid URL, don't update defaults
    }
  }

  const validateStep1 = () => {
    const newErrors: string[] = []
    
    if (!config.gitbookUrl) {
      newErrors.push('GitBook URL is required')
    } else {
      try {
        new URL(config.gitbookUrl)
      } catch {
        newErrors.push('Please provide a valid URL starting with http:// or https://')
      }
    }

    if (!config.serverName) {
      newErrors.push('Server name is required')
    } else if (!/^[a-z0-9-]+$/.test(config.serverName)) {
      newErrors.push('Server name must contain only lowercase letters, numbers, and hyphens')
    }

    if (!config.description) {
      newErrors.push('Description is required')
    }

    if (!config.targetDir) {
      newErrors.push('Target directory is required')
    }

    setErrors(newErrors)
    return newErrors.length === 0
  }

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2)
    }
  }

  const handleCreate = () => {
    onComplete(config)
    onClose()
  }

  const handleUrlChange = (url: string) => {
    setConfig(prev => ({ ...prev, gitbookUrl: url }))
    if (url && !config.serverName) {
      generateDefaults(url)
    }
  }

  const handleServerNameChange = (name: string) => {
    let serverName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (serverName && !serverName.endsWith('-mcp')) {
      serverName += '-mcp'
    }
    setConfig(prev => ({ ...prev, serverName }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900">
              🚀 Create MCP Server
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p className="text-gray-600 mt-2">
            Create a personalized MCP server for any GitBook documentation
          </p>
        </div>

        <div className="p-6">
          {/* Progress indicator */}
          <div className="flex items-center mb-6">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'} font-semibold`}>
              1
            </div>
            <div className={`flex-1 h-1 mx-4 ${step >= 2 ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-600'} font-semibold`}>
              2
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">📝 Configuration</h3>
              
              {errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="text-red-800 font-medium mb-2">Please fix the following errors:</h4>
                  <ul className="text-red-700 text-sm space-y-1">
                    {errors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🌐 GitBook URL
                </label>
                <input
                  type="url"
                  placeholder="https://docs.example.com"
                  value={config.gitbookUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  📦 Server Name
                </label>
                <input
                  type="text"
                  placeholder="example-docs-mcp"
                  value={config.serverName}
                  onChange={(e) => handleServerNameChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Must contain only lowercase letters, numbers, and hyphens. Will auto-add '-mcp' suffix.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  📝 Description
                </label>
                <input
                  type="text"
                  placeholder="Documentation and guides"
                  value={config.description}
                  onChange={(e) => setConfig(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  📁 Installation Directory
                </label>
                <input
                  type="text"
                  placeholder="/home/user/.config/mcpbooks/servers/example-docs-mcp"
                  value={config.targetDir}
                  onChange={(e) => setConfig(prev => ({ ...prev, targetDir: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">📋 Configuration Summary</h3>
              
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div>
                  <span className="font-medium text-gray-700">GitBook URL:</span>
                  <span className="ml-2 text-gray-900">{config.gitbookUrl}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Server Name:</span>
                  <span className="ml-2 text-gray-900">{config.serverName}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Description:</span>
                  <span className="ml-2 text-gray-900">{config.description}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Directory:</span>
                  <span className="ml-2 text-gray-900 font-mono text-sm">{config.targetDir}</span>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-gray-700">🔧 Installation Options</h4>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={config.installGlobally}
                    onChange={(e) => setConfig(prev => ({ ...prev, installGlobally: e.target.checked }))}
                    className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-gray-700">🌍 Install globally (accessible from anywhere)</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={config.addToClaudeDesktop}
                    onChange={(e) => setConfig(prev => ({ ...prev, addToClaudeDesktop: e.target.checked }))}
                    className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-gray-700">🤖 Add to Claude Desktop configuration</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-gray-50 flex justify-between">
          {step === 1 ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Next →
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                ← Back
              </button>
              <button
                onClick={handleCreate}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                🚀 Create Server
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}