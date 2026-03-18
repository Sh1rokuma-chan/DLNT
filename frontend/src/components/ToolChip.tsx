import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader } from 'lucide-react'
import clsx from 'clsx'

interface ToolCall {
  name: string
  args: Record<string, unknown>
  success?: boolean
  summary?: string
  elapsed?: number
  done: boolean
}

interface Props {
  toolCalls: ToolCall[]
}

const TOOL_ICONS: Record<string, string> = {
  web_search: '🔍',
  web_fetch: '🌐',
  file_read: '📄',
  file_write: '✏️',
  file_search: '📁',
  shell_exec: '💻',
  code_exec: '⚡',
  whisper: '🎤',
  memory_search: '🧠',
}

function SingleChip({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[tool.name] ?? '🔧'

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(v => !v)}
        className={clsx(
          'flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
          tool.done
            ? tool.success
              ? 'bg-green-900/40 border border-green-700/50 text-green-300 hover:bg-green-900/60'
              : 'bg-red-900/40 border border-red-700/50 text-red-300 hover:bg-red-900/60'
            : 'bg-gray-700/60 border border-gray-600/50 text-gray-300'
        )}
      >
        <span>{icon}</span>
        <span className="font-mono">{tool.name}</span>
        {tool.elapsed != null && (
          <span className="text-gray-400">{tool.elapsed}s</span>
        )}
        {!tool.done ? (
          <Loader size={10} className="animate-spin text-blue-400" />
        ) : tool.success ? (
          <CheckCircle size={10} className="text-green-400" />
        ) : (
          <XCircle size={10} className="text-red-400" />
        )}
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>

      {open && (
        <div className="mt-1 ml-3 bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs font-mono space-y-2">
          <div>
            <span className="text-gray-500 uppercase tracking-wide">引数</span>
            <pre className="mt-1 text-gray-300 whitespace-pre-wrap break-all">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>
          {tool.summary && (
            <div>
              <span className="text-gray-500 uppercase tracking-wide">結果</span>
              <p className="mt-1 text-gray-300">{tool.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolChips({ toolCalls }: Props) {
  if (toolCalls.length === 0) return null

  return (
    <div className="mb-3 space-y-1">
      {toolCalls.map((t, i) => (
        <SingleChip key={i} tool={t} />
      ))}
    </div>
  )
}
