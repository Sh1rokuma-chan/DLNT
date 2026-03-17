"""ファイル操作ツール (file_read, file_write, file_search)"""
import logging
import os
from pathlib import Path

import aiofiles

from app.config import get_settings
from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)
settings = get_settings()

ALLOWED_READ_ROOTS = [
    Path(settings.documents_path),
    Path(settings.workspace_path),
]
ALLOWED_WRITE_ROOT = Path(settings.workspace_path)


def _resolve_safe(path_str: str, allowed_roots: list[Path]) -> Path | None:
    """パストラバーサル防止: 許可ディレクトリ内のパスか確認"""
    try:
        p = Path(path_str).resolve()
        for root in allowed_roots:
            root = root.resolve()
            if p == root or root in p.parents:
                return p
    except Exception:
        pass
    return None


class FileReadTool(BaseTool):
    name = "file_read"
    description = "ローカルファイルの内容を読み取る。テキスト、CSV、JSON、Markdown等に対応"
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "ファイルパス"},
            "max_chars": {"type": "integer", "description": "最大文字数", "default": 20000},
        },
        "required": ["path"],
    }
    timeout = 10

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        path_str = args.get("path", "")
        max_chars = int(args.get("max_chars", 20000))

        safe_path = _resolve_safe(path_str, ALLOWED_READ_ROOTS)
        if not safe_path:
            return ToolResult(success=False, data={}, display="アクセス拒否", error="許可されていないパス")

        try:
            async with aiofiles.open(safe_path, encoding="utf-8", errors="replace") as f:
                content = await f.read(max_chars)
            return ToolResult(
                success=True,
                data={"path": str(safe_path), "content": content},
                display=f"ファイル読込完了 ({len(content)}文字): {safe_path.name}",
            )
        except FileNotFoundError:
            return ToolResult(success=False, data={}, display="ファイルが見つかりません", error=f"{path_str} not found")
        except Exception as e:
            logger.error("file_read error: %s", e)
            return ToolResult(success=False, data={}, display="読込失敗", error=str(e))


class FileWriteTool(BaseTool):
    name = "file_write"
    description = "ファイルを作成または上書きする。レポート、スクリプト、データ出力等に使用"
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "書き込み先ファイルパス"},
            "content": {"type": "string", "description": "書き込む内容"},
        },
        "required": ["path", "content"],
    }
    timeout = 10

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        path_str = args.get("path", "")
        content = args.get("content", "")

        safe_path = _resolve_safe(path_str, [ALLOWED_WRITE_ROOT])
        if not safe_path:
            return ToolResult(success=False, data={}, display="書き込み拒否", error="許可されていないパス")

        try:
            safe_path.parent.mkdir(parents=True, exist_ok=True)
            async with aiofiles.open(safe_path, "w", encoding="utf-8") as f:
                await f.write(content)
            return ToolResult(
                success=True,
                data={"path": str(safe_path), "bytes": len(content.encode())},
                display=f"ファイル書込完了: {safe_path.name}",
            )
        except Exception as e:
            logger.error("file_write error: %s", e)
            return ToolResult(success=False, data={}, display="書込失敗", error=str(e))


class FileSearchTool(BaseTool):
    name = "file_search"
    description = "ローカルファイルシステムでファイル名や内容を検索する"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "検索キーワード"},
            "directory": {"type": "string", "description": "検索ディレクトリ", "default": "/mnt/user/documents"},
            "type": {"type": "string", "enum": ["name", "content", "both"], "default": "both"},
        },
        "required": ["query"],
    }
    timeout = 30

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        query = args.get("query", "").lower()
        directory = args.get("directory", settings.documents_path)
        search_type = args.get("type", "both")

        safe_dir = _resolve_safe(directory, ALLOWED_READ_ROOTS)
        if not safe_dir or not safe_dir.is_dir():
            return ToolResult(success=False, data=[], display="ディレクトリ不正", error="アクセス不可")

        results = []
        try:
            for root, _, files in os.walk(safe_dir):
                for fname in files:
                    fpath = Path(root) / fname
                    matched = False

                    if search_type in ("name", "both") and query in fname.lower():
                        matched = True

                    if not matched and search_type in ("content", "both"):
                        try:
                            text = fpath.read_text(encoding="utf-8", errors="ignore")
                            if query in text.lower():
                                matched = True
                        except Exception:
                            pass

                    if matched:
                        results.append(str(fpath))
                        if len(results) >= 20:
                            break
                if len(results) >= 20:
                    break

            return ToolResult(
                success=True,
                data=results,
                display=f"{len(results)}件のファイルが見つかりました: {query}",
            )
        except Exception as e:
            logger.error("file_search error: %s", e)
            return ToolResult(success=False, data=[], display="検索失敗", error=str(e))
