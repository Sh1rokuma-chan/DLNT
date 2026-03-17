# DLNT v2 — AIエージェントプラットフォーム RFP (Final)

**発行日**: 2026-03-17
**バージョン**: 2.0 Final
**プロジェクト名**: DLNT v2 (Development Lab for Next-gen Tools)
**対象環境**: MacBook Pro M5, 24GB Unified Memory, macOS, Docker Desktop
**主要LLM**: Ollama gpt-oss:20b (MXFP4量子化, 13GB)
**ライセンス**: Apache 2.0 (gpt-oss), 社内利用

---

## 0. 本ドキュメントの目的

Claude Codeに渡す実装指示書として機能するRFPである。設計判断の根拠を明記し、実装者が「なぜこうするのか」を理解した上でコードを書ける粒度を目指す。

---

## 1. 現行v1の診断と方針

### 1.1 現行アーキテクチャ

```
nginx:80 → Open WebUI (/), Agent UI (/agent/)
Agent UI: Express (server.js 690行) + 単一HTML (856行)
エージェント: research / task / minutes (Prompt Chain方式)
バックエンド: Ollama, SearXNG, faster-whisper
データ永続化: JSONファイル (/app/data/conversations/*.json)
```

### 1.2 診断

| 問題 | 詳細 |
|------|------|
| エージェントが「エージェント」ではない | Prompt Chain（線形パイプライン）。LLM自律ツール選択なし |
| UI/UX | Markdownレンダリングなし、モバイル非対応、会話サイドバーなし |
| データ層 | JSONファイル。検索・タグ・コンテキスト引継ぎ不可 |
| オンプレ優位性の未活用 | ローカルファイル操作、シェル実行、RAG — 全て未実装 |

### 1.3 方針

- **まず動くものを作る。** ハルシネーション対策、精度チューニング等は後続フェーズ。
- **gpt-oss:20b固定で開始。** モデルスワップの設計はインターフェースのみ用意し、初期実装では単一モデル。
- **Open WebUI廃止。** DLNT v2に統合。
- **Discord的DM UIを採用。** エージェントに人格を持たせ、DMする感覚で対話。

---

## 2. アーキテクチャ

### 2.1 全体構成図

```
Browser (React SPA)
  ├── Agent List (左サイドバー: Discord DM風)
  │   ├── Scout 🔍   ... 調査 (Web検索 + ローカルデータ横断)
  │   ├── Coder ⚡    ... コード実行 + シェル + ファイル操作
  │   ├── Archivist 📚 ... ローカルRAG + ファイル検索
  │   └── Scribe 📝   ... 議事録・レポート・要約 + Whisper
  ├── Chat Area (メイン: メッセージ + 折りたたみツール実行)
  └── Input Bar (テキスト + ファイルドロップ + 音声入力)
      │
      │ WebSocket (双方向ストリーミング)
      ↓
API Server (FastAPI, Python)
  ├── ReAct Loop Engine (自作, XMLタグベースツール呼び出し)
  ├── Tool Registry (プラグイン方式)
  │   ├── web_search   (SearXNG)
  │   ├── web_fetch    (httpx or Playwright)
  │   ├── file_read    (ローカルFS)
  │   ├── file_write   (ローカルFS)
  │   ├── file_search  (ファイル名 + 内容検索)
  │   ├── shell_exec   (許可リスト方式サンドボックス)
  │   ├── code_exec    (Python隔離実行)
  │   ├── whisper      (音声→テキスト)
  │   └── memory_search (pgvector類似度検索)
  ├── Conversation Manager (PostgreSQL CRUD + 全文検索)
  └── RAG Pipeline (インデックス構築 + 検索 + 注入)
      │
      ↓
Data Layer
  ├── PostgreSQL 16 + pgvector (会話, メタデータ, エンベディング)
  ├── Redis 7 (セッション, キャッシュ, PubSub)
  └── Volume Mount (~/dlnt-docs/ — RAG対象ディレクトリ)
      │
      ↓
Infrastructure
  ├── Ollama (ホスト側, gpt-oss:20b)
  ├── SearXNG (ローカルWeb検索)
  ├── faster-whisper (CPU版, 音声文字起こし — 常時起動)
  ├── Caddy (リバースプロキシ, 自動HTTPS)
  └── Netdata (システム監視)
```

