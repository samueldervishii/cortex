"""File-blob storage abstraction.

Two backends, switched by config:

* **Mongo (default)**: writes the base64-encoded blob into the existing
  ``file_storage`` collection. Convenient for local dev and very small
  deployments because there's nothing else to provision, but it bloats
  the database, eats RAM on every backup, and pushes documents past
  the 16MB BSON limit once a single file gets large.

* **S3-compatible** (AWS S3, Cloudflare R2, Backblaze B2, MinIO):
  writes the raw bytes to an object store, keeps just a key + metadata
  in Mongo. Activated automatically when ``S3_BUCKET`` is set.

Callers don't need to know which backend is active — they just use
``store_file`` / ``load_file_bytes`` and get back/give a storage ID.
The download endpoint reads the stored backend hint off the metadata
doc so a single deployment can have legacy Mongo blobs and new S3
blobs coexisting (e.g. after flipping the env var on).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from typing import Optional

from config import settings
from core.timestamps import utc_iso

logger = logging.getLogger("etude.storage")

# Lazy boto3 client. We only construct it the first time it's needed,
# and only if S3 is actually configured. This keeps the import-time
# cost of the API zero for deployments that don't use object storage.
_s3_client = None
_s3_client_lock = asyncio.Lock()


def _is_s3_configured() -> bool:
    return bool(settings.s3_bucket)


async def _get_s3_client():
    """Return a singleton boto3 S3 client, lazily constructed."""
    global _s3_client
    if _s3_client is not None:
        return _s3_client
    async with _s3_client_lock:
        if _s3_client is not None:
            return _s3_client
        try:
            import boto3
            from botocore.config import Config as BotoConfig
        except ImportError as e:
            raise RuntimeError(
                "S3 storage is configured (S3_BUCKET set) but boto3 is not "
                "installed. Add `boto3` to requirements.txt."
            ) from e

        boto_config = BotoConfig(
            s3={"addressing_style": "path" if settings.s3_path_style else "auto"},
            retries={"max_attempts": 3, "mode": "standard"},
        )
        kwargs = {
            "service_name": "s3",
            "config": boto_config,
        }
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url
        if settings.s3_region:
            kwargs["region_name"] = settings.s3_region
        if settings.s3_access_key_id and settings.s3_secret_access_key:
            kwargs["aws_access_key_id"] = settings.s3_access_key_id
            kwargs["aws_secret_access_key"] = settings.s3_secret_access_key
        # Construction itself doesn't hit the network so running it
        # synchronously in the event loop is fine.
        _s3_client = boto3.client(**kwargs)
        logger.info(
            "S3 storage backend initialized (bucket=%s, endpoint=%s)",
            settings.s3_bucket,
            settings.s3_endpoint_url or "AWS",
        )
        return _s3_client


async def store_file(
    db,
    *,
    session_id: str,
    user_id: Optional[str],
    content: bytes,
    filename: str,
    content_type: str,
) -> str:
    """Persist ``content`` and return a storage ID.

    The returned ID is what gets written to ``Message.file_storage_id``
    so the download endpoint can later resolve it back to bytes via
    :func:`load_file_bytes`.

    Backend selection is automatic. The metadata document in
    ``file_storage`` records the backend used (``"s3"`` or ``"mongo"``)
    so a single session/user can mix old and new blobs after a config
    flip.
    """
    storage_id = str(uuid.uuid4())
    size = len(content)

    if _is_s3_configured():
        client = await _get_s3_client()
        # S3 keys: namespace by user → session for trivial GDPR-style
        # bulk delete and easy lifecycle policies in the bucket config.
        key = f"users/{user_id or 'anon'}/sessions/{session_id}/{storage_id}"
        try:
            await asyncio.to_thread(
                client.put_object,
                Bucket=settings.s3_bucket,
                Key=key,
                Body=content,
                ContentType=content_type or "application/octet-stream",
            )
        except Exception:
            logger.exception("S3 put_object failed; falling back to Mongo storage")
            return await _store_in_mongo(
                db,
                storage_id=storage_id,
                session_id=session_id,
                content=content,
                filename=filename,
                content_type=content_type,
                size=size,
            )

        await db["file_storage"].insert_one(
            {
                "id": storage_id,
                "session_id": session_id,
                "user_id": user_id,
                "backend": "s3",
                "bucket": settings.s3_bucket,
                "key": key,
                "filename": filename,
                "content_type": content_type,
                "size": size,
                "created_at": utc_iso(),
            }
        )
        return storage_id

    return await _store_in_mongo(
        db,
        storage_id=storage_id,
        session_id=session_id,
        content=content,
        filename=filename,
        content_type=content_type,
        size=size,
    )


async def _store_in_mongo(
    db,
    *,
    storage_id: str,
    session_id: str,
    content: bytes,
    filename: str,
    content_type: str,
    size: int,
) -> str:
    """Legacy in-Mongo blob storage. Always available as a fallback."""
    data_b64 = await asyncio.to_thread(
        lambda: base64.b64encode(content).decode("ascii")
    )
    await db["file_storage"].insert_one(
        {
            "id": storage_id,
            "session_id": session_id,
            "backend": "mongo",
            "data_base64": data_b64,
            "filename": filename,
            "content_type": content_type,
            "size": size,
            "created_at": utc_iso(),
        }
    )
    return storage_id


async def load_file_bytes(db, storage_id: str) -> Optional[bytes]:
    """Return raw bytes for a previously-stored file, or ``None``.

    Reads the metadata doc, dispatches to the right backend, and
    returns decoded bytes ready to be served.
    """
    if not storage_id:
        return None
    doc = await db["file_storage"].find_one({"id": storage_id})
    if not doc:
        return None

    backend = doc.get("backend") or ("s3" if doc.get("key") else "mongo")

    if backend == "s3":
        client = await _get_s3_client()
        try:
            resp = await asyncio.to_thread(
                client.get_object,
                Bucket=doc.get("bucket") or settings.s3_bucket,
                Key=doc["key"],
            )
            return await asyncio.to_thread(resp["Body"].read)
        except Exception:
            logger.exception(
                "S3 get_object failed for storage_id=%s key=%s",
                storage_id,
                doc.get("key"),
            )
            return None

    data_b64 = doc.get("data_base64") or ""
    if not data_b64:
        return None
    try:
        return await asyncio.to_thread(base64.b64decode, data_b64)
    except Exception:
        logger.exception(
            "Failed to base64-decode legacy mongo blob for %s", storage_id
        )
        return None


async def delete_file(db, storage_id: str) -> None:
    """Remove a stored file (best-effort).

    Used by session-deletion paths so we don't accumulate orphaned blobs
    in the bucket. Never raises — a failed remote delete is logged and
    the metadata doc is still removed locally.
    """
    if not storage_id:
        return
    doc = await db["file_storage"].find_one({"id": storage_id})
    if not doc:
        return
    backend = doc.get("backend") or ("s3" if doc.get("key") else "mongo")
    if backend == "s3":
        try:
            client = await _get_s3_client()
            await asyncio.to_thread(
                client.delete_object,
                Bucket=doc.get("bucket") or settings.s3_bucket,
                Key=doc["key"],
            )
        except Exception:
            logger.exception("S3 delete_object failed for %s", storage_id)
    await db["file_storage"].delete_one({"id": storage_id})
