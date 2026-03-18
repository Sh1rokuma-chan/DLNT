"""WebSocket チャットルーター + REST チャットエンドポイント"""
import json
import logging
import uuid
import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.engine import route_agent, run_agent
from app.db import crud
from app.db.session import get_db
from app.llm.ollama import OllamaProvider
from app.models.schemas import ChatRequest

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/chat/{conversation_id}")
async def websocket_chat(
    websocket: WebSocket,
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    WebSocket チャットエンドポイント。

    クライアント送信:
      {"message": "ユーザーの質問", "agent_type": "scout", "model": "qwen3.5:35b-a3b"}
      {"type": "stop"}  ← 生成停止シグナル

    サーバー送出 (JSON Lines):
      {"type": "think_start"}
      {"type": "think_token", "content": "..."}
      {"type": "tool_call", "name": "web_search", "args": {...}}
      {"type": "tool_result", "name": "web_search", "success": true, "summary": "...", "elapsed": 1.2}
      {"type": "answer_token", "content": "..."}
      {"type": "done", "total_elapsed": 4.3, "tools_used": 2}
    """
    await websocket.accept()
    logger.info("WebSocket接続: conversation_id=%s", conversation_id)

    conv = await crud.get_conversation(db, conversation_id)
    if not conv:
        await websocket.send_text(json.dumps({"type": "error", "message": "会話が見つかりません"}))
        await websocket.close()
        return

    stop_flag = [False]
    msg_queue: asyncio.Queue = asyncio.Queue()

    async def ws_reader():
        """WebSocketメッセージを受信してキューに積む (DBを触らない)"""
        try:
            while True:
                raw = await websocket.receive_text()
                data = json.loads(raw)
                await msg_queue.put(data)
        except WebSocketDisconnect:
            await msg_queue.put(None)
        except Exception:
            await msg_queue.put(None)

    reader_task = asyncio.create_task(ws_reader())

    try:
        while True:
            stop_flag[0] = False

            # メッセージ待機 (メインコルーチンのみDBを操作)
            data = await msg_queue.get()
            if data is None:
                break  # 切断

            if data.get("type") == "stop":
                continue

            user_message = data.get("message", "")
            agent_type = data.get("agent_type", conv.agent_type)
            model = data.get("model")
            web_search_enabled = data.get("web_search", True)

            if not user_message.strip():
                continue

            # 自動ルーティング
            llm = OllamaProvider(model=model) if model else OllamaProvider()
            if agent_type == "auto":
                agent_type = await route_agent(user_message, llm)
                await websocket.send_text(json.dumps({
                    "type": "route",
                    "agent": agent_type,
                    "message": f"{agent_type} に転送しました",
                }))

            # ユーザーメッセージ保存 (メインコルーチン = greenlet安全)
            await crud.create_message(db, conversation_id, "user", user_message)

            # 会話履歴取得 (最新50件)
            msgs = await crud.get_conversation_messages(db, conversation_id, limit=50)
            history = [
                {"role": m.role if m.role in ("user", "assistant") else "user", "content": m.content}
                for m in msgs[:-1]  # 直前のユーザーメッセージを除く
            ]

            # ReActループ実行 (メインコルーチンで直接イテレート)
            think_content = ""
            tool_calls_log = []
            answer_buffer = ""

            async for event in run_agent(user_message, agent_type, history, stop_flag=stop_flag, llm=llm, web_search=web_search_enabled):
                try:
                    await websocket.send_text(json.dumps(event, ensure_ascii=False))
                except Exception:
                    stop_flag[0] = True
                    break

                if event["type"] == "think_token":
                    think_content += event["content"]
                elif event["type"] == "answer_token":
                    answer_buffer += event["content"]
                elif event["type"] == "tool_call":
                    tool_calls_log.append({"name": event["name"], "args": event["args"]})
                elif event["type"] == "tool_result":
                    if tool_calls_log:
                        tool_calls_log[-1].update({
                            "success": event["success"],
                            "summary": event["summary"],
                            "elapsed": event["elapsed"],
                        })

                # 停止シグナルをキューから非ブロッキングチェック
                try:
                    msg = msg_queue.get_nowait()
                    if msg is None:
                        stop_flag[0] = True
                        break
                    elif msg.get("type") == "stop":
                        stop_flag[0] = True
                        logger.info("停止シグナル受信: conversation_id=%s", conversation_id)
                        break
                    else:
                        # 次のメッセージはキューに戻す
                        await msg_queue.put(msg)
                except asyncio.QueueEmpty:
                    pass

            # アシスタントメッセージ保存 (メインコルーチン = greenlet安全)
            if answer_buffer:
                await crud.create_message(
                    db,
                    conversation_id,
                    "assistant",
                    answer_buffer,
                    think_content=think_content or None,
                    tool_calls=tool_calls_log or None,
                )

    except WebSocketDisconnect:
        logger.info("WebSocket切断: conversation_id=%s", conversation_id)
    except Exception as e:
        logger.error("WebSocketエラー: %s", e, exc_info=True)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        reader_task.cancel()
        try:
            await reader_task
        except asyncio.CancelledError:
            pass


@router.post("/api/chat")
async def rest_chat(body: ChatRequest, db: AsyncSession = Depends(get_db)):
    """REST チャットエンドポイント (非ストリーミング、テスト用)"""
    llm = OllamaProvider()

    if body.conversation_id:
        conv = await crud.get_conversation(db, body.conversation_id)
        if not conv:
            conv = await crud.create_conversation(db, agent_type=body.agent_type)
    else:
        conv = await crud.create_conversation(db, agent_type=body.agent_type)

    agent_type = body.agent_type
    if agent_type == "auto":
        agent_type = await route_agent(body.message, llm)

    await crud.create_message(db, conv.id, "user", body.message)

    msgs = await crud.get_conversation_messages(db, conv.id, limit=50)
    history = [
        {"role": m.role if m.role in ("user", "assistant") else "user", "content": m.content}
        for m in msgs[:-1]
    ]

    events = []
    answer = ""
    think_content = ""
    tool_calls_log = []

    async for event in run_agent(body.message, agent_type, history):
        events.append(event)
        if event["type"] == "answer_token":
            answer += event["content"]
        elif event["type"] == "think_token":
            think_content += event["content"]
        elif event["type"] == "tool_call":
            tool_calls_log.append({"name": event["name"], "args": event["args"]})
        elif event["type"] == "tool_result" and tool_calls_log:
            tool_calls_log[-1].update({
                "success": event["success"],
                "summary": event["summary"],
                "elapsed": event["elapsed"],
            })

    if answer:
        await crud.create_message(
            db, conv.id, "assistant", answer,
            think_content=think_content or None,
            tool_calls=tool_calls_log or None,
        )

    done_event = next((e for e in events if e["type"] == "done"), {})

    return {
        "conversation_id": str(conv.id),
        "agent": agent_type,
        "answer": answer,
        "think": think_content,
        "tool_calls": tool_calls_log,
        "total_elapsed": done_event.get("total_elapsed"),
        "tools_used": done_event.get("tools_used", 0),
    }