### 2.2 技術スタック

| レイヤー | 選定 | 理由 |
|----------|------|------|
| フロントエンド | React + Vite + Tailwind + shadcn/ui | コンポーネント分離, HMR, モダンUIキット |
| APIサーバー | FastAPI (Python) | async, WebSocket統合, LLMエコシステム親和性 |
| エージェントランタイム | 自作ReActエンジン (Python) | gpt-oss:20bはtool use対応だが、XMLタグ方式も併用しSwallow等未対応モデルへの切替パスを確保 |
| DB | PostgreSQL 16 + pgvector | 会話永続化 + ベクトル検索を単一DBで |
| キャッシュ | Redis 7 | セッション, PubSub, ツール結果キャッシュ |
| リバースプロキシ | Caddy | 設定簡潔, WebSocket対応 |

### 2.3 モデル管理方針

**初期実装**: gpt-oss:20b 固定。Ollama `/api/chat` を直接呼び出し。

**将来拡張のためのインターフェース設計**:
```python
class LLMProvider(Protocol):
    async def chat(self, messages: list[dict], tools: list[dict] | None,
                   stream: bool) -> AsyncIterator[str]: ...
    async def embed(self, text: str) -> list[float]: ...

class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str): ...
```

モデル切替は設定ファイル（YAML）で行い、エージェントごとにモデルを指定可能にする。ただし初期実装では全エージェントが同一モデルを使用。

```yaml
# config.yaml (将来拡張用、初期は全て同じモデル)
models:
  default: gpt-oss:20b
  agents:
    scout: gpt-oss:20b
    coder: gpt-oss:20b
    archivist: gpt-oss:20b
    scribe: gpt-oss:20b
```

**Ollamaのマルチモデル制約**: Ollamaは1モデルをメモリ保持し、別モデル呼び出し時にスワップ（30-60秒）が発生する。24GBで20bモデル（13GB）と8Bモデル（5GB）の同時保持は理論上可能だが、Ollamaは標準でマルチモデル同時ロードをサポートしない。軽量モデル並走が必要になった場合は、llama.cppを別ポートで起動する案を検討する（Phase 2以降）。

---

## 3. ReActエージェントエンジン

### 3.1 コアループ

```
ユーザー入力 + System Prompt + Tool Definitions + 会話履歴
    ↓
┌─→ LLM推論
│   出力パターン:
│     A) <tool_call>{"name": "xxx", "args": {...}}</tool_call>
│        → ツール実行 → 結果をObservationとしてコンテキストに追加 → ループ継続
│     B) <final_answer>...</final_answer>
│        → 最終回答をユーザーに返す → ループ終了
│     C) 通常テキスト（タグなし）
│        → 最終回答として扱う → ループ終了
│   ↓
└── 最大ループ: 8回 (設定可能)
```

### 3.2 System Prompt テンプレート（エージェント共通部分）

```
あなたは「{agent_name}」というAIエージェントです。
ユーザーの要求を達成するために、以下のツールを使用できます。

## 使用可能なツール
{tool_definitions}

## ツールの使い方
ツールを使用するには、以下の形式で出力してください:
<tool_call>{"name": "ツール名", "args": {"引数名": "値"}}</tool_call>

ツール実行結果は <tool_result> タグで提供されます。

## 回答の仕方
- 最終回答を出す準備ができたら、そのまま回答を記述してください。
- 推論過程は <think>...</think> で囲んでください。
- 複数のツールを順次使用できます（1回のレスポンスで1ツール）。
- ツール実行が失敗した場合は、別のアプローチを試みてください。
```

### 3.3 ツール呼び出しパーサー

gpt-oss:20bはOpenAI互換のfunction calling（`tools`パラメータ）をサポートしている。初期実装では**まずOllama APIの`tools`パラメータを試行**し、精度不足（JSONパースエラー率が高い等）の場合にXMLタグ方式にフォールバックする。

