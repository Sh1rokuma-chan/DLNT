import { useState, useEffect, useRef } from 'react'
import {
  Plus, Trash2, Search, X, ChevronDown, ChevronRight,
  Pin, FolderPlus, Folder, FolderOpen,
} from 'lucide-react'
import clsx from 'clsx'
import { useChatStore } from '../stores/chatStore'
import { Agent, Conversation } from '../lib/api'

// ─── エージェントアイテム ────────────────────────────────────
function AgentItem({
  agent,
  selected,
  onClick,
  onNewChat,
  onProfileClick,
}: {
  agent: Agent
  selected: boolean
  onClick: () => void
  onNewChat: () => void
  onProfileClick: () => void
}) {
  return (
    <div
      className={clsx(
        'group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all',
        selected ? 'bg-gray-700' : 'hover:bg-gray-700/60'
      )}
      onClick={onClick}
    >
      <button
        onClick={e => { e.stopPropagation(); onProfileClick() }}
        className="w-9 h-9 rounded-full bg-gray-600 flex items-center justify-center text-lg flex-shrink-0 hover:bg-gray-500 transition-colors"
        title={`${agent.name} のプロフィール`}
      >
        {agent.icon}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-gray-200 truncate">{agent.name}</span>
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
        </div>
        <p className="text-xs text-gray-500 truncate">{agent.description.split('\u3002')[0]}</p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onNewChat() }}
        className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-gray-200 transition-all"
        title="新しい会話"
      >
        <Plus size={15} />
      </button>
    </div>
  )
}

// ─── フォルダメニュー ──────────────────────────────────────────
function FolderMenu({
  conv,
  folders,
  onClose,
}: {
  conv: Conversation
  folders: string[]
  onClose: () => void
}) {
  const { updateFolder } = useChatStore()
  const [newFolder, setNewFolder] = useState('')
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleMove = async (folder: string | null) => {
    await updateFolder(conv.id, folder)
    onClose()
  }

  const handleCreate = async () => {
    if (!newFolder.trim()) return
    await updateFolder(conv.id, newFolder.trim())
    onClose()
  }

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px]">
      {conv.folder && (
        <button
          onClick={() => handleMove(null)}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        >
          フォルダから外す
        </button>
      )}
      {folders.filter(f => f !== conv.folder).map(f => (
        <button
          key={f}
          onClick={() => handleMove(f)}
          className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          <Folder size={11} className="text-gray-500" /> {f}
        </button>
      ))}
      {!creating ? (
        <button
          onClick={() => setCreating(true)}
          className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-indigo-400 hover:bg-gray-700 border-t border-gray-700 mt-1"
        >
          <FolderPlus size={11} /> 新しいフォルダ
        </button>
      ) : (
        <div className="px-2 py-1.5 border-t border-gray-700 mt-1">
          <input
            autoFocus
            value={newFolder}
            onChange={e => setNewFolder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onClose() }}
            placeholder="フォルダ名"
            className="w-full bg-gray-700 text-xs text-gray-200 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}
    </div>
  )
}

