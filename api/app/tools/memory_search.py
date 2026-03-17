"""pgvector類似度検索ツール (memory_search)"""
import logging

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
            "limit": {"type": "integer", "description": "取得件数", "default": 5},
            "scope": {
                "type": "string",
                "enum": ["all", "conversations", "documents"],
                "default": "all",
                "description": "検索スコープ",
            },
        },
        "required": ["query"],
    }
    timeout = 10

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        # Phase 1: RAGパイプライン未実装のため、スタブを返す
        # Phase 4でembedder + pgvector検索を実装
        query = args.get("query", "")
        return ToolResult(
            success=True,
            data=[],
            display=f"メモリ検索: '{query}' — RAGは Phase 4 で実装予定",
        )
