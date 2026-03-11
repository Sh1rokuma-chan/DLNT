const API_BASE = '/agent';

const state = {
  agent: 'chat',
  messages: [],
  isLoading: false,
  conversationId: null,
  currentAiMessageEl: null,
  currentAiContent: '',
  abortController: null,
  audioBlob: null,
  mediaRecorder: null,
  recordingChunks: [],
};

const chatEl = document.getElementById('chat-messages');
const logEl = document.getElementById('workflow-log');
const inputEl = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const modelSelect = document.getElementById('model-select');
const apiKeyInput = document.getElementById('api-key-input');
const agentConfig = document.getElementById('agent-config');
const minutesConfig = document.getElementById('minutes-config');
const audioArea = document.getElementById('audio-area');
const audioStatus = document.getElementById('audio-status');
const paneAgentTag = document.getElementById('pane-agent-tag');

const AGENT_CFG = {
  chat:     { tag: 'Ollama直接',   placeholder: 'メッセージを入力... (Shift+Enter で改行、Enter で送信)', showConfig: false, showMinutes: false, showAudio: false },
  research: { tag: 'Web検索',      placeholder: '調査したい内容を入力してください...', showConfig: true, showMinutes: false, showAudio: false },
  task:     { tag: 'マルチステップ', placeholder: 'こなしてほしいタスクを説明してください...', showConfig: true, showMinutes: false, showAudio: false },
  minutes:  { tag: '議事録作成',   placeholder: '会議の文字起こし・議事メモをここに貼り付けてください...', showConfig: true, showMinutes: true, showAudio: true },
};

function switchAgent(agent) {
  state.agent = agent;
  const cfg = AGENT_CFG[agent];
  document.querySelectorAll('.agent-tab').forEach(t => t.classList.toggle('active', t.dataset.agent === agent));
  agentConfig.classList.toggle('show', cfg.showConfig);
  minutesConfig.style.display = cfg.showMinutes ? 'flex' : 'none';
  audioArea.classList.toggle('show', cfg.showAudio);
  modelSelect.style.display = agent === 'chat' ? 'inline-block' : 'none';
  inputEl.placeholder = cfg.placeholder;
  paneAgentTag.textContent = cfg.tag;
  if (!cfg.showAudio) { state.audioBlob = null; audioStatus.textContent = '音声なし (テキスト入力も使用可)'; }
  clearLog();
}

async function checkHealth() {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    const data = await r.json();
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    const offline = ['ollama','dify','searxng','whisper'].filter(s => data[s] !== 'running');
    if (offline.length === 0) { dot.className = 'status-dot ok'; txt.textContent = '全サービス稼働中'; }
    else if (data.ollama === 'running') { dot.className = 'status-dot warn'; txt.textContent = `Ollama稼働 / ${offline.join('+')}オフライン`; }
    else { dot.className = 'status-dot err'; txt.textContent = 'Ollamaオフライン'; }
  } catch {
    document.getElementById('status-dot').className = 'status-dot err';
    document.getElementById('status-text').textContent = '接続エラー';
  }
}

async function loadModels() {
  try {
    const r = await fetch(`${API_BASE}/api/models`);
    const models = await r.json();
    if (Array.isArray(models) && models.length > 0) {
      modelSelect.innerHTML = '';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        opt.selected = m.name === 'gpt-oss:20b';
        modelSelect.appendChild(opt);
      }
    }
  } catch {}
}

inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px'; });
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

async function sendMessage() {
  const text = inputEl.value.trim();
  if ((!text && !state.audioBlob) || state.isLoading) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  setLoading(true);
  const finalText = text || '[音声入力]';
  addMessage('user', finalText);
  state.messages.push({ role: 'user', content: finalText });
  if (state.agent === 'chat') await runChat(finalText);
  else await runAgent(finalText);
  setLoading(false);
}