```python
# 2段階パーサー
class ToolCallParser:
    def parse(self, response: str, mode: str = "auto") -> ToolCall | FinalAnswer:
        if mode == "native" or mode == "auto":
            # Ollama tools APIのレスポンスからtool_callsを抽出
            ...
        if mode == "xml" or (mode == "auto" and native_failed):
            # <tool_call>...</tool_call> タグをパース
            match = re.search(r'<tool_call>(.*?)</tool_call>', response, re.DOTALL)
            ...
```

### 3.4 ストリーミング

各ステップをWebSocket経由でフロントエンドにリアルタイム送出する。

```json
// 思考過程の開始
{"type": "think_start"}
// 思考トークン (ストリーミング)
{"type": "think_token", "content": "ユーザーはNutanixの..."}
// 思考過程の終了
{"type": "think_end"}
// ツール呼び出し
{"type": "tool_call", "name": "web_search", "args": {"query": "Nutanix NCP-MCI"}}
// ツール実行結果
{"type": "tool_result", "name": "web_search", "success": true, "summary": "8件取得", "elapsed": 1.2}
// 最終回答トークン (ストリーミング)
{"type": "answer_token", "content": "NCP-MCIは..."}
// 完了
{"type": "done", "total_elapsed": 4.3, "tools_used": 3}
```

---

## 4. エージェント設計 (Discord DM形式)

### 4.1 エージェント一覧

| エージェント | アイコン | 役割 | 主要ツール | プロフィール説明 |
|-------------|---------|------|------------|----------------|
| **Scout** | 🔍 | 調査・分析 | web_search, web_fetch, file_read, memory_search | Web検索とローカルデータを横断して調査レポートを生成。出典付き。 |
| **Coder** | ⚡ | コード・シェル | code_exec, shell_exec, file_read, file_write | Pythonコード実行、シェルコマンド、ファイル操作。デバッグやデータ分析に。 |
| **Archivist** | 📚 | 知識・RAG | memory_search, file_search, file_read | プロジェクト内ドキュメントの横断検索。過去の会話から知識を引き出す。 |
| **Scribe** | 📝 | 文書生成 | whisper, file_write, file_read | 議事録・レポート・要約の生成。音声ファイルからの文字起こしに対応。 |

**全エージェントが全ツールにアクセス可能**とする。上記の「主要ツール」は、System Promptで優先的に使うよう指示するツールであり、アクセス制限ではない。ScoutがCoderのcode_execを使うことも許容する。

### 4.2 Auto Routing

入力欄で特定のエージェントを選ばずに送信した場合、LLMがクエリを分類して適切なエージェントにディスパッチする。

```python
ROUTING_PROMPT = """以下のユーザーメッセージを分類し、最適なエージェントを1つ選んでください。
JSON形式で回答してください: {"agent": "scout|coder|archivist|scribe"}

エージェント:
- scout: Web検索が必要、最新情報、ニュース、調査
- coder: コード実行、デバッグ、データ分析、シェルコマンド
- archivist: ローカルファイル検索、過去の情報参照、RAG
- scribe: 議事録、レポート作成、要約、文書生成

メッセージ: {message}"""
```

**ルーティング判定はメインモデル（gpt-oss:20b）で実行する。** 軽量モデルでの分類は将来の最適化として残す。ルーティング結果はシステムメッセージ（「Scout に転送しました」）で表示。

### 4.3 エージェントプロフィール画面

エージェントのアイコンまたは名前をクリックすると、プロフィールカードがオーバーレイ表示される。

```
┌─────────────────────────────────┐
│  🔍 Scout                        │
│  調査・分析エージェント            │
│                                   │
│  使えるツール:                    │
│  • web_search — Web検索          │
│  • web_fetch — ページ取得         │
│  • file_read — ファイル読み取り    │
│  • memory_search — 記憶検索       │
│                                   │
│  得意なこと:                      │
│  最新ニュースの調査、技術情報の    │
│  リサーチ、出典付きレポート作成    │
│                                   │
│  統計:                            │
│  会話数: 47 | 平均応答: 4.2s      │
│  最もよく使うツール: web_search   │
│                                   │
│  モデル: gpt-oss:20b              │
│  ステータス: 🟢 Online            │
└─────────────────────────────────┘
```

