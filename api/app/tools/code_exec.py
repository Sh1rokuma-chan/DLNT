"""Pythonコード隔離実行ツール"""
import asyncio
import logging
import tempfile
from pathlib import Path

from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)


class CodeExecTool(BaseTool):
    name = "code_exec"
    description = "Pythonコードを隔離環境で実行し、出力を返す。データ分析、計算、変換に使用"
    parameters = {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "実行するPythonコード"},
        },
        "required": ["code"],
    }
    timeout = 60

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        code = args.get("code", "")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
            f.write(code)
            tmp_path = f.name

        try:
            proc = await asyncio.create_subprocess_exec(
                "python3", tmp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=self.timeout
            )
            output = stdout.decode(errors="replace")
            err = stderr.decode(errors="replace")
            success = proc.returncode == 0

            return ToolResult(
                success=success,
                data={"output": output, "error": err, "returncode": proc.returncode},
                display=f"コード実行完了 (rc={proc.returncode}), 出力{len(output)}文字",
                error=err if not success else "",
            )
        except asyncio.TimeoutError:
            return ToolResult(success=False, data={}, display="タイムアウト (60s)", error="実行タイムアウト")
        except Exception as e:
            logger.error("code_exec error: %s", e)
            return ToolResult(success=False, data={}, display="実行失敗", error=str(e))
        finally:
            Path(tmp_path).unlink(missing_ok=True)
