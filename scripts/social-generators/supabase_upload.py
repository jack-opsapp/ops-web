"""
Supabase Storage upload utility for OPS social media images.

Uploads generated images to Supabase Storage and returns public URLs.
Uses the service role key for unrestricted access (bypasses RLS).

Supports two buckets:
  - social-media: social graphics (carousels, OPPs, insights, features)
  - images: blog thumbnails, in-post images

Usage:
    from supabase_upload import upload_images
    urls = upload_images(["slide_1.png", "slide_2.png"], prefix="blog-carousel")
    url = upload_single("thumb.webp", "blog-thumbnails/thumb.webp", bucket="images")

CLI:
    python supabase_upload.py --prefix blog-carousel slide_1.png slide_2.png
    python supabase_upload.py --bucket images --prefix blog-thumbnails photo.webp
"""

import argparse
import os
import sys
import json
import hashlib
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ─── CONFIG ──────────────────────────────────────────────────
SUPABASE_URL = "https://ijeekuhbatykdomumfjx.supabase.co"

# Service role key — bypasses RLS for all storage operations.
# Falls back to env var SUPABASE_SERVICE_ROLE_KEY if set.
SUPABASE_SERVICE_KEY = os.environ.get(
    "SUPABASE_SERVICE_ROLE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZWVrdWhiYXR5a2RvbXVtZmp4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI3MzYxOCwiZXhwIjoyMDg2ODQ5NjE4fQ.GevX3JY6TSV7BPaDNcLxqSkkJbYRTIFJsNOJwiajoI4",
)

DEFAULT_BUCKET = "social-media"

# MIME type map
_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _upload_file(file_path: str, object_path: str, bucket: str = DEFAULT_BUCKET) -> str:
    """Upload a single file to Supabase Storage. Returns public URL."""
    with open(file_path, "rb") as f:
        data = f.read()

    ext = os.path.splitext(file_path)[1].lower()
    mime = _MIME.get(ext, "application/octet-stream")

    storage_url = f"{SUPABASE_URL}/storage/v1/object/{bucket}"
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{bucket}"

    req = Request(
        f"{storage_url}/{object_path}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "apikey": SUPABASE_SERVICE_KEY,
            "Content-Type": mime,
            "x-upsert": "true",  # overwrite if exists
        },
    )

    try:
        with urlopen(req) as resp:
            result = json.loads(resp.read())
    except HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"Upload failed ({e.code}): {body}") from e

    return f"{public_url}/{object_path}"


def upload_images(
    file_paths: list[str],
    prefix: str = "post",
    timestamp: str | None = None,
    bucket: str = DEFAULT_BUCKET,
) -> list[str]:
    """
    Upload multiple images to Supabase Storage.

    Args:
        file_paths: List of local file paths to upload.
        prefix: Folder/name prefix (e.g., "blog-carousel", "opp-042").
        timestamp: Optional timestamp string. Auto-generated if omitted.
        bucket: Storage bucket name. Defaults to "social-media".

    Returns:
        List of public URLs in the same order as file_paths.
    """
    if timestamp is None:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    urls = []
    for i, path in enumerate(file_paths):
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")

        ext = os.path.splitext(path)[1] or ".png"
        # e.g., social-media/blog-carousel/20260413-143022/slide_01.png
        object_path = f"{prefix}/{timestamp}/slide_{i + 1:02d}{ext}"

        url = _upload_file(path, object_path, bucket=bucket)
        urls.append(url)
        print(f"  ✓ Uploaded: {url}")

    return urls


def upload_single(
    file_path: str,
    object_name: str | None = None,
    bucket: str = DEFAULT_BUCKET,
) -> str:
    """
    Upload a single image. Returns public URL.

    Args:
        file_path: Local file path.
        object_name: Optional custom object path. Auto-generated if omitted.
        bucket: Storage bucket name. Defaults to "social-media".
    """
    if object_name is None:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        base = os.path.basename(file_path)
        object_name = f"singles/{ts}/{base}"

    return _upload_file(file_path, object_name, bucket=bucket)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload images to Supabase Storage")
    parser.add_argument("files", nargs="+", help="Image file paths to upload")
    parser.add_argument("--prefix", default="post", help="Storage prefix/folder name")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="Storage bucket (default: social-media)")
    args = parser.parse_args()

    print(f"Uploading {len(args.files)} image(s) to {args.bucket}/{args.prefix}/...")
    urls = upload_images(args.files, prefix=args.prefix, bucket=args.bucket)
    print(f"\nDone. {len(urls)} image(s) uploaded.")
    print(json.dumps(urls, indent=2))
