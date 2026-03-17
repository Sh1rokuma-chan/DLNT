"""Webページ取得ツール"""
import logging
import re

import httpx

from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)


class WebFetchTool(BaseTool):
    name = "web_fetch"
    description = "指定URLのWebページ全文を取得しテキスト化する"
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "取得するURL"},
            "max_chars": {"type": "integer", "description": "最大文字数", "default": 10000},
        },
        "required": ["url"],
    }
    timeout = 30

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        url = args.get("url", "")
        max_chars = int(args.get("max_chars", 10000))

        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; DLNT/2.0)"},
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                html = resp.text

            # HTMLタグを除去してプレーンテキスト化
            text = re.sub(r"<[^>]+>", " ", html)
            text = re.sub(r"\s+", " ", text).strip()
            text = text[:max_chars]

            return ToolResult(
                success=True,
                data={"url": url, "content": text, "chars": len(text)},
                display=f"ページ取得完了 ({len(text)}文字): {url}",
            )
        except Exception as e:
            logger.error("web_fetch error: %s", e)
            return ToolResult(success=False, data={}, display="ページ取得失敗", error=str(e))
