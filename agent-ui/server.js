/**
 * MyAI Agent Dashboard v3 - バックエンドサーバー
 *
 * 3エージェント対応:
 *   research  → 調査エージェント (advanced-chat + SearXNG検索)
 *   task      → タスクエージェント (advanced-chat + 検索/コード実行)
 *   minutes   → 議事録エージェント (workflow + Whisper音声文字起こし)
 *
 * 主要エンドポイント:
 *   POST /api/agent     - Difyエージェント実行 (SSEストリーミング)
 *   POST /api/chat      - Ollama直接チャット (SSEストリーミング)
 *   POST /api/transcribe - Whisper音声文字起こし
 *   GET  /api/models    - Ollamaモデル一覧
 *   GET  /api/health    - 全サービスヘルスチェック
 *   CRUD /api/conversations - 会話履歴管理
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// ── 環境変数 ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const DIFY_BASE_URL = process.env.DIFY_BASE_URL || 'http://dify-nginx/v1';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://mcp-server:8808/sse';
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://searxng:8080';
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper-api:8000';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b';

// Dify エージェント別 API キー
const AGENT_KEYS = {
  research: process.env.DIFY_API_KEY_RESEARCH || '',
  task: process.env.DIFY_API_KEY_TASK || '',
  minutes: process.env.DIFY_API_KEY_MINUTES || '',
};

const HISTORY_DIR = path.join('/app/data/conversations');

// ── セキュリティ: 会話IDの検証 (パストラバーサル防止) ──────────
const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function isValidId(id) {
  return typeof id === 'string' && VALID_ID_RE.test(id);
}

// ── ミドルウェア ────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── ルート ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Ollama 直接チャット (SSEストリーミング) ─────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history, model } = req.body;
  const useModel = model || DEFAULT_MODEL;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'メッセージが空です' });
  }

  const messages = Array.isArray(history) ? [...history] : [];

  if (messages.length === 0 || messages[0].role !== 'system') {
    messages.unshift({
      role: 'system',
      content: 'あなたは優秀な日本語AIアシスタントです。丁寧かつ正確に回答してください。推論プロセスは<think>タグで囲み、その後に最終回答を出力してください。',
    });
  }
  messages.push({ role: 'user', content: message });

  try {
    const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        messages,
        stream: true,
        options: {
          num_predict: 4096,
          repeat_penalty: 1.15,
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: errText });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              res.write(`data: ${JSON.stringify({ event: 'chat_token', content: data.message.content })}\n\n`);
            }
            if (data.done) {
              res.write(`data: ${JSON.stringify({ event: 'chat_done' })}\n\n`);
            }
          } catch { /* パースエラーは無視 */ }
        }
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error('[chat] Error:', error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: `Ollama接続エラー: ${error.message}` });
    } else {
      res.end();
    }
  }
});