---

## 5. ツール仕様

### 5.1 ツール定義インターフェース

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class ToolResult:
    success: bool
    data: Any           # 構造化データ（LLMコンテキストに注入）
    display: str        # UI表示用のサマリー（1-2行）
    error: str = ""

class BaseTool:
    name: str
    description: str
    parameters: dict    # JSON Schema形式
    timeout: int = 30   # 秒

    async def execute(self, args: dict, context: dict) -> ToolResult:
        raise NotImplementedError
```

### 5.2 初期搭載ツール詳細

#### web_search
```python
name = "web_search"
description = "SearXNGでWeb検索を実行し、結果のタイトル・URL・スニペットを返す"
parameters = {
    "query": {"type": "string", "required": True},
    "count": {"type": "integer", "default": 5, "max": 10}
}
timeout = 15
```

#### web_fetch
```python
name = "web_fetch"
description = "指定URLのWebページ全文を取得しテキスト化する"
parameters = {
    "url": {"type": "string", "required": True},
    "max_chars": {"type": "integer", "default": 10000}
}
timeout = 30
```

#### file_read
```python
name = "file_read"
description = "ローカルファイルの内容を読み取る。テキスト、CSV、JSON、Markdown等に対応"
parameters = {
    "path": {"type": "string", "required": True},
    "max_chars": {"type": "integer", "default": 20000}
}
timeout = 10
# セキュリティ: マウントポイント内のパスのみ許可
```

#### file_write
```python
name = "file_write"
description = "ファイルを作成または上書きする。レポート、スクリプト、データ出力等に使用"
parameters = {
    "path": {"type": "string", "required": True},
    "content": {"type": "string", "required": True}
}
timeout = 10
# セキュリティ: 書き込み許可ディレクトリのみ
```

#### file_search
```python
name = "file_search"
description = "ローカルファイルシステムでファイル名や内容を検索する"
parameters = {
    "query": {"type": "string", "required": True},
    "directory": {"type": "string", "default": "/mnt/user/documents"},
    "type": {"type": "string", "enum": ["name", "content", "both"], "default": "both"}
}
timeout = 30
```

#### shell_exec
```python
name = "shell_exec"
description = "シェルコマンドを実行する（許可リスト制）。git, python, ls, grep等"
parameters = {
    "command": {"type": "string", "required": True}
}
timeout = 30
# 許可リスト (config/allowed_commands.yaml) で制御
# rm -rf, sudo, chmod, kill 等は拒否
```

#### code_exec
```python
name = "code_exec"
description = "Pythonコードを隔離環境で実行し、出力を返す。データ分析、計算、変換に使用"
parameters = {
    "code": {"type": "string", "required": True}
}
timeout = 60
# subprocess + tempfile で隔離実行
# pandas, numpy, matplotlib 等は利用可能
```

#### whisper
```python
name = "whisper"
description = "音声ファイルを日本語テキストに文字起こしする"
parameters = {
    "audio_path": {"type": "string", "required": True}
}
timeout = 300
# faster-whisper API (http://whisper-api:8000) にプロキシ
```

#### memory_search
```python
name = "memory_search"
description = "過去の会話やインデックス済みドキュメントからベクトル類似度検索を行う"
parameters = {
    "query": {"type": "string", "required": True},
    "limit": {"type": "integer", "default": 5},
    "scope": {"type": "string", "enum": ["all", "conversations", "documents"], "default": "all"}
}
timeout = 5
```

---

## 6. フロントエンド設計

### 6.1 Discord DM風レイアウト

```
┌──────────────┬───────────────────────────────────┐
│ Agent List   │  Chat Header                       │
│              │  [🔍 Scout] Online — gpt-oss:20b   │
│ 🔍 Scout ●  │  [Profile] [Tools]                 │
│ ⚡ Coder ●  ├───────────────────────────────────┤
│ 📚 Archivst │  Messages                          │
│ 📝 Scribe ● │                                    │
│ ─────────── │  [User] テキスト ✓✓                │
│ Recent:      │                                    │
│  "NCP-MCI.." │  [Scout]                           │
│  "IaC deb.." │   ┌ ● web_search — 1.2s ──────┐  │
│              │   │ ● file_read  — 0.3s        │  │
│              │   └────────── 折りたたみ ───────┘  │
│              │   最終回答テキスト (Markdown)       │
│              │                                    │
│ ─────────── ├───────────────────────────────────┤
│ Workspace:   │  [📎] [🎤] メッセージ...    [↑]   │
│ [NutanixSI▾] │                                    │
└──────────────┴───────────────────────────────────┘
```

### 6.2 UI要件

**メッセージ表示**:
- Markdownレンダリング: react-markdown + remark-gfm + rehype-highlight
- コードブロック: シンタックスハイライト + コピーボタン
- `<think>` タグ: **デフォルト折りたたみ**。「思考過程 ▶」クリックで展開。薄いグレー背景。
- ツール呼び出し: メッセージ上部にチップ形式で表示。クリックで引数・結果展開。
- 既読表示: ✓ (送信済み) → ✓✓ (処理開始) → 応答開始で消える

**サイドバー**:
- エージェント一覧（オンライン状態表示）
- 会話履歴（最新順、検索可能）
- ワークスペース選択（RAGスコープ制御）

**入力**:
- テキスト入力 (Shift+Enter改行, Enter送信)
- ファイルドロップ (ドラッグ&ドロップ)
- 音声入力 (MediaRecorder → Whisperエージェント)
- エージェント選択 (@メンション or タブ切替)

**レスポンシブ**: モバイルではサイドバー折りたたみ。チャットエリアのみ表示。

### 6.3 キーボードショートカット

| ショートカット | 動作 |
|--------------|------|
| Cmd+K | 会話検索 |
| Cmd+N | 新規会話 |
| Cmd+Enter | 送信 |
| Cmd+1-4 | エージェント切替 |
| Escape | 生成停止 |

---

## 7. データ設計

### 7.1 PostgreSQLスキーマ

```sql
-- ワークスペース（プロジェクト単位管理）
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    rag_directories TEXT[] DEFAULT '{}',  -- RAG対象パス
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会話
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id),
    agent_type TEXT NOT NULL DEFAULT 'scout',
    title TEXT NOT NULL DEFAULT '新しい会話',
    pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- メッセージ
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,           -- user, assistant, system, tool_call, tool_result
    content TEXT NOT NULL,
    think_content TEXT,           -- <think>タグの内容（分離保存）
    tool_calls JSONB,            -- [{name, args, result, elapsed, success}]
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

