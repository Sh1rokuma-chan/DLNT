"""システムルーター (ヘルスチェック等)"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.llm.ollama import OllamaProvider
from app.models.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    # DB確認
    db_ok = False
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    # Ollama確認
    llm = OllamaProvider()
    ollama_ok = await llm.health_check()

    return HealthResponse(
        status="ok" if (db_ok and ollama_ok) else "degraded",
        ollama=ollama_ok,
        database=db_ok,
    )
