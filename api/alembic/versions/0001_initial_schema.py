"""Initial schema — workspaces, conversations, messages, embeddings

Revision ID: 0001
Revises:
Create Date: 2026-03-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgvector拡張
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # workspaces
    op.create_table(
        "workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("rag_directories", postgresql.ARRAY(sa.Text), server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute("INSERT INTO workspaces (name, description) VALUES ('Default', 'デフォルトワークスペース')")

    # conversations
    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="SET NULL")),
        sa.Column("agent_type", sa.Text, nullable=False, server_default="scout"),
        sa.Column("title", sa.Text, nullable=False, server_default="新しい会話"),
        sa.Column("pinned", sa.Boolean, server_default="false"),
        sa.Column("search_tsv", postgresql.TSVECTOR),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_conversations_workspace", "conversations", ["workspace_id"])
    op.create_index("idx_conversations_updated", "conversations", [sa.text("updated_at DESC")])
    op.create_index("idx_conv_search", "conversations", ["search_tsv"], postgresql_using="gin")

    # messages
    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Text, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("think_content", sa.Text),
        sa.Column("tool_calls", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_messages_conv", "messages", ["conversation_id", "created_at"])

    # embeddings
    op.create_table(
        "embeddings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE")),
        sa.Column("source_type", sa.Text, nullable=False),
        sa.Column("source_ref", sa.Text),
        sa.Column("chunk_index", sa.Integer, server_default="0"),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", Vector(384)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_embeddings_workspace", "embeddings", ["workspace_id"])
    op.create_index("idx_embeddings_source", "embeddings", ["source_type", "source_ref"])

    # updated_at トリガー
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE OR REPLACE TRIGGER trg_conversations_updated_at
        BEFORE UPDATE ON conversations
        FOR EACH ROW EXECUTE FUNCTION update_updated_at()
    """)

    # search_tsv トリガー
    op.execute("""
        CREATE OR REPLACE FUNCTION update_conversation_search_tsv()
        RETURNS TRIGGER AS $$
        BEGIN NEW.search_tsv = to_tsvector('simple', COALESCE(NEW.title, '')); RETURN NEW; END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE OR REPLACE TRIGGER trg_conversations_search_tsv
        BEFORE INSERT OR UPDATE ON conversations
        FOR EACH ROW EXECUTE FUNCTION update_conversation_search_tsv()
    """)


def downgrade() -> None:
    op.drop_table("embeddings")
    op.drop_table("messages")
    op.drop_table("conversations")
    op.drop_table("workspaces")
    op.execute("DROP FUNCTION IF EXISTS update_updated_at CASCADE")
    op.execute("DROP FUNCTION IF EXISTS update_conversation_search_tsv CASCADE")
