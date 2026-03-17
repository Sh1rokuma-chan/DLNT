"""SearXNG Web検索ツール"""
import logging

import httpx

from app.config import get_settings
from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)
settings = get_settings()


class WebSearchTool(BaseTool):
    name = "web_search"
    description = "SearXNGでWeb検索を実行し、結果のタイトル・URL・スニペットを返す"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "検索クエリ"},
            "count": {"type": "integer", "description": "取得件数 (1-10)", "default": 5},
        },
        "required": ["query"],
    }
    timeout = 15

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        query = args.get("query", "")
        count = min(int(args.get("count", 5)), 10)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(
                    f"{settings.searxng_url}/search",
                    params={"q": query, "format": "json", "count": count},
                )
                resp.raise_for_status()
                data = resp.json()

            results = data.get("results", [])[:count]
            items = [
                {"title": r.get("title"), "url": r.get("url"), "snippet": r.get("content")}
                for r in results
            ]

            return ToolResult(
                success=True,
                data=items,
                display=f"{len(items)}件の検索結果を取得: {query}",
            )
        except Exception as e:
            logger.error("web_search error: %s", e)
            return ToolResult(success=False, data=[], display="検索失敗", error=str(e))
