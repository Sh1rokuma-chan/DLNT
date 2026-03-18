"""ワークスペース CRUD ルーター"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.models import Workspace
from app.db.session import get_db
from sqlalchemy import select

router = APIRouter()


class WorkspaceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    rag_directories: list[str] = []


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    rag_directories: list[str]
    created_at: str

    model_config = {"from_attributes": True}

    def model_post_init(self, __context):
        if hasattr(self, 'created_at') and not isinstance(self.created_at, str):
            object.__setattr__(self, 'created_at', self.created_at.isoformat())


@router.get("/", response_model=list[WorkspaceOut])
async def list_workspaces(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workspace).order_by(Workspace.created_at))
    workspaces = list(result.scalars().all())
    # Default workspace がなければ作成
    if not workspaces:
        ws = Workspace(name="Default", description="デフォルトワークスペース")
        db.add(ws)
        await db.commit()
        await db.refresh(ws)
        workspaces = [ws]
    return [
        WorkspaceOut(
            id=w.id,
            name=w.name,
            description=w.description,
            rag_directories=w.rag_directories or [],
            created_at=w.created_at.isoformat(),
        )
        for w in workspaces
    ]


@router.post("/", status_code=201)
async def create_workspace(body: WorkspaceCreate, db: AsyncSession = Depends(get_db)):
    ws = Workspace(
        name=body.name,
        description=body.description,
        rag_directories=body.rag_directories,
    )
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        description=ws.description,
        rag_directories=ws.rag_directories or [],
        created_at=ws.created_at.isoformat(),
    )


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    ws = await db.get(Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="ワークスペースが見つかりません")
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        description=ws.description,
        rag_directories=ws.rag_directories or [],
        created_at=ws.created_at.isoformat(),
    )


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(workspace_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    ws = await db.get(Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="ワークスペースが見つかりません")
    if ws.name == "Default":
        raise HTTPException(status_code=400, detail="Defaultワークスペースは削除できません")
    await db.delete(ws)
    await db.commit()
