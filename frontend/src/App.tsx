import { useEffect } from 'react'
import { useChatStore } from './stores/chatStore'
import { AgentList } from './components/AgentList'
import { ChatArea } from './components/ChatArea'
import { AgentProfile } from './components/AgentProfile'
import { ModelSelector } from './components/ModelSelector'
import { HelpPage } from './components/HelpPage'
import { Menu, HelpCircle, Home } from 'lucide-react'

export default function App() {
  const {
    loadAgents,
    loadModels,
    agents,
    profileAgentId,
    setProfileAgentId,
    sidebarOpen,
    setSidebarOpen,
    selectedAgentId,
    currentConversationId,
    setCurrentConversationId,
    conversations,
    selectedModel,
    helpOpen,
    setHelpOpen,
  } = useChatStore()

  useEffect(() => {
    loadAgents()
    loadModels()
  }, [])

  const profileAgent = agents.find(a => a.id === profileAgentId)
  const currentConv = conversations.find(c => c.id === currentConversationId)
  const selectedAgent = agents.find(a => a.id === selectedAgentId)

  return (
    <div className="h-screen flex overflow-hidden bg-gray-900">
      {/* サイドバー */}
      {sidebarOpen && (
        <AgentList onProfileClick={(id) => setProfileAgentId(id)} />
      )}

      {/* メインエリア */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* チャットヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50 bg-gray-900/80 backdrop-blur-sm flex-shrink-0">
          {/* サイドバートグル */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Menu size={18} />
          </button>

          {/* ホームボタン */}
          <button
            onClick={() => setCurrentConversationId(null)}
            className={`transition-colors ${
              !currentConversationId
                ? 'text-indigo-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            title="ホーム"
          >
            <Home size={18} />
          </button>

          {selectedAgent && (
            <>
              <button
                onClick={() => setProfileAgentId(selectedAgentId)}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                title="プロフィールを表示"
              >
                <span className="text-xl">{selectedAgent.icon}</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white">{selectedAgent.name}</span>
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    <span className="text-xs text-green-400">Online</span>
                  </div>
                  <p className="text-xs text-gray-500">{selectedModel}</p>
                </div>
              </button>

              {currentConv && (
                <>
                  <span className="text-gray-700">/</span>
                  <span className="text-sm text-gray-400 truncate max-w-xs">{currentConv.title}</span>
                </>
              )}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setHelpOpen(true)}
              title="ヘルプ"
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              <HelpCircle size={16} />
            </button>
            <ModelSelector />
          </div>
        </div>

        {/* チャットエリア */}
        <ChatArea onAgentClick={(id) => setProfileAgentId(id)} />
      </div>

      {/* エージェントプロフィールモーダル */}
      {profileAgent && (
        <AgentProfile
          agent={profileAgent}
          onClose={() => setProfileAgentId(null)}
        />
      )}

      {/* ヘルプページ */}
      <HelpPage />
    </div>
  )
}
