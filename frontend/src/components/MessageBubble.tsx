import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check } from 'lucide-react'
import { Message } from '../lib/api'
import { PendingMessage } from '../stores/chatStore'
import { ThinkFold } from './ThinkFold'
import { ToolChips } from './ToolChip'
import clsx from 'clsx'

// コードブロック（コピーボタン付き）
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  const isInline = !className
  if (isInline) {
    return <code className="bg-gray-800 text-purple-300 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
  }

  return (
    <div className="relative group mb-3">
      <pre className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
        <code className={clsx(className, 'text-sm font-mono text-gray-200')}>{children}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1"
      >
        {copied ? <><Check size={11} /> コピー済み</> : <><Copy size={11} /> コピー</>}
      </button>
    </div>
  )
}

const MD_COMPONENTS = {
  code({ node, className, children, ...props }: any) {
    const content = String(children).replace(/\n$/, '')
    return <CodeBlock className={className}>{content}</CodeBlock>
  },
  pre({ children }: any) {
    return <>{children}</>
  },
}

interface UserBubbleProps {
  message: Message
}

function UserBubble({ message }: UserBubbleProps) {
  return (
    <div className="flex justify-end mb-4 message-enter">
      <div className="max-w-[75%]">
        <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
        <div className="flex justify-end mt-1 gap-1">
          <span className="text-xs text-gray-500">
            {new Date(message.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="text-xs text-indigo-400">✓✓</span>
        </div>
      </div>
    </div>
  )
}

interface AssistantBubbleProps {
  message: Message
  agentIcon?: string
  agentName?: string
  onAgentClick?: () => void
}

function AssistantBubble({ message, agentIcon, agentName, onAgentClick }: AssistantBubbleProps) {
  return (
    <div className="flex gap-3 mb-4 message-enter">
      <button
        onClick={onAgentClick}
        className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-base flex-shrink-0 mt-0.5 hover:bg-gray-600 transition-colors"
        title={agentName}
      >
        {agentIcon ?? '🤖'}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-200">{agentName ?? 'Agent'}</span>
          <span className="text-xs text-gray-500">
            {new Date(message.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {message.tool_calls && message.tool_calls.length > 0 && (
            <span className="text-xs text-gray-500">{message.tool_calls.length}ツール使用</span>
          )}
        </div>

        {message.think_content && (
          <ThinkFold content={message.think_content} />
        )}

        {message.tool_calls && (
          <ToolChips toolCalls={message.tool_calls.map(t => ({ ...t, done: true }))} />
        )}

        <div className="prose-chat text-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={MD_COMPONENTS as any}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

interface PendingBubbleProps {
  pending: PendingMessage
  agentIcon?: string
  agentName?: string
  onAgentClick?: () => void
}

export function PendingBubble({ pending, agentIcon, agentName, onAgentClick }: PendingBubbleProps) {
  const displayName = pending.routedAgent
    ? `${agentName} → ${pending.routedAgent}`
    : (agentName ?? 'Agent')

  return (
    <div className="flex gap-3 mb-4">
      <button
        onClick={onAgentClick}
        className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-base flex-shrink-0 mt-0.5 animate-pulse hover:bg-gray-600"
      >
        {agentIcon ?? '🤖'}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-200">{displayName}</span>
          <span className="text-xs text-blue-400 animate-pulse">入力中…</span>
        </div>

        {(pending.thinking || !pending.thinkDone) && pending.thinking && (
          <ThinkFold content={pending.thinking} streaming={!pending.thinkDone} />
        )}

        {pending.toolCalls.length > 0 && (
          <ToolChips toolCalls={pending.toolCalls} />
        )}

        {pending.content ? (
          <div className="prose-chat text-sm streaming-cursor">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={MD_COMPONENTS as any}
            >
              {pending.content}
            </ReactMarkdown>
          </div>
        ) : pending.toolCalls.length === 0 && !pending.thinking ? (
          <div className="flex gap-1 mt-2">
            <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface Props {
  message: Message
  agentIcon?: string
  agentName?: string
  onAgentClick?: () => void
}

export function MessageBubble({ message, agentIcon, agentName, onAgentClick }: Props) {
  if (message.role === 'user') return <UserBubble message={message} />
  return (
    <AssistantBubble
      message={message}
      agentIcon={agentIcon}
      agentName={agentName}
      onAgentClick={onAgentClick}
    />
  )
}
