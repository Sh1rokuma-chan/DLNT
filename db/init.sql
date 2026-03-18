-- DLNT PostgreSQL 初期化スクリプト
-- pgvector拡張を有効化し、初期スキーマを作成する

-- pgvector拡張
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- 全文検索用

-- ─────────────────────────────────────────────────────────
-- ワークスペース（プロジェクト単位管理）
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    rag_directories TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- デフォルトワークスペース
INSERT INTO workspaces (name, description) VALUES ('Default', 'デフォルトワークスペース')
    ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 会話
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    agent_type TEXT NOT NULL DEFAULT 'scout',
    title TEXT NOT NULL DEFAULT '新しい会話',
    pinned BOOLEAN DEFAULT FALSE,
    search_tsv tsvector,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_search ON conversations USING gin(search_tsv);

-- ─────────────────────────────────────────────────────────
-- メッセージ
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool_call', 'tool_result')),
    content TEXT NOT NULL,
    think_content TEXT,
    tool_calls JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

-- ─────────────────────────────────────────────────────────
-- エンベディング (RAG用)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('message', 'file')),
    source_ref TEXT,
    chunk_index INTEGER DEFAULT 0,
    content TEXT NOT NULL,
    embedding vector(384),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_workspace ON embeddings(workspace_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_ref);
-- ivfflatインデックスはAlembicマイグレーション後に作成する（データ投入後）

-- ─────────────────────────────────────────────────────────
-- updated_at 自動更新トリガー
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────
-- conversations.search_tsv 自動更新トリガー
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_conversation_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_tsv = to_tsvector('simple', COALESCE(NEW.title, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_conversations_search_tsv
    BEFORE INSERT OR UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_conversation_search_tsv();
