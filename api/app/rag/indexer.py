"""RAGインデクサー — ファイルをチャンク化してpgvectorに保存"""
import asyncio
import gc
import json
import logging
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Embedding
from app.rag.embedder import embed_text

logger = logging.getLogger(__name__)

# 対応拡張子
SUPPORTED_EXTENSIONS = {
    '.txt', '.md', '.py', '.js', '.ts', '.json', '.csv',
    '.yaml', '.yml', '.toml', '.rst', '.html', '.xml',
    '.pdf',
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
        if end == len(text):
            break
        start = end - overlap
    return chunks


def _read_file(path: Path) -> str | None:
    """ファイルを読み込む。PDF はテキスト抽出。失敗時はNone。"""
    try:
        if path.suffix.lower() == '.pdf':
            return _read_pdf(path)
        return path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        logger.warning("ファイル読み込み失敗 %s: %s", path, e)
        return None


def _read_pdf(path: Path) -> str | None:
    """PDFからテキストを抽出する"""
    try:
        import fitz  # pymupdf
        doc = fitz.open(str(path))
        pages = []
        for page in doc:
            text = page.get_text()
            if text.strip():
                pages.append(text)
        doc.close()
        return "\n\n".join(pages) if pages else None
    except Exception as e:
        logger.warning("PDF読み込み失敗 %s: %s", path, e)
        return None


async def index_directory_subprocess(
    directory: str,
    workspace_id: uuid.UUID,
    clear_existing: bool = False,
) -> dict:
    """
    サブプロセスでインデックスを実行。
    uvicorn プロセスのメモリ OOM を回避するため、
    別プロセスで DB 操作 + エンベディングを行う。
    """
    args = json.dumps({
        "directory": directory,
        "workspace_id": str(workspace_id),
        "clear_existing": clear_existing,
    })

    proc = await asyncio.create_subprocess_exec(
        "python", "-m", "app.rag.index_worker", args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        stderr_text = stderr.decode().strip()
        logger.error("index_worker 失敗 (exit %d): %s", proc.returncode, stderr_text[-500:])
        return {"error": f"Worker failed (exit {proc.returncode})", "stderr": stderr_text[-500:]}

    # stdout の最後の行が JSON 結果
    stdout_text = stdout.decode().strip()
    lines = stdout_text.split('\n')
    for line in reversed(lines):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue

    return {"error": "No JSON output from worker", "stdout": stdout_text[-500:]}


async def index_message(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    message_id: str,
    content: str,
) -> None:
    """会話メッセージをRAGインデックスに追加"""
    chunks = _chunk_text(content, size=400, overlap=50)

    for i, chunk in enumerate(chunks):
        vec = await embed_text(chunk)
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
