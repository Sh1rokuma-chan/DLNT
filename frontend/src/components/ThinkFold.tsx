import { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'

interface Props {
  content: string
  streaming?: boolean
}

export function ThinkFold({ content, streaming }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-300 transition-colors"
      >
        <Brain size={12} className={streaming ? 'text-purple-400 animate-pulse' : 'text-gray-500'} />
        <span>思考過程</span>
        {streaming && <span className="text-purple-400">...</span>}
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="mt-2 bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 text-xs text-gray-400 font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  )
}
