from fastapi import APIRouter, WebSocket

router = APIRouter()


@router.websocket('/ws/chat')
async def chat_echo(websocket: WebSocket) -> None:
    await websocket.accept()

    while True:
        message = await websocket.receive_text()
        await websocket.send_text(message)
