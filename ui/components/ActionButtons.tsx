interface ActionButtonsProps {
  disabled?: boolean
  isCreating?: boolean
  creatingServerName?: string | null
  onCreateServer: () => void
  onCancelCreation?: () => void
  onRefreshAll: () => void
  onRebuild: () => void
}

export default function ActionButtons({ 
  disabled = false, 
  isCreating = false, 
  creatingServerName = null,
  onCreateServer, 
  onCancelCreation,
  onRefreshAll, 
  onRebuild 
}: ActionButtonsProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Quick Actions
      </h3>
      
      <div className="space-y-3">
        {isCreating ? (
          <>
            {/* Creation in progress UI */}
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center mb-2">
                <span className="animate-spin mr-2">⏳</span>
                <span className="font-medium text-yellow-800">
                  Creating Server
                </span>
              </div>
              <p className="text-sm text-yellow-700 mb-3">
                {creatingServerName ? `Creating "${creatingServerName}"...` : 'Server creation in progress...'}
              </p>
              <button
                onClick={onCancelCreation}
                className="w-full flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <span className="mr-2">⏹️</span>
                Cancel Creation
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Normal UI */}
            <button
              onClick={onCreateServer}
              disabled={disabled}
              className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="mr-2">🚀</span>
              Create New Server
            </button>
            
            <button
              onClick={onRefreshAll}
              disabled={disabled}
              className="w-full flex items-center justify-center px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="mr-2">🔄</span>
              Refresh Content
            </button>
            
            <button
              onClick={onRebuild}
              disabled={disabled}
              className="w-full flex items-center justify-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="mr-2">🔨</span>
              Rebuild
            </button>
          </>
        )}
      </div>

      <div className="mt-6 pt-4 border-t">
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          WebUI Status
        </h4>
        <div className="text-xs text-gray-500 space-y-1">
          <div className="flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
            Connected
          </div>
          <div>Interface: Web Dashboard</div>
        </div>
      </div>
    </div>
  )
}