async function runChat(text) {
  clearLog();
  const aiEl = addMessage('ai', '');
  state.currentAiMessageEl = aiEl.querySelector('.msg-bubble');
  state.currentAiContent = '';
  const controller = new AbortController();
  state.abortController = controller;
  try {
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: state.messages.slice(-12), model: modelSelect.value }),
      signal: controller.signal,
    });
    if (!r.ok) { updateAiMessage(`[エラー] ${(await r.json()).error}`); return; }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      let done, value;
      try { ({ done, value } = await reader.read()); } catch(e) { if (e.name === 'AbortError') break; throw e; }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        if (!chunk.startsWith('data: ')) continue;
        try { const d = JSON.parse(chunk.slice(6)); if (d.event === 'chat_token' && d.content) { state.currentAiContent += d.content; renderAiContent(state.currentAiContent); } } catch {}
      }
    }
    if (state.currentAiContent) state.messages.push({ role: 'assistant', content: state.currentAiContent });
  } catch(err) { if (err.name !== 'AbortError') updateAiMessage(`[接続エラー] ${err.message}`); }
  finally { state.abortController = null; }
}

async function runAgent(text) {
  let finalText = text;
  if (state.agent === 'minutes' && state.audioBlob) {
    clearLog();
    addLogEntry('system', '🎙️', 'Whisperで音声を文字起こし中...');
    try {
      const ab = await state.audioBlob.arrayBuffer();
      const r = await fetch(`${API_BASE}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': state.audioBlob.type || 'audio/wav', 'X-Filename': 'recording.wav' },
        body: ab,
      });
      if (r.ok) {
        const data = await r.json();
        finalText = data.text || text;
        addLogEntry('done', '✓', `文字起こし完了 (${finalText.length}文字)`);
        if (!text) { addMessage('user', `[音声→テキスト]\n${finalText}`); state.messages.push({ role: 'user', content: finalText }); }
      } else { addLogEntry('error', '✗', 'Whisper接続失敗。テキスト入力を使用します'); }
    } catch(err) { addLogEntry('error', '✗', `文字起こしエラー: ${err.message}`); }
    state.audioBlob = null;
    audioStatus.textContent = '音声なし (テキスト入力も使用可)';
  } else {
    clearLog();
    addLogEntry('system', '⚡', `エージェントを起動中...`);
  }
  const aiEl = addMessage('ai', '');
  state.currentAiMessageEl = aiEl.querySelector('.msg-bubble');
  state.currentAiContent = '';
  const body = {
    message: finalText,
    agent_type: state.agent,
    api_key: apiKeyInput.value.trim(),
    conversation_id: state.conversationId,
  };
  if (state.agent === 'minutes') {
    body.minutes_inputs = {
      title: document.getElementById('meeting-title').value || '会議議事録',
      format: document.getElementById('minutes-format').value || '標準議事録',
      notes: '',
    };
  }
  try {
    const r = await fetch(`${API_BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json();
      addLogEntry('error', '✗', err.error || 'エラー');
      updateAiMessage(`[エラー] ${err.error}`);
      return;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const startTimes = {};
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        if (!chunk.startsWith('data: ')) continue;
        try { handleAgentEvent(JSON.parse(chunk.slice(6)), startTimes); } catch {}
      }
    }
    if (state.currentAiContent) state.messages.push({ role: 'assistant', content: state.currentAiContent });
  } catch(err) { addLogEntry('error', '✗', `接続エラー: ${err.message}`); updateAiMessage(`[接続エラー] ${err.message}`); }
}

function handleAgentEvent(data, startTimes) {
  const now = new Date().toLocaleTimeString('ja-JP', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  switch (data.type) {
    case 'workflow_start': addLogEntry('start', '▶', data.message || 'ワークフロー開始', now); break;
    case 'node_start':
      startTimes[data.node_id] = Date.now();
      addLogEntry('start', '⏳', data.title || '処理中', now, null, data.node_id);
      break;
    case 'node_done': {
      const e = startTimes[data.node_id] ? ((Date.now() - startTimes[data.node_id]) / 1000).toFixed(1) : data.elapsed;
      addLogEntry(data.status !== 'failed' ? 'done' : 'error', data.status !== 'failed' ? '✓' : '✗', data.title || '完了', now, e ? `${e}s` : null);
      if (data.error) addLogEntry('error', '⚠', `エラー: ${data.error}`, now);
      break;
    }
    case 'workflow_done': addLogEntry('done', '✅', data.message || '完了', now); break;
    case 'iter_start':  addLogEntry('iter', '↻', data.title, now); break;
    case 'iter_next':   addLogEntry('iter', '↺', data.title, now); break;
    case 'iter_done':   addLogEntry('iter', '✓', data.title, now); break;
    case 'message_chunk': if (data.content) { state.currentAiContent += data.content; renderAiContent(state.currentAiContent); } break;
    case 'message_done': if (data.conversation_id) state.conversationId = data.conversation_id; break;
    case 'error': addLogEntry('error', '✗', data.message || 'エラー', now); break;
    case 'system': addLogEntry('system', '◎', data.message, now); break;
  }
}

async function toggleRecording() {
  const btn = document.getElementById('btn-record');
  if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
    state.mediaRecorder.stop();
    btn.textContent = '🎙️ 録音開始';
    btn.classList.remove('recording');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordingChunks = [];
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    state.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.recordingChunks.push(e.data); };
    state.mediaRecorder.onstop = () => {
      state.audioBlob = new Blob(state.recordingChunks, { type: 'audio/webm' });
      audioStatus.textContent = `録音完了 (${(state.audioBlob.size / 1024 / 1024).toFixed(2)}MB) — 送信ボタンで処理開始`;
      stream.getTracks().forEach(t => t.stop());
    };
    state.mediaRecorder.start();
    btn.textContent = '⏹ 録音停止';
    btn.classList.add('recording');
    audioStatus.textContent = '録音中...';
  } catch(err) { audioStatus.textContent = `マイクアクセスエラー: ${err.message}`; }
}

