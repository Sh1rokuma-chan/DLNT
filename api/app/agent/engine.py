"""ReActループエンジン — Thought / Action / Observation"""
import json
import logging
import time
from typing import AsyncIterator

from app.agent.agents import AgentDefinition, get_agent
from app.agent.parser import FinalAnswer, ToolCall, ToolCallParser
from app.agent.prompts import ROUTING_PROMPT, SYSTEM_PROMPT_TEMPLATE
from app.config import get_settings
from app.llm.ollama import OllamaProvider
from app.tools.registry import get_registry

logger = logging.getLogger(__name__)
settings = get_settings()

parser = ToolCallParser()


WEB_TOOLS = {"web_search", "web_fetch"}


def _build_system_prompt(agent: AgentDefinition, web_search: bool = True) -> str:
    registry = get_registry()
    tools = registry.all() if web_search else [t for t in registry.all() if t.name not in WEB_TOOLS]
    tool_defs = json.dumps(
        [t.to_ollama_tool()["function"] for t in tools],
        ensure_ascii=False,
        indent=2,
    )
    extra = "" if web_search else "\n注意: Web検索は無効化されています。ローカルの知識のみで回答してください。"
    return SYSTEM_PROMPT_TEMPLATE.format(
        agent_name=f"{agent.icon} {agent.name}",
        agent_description=agent.description,
        tool_definitions=tool_defs,
    ) + f"\n{agent.system_addendum}" + extra


async def route_agent(message: str, llm: OllamaProvider) -> str:
    """メッセージを分析して最適なエージェントIDを返す"""
    prompt = ROUTING_PROMPT.format(message=message)
    try:
        response = await llm.chat_complete([{"role": "user", "content": prompt}])
        # JSON部分を抽出 (前後のテキストを無視)
        import re
        m = re.search(r'\{[^}]+\}', response)
        if not m:
            return "scout"
        data = json.loads(m.group(0))
        agent_id = data.get("agent", "scout")
        if agent_id not in ("scout", "coder", "archivist", "scribe"):
            return "scout"
        return agent_id
    except Exception:
        return "scout"


async def run_agent(
    user_message: str,
    agent_id: str,
    history: list[dict],
    stop_flag: list[bool] | None = None,
    llm: OllamaProvider | None = None,
    web_search: bool = True,
) -> AsyncIterator[dict]:
    """
    ReActループを実行し、WebSocket送出用のイベントをyieldする。

    stop_flag: [False] のリストを渡すと、[True]に変えることで生成を中断できる。

    イベント形式:
      {"type": "think_start"}
      {"type": "think_token", "content": "..."}
      {"type": "think_end"}
      {"type": "tool_call", "name": "...", "args": {...}}
      {"type": "tool_result", "name": "...", "success": bool, "summary": "...", "elapsed": float}
      {"type": "answer_token", "content": "..."}
      {"type": "done", "total_elapsed": float, "tools_used": int}
      {"type": "error", "message": "..."}
    """
    start_time = time.time()
    agent = get_agent(agent_id)
    registry = get_registry()
    if llm is None:
        llm = OllamaProvider()

    system_prompt = _build_system_prompt(agent, web_search=web_search)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    tools_used = 0
    max_iter = settings.react_max_iterations

    for iteration in range(max_iter):
        # 停止チェック
        if stop_flag and stop_flag[0]:
            yield {"type": "done", "total_elapsed": round(time.time() - start_time, 2), "tools_used": tools_used}
            return

        logger.info("ReAct iteration %d/%d (agent=%s)", iteration + 1, max_iter, agent_id)

        buffer = ""
        in_think = False
        think_buffer = ""

        async for token in llm.chat(messages, stream=True):
            # 停止チェック
            if stop_flag and stop_flag[0]:
                yield {"type": "done", "total_elapsed": round(time.time() - start_time, 2), "tools_used": tools_used}
                return

            buffer += token

            # <think> タグ検出
            if not in_think and "<think>" in buffer:
                in_think = True
                yield {"type": "think_start"}
                # <think>より前のテキストは捨てる
                buffer = buffer[buffer.index("<think>") + len("<think>"):]
                continue

            if in_think:
                if "</think>" in buffer:
                    in_think = False
                    think_part = buffer[:buffer.index("</think>")]
                    think_buffer += think_part
                    yield {"type": "think_token", "content": think_part}
                    yield {"type": "think_end"}
                    buffer = buffer[buffer.index("</think>") + len("</think>"):]
                else:
                    yield {"type": "think_token", "content": token}
                    think_buffer += token
                    buffer = ""
                continue

            # native tool call (Ollama function calling)
            if buffer.strip().startswith('{"tool_calls":') or buffer.strip().startswith('[{"'):
                break

        # バッファをパース
        result = parser.parse_streaming_buffer(buffer)

        if isinstance(result, ToolCall):
            # Web検索無効時はWebツールをブロック
            if not web_search and result.name in WEB_TOOLS:
                messages.append({"role": "assistant", "content": buffer})
                messages.append({"role": "user", "content": "[Web検索は無効化されています。ローカルの知識のみで回答してください。]"})
                continue

            tool = registry.get(result.name)
            if not tool:
                yield {"type": "error", "message": f"ツール '{result.name}' が見つかりません"}
                break

            yield {"type": "tool_call", "name": result.name, "args": result.args}

            t0 = time.time()
            try:
                tool_result = await tool.execute(result.args)
            except Exception as e:
                tool_result_obj = type('R', (), {
                    'success': False,
                    'display': str(e),
                    'data': None,
                    'error': str(e),
                })()
                tool_result = tool_result_obj  # type: ignore

            elapsed = round(time.time() - t0, 2)
            tools_used += 1

            yield {
                "type": "tool_result",
                "name": result.name,
                "success": tool_result.success,
                "summary": tool_result.display,
                "elapsed": elapsed,
            }

            # ツール結果をコンテキストに追加
            messages.append({"role": "assistant", "content": buffer})
            obs = json.dumps(
                {"result": tool_result.data, "error": tool_result.error if hasattr(tool_result, 'error') else ""},
                ensure_ascii=False,
            )
            # role="user" で観測結果を返す (role="tool" だとモデルが混乱するため)
            messages.append({
                "role": "user",
                "content": f"[ツール実行結果: {result.name}]\n{obs}\n\n上記のツール結果を使って、元の質問に日本語で回答してください。",
            })

        elif isinstance(result, FinalAnswer):
            # 最終回答をチャンク単位でストリーム（文字単位より効率的）
            CHUNK = 8
            content = result.content
            for i in range(0, len(content), CHUNK):
                if stop_flag and stop_flag[0]:
                    break
                yield {"type": "answer_token", "content": content[i:i + CHUNK]}
            break

        else:
            # パース失敗 → バッファ全体を最終回答として返す
            if buffer.strip():
                CHUNK = 8
                for i in range(0, len(buffer), CHUNK):
                    yield {"type": "answer_token", "content": buffer[i:i + CHUNK]}
            break

    total_elapsed = round(time.time() - start_time, 2)
    yield {"type": "done", "total_elapsed": total_elapsed, "tools_used": tools_used}
