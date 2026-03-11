/**
 * MyAI Agent Dashboard v3 — Dify-free直接実行アーキテクチャ
 *
 * 3エージェント + チャット:
 *   research  → SearXNG検索 → LLM分析・回答 (ストリーミング)
 *   task      → LLM計画 → 検索 or 直接推論 → LLM統合 (ストリーミング)
 *   minutes   → スマート分割 → 順次LLM要約 → 統合 → 整形 (ストリーミング)
 *   chat      → Ollama直接チャット (ストリーミング)
 *
 * エンドポイント:
 *   POST /api/agent      - 3エージェント実行 (SSE)
 *   POST /api/chat       - Ollama直接チャット (SSE)
 *   POST /api/transcribe - Whisper音声文字起こし
 *   GET  /api/models     - Ollamaモデル一覧
 *   GET  /api/health     - サービスヘルスチェック
 *   CRUD /api/conversations - 会話履歴管理
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// ── 環境変数 ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://searxng:8080';
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper-api:8000';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b';

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

// ══════════════════════════════════════════════════════════════
//  共通ユーティリティ
// ══════════════════════════════════════════════════════════════

/** SSEレスポンスを初期化し、送信ヘルパーを返す */
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  return {
    send(pane, type, payload = {}) {
      res.write(`data: ${JSON.stringify({ pane, type, ...payload })}\n\n`);
    },
    end() {
      res.end();
    },
  };
}

/** Ollamaストリーミング呼び出し — トークンごとにコールバック */
async function streamOllama({ model, messages, onToken, onDone, timeout = 300000 }) {
  const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      stream: true,
      options: { num_predict: 4096, repeat_penalty: 1.15 },
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    throw new Error(`Ollama応答エラー (${upstream.status}): ${errText}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

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
            fullText += data.message.content;
            if (onToken) onToken(data.message.content);
          }
          if (data.done && onDone) onDone(fullText);
        } catch { /* パースエラーは無視 */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

/** Ollama非ストリーミング呼び出し — 計画・分類用 */
async function callOllama({ model, messages, timeout = 120000 }) {
  const upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      stream: false,
      options: { num_predict: 2048, repeat_penalty: 1.15 },
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    throw new Error(`Ollama応答エラー (${upstream.status}): ${errText}`);
  }

  const data = await upstream.json();
  return data.message?.content || '';
}

/** SearXNG検索 */
async function searchSearXNG(query, count = 5) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language: 'ja',
    pageno: '1',
  });

  const r = await fetch(`${SEARXNG_URL}/search?${params}`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!r.ok) throw new Error(`SearXNG応答エラー (${r.status})`);

  const data = await r.json();
  return (data.results || []).slice(0, count).map(r => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || '',
  }));
}

/** テキストをスマートにチャンク分割（議事録用） */
function smartChunk(text, maxChars = 4000, overlap = 200) {
  if (!text || text.length <= maxChars) return [text || ''];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      // 優先分割パターン: 段落境界 > 文末 > 句読点 > スペース
      const segment = text.slice(start, end);
      const patterns = [/\n\n[^]*$/, /[。．！？\n][^]*$/, /[、，,][^]*$/, /\s[^]*$/];
      for (const pat of patterns) {
        const m = segment.slice(Math.floor(maxChars * 0.6)).match(pat);
        if (m) {
          end = start + Math.floor(maxChars * 0.6) + (segment.slice(Math.floor(maxChars * 0.6)).length - m[0].length) + 1;
          break;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = Math.max(start + 1, end - overlap);
  }

  return chunks.filter(c => c.length > 0);
}

// ══════════════════════════════════════════════════════════════
//  エージェント実装
// ══════════════════════════════════════════════════════════════

/** 調査エージェント: SearXNG検索 → LLM分析 */
async function runResearchAgent(message, model, sse) {
  // Step 1: Web検索
  sse.send('log', 'system', { message: '🔍 Web検索を実行中...' });
  let searchResults = [];
  try {
    searchResults = await searchSearXNG(message, 8);
    sse.send('log', 'system', { message: `${searchResults.length}件の検索結果を取得` });
  } catch (err) {
    sse.send('log', 'system', { message: `検索失敗: ${err.message}（LLM知識のみで回答します）` });
  }

  // Step 2: 検索結果をコンテキストに組み立て
  let context = '';
  if (searchResults.length > 0) {
    context = '以下はWeb検索の結果です:\n\n' +
      searchResults.map((r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`
      ).join('\n\n') + '\n\n';
  }

  // Step 3: LLM回答生成（ストリーミング）
  sse.send('log', 'system', { message: '🧠 回答を生成中...' });

  const systemPrompt = `あなたは優秀な調査アシスタントです。
${context ? 'Web検索結果を分析し、' : ''}ユーザーの質問に対して正確で包括的な回答を生成してください。
${context ? '回答の最後に【出典】として参照したURLを記載してください。' : ''}
推論プロセスは<think>タグで囲み、その後に最終回答を出力してください。`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context + message },
  ];

  await streamOllama({
    model,
    messages,
    onToken(token) {
      sse.send('chat', 'message_chunk', { content: token });
    },
    onDone() {
      sse.send('chat', 'message_done', {});
      sse.send('log', 'system', { message: '✅ 回答生成完了' });
    },
  });
}