function handleAudioFile(input) {
  const file = input.files[0];
  if (!file) return;
  state.audioBlob = file;
  audioStatus.textContent = `ファイル: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) — 送信ボタンで処理開始`;
}

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `<div class="msg-role">${role === 'user' ? 'あなた' : 'MyAI'}</div><div class="msg-bubble">${escapeHtml(content)}</div>`;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  if (!content) div.querySelector('.msg-bubble').innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  return div;
}

function updateAiMessage(content) { if (state.currentAiMessageEl) state.currentAiMessageEl.textContent = content; }

function renderAiContent(content) {
  if (!state.currentAiMessageEl) return;
  const el = state.currentAiMessageEl;
  el.innerHTML = '';
  const parts = content.split(/(<think>[\s\S]*?<\/think>)/);
  for (const part of parts) {
    const m = part.match(/^<think>([\s\S]*?)<\/think>$/);
    if (m) { const d = document.createElement('div'); d.className = 'think'; d.textContent = '🤔 ' + m[1].trim(); el.appendChild(d); }
    else if (part) {
      const lines = part.split('\n');
      for (let i = 0; i < lines.length; i++) { el.appendChild(document.createTextNode(lines[i])); if (i < lines.length - 1) el.appendChild(document.createElement('br')); }
    }
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addLogEntry(cls, icon, text, time, elapsed, nodeId) {
  const existing = nodeId ? logEl.querySelector(`[data-node="${nodeId}"]`) : null;
  const div = existing || document.createElement('div');
  const ph = logEl.querySelector('.log-placeholder');
  if (ph) ph.remove();
  div.className = `log-entry ${cls}`;
  if (nodeId) div.dataset.node = nodeId;
  div.innerHTML = `<span class="log-icon">${icon}</span>${time ? `<span class="log-time">${time}</span>` : ''}<span class="log-text">${escapeHtml(String(text || ''))}</span>${elapsed ? `<span class="log-elapsed">${elapsed}</span>` : ''}`;
  if (!existing) logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() { logEl.innerHTML = ''; }

function newChat() {
  state.messages = []; state.conversationId = null; state.currentAiMessageEl = null; state.currentAiContent = ''; state.audioBlob = null;
  audioStatus.textContent = '音声なし (テキスト入力も使用可)';
  chatEl.innerHTML = '<div class="message ai"><div class="msg-role">MyAI</div><div class="msg-bubble">新しい会話を始めます。何でもお聞きください！</div></div>';
  logEl.innerHTML = '<div class="log-placeholder">エージェント実行時に<br>ノードの処理状況が<br>ここに表示されます</div>';
}

function setLoading(v) {
  state.isLoading = v;
  inputEl.disabled = v;
  sendBtn.style.display = v ? 'none' : 'flex';
  stopBtn.style.display = v ? 'flex' : 'none';
}

function stopGeneration() { if (state.abortController) { state.abortController.abort(); state.abortController = null; } }

function escapeHtml(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

switchAgent('chat');
newChat();
checkHealth();
loadModels();
setInterval(checkHealth, 30000);

window.switchAgent = switchAgent;
window.sendMessage = sendMessage;
window.stopGeneration = stopGeneration;
window.newChat = newChat;
window.toggleRecording = toggleRecording;
window.handleAudioFile = handleAudioFile;
