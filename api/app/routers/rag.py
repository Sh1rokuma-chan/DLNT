"""RAGインデックス管理ルーター"""
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import Workspace
from app.db.session import get_db
from app.rag.indexer import index_directory

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter()


class IndexRequest(BaseModel):
    workspace_id: Optional[uuid.UUID] = None
    directory: Optional[str] = None  # 未指定時は settings.documents_path
    clear_existing: bool = False


class IndexResponse(BaseModel):
    status: str
    workspace_id: Optional[str]
    directory: str
    message: str


@router.post("/index", response_model=IndexResponse)
async def trigger_index(
    body: IndexRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """RAGインデックスをバックグラウンドで構築"""
    workspace_id = body.workspace_id
    directory = body.directory or settings.documents_path

    # ワークスペース取得
    if workspace_id:
        ws = await db.get(Workspace, workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="ワークスペースが見つかりません")
    else:
        # デフォルトワークスペース
        from sqlalchemy import select
        result = await db.execute(select(Workspace).where(Workspace.name == "Default"))
        ws = result.scalar_one_or_none()
        if not ws:
            ws = Workspace(name="Default", description="デフォルトワークスペース")
            db.add(ws)
            await db.commit()
            await db.refresh(ws)
        workspace_id = ws.id

    async def _do_index():
        from app.db.session import async_session_factory
        async with async_session_factory() as session:
            count = await index_directory(
                session, directory, workspace_id, clear_existing=body.clear_existing
            )
            logger.info("バックグラウンドインデックス完了: %d チャンク", count)

    background_tasks.add_task(_do_index)

    return IndexResponse(
        status="indexing",
        workspace_id=str(workspace_id),
        directory=directory,
        message=f"バックグラウンドでインデックス化を開始しました: {directory}",
    )
