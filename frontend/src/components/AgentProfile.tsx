import { X, Zap, Globe, FileText, Terminal, Code, Mic, Brain } from 'lucide-react'
import { Agent } from '../lib/api'
import { useChatStore } from '../stores/chatStore'

const TOOL_INFO: Record<string, { icon: React.ReactNode; label: string; desc: string }> = {
  web_search:   { icon: <Globe size={14} />,    label: 'web_search',   desc: 'Web検索 (SearXNG)' },
  web_fetch:    { icon: <Globe size={14} />,    label: 'web_fetch',    desc: 'ページ全文取得' },
  file_read:    { icon: <FileText size={14} />, label: 'file_read',    desc: 'ファイル読み取り' },
  file_write:   { icon: <FileText size={14} />, label: 'file_write',   desc: 'ファイル書き込み' },
  file_search:  { icon: <FileText size={14} />, label: 'file_search',  desc: 'ファイル検索' },
  shell_exec:   { icon: <Terminal size={14} />, label: 'shell_exec',   desc: 'シェルコマンド' },
  code_exec:    { icon: <Code size={14} />,     label: 'code_exec',    desc: 'Python実行' },
  whisper:      { icon: <Mic size={14} />,      label: 'whisper',      desc: '音声文字起こし' },
  memory_search:{ icon: <Brain size={14} />,    label: 'memory_search',desc: 'ベクトル検索 (RAG)' },
}

interface Props {
  agent: Agent
  onClose: () => void
}

export function AgentProfile({ agent, onClose }: Props) {
  const { selectedModel } = useChatStore()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-gray-800 border border-gray-700 rounded-2xl p-6 w-80 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <X size={18} />
        </button>

        {/* ヘッダー */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 bg-gray-700 rounded-full flex items-center justify-center text-3xl">
            {agent.icon}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{agent.name}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-xs text-green-400">Online</span>
            </div>
          </div>
        </div>

        {/* 説明 */}
        <p className="text-sm text-gray-300 mb-4 leading-relaxed">{agent.description}</p>

        {/* 使えるツール */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">使えるツール</h3>
          <div className="space-y-1.5">
            {agent.primary_tools.map(toolName => {
              const info = TOOL_INFO[toolName]
              return (
                <div key={toolName} className="flex items-center gap-2 text-sm text-gray-300">
                  <span className="text-gray-500 w-4 flex-shrink-0">{info?.icon ?? <Zap size={14} />}</span>
                  <span className="font-mono text-xs text-purple-300">{toolName}</span>
                  <span className="text-gray-500 text-xs">— {info?.desc ?? ''}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* モデル */}
        <div className="pt-3 border-t border-gray-700">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>使用中モデル</span>
            <span className="px-2 py-0.5 bg-indigo-900/40 border border-indigo-700/50 rounded-full font-mono text-indigo-300">
              {selectedModel}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