// ─── 会話アイテム ────────────────────────────────────────────
function ConversationItem({
  conv,
  selected,
  onClick,
  onDelete,
  folders,
}: {
  conv: Conversation
  selected: boolean
  onClick: () => void
  onDelete: () => void
  folders: string[]
}) {
  const [confirm, setConfirm] = useState(false)
  const [folderMenu, setFolderMenu] = useState(false)

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm) { onDelete(); setConfirm(false) }
    else { setConfirm(true); setTimeout(() => setConfirm(false), 2000) }
  }

  return (
    <div
      className={clsx(
        'group relative flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-all',
        selected ? 'bg-indigo-900/50 border border-indigo-700/50' : 'hover:bg-gray-700/50'
      )}
      onClick={onClick}
    >
      {conv.pinned && <Pin size={11} className="text-yellow-500 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 truncate">{conv.title}</p>
        <p className="text-xs text-gray-600 truncate">
          {new Date(conv.updated_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
        </p>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={e => { e.stopPropagation(); setFolderMenu(v => !v) }}
          className={clsx(
            'opacity-0 group-hover:opacity-100 p-1 rounded transition-all',
            'text-gray-500 hover:text-indigo-400'
          )}
          title="フォルダに移動"
        >
          <FolderPlus size={12} />
        </button>
        <button
          onClick={handleDelete}
          className={clsx(
            'opacity-0 group-hover:opacity-100 p-1 rounded transition-all flex-shrink-0',
            confirm ? 'text-red-400 opacity-100' : 'text-gray-500 hover:text-red-400'
          )}
          title={confirm ? 'もう一度クリックで削除' : '削除'}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {folderMenu && (
        <FolderMenu conv={conv} folders={folders} onClose={() => setFolderMenu(false)} />
      )}
    </div>
  )
}

// ─── フォルダセクション ─────────────────────────────────────
function FolderSection({
  name,
  conversations,
  currentConversationId,
  onSelect,
  onDelete,
  folders,
}: {
  name: string
  conversations: Conversation[]
  currentConversationId: string | null
  onSelect: (conv: Conversation) => void
  onDelete: (id: string) => void
  folders: string[]
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-gray-400 px-2 py-1 hover:text-gray-300 transition-colors w-full"
      >
        {open ? <FolderOpen size={12} className="text-indigo-400" /> : <Folder size={12} className="text-gray-500" />}
        <span className="truncate font-medium">{name}</span>
        <span className="ml-auto text-gray-600 text-[10px]">{conversations.length}</span>
      </button>
      {open && (
        <div className="space-y-0.5 ml-2 border-l border-gray-700/50 pl-1">
          {conversations.map(conv => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              selected={conv.id === currentConversationId}
              onClick={() => onSelect(conv)}
              onDelete={() => onDelete(conv.id)}
              folders={folders}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── メイン コンポーネント ──────────────────────────────────
interface Props {
  onProfileClick: (agentId: string) => void
}

export function AgentList({ onProfileClick }: Props) {
  const {
    agents,
    conversations,
    currentConversationId,
    selectedAgentId,
    setSelectedAgentId,
    setCurrentConversationId,
    loadConversations,
    deleteConversation,
    loadMessages,
    searchQuery,
    setSearchQuery,
    folders,
    loadFolders,
  } = useChatStore()

  const [recentOpen, setRecentOpen] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadConversations(); loadFolders() }, [])

  const handleSelectAgent = async (agentId: string) => {
    setSelectedAgentId(agentId)
  }

  const handleNewChat = (agentId: string) => {
    setSelectedAgentId(agentId)
    setCurrentConversationId(null)
    // 会話はメッセージ送信時に遅延作成される
  }

  const handleSelectConversation = async (conv: Conversation) => {
    setSelectedAgentId(conv.agent_type)
    setCurrentConversationId(conv.id)
    await loadMessages(conv.id)
  }

  // キーボードショートカット
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k') { e.preventDefault(); searchRef.current?.focus() }
        if (e.key === 'n') { e.preventDefault(); handleNewChat(selectedAgentId) }
        const num = parseInt(e.key)
        if (num >= 1 && num <= 4) {
          e.preventDefault()
          const agent = agents[num - 1]
          if (agent) handleSelectAgent(agent.id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [agents, selectedAgentId])

  const filteredConversations = searchQuery
    ? conversations.filter(c =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations

  // フォルダごとにグループ化
  const folderMap = new Map<string, Conversation[]>()
  const unfolderedConvs: Conversation[] = []
  for (const conv of filteredConversations) {
    if (conv.folder) {
      const list = folderMap.get(conv.folder) || []
      list.push(conv)
      folderMap.set(conv.folder, list)
    } else {
      unfolderedConvs.push(conv)
    }
  }

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-700/50 flex flex-col h-full select-none">
      {/* ヘッダー */}
      <div className="px-4 py-4 border-b border-gray-700/50">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">T</span>
          </div>
          <h1 className="text-sm font-bold text-white tracking-tight">Tak AI Chat</h1>
        </div>

        {/* 検索 */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="会話を検索 (⌘K)"
            className="w-full bg-gray-700/60 text-sm text-gray-200 placeholder-gray-500 pl-8 pr-7 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* エージェント一覧 */}
        <div className="px-2 pt-3 pb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 mb-2">エージェント</p>
          <div className="space-y-0.5">
            {agents.map(agent => (
              <AgentItem
                key={agent.id}
                agent={agent}
                selected={selectedAgentId === agent.id}
                onClick={() => handleSelectAgent(agent.id)}
                onNewChat={() => handleNewChat(agent.id)}
                onProfileClick={() => onProfileClick(agent.id)}
              />
            ))}
          </div>
        </div>

        {/* フォルダ */}
        {folderMap.size > 0 && (
          <div className="px-2 pb-2">
            {Array.from(folderMap.entries()).map(([name, convs]) => (
              <FolderSection
                key={name}
                name={name}
                conversations={convs}
                currentConversationId={currentConversationId}
                onSelect={handleSelectConversation}
                onDelete={id => deleteConversation(id)}
                folders={folders}
              />
            ))}
          </div>
        )}

        {/* 最近の会話 (フォルダ未分類) */}
        <div className="px-2 pb-3">
          <button
            onClick={() => setRecentOpen(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 mb-2 hover:text-gray-400 transition-colors"
          >
            {recentOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            最近の会話
            <span className="ml-1 text-gray-600">({unfolderedConvs.length})</span>
          </button>

          {recentOpen && (
            <div className="space-y-0.5">
              {unfolderedConvs.length === 0 ? (
                <p className="text-xs text-gray-600 px-3 py-2">
                  {searchQuery ? '見つかりません' : 'まだ会話がありません'}
                </p>
              ) : (
                unfolderedConvs.map(conv => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    selected={conv.id === currentConversationId}
                    onClick={() => handleSelectConversation(conv)}
                    onDelete={() => deleteConversation(conv.id)}
                    folders={folders}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* フッター (新しい会話ボタン) */}
      <div className="p-3 border-t border-gray-700/50">
        <button
          onClick={() => handleNewChat(selectedAgentId)}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          title="新しい会話 (⌘N)"
        >
          <Plus size={15} />
          新しい会話
        </button>
        <p className="text-center text-xs text-gray-600 mt-2">⌘1-4 でエージェント切替</p>
      </div>
    </div>
  )
}