/** タスクエージェント: LLM計画 → 検索 or 直接推論 → LLM統合 */
async function runTaskAgent(message, model, sse) {
  // Step 1: タスク分析・計画
  sse.send('log', 'system', { message: '📋 タスクを分析中...' });

  const planPrompt = `あなたはタスク分析アシスタントです。以下のタスクを分析し、JSON形式で計画を出力してください。

タスク: ${message}

以下のJSON形式で出力してください（JSON以外は出力しないこと）:
{
  "needs_search": true/false,
  "search_queries": ["検索クエリ1", "検索クエリ2"],
  "steps": ["ステップ1の説明", "ステップ2の説明"],
  "summary": "タスクの要約"
}

needs_searchは、Web検索が必要な場合はtrue、LLMの知識だけで回答できる場合はfalseにしてください。`;

  let plan;
  try {
    const planText = await callOllama({
      model,
      messages: [{ role: 'user', content: planPrompt }],
    });

    // JSONを抽出（テキスト内のJSON部分を探す）
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    plan = jsonMatch ? JSON.parse(jsonMatch[0]) : { needs_search: false, steps: ['直接回答'], summary: message };
    sse.send('log', 'system', { message: `分析完了: ${plan.steps?.length || 1}ステップ、検索${plan.needs_search ? 'あり' : 'なし'}` });
  } catch (err) {
    sse.send('log', 'system', { message: `計画生成エラー（直接回答に切替）: ${err.message}` });
    plan = { needs_search: false, steps: ['直接回答'], summary: message };
  }

  // Step 2: 検索が必要なら実行
  let searchContext = '';
  if (plan.needs_search && plan.search_queries?.length > 0) {
    for (const query of plan.search_queries.slice(0, 3)) {
      sse.send('log', 'system', { message: `🔍 検索: "${query}"` });
      try {
        const results = await searchSearXNG(query, 5);
        searchContext += `\n【検索: ${query}】\n` +
          results.map((r, i) => `[${i + 1}] ${r.title}: ${r.content}`).join('\n') + '\n';
        sse.send('log', 'system', { message: `${results.length}件取得` });
      } catch (err) {
        sse.send('log', 'system', { message: `検索失敗: ${err.message}` });
      }
    }
  }

  // Step 3: 統合回答生成（ストリーミング）
  sse.send('log', 'system', { message: '🧠 回答を生成中...' });

  const systemPrompt = `あなたは優秀なタスク遂行アシスタントです。
以下のタスクに対して、計画に基づき詳細かつ実用的な回答を生成してください。
${searchContext ? '提供された検索結果も参考にしてください。' : ''}
推論プロセスは<think>タグで囲み、その後に最終回答を出力してください。

計画: ${JSON.stringify(plan.steps || [])}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: searchContext ? `${message}\n\n${searchContext}` : message },
  ];

  await streamOllama({
    model,
    messages,
    onToken(token) {
      sse.send('chat', 'message_chunk', { content: token });
    },
    onDone() {
      sse.send('chat', 'message_done', {});
      sse.send('log', 'system', { message: '✅ タスク完了' });
    },
  });
}

/** 議事録エージェント: チャンク分割 → 順次要約 → 統合 → 整形 */
async function runMinutesAgent(message, model, sse, minutesInputs = {}) {
  const title = minutesInputs.title || '会議議事録';
  const notes = minutesInputs.notes || '';
  const format = minutesInputs.format || '標準議事録';

  // Step 1: チャンク分割
  sse.send('log', 'system', { message: '📝 テキストを分割中...' });
  const chunks = smartChunk(message, 4000, 200);
  sse.send('log', 'system', { message: `${chunks.length}チャンクに分割` });

  // Step 2: 各チャンクを順次要約
  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    sse.send('log', 'system', { message: `📄 チャンク ${i + 1}/${chunks.length} を要約中...` });

    const chunkPrompt = `以下は会議の書き起こしテキストの一部（チャンク${i + 1}/${chunks.length}）です。
重要な発言、決定事項、アクションアイテムを抽出して要約してください。
発言者が特定できる場合は明記してください。

テキスト:
${chunks[i]}`;

    try {
      const summary = await callOllama({
        model,
        messages: [{ role: 'user', content: chunkPrompt }],
      });
      summaries.push(summary);
      sse.send('log', 'system', { message: `チャンク ${i + 1} 完了` });
    } catch (err) {
      sse.send('log', 'system', { message: `チャンク ${i + 1} エラー: ${err.message}` });
      summaries.push(`[要約失敗: ${err.message}]`);
    }
  }

  // Step 3: 統合・整形（ストリーミング）
  sse.send('log', 'system', { message: '✍️ 議事録を整形中...' });

  const systemPrompt = `あなたは議事録作成の専門家です。
以下のチャンク要約を統合し、「${format}」形式の議事録を作成してください。

タイトル: ${title}
${notes ? `補足メモ: ${notes}` : ''}

以下の構成で出力してください:
# ${title}
## 概要
## 議題・討議内容
## 決定事項
## アクションアイテム
## 次回予定（あれば）

推論プロセスは<think>タグで囲み、その後に最終的な議事録を出力してください。`;

  const combinedSummaries = summaries.map((s, i) => `【チャンク${i + 1}の要約】\n${s}`).join('\n\n');

  await streamOllama({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: combinedSummaries },
    ],
    onToken(token) {
      sse.send('chat', 'message_chunk', { content: token });
    },
    onDone() {
      sse.send('chat', 'message_done', {});
      sse.send('log', 'system', { message: '✅ 議事録作成完了' });
    },
  });
}

// ══════════════════════════════════════════════════════════════
//  ルート定義
// ══════════════════════════════════════════════════════════════

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

// ── エージェント実行 (SSE: 左右ペイン振り分け) ─────────────────
app.post('/api/agent', async (req, res) => {
  const { message, agent_type, model } = req.body;
  const useModel = model || DEFAULT_MODEL;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'メッセージが空です' });
  }

  const sse = setupSSE(res);

  const agentLabel = {
    research: '🔍 調査エージェント',
    task: '🧠 タスクエージェント',
    minutes: '📝 議事録エージェント',
  }[agent_type] || 'エージェント';

  sse.send('log', 'system', { message: `${agentLabel}を起動 (モデル: ${useModel})` });

  try {
    switch (agent_type) {
      case 'research':
        await runResearchAgent(message, useModel, sse);
        break;
      case 'task':
        await runTaskAgent(message, useModel, sse);
        break;
      case 'minutes':
        await runMinutesAgent(message, useModel, sse, req.body.minutes_inputs);
        break;
      default:
        sse.send('log', 'error', { message: `未知のエージェント種別: ${agent_type}` });
        sse.send('chat', 'message_error', { message: 'エージェント種別が不正です' });
    }
  } catch (error) {
    console.error(`[agent:${agent_type}] Error:`, error.message);
    sse.send('log', 'error', { message: `エラー: ${error.message}` });
    if (!res.headersSent) {
      sse.send('chat', 'message_error', { message: error.message });
    }
  } finally {
    sse.end();
  }
});

// ── Whisper 音声文字起こし ──────────────────────────────────────
app.post('/api/transcribe', async (req, res) => {
  try {
    const audioBuffer = req.body;
    const filename = req.headers['x-filename'] || 'audio.wav';
    const mimeType = req.headers['content-type'] || 'audio/wav';

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      return res.status(400).json({ error: '音声データが空です' });
    }

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('model', 'large-v3');
    formData.append('language', 'ja');
    formData.append('response_format', 'json');

    const whisperRes = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300000),
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

// ── ヘルスチェック ─────────────────────────────────────────────
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
    checkService('searxng', `${SEARXNG_URL}/search?q=test&format=json`, 8000),
    checkService('whisper', `${WHISPER_URL}/health`, 5000),
  ]);

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
  console.log('  ║   MyAI Agent Dashboard v3  (Dify-free)   ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  Ollama:   ${OLLAMA_URL}`);
  console.log(`  SearXNG:  ${SEARXNG_URL}`);
  console.log(`  Whisper:  ${WHISPER_URL}`);
  console.log(`  Model:    ${DEFAULT_MODEL}`);
  console.log('');
});

const shutdown = (sig) => {
  console.log(`\n  ${sig} 受信。シャットダウンします...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
