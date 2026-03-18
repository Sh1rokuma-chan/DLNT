import { useRef, useState, useCallback, KeyboardEvent, CompositionEvent } from 'react'
import { Send, Paperclip, Mic, Square, MicOff, Globe, GlobeLock } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../lib/api'

interface Props {
  onSend: (text: string, options?: { webSearch?: boolean }) => void
  onStop: () => void
  isStreaming: boolean
  disabled?: boolean
}

export function InputBar({ onSend, onStop, isStreaming, disabled }: Props) {
  const [text, setText] = useState('')
  const [webSearch, setWebSearch] = useState(true)
  const [recording, setRecording] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [composing, setComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])

  const send = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    try {
      onSend(trimmed, { webSearch })
    } finally {
      setText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }, [text, isStreaming, onSend, webSearch])

  const handleKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME変換中はEnterを無視
    if (composing) return
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      send()
    }
  }, [send, composing])

  const handleCompositionStart = useCallback((_e: CompositionEvent<HTMLTextAreaElement>) => {
    setComposing(true)
  }, [])

  const handleCompositionEnd = useCallback((_e: CompositionEvent<HTMLTextAreaElement>) => {
    setComposing(false)
  }, [])

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    try {
      const result = await api.uploadFile(file)
      setText(prev => prev + `\n[ファイルをアップロード: ${result.filename ?? file.name}]\n`)
    } catch {
      setText(prev => prev + `\n[ファイル: ${file.name}]\n`)
    }
  }, [])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await api.uploadFile(file)
      setText(prev => prev + `\n[ファイルをアップロード: ${result.filename ?? file.name}]\n`)
    } catch {
      setText(prev => prev + `\n[ファイル: ${file.name}]\n`)
    }
    e.target.value = ''
  }, [])

  const toggleRecording = useCallback(async () => {
    if (recording) {
      mediaRef.current?.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mediaRef.current = mr
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' })
        try {
          const result = await api.uploadFile(file)
          onSend(`音声ファイルを文字起こししてください: ${result.path ?? result.filename ?? 'recording.webm'}`)
        } catch {
          setText(prev => prev + '\n[音声ファイルを文字起こししてください]\n')
        }
      }
      mr.start()
      setRecording(true)
    } catch {
      alert('マイクへのアクセスが許可されていません')
    }
  }, [recording, onSend])

  return (
    <div
      className={clsx(
        'border-t border-gray-700 bg-gray-850 p-4 transition-colors',
        dragOver && 'bg-indigo-900/20 border-indigo-600'
      )}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-indigo-900/30 rounded-xl pointer-events-none z-10">
          <p className="text-indigo-300 font-medium">ファイルをドロップ</p>
        </div>
      )}

      <div className="relative flex items-end gap-2 bg-gray-700/50 rounded-xl border border-gray-600 focus-within:border-indigo-500 transition-colors">
        {/* ファイル添付 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming}
          className="flex-shrink-0 p-3 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors"
          title="ファイルを添付"
        >
          <Paperclip size={18} />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

        {/* Web検索トグル */}
        <button
          onClick={() => setWebSearch(v => !v)}
          disabled={isStreaming}
          className={clsx(
            'flex-shrink-0 p-3 transition-colors disabled:opacity-40',
            webSearch
              ? 'text-indigo-400 hover:text-indigo-300'
              : 'text-gray-500 hover:text-gray-300'
          )}
          title={webSearch ? 'Web検索: ON (クリックで無効化)' : 'Web検索: OFF (クリックで有効化)'}
        >
          {webSearch ? <Globe size={18} /> : <GlobeLock size={18} />}
        </button>

        {/* テキスト入力 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => { setText(e.target.value); handleInput() }}
          onKeyDown={handleKey}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={isStreaming ? '生成中...' : 'メッセージを入力 (Enter送信 / Shift+Enter改行)'}
          disabled={disabled || isStreaming}
          rows={1}
          className="flex-1 bg-transparent resize-none text-sm text-gray-100 placeholder-gray-500 py-3 focus:outline-none max-h-[200px] overflow-y-auto leading-relaxed disabled:opacity-50"
        />

        {/* 音声入力 */}
        <button
          onClick={toggleRecording}
          disabled={isStreaming}
          className={clsx(
            'flex-shrink-0 p-3 transition-colors disabled:opacity-40',
            recording ? 'text-red-400 animate-pulse' : 'text-gray-400 hover:text-gray-200'
          )}
          title={recording ? '録音停止' : '音声入力'}
        >
          {recording ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        {/* 送信 / 停止 */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 m-2 p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            title="生成停止 (Esc)"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!text.trim() || disabled}
            className="flex-shrink-0 m-2 p-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:opacity-40 text-white rounded-lg transition-colors"
            title="送信 (Enter)"
          >
            <Send size={16} />
          </button>
        )}
      </div>

      <div className="flex justify-between items-center mt-2 px-1">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">Shift+Enter で改行 · Esc で停止</span>
          <span className={clsx(
            'text-xs flex items-center gap-1',
            webSearch ? 'text-indigo-400/70' : 'text-gray-600'
          )}>
            {webSearch ? <Globe size={10} /> : <GlobeLock size={10} />}
            {webSearch ? 'Web検索 ON' : 'Web検索 OFF'}
          </span>
        </div>
        {recording && (
          <span className="text-xs text-red-400 animate-pulse flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
            録音中
          </span>
        )}
      </div>
    </div>
  )
}
