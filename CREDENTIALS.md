# ==========================================================
# ローカルAI (MyAI) 認証情報
# ==========================================================
# 作成日: 2026-02-23 (v2 - 完全再設計)
# ==========================================================

## アクセスURL一覧

| サービス | URL | 説明 |
|---------|-----|------|
| Chat UI | http://localhost/ | Open WebUI (ChatGPT風) |
| Agent UI | http://localhost/agent/ | 2ペインAgent Dashboard |
| Dify 管理画面 | http://localhost:8888/ | ワークフロー管理・初期設定 |
| Dify 初回セットアップ | http://localhost:8888/install | 初回のみ |
| Netdata 監視 | http://localhost:19999/ | リソース監視ダッシュボード |
| Ollama API | http://localhost:11434 | LLM API (ホスト側) |

---

## Dify 管理者アカウント 
  user:Admin
- URL: http://localhost:8888
- Email: admin@local.ai
- Password: LocalAI2026!

> 初回起動後 http://localhost:8888/install でセットアップが必要

---

## Dify API キー

- API Base URL: http://localhost:8888/v1
- エージェントワークフロー: ※Dify初回セットアップ後にDSLインポートして取得
- 議事録ワークフロー: ※Dify初回セットアップ後にDSLインポートして取得

> DSLファイル: `dsl/agent_workflow.yml` / `dsl/minutes_workflow.yml`

---

## Ollama

- URL: http://localhost:11434
- モデル: gpt-oss:20b (MXFP4量子化, 約13GB)
- コンテナからの接続: http://host.docker.internal:11434

---

## データベース (PostgreSQL)

- ホスト: localhost (コンテナ内: postgres)
- ポート: 5432 (内部のみ)
- DB名: dify
- ユーザー: dify
- Password: c9581b8b9f33045f6f4a250df4868804

---

## Redis

- ホスト: localhost (コンテナ内: redis)
- ポート: 6379 (内部のみ)
- Password: 9ed52e69782f93944174e27856de9607

---

## Qdrant (ベクトルDB)

- ホスト: localhost (コンテナ内: qdrant)
- ポート: 6333 (内部のみ)
- API Key: 046213dabf92a1c2f98918fda1430924

---

## Dify 内部シークレット

- SECRET_KEY: b4776390baea551eef7d78cb778e9a5c782bc76bad8a1baf9e68e219a126c267b9e307d613b1123f1dea
- SANDBOX_API_KEY: dify-sandbox-3f960f92715ac55c

---

## サービス管理コマンド

```bash
cd /Users/shirokuma-papa-pro/Documents/code/dify-local-agent

# 起動
docker compose up -d

# 停止
docker compose down

# ログ確認
docker compose logs -f [サービス名]

# 状態確認
docker compose ps

# sandboxのみ再起動
docker compose restart sandbox
```

---

## 初回セットアップ手順

1. `docker compose up -d` で全サービス起動
2. http://localhost:8888/install でDify管理者アカウント作成
   - Email: admin@local.ai
   - Password: LocalAI2026!
3. Dify管理画面 → Settings → Model Providers → Ollama
   - Base URL: http://host.docker.internal:11434
   - Model: gpt-oss:20b を追加
4. Studio → DSLインポート (`dsl/agent_workflow.yml`, `dsl/minutes_workflow.yml`)
5. 各ワークフローのAPIキーを取得して `.env` の `DIFY_*_API_KEY` を更新
6. `docker compose restart agent-ui` で反映

---

## Open WebUI (MyAI Chat)

- URL: http://localhost/chat/
- 初回: アカウント作成が必要
- Ollama接続: 自動設定済み (WEBUI_OLLAMA_BASE_URL=http://host.docker.internal:11434)
- カスタムCSS: `open-webui/custom.css` で ChatGPT風テーマ適用済み