// ── Difyエージェント実行 (SSE: 左右ペイン振り分け) ────────────
app.post('/api/agent', async (req, res) => {
  const { message, agent_type, api_key, conversation_id } = req.body;

  // APIキーの決定: リクエストのapi_keyを優先、なければenv変数
  const resolvedKey = api_key || AGENT_KEYS[agent_type] || '';
  if (!resolvedKey) {
    return res.status(400).json({
      error: `Dify APIキーが設定されていません。
エージェント種別: ${agent_type || 'unknown'}
環境変数 DIFY_API_KEY_${(agent_type || '').toUpperCase()} を設定するか、
UIのAPIキー入力欄に入力してください。`,
    });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'メッセージが空です' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (pane, type, payload = {}) => {
    res.write(`data: ${JSON.stringify({ pane, type, ...payload })}\n\n`);
  };

  const agentLabel = {
    research: '調査エージェント',
    task: 'タスクエージェント',
    minutes: '議事録エージェント',
  }[agent_type] || 'エージェント';

  sendEvent('log', 'system', { message: `${agentLabel}を起動中...` });

  try {
    const isWorkflow = agent_type === 'minutes';
    const endpoint = isWorkflow
      ? `${DIFY_BASE_URL}/workflows/run`
      : `${DIFY_BASE_URL}/chat-messages`;

    let requestBody;
    if (isWorkflow) {
      // 議事録エージェント: workflow モード
      const minutesInputs = req.body.minutes_inputs || {};
      requestBody = {
        inputs: {
          transcript: message,
          title: minutesInputs.title || '会議議事録',
          notes: minutesInputs.notes || '',
          format: minutesInputs.format || '標準議事録',
        },
        response_mode: 'streaming',
        user: 'agent-ui-user',
      };
    } else {
      // research/task エージェント: advanced-chat モード
      requestBody = {
        inputs: {},
        query: message,
        response_mode: 'streaming',
        conversation_id: conversation_id || '',
        user: 'agent-ui-user',
      };
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(600000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      sendEvent('log', 'error', { message: `Dify APIエラー (${upstream.status}): ${errText}` });
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const event = JSON.parse(jsonStr);
            const evType = event.event;

            switch (evType) {
              case 'workflow_started':
                sendEvent('log', 'workflow_start', {
                  message: `ワークフロー開始 (ID: ${event.workflow_run_id?.slice(0, 8) || '-'})`,
                });
                break;
              case 'node_started':
                sendEvent('log', 'node_start', {
                  node_id: event.data?.node_id,
                  title: event.data?.title || event.data?.node_type || '処理中',
                  type: event.data?.node_type,
                });
                break;
              case 'node_finished':
                sendEvent('log', 'node_done', {
                  node_id: event.data?.node_id,
                  title: event.data?.title || event.data?.node_type || '完了',
                  elapsed: event.data?.elapsed_time?.toFixed(2),
                  status: event.data?.status,
                  error: event.data?.error,
                  // HTTPノードの検索クエリを可視化
                  outputs: event.data?.node_type === 'http-request'
                    ? { status_code: event.data?.outputs?.status_code }
                    : undefined,
                });
                break;
              case 'workflow_finished':
                sendEvent('log', 'workflow_done', {
                  message: `完了 (${(event.data?.elapsed_time || 0).toFixed(2)}s)`,
                  status: event.data?.status,
                });
                if (event.data?.outputs) {
                  const output = Object.values(event.data.outputs).join('\n\n');
                  if (output.trim()) {
                    sendEvent('chat', 'message_chunk', { content: output });
                    sendEvent('chat', 'message_done', {});
                  }
                }
                break;
              case 'agent_message':
              case 'message':
                if (event.answer) {
                  sendEvent('chat', 'message_chunk', { content: event.answer });
                }
                break;
              case 'message_end':
                sendEvent('chat', 'message_done', { conversation_id: event.conversation_id });
                break;
              case 'error':
                sendEvent('log', 'error', { message: event.message || 'エラーが発生しました' });
                sendEvent('chat', 'message_error', { message: event.message || 'エラー' });
                break;
              case 'iteration_started':
                sendEvent('log', 'iter_start', {
                  title: `イテレーション開始 (合計: ${event.data?.inputs?.length || '?'} チャンク)`,
                });
                break;
              case 'iteration_next':
                sendEvent('log', 'iter_next', {
                  title: `チャンク処理中 (${(event.data?.index || 0) + 1}/${event.data?.inputs?.length || '?'})`,
                });
                break;
              case 'iteration_completed':
                sendEvent('log', 'iter_done', { title: 'イテレーション完了' });
                break;
            }
          } catch { /* パースエラーは無視 */ }
        }
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error('[agent] Error:', error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: `エージェントエラー: ${error.message}` });
    } else {
      sendEvent('log', 'error', { message: `接続エラー: ${error.message}` });
      res.end();
    }
  }
});

// ── Whisper 音声文字起こし ──────────────────────────────────────
// 音声ファイルを受け取り Whisper API に転送して文字起こしを返す
// Content-Type: multipart/form-data (audio field)
app.post('/api/transcribe', async (req, res) => {
  try {
    // バッファとして受け取った音声データ + ファイルメタ情報
    const audioBuffer = req.body; // express.raw() で取得
    const filename = req.headers['x-filename'] || 'audio.wav';
    const mimeType = req.headers['content-type'] || 'audio/wav';

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      return res.status(400).json({ error: '音声データが空です' });
    }

    // Whisper API へ multipart/form-data で転送
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('model', 'large-v3');
    formData.append('language', 'ja');
    formData.append('response_format', 'json');

    const whisperRes = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300000), // 最大5分
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      return res.status(502).json({ error: `Whisper APIエラー: ${errText}` });
    }

    const data = await whisperRes.json();
    res.json({ text: data.text || '', segments: data.segments || [] });
  } catch (error) {
    console.error('[transcribe] Error:', error.message);
    res.status(502).json({ error: `文字起こしエラー: ${error.message}` });
  }
});

