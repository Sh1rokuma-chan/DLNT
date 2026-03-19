"""RAG Index Worker — サブプロセスとして実行"""
import asyncio
import gc
import json
import logging
import sys
import uuid
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    """サブプロセスのエントリポイント"""
    args = json.loads(sys.argv[1])
    directory = args["directory"]
    workspace_id = uuid.UUID(args["workspace_id"])
    clear_existing = args.get("clear_existing", False)

    from app.db.session import async_session_factory, init_db
    from app.db.models import Embedding
    from app.rag.indexer import _read_file, _chunk_text, SUPPORTED_EXTENSIONS
    from app.rag.embedder import embed_text
    from sqlalchemy import delete

    await init_db()

    async with async_session_factory() as db:
        if clear_existing:
            await db.execute(
                delete(Embedding)
                .where(Embedding.workspace_id == workspace_id)
                .where(Embedding.source_type == 'file')
            )
            await db.commit()

        root = Path(directory)
        if not root.exists():
            print(json.dumps({"error": f"ディレクトリなし: {directory}"}))
            return

        files = [
            p for p in root.rglob('*')
            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
        ]
        files.sort(key=lambda p: p.stat().st_size)
        logger.info("%d ファイルをインデックス化", len(files))

        total_chunks = 0
        total_embedded = 0

        for file_path in files:
            try:
                content = _read_file(file_path)
            except Exception as e:
                logger.error("読み込み失敗 %s: %s", file_path.name, e)
                continue
            if not content:
                continue

            rel_path = str(file_path.relative_to(root))
            chunks = _chunk_text(content)
            logger.info("  %s: %d チャンク", rel_path, len(chunks))

            for i, chunk in enumerate(chunks):
                vec = await embed_text(chunk)
                emb = Embedding(
                    workspace_id=workspace_id,
                    source_type='file',
                    source_ref=rel_path,
                    chunk_index=i,
                    content=chunk,
                    embedding=vec,
                )
                db.add(emb)
                if vec:
                    total_embedded += 1

            await db.commit()
            total_chunks += len(chunks)
            del content, chunks
            gc.collect()

        logger.info("完了: %d チャンク, %d embedded", total_chunks, total_embedded)
        print(json.dumps({"total_chunks": total_chunks, "total_embedded": total_embedded}))


if __name__ == "__main__":
    asyncio.run(main())
