import { create } from 'zustand'
import { api, Agent, Conversation, Message } from '../lib/api'

export interface ModelInfo {
  name: string
  label: string
}

export interface PendingMessage {
  thinking: string
  thinkDone: boolean
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    success?: boolean
    summary?: string
    elapsed?: number
    done: boolean
  }>
  content: string
  routedAgent?: string
}

interface ChatStore {
  // ─── Agents ─────────────────────────────────────────────
  agents: Agent[]
  loadAgents: () => Promise<void>

  // ─── Conversations ──────────────────────────────────────
  conversations: Conversation[]
  currentConversationId: string | null
  setCurrentConversationId: (id: string | null) => void
  loadConversations: () => Promise<void>
  createConversation: (agentId: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  updateTitle: (id: string, title: string) => Promise<void>
  updateFolder: (id: string, folder: string | null) => Promise<void>
  folders: string[]
  loadFolders: () => Promise<void>

  // ─── Messages ───────────────────────────────────────────
  messages: Message[]
  loadMessages: (conversationId: string) => Promise<void>
  appendMessage: (msg: Message) => void

  // ─── Streaming state ────────────────────────────────────
  pending: PendingMessage | null
  isStreaming: boolean
  setPending: (p: PendingMessage | null) => void
  updatePending: (updater: (prev: PendingMessage) => PendingMessage) => void
  setIsStreaming: (v: boolean) => void

  // ─── Model selection ────────────────────────────────────
  selectedModel: string
  setSelectedModel: (model: string) => void
  availableModels: ModelInfo[]
  loadModels: () => Promise<void>

  // ─── UI state ───────────────────────────────────────────
  selectedAgentId: string
  setSelectedAgentId: (id: string) => void
  profileAgentId: string | null
  setProfileAgentId: (id: string | null) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // ─── Agents ─────────────────────────────────────────────
  agents: [],
  loadAgents: async () => {
    try {
      const agents = await api.listAgents()
      set({ agents })
    } catch {
      // ハードコードしたフォールバック
      set({
        agents: [
          { id: 'scout', name: 'Scout', icon: '🔍', description: '調査・分析エージェント。Web検索とローカルデータを横断して調査レポートを生成。出典付き。', primary_tools: ['web_search', 'web_fetch', 'file_read', 'memory_search'], model: 'gpt-oss:20b' },
          { id: 'coder', name: 'Coder', icon: '⚡', description: 'コード・シェルエージェント。Pythonコード実行、シェルコマンド、ファイル操作。', primary_tools: ['code_exec', 'shell_exec', 'file_read', 'file_write'], model: 'gpt-oss:20b' },
          { id: 'archivist', name: 'Archivist', icon: '📚', description: '知識・RAGエージェント。プロジェクト内ドキュメントの横断検索。過去の会話から知識を引き出す。', primary_tools: ['memory_search', 'file_search', 'file_read'], model: 'gpt-oss:20b' },
          { id: 'scribe', name: 'Scribe', icon: '📝', description: '文書生成エージェント。議事録・レポート・要約の生成。音声ファイルからの文字起こしに対応。', primary_tools: ['whisper', 'file_write', 'file_read'], model: 'gpt-oss:20b' },
        ],
      })
    }
  },

  // ─── Conversations ──────────────────────────────────────
  conversations: [],
  currentConversationId: null,
  setCurrentConversationId: (id) => set({ currentConversationId: id, messages: id ? get().messages : [] }),
  loadConversations: async () => {
    try {
      const conversations = await api.listConversations()
      set({ conversations })
    } catch { /* ignore */ }
  },
  createConversation: async (agentId: string) => {
    const conv = await api.createConversation(agentId)
    set(s => ({ conversations: [conv, ...s.conversations], currentConversationId: conv.id, messages: [] }))
    return conv.id
  },
  deleteConversation: async (id: string) => {
    await api.deleteConversation(id)
    const { currentConversationId, conversations } = get()
    const next = conversations.filter(c => c.id !== id)
    set({
      conversations: next,
      currentConversationId: currentConversationId === id ? (next[0]?.id ?? null) : currentConversationId,
      messages: currentConversationId === id ? [] : get().messages,
    })
  },
  updateTitle: async (id: string, title: string) => {
    await api.updateConversationTitle(id, title)
    set(s => ({
      conversations: s.conversations.map(c => c.id === id ? { ...c, title } : c),
    }))
  },
  updateFolder: async (id: string, folder: string | null) => {
    await api.updateConversationFolder(id, folder)
    set(s => ({
      conversations: s.conversations.map(c => c.id === id ? { ...c, folder } : c),
    }))
    get().loadFolders()
  },
  folders: [],
  loadFolders: async () => {
    try {
      const folders = await api.listFolders()
      set({ folders })
    } catch { /* ignore */ }
  },

  // ─── Messages ───────────────────────────────────────────
  messages: [],
  loadMessages: async (conversationId: string) => {
    const messages = await api.getMessages(conversationId)
    set({ messages })
  },
  appendMessage: (msg: Message) => {
    set(s => ({ messages: [...s.messages, msg] }))
    // 会話タイトル自動更新（最初のユーザーメッセージで）
    const { messages, currentConversationId } = get()
    if (msg.role === 'user' && messages.length <= 1 && currentConversationId) {
      const title = msg.content.slice(0, 40) + (msg.content.length > 40 ? '…' : '')
      get().updateTitle(currentConversationId, title).catch(() => {})
    }
  },

  // ─── Streaming state ────────────────────────────────────
  pending: null,
  isStreaming: false,
  setPending: (p) => set({ pending: p }),
  updatePending: (updater) => set(s => ({ pending: s.pending ? updater(s.pending) : s.pending })),
  setIsStreaming: (v) => set({ isStreaming: v }),

  // ─── Model selection ────────────────────────────────────
  selectedModel: 'gpt-oss:20b',
  setSelectedModel: (model) => set({ selectedModel: model }),
  availableModels: [
    { name: 'gpt-oss:20b', label: 'GPT-OSS 20B (デフォルト)' },
    { name: 'qwen3.5:35b-a3b', label: 'Qwen3.5 35B-A3B (HauhauCS / セーフガード解除)' },
  ],
  loadModels: async () => {
    try {
      const resp = await fetch('/api/system/models')
      if (resp.ok) {
        const data = await resp.json()
        if (data.models?.length > 0) {
          set({ availableModels: data.models })
        }
      }
    } catch { /* ignore */ }
  },

  // ─── UI state ───────────────────────────────────────────
  selectedAgentId: 'scout',
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  profileAgentId: null,
  setProfileAgentId: (id) => set({ profileAgentId: id }),
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  helpOpen: false,
  setHelpOpen: (open) => set({ helpOpen: open }),
}))
