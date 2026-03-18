# Tak AI Chat — ローカルAIエージェント on Apple Silicon Mac

**完全ローカル動作のAIエージェントシステム。**
会話データ・ファイル・音声はすべてマシン内で処理され、外部サーバーへのアップロードや学習への利用は一切ありません。

FastAPI + React + Ollama + llama.cpp + SearXNG + pgvector を組み合わせ、
Web検索・コード実行・音声議事録・マルチステップ自動実行をオンプレ環境で実現します。

---

## 閉域ネットワーク動作について

| 項目 | 説明 |
|------|------|
| **LLM 処理** | Ollama / llama.cpp がローカルで動作。クラウド API 不使用 |
| **会話データ** | PostgreSQL にローカル保存。外部送信なし |
| **ファイル・音声** | マシン内で処理。アップロード・学習利用なし |
| **Web 接続** | Web検索ツール (SearXNG) 使用時のみ。入力バーの Globe ボタンで ON/OFF 切替可能 |
| **オフライン動作** | Web検索を OFF にすれば完全オフラインで動作 |

---

## エージェント

| エージェント | 機能 |
|------|------|
| 🔍 **Scout** | SearXNG でWeb検索 → LLMが分析・出典付きレポートを生成 |
| ⚡ **Coder** | Python/シェル実行、ファイル操作、コード分析 |
| 📚 **Archivist** | プロジェクト内ドキュメントを pgvector RAG で横断検索 |
| 📝 **Scribe** | 議事録・レポート生成、Whisper 音声文字起こし対応 |

---

## アーキテクチャ

```
ブラウザ → http://localhost:8080/     → Caddy (リバースプロキシ)
                                         ├─ /         → React SPA (Frontend)
                                         ├─ /api/*    → FastAPI (REST)
                                         └─ /ws/*     → FastAPI (WebSocket)

FastAPI (API Server)
  ├─ Ollama (host:11434)         … gpt-oss:20b (デフォルト)
  ├─ llama.cpp (host:11435)      … Qwen3.5-35B-A3B (オンデマンド起動)
  ├─ PostgreSQL + pgvector       … 会話履歴・ベクトルDB
  ├─ Redis                       … セッション管理
  ├─ SearXNG                     … Web検索エンジン
  └─ Whisper API                 … 音声文字起こし

http://localhost:19999/  → Netdata (システム監視)
```

| コンポーネント | 役割 |
|:---|:---|
| **FastAPI** | ReActエンジン、WebSocket ストリーミング、ツール実行 |
| **React + Zustand** | Tak AI Chat UI (SPA) |
| **Ollama** | ローカルLLMサーバー (gpt-oss:20b デフォルト) |
| **llama.cpp** | Qwen3.5-35B-A3B HauhauCS (セーフガード解除、モデル選択時に自動起動) |
| **PostgreSQL + pgvector** | 会話履歴・ベクトル埋め込みDB |
| **Redis** | セッション管理 |
| **SearXNG** | ローカルメタ検索エンジン (Google/Bing/DuckDuckGo集約) |
| **Whisper API** | ローカル音声文字起こし (faster-whisper CPU版) |
| **Caddy** | リバースプロキシ (WebSocket自動対応) |
| **Netdata** | リソース監視ダッシュボード |

---

## ファイル構成