-- エンベディング (RAG用)
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id),
    source_type TEXT NOT NULL,    -- 'message', 'file'
    source_ref TEXT,              -- ファイルパス or メッセージID
    chunk_index INTEGER,
    content TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_embeddings_vec ON embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 全文検索用インデックス
ALTER TABLE conversations ADD COLUMN search_tsv tsvector;
CREATE INDEX idx_conv_search ON conversations USING gin(search_tsv);
```

### 7.2 RAG設計

**Claude Codeへの指示**: RAGの実装詳細（チャンク分割戦略、エンベディングモデル選定、インデックス更新方式）は実装時に最適な判断をせよ。以下は方針のみ。

- **対象ディレクトリ**: ワークスペースごとに `rag_directories` で指定（例: `~/dlnt-docs/nutanix/`）
- **対応形式**: .txt, .md, .pdf, .docx, .csv, .json, .py, .js, .ts
- **エンベディングモデル**: CPU推論で高速な384次元モデル。multilingual-e5-small（日本語重視）を第一候補とする
- **検索**: pgvectorのコサイン類似度検索。上位5-10件をSystem Promptに注入
- **更新**: 初回は手動インデックス構築。将来的にはファイル変更検知で差分更新

---

## 8. docker-compose.yaml

```yaml
services:
  # --- Frontend (React SPA, Viteビルド済み) ---
  frontend:
    build: ./frontend
    # Caddyで配信

  # --- API Server ---
  api:
    build: ./api
    environment:
      DATABASE_URL: postgresql://dlnt:${DB_PASSWORD}@postgres:5432/dlnt
      REDIS_URL: redis://redis:6379
      OLLAMA_URL: http://host.docker.internal:11434
      OLLAMA_MODEL: gpt-oss:20b
      SEARXNG_URL: http://searxng:8080
      WHISPER_URL: http://whisper-api:8000
    volumes:
      - ${DLNT_DOCS_DIR:-~/dlnt-docs}:/mnt/user/documents
      - ${HOME}/Desktop:/mnt/user/desktop
      - agent-workspace:/app/workspace
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    extra_hosts:
      - "host.docker.internal:host-gateway"
    networks:
      - frontend-net
      - backend-net

  # --- Database ---
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: dlnt
      POSTGRES_USER: dlnt
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dlnt"]
      interval: 5s
      retries: 5
    networks:
      - backend-net

  # --- Cache ---
  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    networks:
      - backend-net

  # --- Search ---
  searxng:
    image: searxng/searxng:latest
    volumes:
      - ./searxng:/etc/searxng
    environment:
      SEARXNG_SECRET_KEY: ${SEARXNG_SECRET_KEY}
    networks:
      - backend-net

  # --- Whisper ---
  whisper-api:
    image: fedirz/faster-whisper-server:latest-cpu
    environment:
      WHISPER__MODEL: ${WHISPER_MODEL:-small}
      WHISPER__LANGUAGE: ja
    networks:
      - backend-net

  # --- Reverse Proxy ---
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on:
      - frontend
      - api
    networks:
      - frontend-net

  # --- Monitoring ---
  netdata:
    image: netdata/netdata:stable
    ports:
      - "19999:19999"
    pid: host
    cap_add: [SYS_PTRACE, SYS_ADMIN]
    security_opt: [apparmor:unconfined]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      NETDATA_DISABLE_CLOUD: 1