// ── モデル一覧 (Ollama) ──────────────────────────────────────────
app.get('/api/models', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('Ollama応答エラー');
    const data = await r.json();
    res.json(data.models || []);
  } catch (error) {
    res.status(502).json({ error: 'モデル一覧取得失敗', details: error.message });
  }
});

// ── ヘルスチェック (全サービス) ─────────────────────────────────
app.get('/api/health', async (req, res) => {
  const checks = {};

  const checkService = async (name, url, timeout = 5000) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      checks[name] = r.ok || r.status < 500 ? 'running' : 'error';
    } catch {
      checks[name] = 'offline';
    }
  };

  await Promise.all([
    checkService('ollama', `${OLLAMA_URL}/api/tags`),
    checkService('dify', `${DIFY_BASE_URL.replace('/v1', '')}/health`),
    checkService('searxng', `${SEARXNG_URL}/search?q=test&format=json`, 8000),
    checkService('whisper', `${WHISPER_URL}/health`, 5000),
    (async () => {
      try {
        await fetch(MCP_SERVER_URL, { signal: AbortSignal.timeout(3000) });
        checks.mcp = 'running';
      } catch {
        checks.mcp = 'offline';
      }
    })(),
  ]);

  // エージェントAPIキーの設定状態
  checks.api_keys = {
    research: AGENT_KEYS.research ? 'configured' : 'missing',
    task: AGENT_KEYS.task ? 'configured' : 'missing',
    minutes: AGENT_KEYS.minutes ? 'configured' : 'missing',
  };

  res.json({ ...checks, timestamp: new Date().toISOString() });
});

// ── 会話履歴 ─────────────────────────────────────────────────────
app.get('/api/conversations', (req, res) => {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
          return { id: data.id, title: data.title, agentType: data.agentType, updatedAt: data.updatedAt };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(files);
  } catch {
    res.json([]);
  }
});

app.get('/api/conversations/:id', (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: '無効なIDです' });
  }
  const fp = path.join(HISTORY_DIR, `${req.params.id}.json`);
  try {
    res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
  } catch {
    res.status(404).json({ error: '会話が見つかりません' });
  }
});

app.post('/api/conversations', (req, res) => {
  const { id, title, messages, agentType } = req.body;
  if (!id) return res.status(400).json({ error: 'IDが必要です' });
  if (!isValidId(id)) {
    return res.status(400).json({ error: '無効なIDです (英数字・ハイフン・アンダースコアのみ使用可)' });
  }
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const data = {
      id,
      title: title || '新しい会話',
      messages: messages || [],
      agentType: agentType || 'chat',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(HISTORY_DIR, `${id}.json`), JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversations/:id', (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ error: '無効なIDです' });
  }
  const fp = path.join(HISTORY_DIR, `${req.params.id}.json`);
  try {
    fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: '会話が見つかりません' });
  }
});

// ── サーバー起動 ──────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   MyAI Agent Dashboard v3                ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  Ollama:   ${OLLAMA_URL}`);
  console.log(`  Dify:     ${DIFY_BASE_URL}`);
  console.log(`  SearXNG:  ${SEARXNG_URL}`);
  console.log(`  Whisper:  ${WHISPER_URL}`);
  console.log('');
  console.log('  Dify APIキー設定状態:');
  console.log(`  Research: ${AGENT_KEYS.research ? '✓ 設定済み' : '✗ 未設定 (DIFY_API_KEY_RESEARCH)'}`);
  console.log(`  Task:     ${AGENT_KEYS.task ? '✓ 設定済み' : '✗ 未設定 (DIFY_API_KEY_TASK)'}`);
  console.log(`  Minutes:  ${AGENT_KEYS.minutes ? '✓ 設定済み' : '✗ 未設定 (DIFY_API_KEY_MINUTES)'}`);
  console.log('');
});

const shutdown = (sig) => {
  console.log(`\n  ${sig} 受信。シャットダウンします...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