```
DLNT/
├── dlnt.sh                  # 統合起動/停止スクリプト
├── docker-compose.yaml      # Docker サービス定義
├── Caddyfile                # リバースプロキシ設定
├── .env                     # 環境変数 (gitignore済み)
├── .env.example             # 設定テンプレート
├── api/                     # FastAPI バックエンド
│   ├── app/
│   │   ├── main.py          # エントリポイント
│   │   ├── config.py        # 設定管理
│   │   ├── agent/           # ReActエンジン・エージェント定義
│   │   │   ├── engine.py    # ReActループ (Thought → Action → Observation)
│   │   │   ├── agents.py    # エージェント定義 (Scout/Coder/Archivist/Scribe)
│   │   │   ├── parser.py    # ツール呼び出しパーサー
│   │   │   └── prompts.py   # システムプロンプト
│   │   ├── routers/         # APIルーター
│   │   │   ├── chat.py      # WebSocket / REST チャット
│   │   │   ├── conversations.py  # 会話CRUD・フォルダ管理
│   │   │   ├── agents.py    # エージェント情報API
│   │   │   └── system.py    # ヘルスチェック・モデル管理・ウォームアップ
│   │   ├── llm/
│   │   │   └── ollama.py    # LLMプロバイダー (Ollama + llama.cpp 統合)
│   │   ├── tools/           # ツール実装
│   │   ├── rag/             # RAG パイプライン
│   │   └── db/              # DB モデル・CRUD
│   ├── alembic/             # DBマイグレーション
│   └── Dockerfile
├── frontend/                # React フロントエンド
│   ├── src/
│   │   ├── App.tsx          # メインレイアウト
│   │   ├── components/      # UIコンポーネント
│   │   ├── stores/          # Zustand ストア
│   │   ├── hooks/           # WebSocket 管理等
│   │   └── lib/             # REST API クライアント
│   └── Dockerfile
├── scripts/                 # ホスト側ユーティリティ
│   └── llamacpp-launcher.py # llama.cpp オンデマンド起動/停止 API (port 11436)
├── config/                  # エージェント・モデル設定 (YAML)
├── db/init.sql              # DB 初期化スクリプト
└── searxng/settings.yml     # SearXNG 設定
```

---

## セットアップ

### 前提条件

- macOS (Apple Silicon)
- **Docker Desktop** — インストール済みで起動していること
- **Ollama** — ホスト側にインストール済み

```bash
# Ollamaとモデルの確認
ollama list   # gpt-oss:20b が表示されること

# モデルがなければダウンロード
ollama pull gpt-oss:20b

# オプション: Qwen3.5 カスタムモデル (セーフガード解除)
# llama.cpp b8398 以降が必要 (~/llama-cpp/llama-b8398/)
# モデル選択時に dlnt.sh のランチャー経由で自動起動されます
```

### 起動

```bash
cd /path/to/DLNT
cp .env.example .env   # 初回のみ

# 統合起動 (Docker + llama.cpp ランチャー)
./dlnt.sh up

# 統合停止 (Docker + llama.cpp + Ollama 全停止)
./dlnt.sh down

# 状態確認
./dlnt.sh status
```

---

## 使い方

| URL | 用途 |
|-----|------|
| http://localhost:8080/ | Tak AI Chat (メインUI) |
| http://localhost:8080/api/docs | FastAPI Swagger UI |
| http://localhost:19999/ | Netdata システム監視 |

### 基本操作

- **Enter** で送信、**Shift+Enter** で改行 (日本語変換中の Enter は送信されません)
- **⌘1〜⌘4** でエージェント切替
- **⌘N** で新しい会話、**⌘K** で会話検索
- **Esc** で AI生成を停止
- 入力バーの **Globe ボタン** で Web検索の ON/OFF 切替
- 会話はフォルダにまとめて整理可能 (ホバー → フォルダアイコン)
- 会話の削除はゴミ箱アイコンをダブルクリック

### モデル切替

ヘッダーのモデルセレクタから切替可能。ロード進捗がプログレスバーで表示されます。

- **gpt-oss:20b** — Ollama で動作 (デフォルト)
- **Qwen3.5-35B-A3B** — llama.cpp で動作 (初回選択時に自動起動)

---

## 日常運用

```bash
# 統合起動/停止
./dlnt.sh up
./dlnt.sh down
./dlnt.sh status

# Docker のみの操作
docker compose logs api --tail=50
docker compose restart api
docker compose up -d --build frontend
```

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| LLM が応答しない | `ollama ps` でモデルがロードされているか確認 |
| qwen が応答しない | `./dlnt.sh status` で llama.cpp サーバーの状態確認 |
| WebSocket 接続エラー | `docker compose logs caddy` でプロキシログ確認 |
| DB エラー | `docker compose logs api` でマイグレーション状態確認 |
| 完全オフライン動作したい | 入力バーの Globe ボタンを OFF に切替 |

---

## CREDENTIALS

初期パスワード等は `.env` ファイルを参照してください。
