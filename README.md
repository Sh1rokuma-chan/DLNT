# MyAI Local — ローカルAIエージェント on M5 Mac

**MacBook Pro (M5, 24GB) 上で完全ローカル動作するAIエージェントシステムです。**

Dify・Ollama・SearXNG・Whisper・MCP を組み合わせ、Web検索・音声議事録・マルチステップ自動実行をオンプレ環境で高速に実現します。
モデルは `gpt-oss:20b` (MXFP4量子化, 13GB) を使用。

---

## ✨ 機能

| エージェント | 機能 |
|------|------|
| 🔍 **調査** | SearXNGでWeb検索 → LLMが分析・回答 |
| 🧠 **タスク** | タスクを分解して複数ステップを自律実行 |
| 📝 **議事録** | 音声/テキスト → 構造化議事録（Whisper文字起こし対応） |
| 💬 **汎用チャット** | Open WebUI で Ollama モデルと直接対話 |

---

## 🏛️ アーキテクチャ

```
http://localhost/         → master-nginx
  ├─ /                   → Open WebUI  (汎用チャット)
  └─ /agent/             → Agent UI v2 (3エージェント専用ダッシュボード)

http://localhost:8888/    → Dify        (ワークフロー管理画面)
http://localhost:19999/   → Netdata     (システム監視)
http://localhost:11434/   → Ollama      (ホスト側、Docker管理外)
```

| コンポーネント | 役割 |
|:---|:---|
| **Dify v1.13.0** | ワークフロー実行基盤。ノードベースでLLM・HTTP・コードを繋ぐ |
| **Ollama** | ローカルLLMサーバー（ホスト側で動作） |
| **gpt-oss:20b** | 使用するLLM（MXFP4量子化, 13GB） |
| **SearXNG** | ローカルメタ検索エンジン（Google/Bing/DuckDuckGo集約） |
| **Whisper API** | ローカル音声文字起こし（faster-whisper CPU版） |
| **MCP Server** | ローカルファイルシステム操作ツール |
| **Open WebUI** | 汎用チャットUI（モデル切り替え・ドキュメントアップロード対応） |
| **Agent UI v2** | 3エージェント専用カスタムダッシュボード |

---

## 📂 ファイル構成

```
dify-local-agent/
├── docker-compose.yaml      # 全19サービス定義
├── .env                     # シークレット・設定値（gitignore済み）
├── .env.example             # 設定テンプレート
├── nginx/conf.d/            # master-nginx設定
├── dify/
│   ├── nginx/conf.d/        # Dify専用nginx設定
│   └── volumes/             # Difyデータ永続化（gitignore済み）
├── agent-ui/                # Agent UI v2 (Express + カスタムHTML)
│   ├── public/index.html    # 4タブUI
│   ├── server.js            # APIプロキシ・Whisperプロキシ
│   └── Dockerfile
├── dsl/                     # Difyワークフロー定義
│   ├── research_agent.yml   # 調査エージェント
│   ├── task_agent.yml       # タスクエージェント
│   └── minutes_v2.yml       # 議事録ワークフロー
├── searxng/
│   └── settings.yml         # SearXNG設定
└── open-webui/
    └── custom.css           # Open WebUIスタイル
```

---

## 🚀 セットアップ

### 前提条件

- macOS (Apple Silicon)
- **Docker Desktop** — インストール済みで起動していること
- **Ollama** — ホスト側にインストール済みで `gpt-oss:20b` をダウンロード済み

```bash
# Ollamaとモデルの確認
ollama list   # gpt-oss:20b が表示されること
```

### 1. 起動

```bash
cd /path/to/dify-local-agent
docker compose up -d
```

初回起動は数分かかります。全サービスの状態確認:

```bash
docker compose ps
```

### 2. Dify 初期設定（初回のみ）

1. ブラウザで **http://localhost:8888/install** を開く
2. 管理者アカウントを作成（パスワードは `.env` の `INIT_PASSWORD` を参照）
3. `設定` → `モデルプロバイダー` → `Ollama` → 追加:
   - **Model Name**: `gpt-oss:20b`
   - **Base URL**: `http://host.docker.internal:11434`

### 3. DSL のインポート（初回のみ）

Dify スタジオ → 「**DSLファイルをインポート**」で以下の3ファイルを順番にインポート:

| ファイル | アプリ種別 | 機能 |
|---------|-----------|------|
| `dsl/research_agent.yml` | アドバンスドチャット | Web検索エージェント |
| `dsl/task_agent.yml` | アドバンスドチャット | タスク自動実行エージェント |
| `dsl/minutes_v2.yml` | ワークフロー | 議事録作成 |

インポート後、各アプリを **公開** し、`API Access` から **APIキー** を取得する。

### 4. APIキーの設定

取得したAPIキーを `.env` に設定:

```bash
# .env を編集
DIFY_API_KEY_RESEARCH=app-xxxxxxxxxxxx
DIFY_API_KEY_TASK=app-xxxxxxxxxxxx
DIFY_API_KEY_MINUTES=app-xxxxxxxxxxxx
```

設定後、agent-ui を再起動:

```bash
docker compose restart agent-ui
```

---

## 💻 使い方

| URL | 用途 |
|-----|------|
| http://localhost/ | Open WebUI (汎用チャット) |
| http://localhost/agent/ | Agent UI v2 (調査・タスク・議事録) |
| http://localhost:8888/ | Dify 管理画面 |
| http://localhost:19999/ | Netdata システム監視 |

---

## 🔧 日常運用

```bash
# 起動
docker compose up -d

# 停止
docker compose down

# ログ確認
docker compose logs [サービス名] --tail=50

# 特定サービスの再起動
docker compose restart agent-ui
```

---

## 📋 CREDENTIALS

初期パスワード等は `CREDENTIALS.md` を参照してください。
