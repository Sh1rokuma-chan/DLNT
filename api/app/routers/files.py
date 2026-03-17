"""ファイルアップロードルーター"""
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

from app.config import get_settings

router = APIRouter()
settings = get_settings()


@router.post("/upload")
async def upload_file(file: UploadFile):
    """ワークスペースにファイルをアップロード"""
    workspace_path = Path(settings.workspace_path)
    workspace_path.mkdir(parents=True, exist_ok=True)

    safe_name = f"{uuid.uuid4()}_{Path(file.filename or 'upload').name}"
    dest = workspace_path / safe_name

    content = await file.read()
    dest.write_bytes(content)

    return {
        "filename": file.filename,
        "saved_as": safe_name,
        "path": str(dest),
        "size": len(content),
    }
