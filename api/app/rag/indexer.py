"""RAGインデクサー — ファイルをチャンク化してpgvectorに保存"""
import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Embedding
from app.rag.embedder import embed_batch

logger = logging.getLogger(__name__)

# 対応拡張子
SUPPORTED_EXTENSIONS = {
    '.txt', '.md', '.py', '.js', '.ts', '.json', '.csv',
    '.yaml', '.yml', '.toml', '.rst', '.html', '.xml',
}

# チャンク設定
CHUNK_SIZE = 800      # 文字数
CHUNK_OVERLAP = 100   # オーバーラップ


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """テキストをオーバーラップ付きチャンクに分割"""
    if len(text) <= size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk)
        start = end - overlap
        if start >= len(text):
            break
    return chunks


def _read_file(path: Path) -> str | None:
    """ファイルを読み込む。失敗時はNone。"""
    try:
        return path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        logger.warning("ファイル読み込み失敗 %s: %s", path, e)
        return None


async def index_directory(
    db: AsyncSession,
    directory: str,
    workspace_id: uuid.UUID,
    clear_existing: bool = False,
) -> int:
    """
    指定ディレクトリ以下のサポートファイルをインデックス化。
    Returns: インデックスしたチャンク数
    """
    from sqlalchemy import delete

    if clear_existing:
        await db.execute(
            delete(Embedding)
            .where(Embedding.workspace_id == workspace_id)
            .where(Embedding.source_type == 'file')
        )
        await db.commit()

    root = Path(directory)
    if not root.exists():
        logger.warning("ディレクトリが存在しません: %s", directory)
        return 0

    total_chunks = 0
    files = [
        p for p in root.rglob('*')
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    logger.info("%d ファイルをインデックス化 (workspace=%s)", len(files), workspace_id)

    BATCH = 32
    pending_embeddings: list[Embedding] = []
    pending_texts: list[str] = []

    for file_path in files:
        content = _read_file(file_path)
        if not content:
            continue

        rel_path = str(file_path.relative_to(root))
        chunks = _chunk_text(content)

        for i, chunk in enumerate(chunks):
            pending_texts.append(chunk)
            pending_embeddings.append(Embedding(
                workspace_id=workspace_id,
                source_type='file',
                source_ref=rel_path,
                chunk_index=i,
                content=chunk,
                embedding=None,
            ))

            if len(pending_texts) >= BATCH:
                vecs = await asyncio.get_event_loop().run_in_executor(
                    None, embed_batch, pending_texts
                )
                for emb, vec in zip(pending_embeddings, vecs):
                    if vec:
                        emb.embedding = vec
                    db.add(emb)
                await db.commit()
                total_chunks += len(pending_embeddings)
                pending_texts.clear()
                pending_embeddings.clear()

    # 残り
    if pending_texts:
        vecs = await asyncio.get_event_loop().run_in_executor(None, embed_batch, pending_texts)
        for emb, vec in zip(pending_embeddings, vecs):
            if vec:
                emb.embedding = vec
            db.add(emb)
        await db.commit()
        total_chunks += len(pending_embeddings)

    logger.info("インデックス完了: %d チャンク (workspace=%s)", total_chunks, workspace_id)
    return total_chunks


async def index_message(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    message_id: str,
    content: str,
) -> None:
    """会話メッセージをRAGインデックスに追加"""
    chunks = _chunk_text(content, size=400, overlap=50)
    texts = [c for c in chunks]
    vecs = await asyncio.get_event_loop().run_in_executor(None, embed_batch, texts)

    for i, (chunk, vec) in enumerate(zip(chunks, vecs)):
        emb = Embedding(
            workspace_id=workspace_id,
            source_type='message',
            source_ref=message_id,
            chunk_index=i,
            content=chunk,
            embedding=vec,
        )
        db.add(emb)

    await db.commit()
