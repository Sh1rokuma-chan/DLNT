"""シェルコマンド実行ツール (許可リスト制)"""
import asyncio
import logging
import shlex

from app.tools.base import BaseTool, ToolResult

logger = logging.getLogger(__name__)

# 許可コマンド先頭トークン
ALLOWED_COMMANDS = {
    "ls", "cat", "head", "tail", "find", "grep", "echo",
    "pwd", "wc", "sort", "uniq", "date", "env",
    "git", "python", "python3", "pip", "pip3",
    "curl", "wget", "jq", "yq", "awk", "sed",
}

# 明示的拒否パターン
DENY_PATTERNS = [
    "rm ", "rm\t", "sudo", "chmod", "chown", "kill", "pkill",
    "> /", ">> /", "; rm", "&& rm", "| rm",
    "dd if", "mkfs", "fdisk",
]


def _is_allowed(command: str) -> bool:
    cmd_lower = command.lower()
    for deny in DENY_PATTERNS:
        if deny in cmd_lower:
            return False
    try:
        tokens = shlex.split(command)
        if not tokens:
            return False
        return tokens[0] in ALLOWED_COMMANDS
    except Exception:
        return False


class ShellExecTool(BaseTool):
    name = "shell_exec"
    description = "シェルコマンドを実行する（許可リスト制）。git, python, ls, grep等"
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "実行するシェルコマンド"},
        },
        "required": ["command"],
    }
    timeout = 30

    async def execute(self, args: dict, context: dict | None = None) -> ToolResult:
        command = args.get("command", "")

        if not _is_allowed(command):
            return ToolResult(
                success=False, data={}, display="コマンド拒否",
                error=f"許可されていないコマンドです: {command}",
            )

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
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
                data={"stdout": output, "stderr": err, "returncode": proc.returncode},
                display=f"コマンド実行完了 (rc={proc.returncode}): {command[:50]}",
                error=err if not success else "",
            )
        except asyncio.TimeoutError:
            return ToolResult(success=False, data={}, display="タイムアウト", error="コマンドがタイムアウト")
        except Exception as e:
            logger.error("shell_exec error: %s", e)
            return ToolResult(success=False, data={}, display="実行失敗", error=str(e))
