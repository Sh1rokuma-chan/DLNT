import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { MessageBubble, PendingBubble } from './MessageBubble'
import { InputBar } from './InputBar'
import { useWebSocket } from '../hooks/useWebSocket'
import { MessageSquare } from 'lucide-react'

interface Props {
  onAgentClick: (agentId: string) => void
}

export function ChatArea({ onAgentClick }: Props) {
  const {
    messages,
    pending,
    isStreaming,
    currentConversationId,
    agents,
    selectedAgentId,
  } = useChatStore()

  const { sendMessage, stopGeneration, isConnected } = useWebSocket(currentConversationId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingFirstMessage = useRef<{ text: string; webSearch?: boolean } | null>(null)

  // 自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pending?.content, pending?.toolCalls.length])

  // Escキーで停止
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isStreaming) stopGeneration()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isStreaming, stopGeneration])

  // 会話作成後、WS接続完了時に保留メッセージを送信
  useEffect(() => {
    if (pendingFirstMessage.current && currentConversationId && isConnected) {
      const { text, webSearch } = pendingFirstMessage.current
      pendingFirstMessage.current = null
      sendMessage(text, undefined, undefined, webSearch)
    }
  }, [currentConversationId, isConnected, sendMessage])

  const selectedAgent = agents.find(a => a.id === selectedAgentId)

  // エージェントアイコン/名前をメッセージから検索
  const getAgentInfo = (agentType?: string) => {
    const agent = agents.find(a => a.id === (agentType ?? selectedAgentId))
    return { icon: agent?.icon ?? '🤖', name: agent?.name ?? 'Agent' }
  }

  // 送信ハンドラ（会話未作成時は遅延作成）
  const handleSend = async (text: string, options?: { webSearch?: boolean }) => {
    if (!currentConversationId) {
      // 会話をまだ作成していない → 作成してからメッセージを送る
      pendingFirstMessage.current = { text, webSearch: options?.webSearch }
      const store = useChatStore.getState()
      await store.createConversation(selectedAgentId)
      // useEffect が isConnected を検知して自動送信する
      return
    }
    sendMessage(text, undefined, undefined, options?.webSearch)
  }

  const { icon: agentIcon, name: agentName } = getAgentInfo()

  // ホーム画面（会話未選択時）
  if (!currentConversationId && messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 select-none">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-900/40">
            <span className="text-white text-3xl font-bold">T</span>
          </div>
          <h2 className="text-xl font-semibold text-gray-300 mb-1">Tak AI Chat</h2>
          <p className="text-sm text-gray-600 mb-2">あなたの専属 AI エージェント</p>
          <p className="text-xs text-gray-600 mb-6">完全ローカル動作 — データは外部に送信されません</p>
          <div className="grid grid-cols-2 gap-3 text-sm mb-6">
            {[
              { id: 'scout', icon: '🔍', name: 'Scout', hint: 'Web調査・情報収集' },
              { id: 'coder', icon: '⚡', name: 'Coder', hint: 'コード実行・分析' },
              { id: 'archivist', icon: '📚', name: 'Archivist', hint: 'ドキュメント検索' },
              { id: 'scribe', icon: '📝', name: 'Scribe', hint: '議事録・レポート生成' },
            ].map(a => (
              <div
                key={a.name}
                onClick={() => useChatStore.getState().setSelectedAgentId(a.id)}
                className={`flex items-center gap-3 bg-gray-800/60 border rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
                  selectedAgentId === a.id
                    ? 'border-indigo-600/70 bg-indigo-900/20 text-gray-300'
                    : 'border-gray-700/50 text-gray-500 hover:border-indigo-700/40 hover:bg-gray-800/80'
                }`}
              >
                <span className="text-xl">{a.icon}</span>
                <div>
                  <div className="text-gray-300 font-semibold text-xs">{a.name}</div>
                  <div className="text-xs text-gray-600">{a.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 入力バー（ホーム画面でも表示・入力可能） */}
        <InputBar
          onSend={(text, options) => handleSend(text, options)}
          onStop={stopGeneration}
          isStreaming={isStreaming}
          disabled={false}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* メッセージ一覧 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-0">
        {messages.length === 0 && !pending && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 select-none pt-20">
            <MessageSquare size={40} className="mb-3 opacity-40" />
            <p className="text-sm">{selectedAgent?.icon} {selectedAgent?.name} に何でも聞いてください</p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            agentIcon={agentIcon}
            agentName={agentName}
            onAgentClick={() => onAgentClick(selectedAgentId)}
          />
        ))}

        {pending && (
          <PendingBubble
            pending={pending}
            agentIcon={agentIcon}
            agentName={agentName}
            onAgentClick={() => onAgentClick(selectedAgentId)}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* 入力バー */}
      <InputBar
        onSend={(text, options) => handleSend(text, options)}
        onStop={stopGeneration}
        isStreaming={isStreaming}
        disabled={false}
      />
    </div>
  )
}
