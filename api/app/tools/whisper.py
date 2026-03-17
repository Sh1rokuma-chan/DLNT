"""Whisper音声文字起こしツール"""
import logging

import httpx

from app.config import get_settings
from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)
settings = get_settings()


class WhisperTool(BaseTool):
    name = "whisper"
    description = "音声ファイルを日本語テキストに文字起こしする"
    parameters = {
        "type": "object",
        "properties": {
            "audio_path": {"type": "string", "description": "音声ファイルパス"},
        },
        "required": ["audio_path"],
    }
    timeout = 300

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        audio_path = args.get("audio_path", "")

        try:
            with open(audio_path, "rb") as f:
                audio_data = f.read()

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{settings.whisper_url}/v1/audio/transcriptions",
                    files={"file": ("audio", audio_data)},
                    data={"language": "ja"},
                )
                resp.raise_for_status()
                data = resp.json()

            text = data.get("text", "")
            return ToolResult(
                success=True,
                data={"text": text, "chars": len(text)},
                display=f"文字起こし完了 ({len(text)}文字)",
            )
        except FileNotFoundError:
            return ToolResult(success=False, data={}, display="ファイルが見つかりません", error=f"{audio_path} not found")
        except Exception as e:
            logger.error("whisper error: %s", e)
            return ToolResult(success=False, data={}, display="文字起こし失敗", error=str(e))
