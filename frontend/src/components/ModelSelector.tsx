import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Cpu, Loader2 } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import clsx from 'clsx'

interface LoadingState {
  active: boolean
  progress: number
  message: string
  model: string
  error: boolean
}

export function ModelSelector() {
  const { selectedModel, setSelectedModel, availableModels } = useChatStore()
  const [open, setOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [loading, setLoading] = useState<LoadingState>({
    active: false,
    progress: 0,
    message: '',
    model: '',
    error: false,
  })
  const abortRef = useRef<AbortController | null>(null)

  const currentLabel = availableModels.find(m => m.name === selectedModel)?.label ?? selectedModel

  // モデルウォームアップ (SSE でロード進捗を受信)
  const warmupModel = async (modelName: string) => {
    // 既にロード中なら中断
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading({ active: true, progress: 0, message: 'チェック中...', model: modelName, error: false })

    try {
      const resp = await fetch('/api/system/models/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
        signal: controller.signal,
      })

      if (!resp.ok || !resp.body) {
        setLoading(prev => ({ ...prev, active: false }))
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            const isError = data.status === 'error'
            const isDone = data.status === 'ready' || isError
            setLoading({
              active: !isDone,
              progress: isError ? 100 : (data.progress ?? 0),
              message: data.message ?? '',
              model: data.model ?? modelName,
              error: isError,
            })

            if (isDone) {
              // エラーは長めに表示
              const delay = isError ? 5000 : 2500
              setTimeout(() => setLoading(prev => ({ ...prev, active: false, progress: 0, error: false })), delay)
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setLoading(prev => ({ ...prev, active: false }))
    }
  }

  const handleSelect = (name: string) => {
    if (name === selectedModel) {
      setOpen(false)
      return
    }
    setSelectedModel(name)
    setOpen(false)
    warmupModel(name)
  }

  const handleCustomSubmit = () => {
    const name = customInput.trim()
    if (!name) return
    setSelectedModel(name)
    setCustomInput('')
    setOpen(false)
    warmupModel(name)
  }

  // クリーンアップ
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={clsx(
          'flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/80 hover:bg-gray-700 border text-xs text-gray-200 font-medium transition-all backdrop-blur-sm shadow-sm',
          loading.active ? 'border-indigo-500/70' : 'border-gray-600/50'
        )}
        title="モデルを選択"
      >
        {loading.active ? (
          <Loader2 size={12} className="text-indigo-400 flex-shrink-0 animate-spin" />
        ) : (
          <Cpu size={12} className="text-indigo-400 flex-shrink-0" />
        )}
        <span className="max-w-[140px] truncate">{currentLabel}</span>
        <ChevronDown size={11} className={clsx('transition-transform flex-shrink-0', open && 'rotate-180')} />
      </button>

      {/* ロード進捗バー */}
      {(loading.active || loading.progress > 0 || loading.error) && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className={clsx(
                'text-xs font-medium flex items-center gap-1.5',
                loading.error ? 'text-red-400' : 'text-gray-300'
              )}>
                {loading.active && <Loader2 size={11} className="animate-spin text-indigo-400" />}
                {loading.message}
              </span>
              <span className={clsx(
                'text-xs font-bold tabular-nums',
                loading.error ? 'text-red-400' : 'text-indigo-400'
              )}>{loading.error ? '' : `${loading.progress}%`}</span>
            </div>
            <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-500 ease-out',
                  loading.error ? 'bg-red-500' : loading.progress >= 100 ? 'bg-green-500' : 'bg-indigo-500'
                )}
                style={{ width: `${loading.error ? 100 : loading.progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ドロップダウン (ロード中でなければ表示) */}
      {open && !loading.active && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="py-1">
            {availableModels.map(m => (
              <button
                key={m.name}
                onClick={() => handleSelect(m.name)}
                className={clsx(
                  'w-full text-left px-3 py-2 text-xs hover:bg-gray-700 transition-colors',
                  selectedModel === m.name ? 'text-indigo-400 bg-indigo-900/20' : 'text-gray-300'
                )}
              >
                <div className="font-medium">{m.label}</div>
                <div className="text-gray-500 mt-0.5">{m.name}</div>
              </button>
            ))}
          </div>

          <div className="border-t border-gray-700 p-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                placeholder="カスタムモデル名..."
                className="flex-1 bg-gray-700 text-xs text-gray-200 placeholder-gray-500 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customInput.trim()}
                className="px-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                適用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* オーバーレイ (ドロップダウン外クリックで閉じる) */}
      {open && !loading.active && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  )
}
