interface Server {
  name: string
  url: string
  status: 'running' | 'stopped' | 'error' | 'pending'
  path: string
  lastUpdated: string
  pageCount?: number
}

interface ServerCardProps {
  server: Server
  disabled?: boolean
  onRefresh: () => void
  onAction: (action: string, serverName: string) => void
}

export default function ServerCard({ server, disabled = false, onRefresh, onAction }: ServerCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-green-100 text-green-800 border-green-200'
      case 'stopped': return 'bg-gray-100 text-gray-800 border-gray-200'
      case 'error': return 'bg-red-100 text-red-800 border-red-200'
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return '🟢'
      case 'stopped': return '⚪'
      case 'error': return '🔴'
      case 'pending': return '🟡'
      default: return '⚪'
    }
  }

  return (
    <div className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-shadow ${disabled ? 'opacity-60' : ''}`}>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center mb-2">
              <h3 className="text-lg font-semibold text-gray-900 mr-3">
                {server.name}
              </h3>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(server.status)}`}>
                {server.status === 'pending' ? (
                  <span className="animate-spin mr-1">⏳</span>
                ) : (
                  getStatusIcon(server.status)
                )} {server.status}
              </span>
            </div>
            <p className="text-sm text-gray-600 break-all">
              📍 {server.url}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <span className="text-gray-500">Pages:</span>
            <span className="ml-2 font-medium">
              {server.pageCount ? server.pageCount.toLocaleString() : 'Unknown'}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Updated:</span>
            <span className="ml-2 font-medium">
              {server.lastUpdated}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          <button 
            onClick={() => onAction('inspect-cache', server.name)}
            disabled={disabled || server.status === 'pending'}
            className="flex items-center px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔍 Inspect
          </button>
          
          <button 
            onClick={() => onAction('refresh-content', server.name)}
            disabled={disabled || server.status === 'pending'}
            className="flex items-center px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔄 Refresh
          </button>
          
          {server.status === 'pending' ? (
            <button 
              disabled={true}
              className="flex items-center px-3 py-1.5 text-xs bg-yellow-50 text-yellow-700 rounded-md opacity-50 cursor-not-allowed"
            >
              ⏳ Creating...
            </button>
          ) : server.status === 'stopped' ? (
            <button 
              onClick={() => onAction('start', server.name)}
              disabled={disabled}
              className="flex items-center px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ▶️ Start
            </button>
          ) : (
            <button 
              onClick={() => onAction('stop', server.name)}
              disabled={disabled}
              className="flex items-center px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ⏹️ Stop
            </button>
          )}
          
          {/* Integration Buttons */}
          {server.status !== 'pending' && (
            <>
              <button 
                onClick={() => onAction('copy-config', server.name)}
                disabled={disabled}
                className="flex items-center px-3 py-1.5 text-xs bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Copy config for this server"
              >
                📋 Copy
              </button>
              
              <button 
                onClick={() => onAction('add-to-claude', server.name)}
                disabled={disabled}
                className="flex items-center px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-md hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Add to Claude Desktop"
              >
                🤖 Add
              </button>
            </>
          )}
          
          <button 
            onClick={() => {
              if (confirm(`Are you sure you want to delete ${server.name}?`)) {
                onAction('delete', server.name)
              }
            }}
            disabled={disabled || server.status === 'pending'}
            className="flex items-center px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>
  )
}