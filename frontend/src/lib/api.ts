/** REST API クライアント */

export interface Agent {
  id: string
  name: string
  icon: string
  description: string
  primary_tools: string[]
  model: string
}

export interface Workspace {
  id: string
  name: string
  description: string | null
  rag_directories: string[]
  created_at: string
}

export interface Conversation {
  id: string
  workspace_id: string | null
  agent_type: string
  title: string
  pinned: boolean
  folder: string | null
  created_at: string
  updated_at: string
}

export interface ToolCallLog {
  name: string
  args: Record<string, unknown>
  success?: boolean
  summary?: string
  elapsed?: number
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  think_content?: string
  tool_calls?: ToolCallLog[]
  created_at: string
}

export interface HealthResponse {
  status: string
  ollama: boolean
  database: boolean
}

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ─── System ───────────────────────────────────────────────
export const api = {
  health: () => request<HealthResponse>('/system/health'),

  // ─── Agents ─────────────────────────────────────────────
  listAgents: () => request<Agent[]>('/agents/'),
  getAgent: (id: string) => request<Agent>(`/agents/${id}`),

  // ─── Workspaces ─────────────────────────────────────────
  listWorkspaces: () => request<Workspace[]>('/workspaces/'),
  createWorkspace: (name: string, description?: string) =>
    request<Workspace>('/workspaces/', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  // ─── Conversations ──────────────────────────────────────
  listConversations: (workspaceId?: string) =>
    request<Conversation[]>(
      '/conversations/' + (workspaceId ? `?workspace_id=${workspaceId}` : '')
    ),
  createConversation: (agentType: string, title?: string, workspaceId?: string) =>
    request<Conversation>('/conversations/', {
      method: 'POST',
      body: JSON.stringify({ agent_type: agentType, title: title ?? '新しい会話', workspace_id: workspaceId }),
    }),
  getConversation: (id: string) => request<Conversation>(`/conversations/${id}`),
  updateConversationTitle: (id: string, title: string) =>
    request<void>(`/conversations/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: string) =>
    request<void>(`/conversations/${id}`, { method: 'DELETE' }),
  updateConversationFolder: (id: string, folder: string | null) =>
    request<void>(`/conversations/${id}/folder`, {
      method: 'PATCH',
      body: JSON.stringify({ folder }),
    }),
  listFolders: () => request<string[]>('/conversations/folders/list'),
  searchConversations: (q: string) =>
    request<Conversation[]>(`/conversations/search?q=${encodeURIComponent(q)}`),

  // ─── Messages ───────────────────────────────────────────
  getMessages: (conversationId: string) =>
    request<Message[]>(`/conversations/${conversationId}/messages`),

  // ─── Files ──────────────────────────────────────────────
  uploadFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(BASE + '/files/upload', { method: 'POST', body: form }).then(r => r.json())
  },

  // ─── RAG ────────────────────────────────────────────────
  indexWorkspace: (workspaceId: string) =>
    request<{ indexed: number }>(`/rag/index`, {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId }),
    }),
}
