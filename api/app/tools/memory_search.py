"""pgvector類似度検索ツール (memory_search) — RAG実装"""
import logging
import uuid

from app.config import get_settings
from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)
settings = get_settings()


class MemorySearchTool(BaseTool):
    name = "memory_search"
    description = "過去の会話やインデックス済みドキュメントからベクトル類似度検索を行う"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "検索クエリ"},
            "limit": {"type": "integer", "description": "取得件数 (デフォルト5)", "default": 5},
            "scope": {
                "type": "string",
                "enum": ["all", "conversations", "documents"],
                "default": "all",
                "description": "検索スコープ: all=全て, conversations=会話のみ, documents=ドキュメントのみ",
            },
        },
        "required": ["query"],
    }
    timeout = 10

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        query = args.get("query", "").strip()
        limit = int(args.get("limit", 5))
        scope = args.get("scope", "all")

        if not query:
            return ToolResult(success=False, data=[], display="クエリが空です", error="empty query")

        workspace_id = context.get("workspace_id") if context else None

        try:
            from app.rag.retriever import search, format_results_for_context
            from app.db.session import async_session_factory

            async with async_session_factory() as db:
                results = await search(
                    db=db,
                    query=query,
                    workspace_id=uuid.UUID(workspace_id) if workspace_id else None,
                    scope=scope,
                    limit=limit,
                )

            if not results:
                return ToolResult(
                    success=True,
                    data=[],
                    display=f"'{query}' に関連するドキュメントは見つかりませんでした",
                )

            formatted = format_results_for_context(results)
            display_summary = f"{len(results)}件 見つかりました (最高類似度: {results[0].score:.2f})"

            return ToolResult(
                success=True,
                data=[
                    {
                        "source": r.source_ref,
                        "type": r.source_type,
                        "score": round(r.score, 3),
                        "content": r.content[:500],
                    }
                    for r in results
                ],
                display=display_summary,
            )

        except Exception as e:
            logger.error("memory_search失敗: %s", e)
            return ToolResult(
                success=False,
                data=[],
                display=f"検索エラー: {e}",
                error=str(e),
            )
