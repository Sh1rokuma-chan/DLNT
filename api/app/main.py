"""DLNT FastAPI エントリポイント"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.session import init_db
from app.routers import agents, chat, conversations, files, system, workspaces, rag

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DLNT API 起動中...")
    await init_db()
    logger.info("DB接続完了")
    yield
    logger.info("DLNT API 停止")


app = FastAPI(
    title="DLNT API",
    description="AIエージェントプラットフォーム DLNT",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(conversations.router, prefix="/api/conversations", tags=["conversations"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(chat.router, tags=["chat"])  # WebSocket /ws/chat/{conversation_id}
