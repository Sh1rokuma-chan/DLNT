import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { Message } from '../lib/api'

export function useWebSocket(conversationId: string | null) {
  const ws = useRef<WebSocket | null>(null)
  const stopRequested = useRef(false)
  const [isConnected, setIsConnected] = useState(false)
  const {
    selectedAgentId,
    selectedModel,
    setPending,
    updatePending,
    setIsStreaming,
    appendMessage,
    conversations,
    setCurrentConversationId,
  } = useChatStore()

  const connect = useCallback(() => {
    if (!conversationId) return
    ws.current?.close()
    setIsConnected(false)

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${window.location.host}/ws/chat/${conversationId}`
    const socket = new WebSocket(url)
    ws.current = socket

    socket.onopen = () => {
      console.log('[WS] connected', conversationId)
      setIsConnected(true)
    }
    socket.onclose = () => {
      console.log('[WS] disconnected')
      setIsConnected(false)
      setIsStreaming(false)
      setPending(null)
    }
    socket.onerror = (e) => {
      console.error('[WS] error', e)
      setIsConnected(false)
      setIsStreaming(false)
      setPending(null)
    }
  }, [conversationId])

  useEffect(() => {
    connect()
    return () => { ws.current?.close() }
  }, [connect])

  const sendMessage = useCallback(
    async (text: string, agentType?: string, model?: string, webSearch?: boolean) => {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        connect()
        await new Promise(r => setTimeout(r, 300))
      }
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return

      stopRequested.current = false

      try {
        setIsStreaming(true)
        setPending({ thinking: '', thinkDone: false, toolCalls: [], content: '' })

        // ユーザーメッセージを即座に表示
        appendMessage({
          id: crypto.randomUUID(),
          conversation_id: conversationId!,
          role: 'user',
          content: text,
          created_at: new Date().toISOString(),
        })

        // assistantメッセージ蓄積用
        let fullContent = ''
        let fullThink = ''
        const toolCallsLog: Message['tool_calls'] = []

        ws.current.onmessage = (ev) => {
          if (stopRequested.current) return
          try {
            const event = JSON.parse(ev.data as string)

            switch (event.type) {
              case 'route':
                updatePending(p => ({ ...p, routedAgent: event.agent }))
                break

              case 'think_start':
                updatePending(p => ({ ...p, thinking: '', thinkDone: false }))
                break

              case 'think_token':
                fullThink += event.content
                updatePending(p => ({ ...p, thinking: p.thinking + event.content }))
                break

              case 'think_end':
                updatePending(p => ({ ...p, thinkDone: true }))
                break

              case 'tool_call':
                toolCallsLog.push({ name: event.name, args: event.args })
                updatePending(p => ({
                  ...p,
                  toolCalls: [...p.toolCalls, { name: event.name, args: event.args, done: false }],
                }))
                break

              case 'tool_result':
                if (toolCallsLog.length > 0) {
                  const last = toolCallsLog[toolCallsLog.length - 1]
                  last.success = event.success
                  last.summary = event.summary
                  last.elapsed = event.elapsed
                }
                updatePending(p => {
                  const toolCalls = [...p.toolCalls]
                  const idx = toolCalls.findLastIndex((t: typeof toolCalls[number]) => !t.done)
                  if (idx >= 0) {
                    toolCalls[idx] = { ...toolCalls[idx], success: event.success, summary: event.summary, elapsed: event.elapsed, done: true }
                  }
                  return { ...p, toolCalls }
                })
                break

              case 'answer_token':
                fullContent += event.content
                updatePending(p => ({ ...p, content: p.content + event.content }))
                break

              case 'done':
                // pending → 確定メッセージ化
                appendMessage({
                  id: crypto.randomUUID(),
                  conversation_id: conversationId!,
                  role: 'assistant',
                  content: fullContent,
                  think_content: fullThink || undefined,
                  tool_calls: toolCallsLog.length > 0 ? toolCallsLog : undefined,
                  created_at: new Date().toISOString(),
                })
                setPending(null)
                setIsStreaming(false)
                break

              case 'error':
                console.error('[Agent error]', event.message)
                setPending(null)
                setIsStreaming(false)
                break
            }
          } catch (e) {
            console.error('[WS parse error]', e)
            setPending(null)
            setIsStreaming(false)
          }
        }

        ws.current.send(JSON.stringify({
          message: text,
          agent_type: agentType ?? selectedAgentId,
          model: model ?? selectedModel,
          web_search: webSearch ?? true,
        }))
      } catch (e) {
        setPending(null)
        setIsStreaming(false)
        throw e
      }
    },
    [conversationId, selectedAgentId, selectedModel, connect]
  )

  const stopGeneration = useCallback(() => {
    stopRequested.current = true
    setPending(null)
    setIsStreaming(false)
  }, [])

  return { sendMessage, stopGeneration, isConnected }
}