networks:
  frontend-net:
  backend-net:

volumes:
  pgdata:
  redis-data:
  caddy-data:
  agent-workspace:
```

---

## 9. メモリバジェット (24GB)

| コンポーネント | 推定メモリ |
|---------------|-----------|
| gpt-oss:20b (Ollama, MXFP4) | ~13 GB |
| PostgreSQL 16 + pgvector | ~0.5 GB |
| Redis 7 | ~0.1 GB |
| FastAPI + Python runtime | ~0.3 GB |
| React SPA (ブラウザ側) | — |
| SearXNG | ~0.2 GB |
| faster-whisper (small, CPU) | ~0.5 GB |
| Caddy + Netdata | ~0.2 GB |
| macOS + Docker overhead | ~2.0 GB |
| **合計** | **~16.8 GB** |
| **余裕** | **~7.2 GB** |

LLM推論中のKVキャッシュ等でOllamaの使用量が一時的に増加するが、7GB以上の余裕があるため問題ない。

---

## 10. 実装フェーズ

### Phase 1: 基盤 (Week 1-2)
- [ ] プロジェクト構造の作成 (monorepo: api/, frontend/, db/, config/)
- [ ] docker-compose.yaml + PostgreSQL初期化SQL
- [ ] FastAPI骨格 (WebSocket + REST endpoints)
- [ ] DBスキーマ + Alembicマイグレーション
- [ ] Ollamaとの疎通確認 (ストリーミングチャット)

### Phase 2: ReActエンジン + ツール (Week 3-4)
- [ ] ReActループエンジン (Thought/Action/Observation パーサー)
- [ ] Tool Registry + 初期ツール (web_search, file_read, file_write, shell_exec, code_exec)
- [ ] WebSocketストリーミング (ツール実行過程のリアルタイム送出)
- [ ] エージェント定義 (Scout, Coder, Archivist, Scribe)

### Phase 3: フロントエンド (Week 5-6)
- [ ] React SPA (Vite + Tailwind + shadcn/ui)
- [ ] Discord DM風レイアウト (サイドバー + チャット)
- [ ] メッセージ表示 (Markdown, コードハイライト, 折りたたみ)
- [ ] エージェントプロフィール, 既読表示, ツール実行チップ
- [ ] ファイルアップロード + 音声入力

### Phase 4: RAG + 高度機能 (Week 7-8)
- [ ] Whisperツール統合
- [ ] RAGパイプライン (インデックス構築 + 検索 + 注入)
- [ ] ワークスペース機能
- [ ] Auto Routing (エージェント自動選択)
- [ ] 会話検索 (PostgreSQL全文検索)

### Phase 5: 仕上げ (Week 9-10)
- [ ] Caddy設定
- [ ] エラーハンドリング + ログ整備
- [ ] パフォーマンスチューニング
- [ ] v1からのデータ移行スクリプト
- [ ] README + セットアップドキュメント

---

## 11. v1からの移行対応表

| v1 | v2 |
|----|----|
| Express server.js | FastAPI (Python) |
| index.html 856行 | React SPA (コンポーネント分離) |
| JSONファイル会話保存 | PostgreSQL |
| Prompt Chain (research/task/minutes) | ReAct Loop + Tool Registry |
| Dify DSLワークフロー (廃止済み) | — |
| SearXNG | SearXNG (継続) |
| faster-whisper | faster-whisper (継続) |
| Open WebUI | **廃止** (DLNT v2に統合) |
| Nginx | Caddy |
| Netdata | Netdata (継続) |

---

## 12. ファイル構成 (想定)

```
dlnt-v2/
├── docker-compose.yaml
├── .env.example
├── Caddyfile
├── README.md
│
├── api/                          # FastAPI バックエンド
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py               # FastAPIエントリポイント
│   │   ├── config.py             # 設定管理
│   │   ├── models/               # Pydanticモデル
│   │   ├── routers/              # APIルーター
│   │   │   ├── chat.py           # WebSocketチャット
│   │   │   ├── agents.py         # エージェント管理
│   │   │   ├── conversations.py  # 会話CRUD
│   │   │   ├── files.py          # ファイルアップロード
│   │   │   └── system.py         # ヘルス, メトリクス
│   │   ├── agent/                # エージェントエンジン
│   │   │   ├── engine.py         # ReActループ
│   │   │   ├── parser.py         # ツール呼び出しパーサー
│   │   │   ├── agents.py         # Scout, Coder, Archivist, Scribe定義
│   │   │   └── prompts.py        # System Prompt テンプレート
│   │   ├── tools/                # ツール実装
│   │   │   ├── base.py           # BaseTool
│   │   │   ├── registry.py       # ToolRegistry
│   │   │   ├── web_search.py
│   │   │   ├── web_fetch.py
│   │   │   ├── file_ops.py       # file_read, file_write, file_search
│   │   │   ├── shell_exec.py
│   │   │   ├── code_exec.py
│   │   │   ├── whisper.py
│   │   │   └── memory_search.py
│   │   ├── llm/                  # LLMプロバイダー
│   │   │   ├── base.py           # LLMProvider Protocol
│   │   │   └── ollama.py         # OllamaProvider
│   │   ├── rag/                  # RAGパイプライン
│   │   │   ├── indexer.py
│   │   │   ├── embedder.py
│   │   │   └── retriever.py
│   │   └── db/                   # DB操作
│   │       ├── session.py
│   │       └── crud.py
│   └── tests/
│
├── frontend/                     # React SPA
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── AgentList.tsx      # 左サイドバー
│   │   │   ├── ChatArea.tsx       # メインチャット
│   │   │   ├── MessageBubble.tsx  # メッセージ表示
│   │   │   ├── ToolChip.tsx       # ツール実行チップ
│   │   │   ├── ThinkFold.tsx      # 思考過程折りたたみ
│   │   │   ├── AgentProfile.tsx   # プロフィールカード
│   │   │   ├── InputBar.tsx       # 入力エリア
│   │   │   └── WorkspaceSelector.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   └── useAgent.ts
│   │   ├── stores/               # Zustand
│   │   │   └── chatStore.ts
│   │   └── lib/
│   │       └── api.ts
│   └── public/
│
├── db/
│   └── init.sql                  # PostgreSQL初期化
│
├── config/
│   ├── agents.yaml               # エージェント定義
│   ├── models.yaml               # モデル設定
│   └── allowed_commands.yaml     # シェル許可リスト
│
└── searxng/
    └── settings.yml
