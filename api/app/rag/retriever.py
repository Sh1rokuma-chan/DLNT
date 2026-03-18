"""RAG検索 — pgvectorコサイン類似度検索"""
import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Embedding
from app.rag.embedder import embed_text

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    source_type: str
    source_ref: Optional[str]
    chunk_index: int
    content: str
    score: float


async def search(
    db: AsyncSession,
    query: str,
    workspace_id: Optional[uuid.UUID] = None,
    scope: str = "all",
    limit: int = 5,
) -> list[SearchResult]:
    """
    クエリに類似したチャンクを検索。
    scope: "all" | "conversations" | "documents"
    Returns: スコア降順のSearchResultリスト
    """
    # クエリをエンベディング
    vec = await asyncio.get_event_loop().run_in_executor(None, embed_text, query)
    if vec is None:
        logger.warning("エンベディング失敗。テキスト検索にフォールバック")
        return await _fallback_search(db, query, workspace_id, scope, limit)

    # pgvector コサイン類似度クエリ
    # 1 - cosine_distance = cosine_similarity
    conditions = ["embedding IS NOT NULL"]
    params: dict = {"vec": str(vec), "limit": limit}

    if workspace_id:
        conditions.append("workspace_id = :workspace_id")
        params["workspace_id"] = str(workspace_id)

    if scope == "conversations":
        conditions.append("source_type = 'message'")
    elif scope == "documents":
        conditions.append("source_type = 'file'")

    where = " AND ".join(conditions)
    sql = text(f"""
        SELECT source_type, source_ref, chunk_index, content,
               1 - (embedding <=> :vec::vector) AS score
        FROM embeddings
        WHERE {where}
        ORDER BY embedding <=> :vec::vector
        LIMIT :limit
    """)

    try:
        result = await db.execute(sql, params)
        rows = result.fetchall()
        return [
            SearchResult(
                source_type=r.source_type,
                source_ref=r.source_ref,
                chunk_index=r.chunk_index,
                content=r.content,
                score=float(r.score),
            )
            for r in rows
        ]
    except Exception as e:
        logger.error("pgvector検索失敗: %s", e)
        return []


async def _fallback_search(
    db: AsyncSession,
    query: str,
    workspace_id: Optional[uuid.UUID],
    scope: str,
    limit: int,
) -> list[SearchResult]:
    """エンベディング失敗時のテキスト類似検索フォールバック"""
    q = select(Embedding).where(Embedding.content.ilike(f"%{query}%")).limit(limit)
    if workspace_id:
        q = q.where(Embedding.workspace_id == workspace_id)
    if scope == "conversations":
        q = q.where(Embedding.source_type == "message")
    elif scope == "documents":
        q = q.where(Embedding.source_type == "file")

    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        SearchResult(
            source_type=r.source_type,
            source_ref=r.source_ref,
            chunk_index=r.chunk_index or 0,
            content=r.content,
            score=0.5,
        )
        for r in rows
    ]


def format_results_for_context(results: list[SearchResult]) -> str:
    """検索結果をLLMコンテキスト注入用テキストに整形"""
    if not results:
        return "関連するドキュメントは見つかりませんでした。"

    lines = ["## 関連ドキュメント\n"]
    for i, r in enumerate(results, 1):
        source = r.source_ref or r.source_type
        score_pct = int(r.score * 100)
        lines.append(f"### [{i}] {source} (類似度: {score_pct}%)")
        lines.append(r.content)
        lines.append("")

    return "\n".join(lines)
