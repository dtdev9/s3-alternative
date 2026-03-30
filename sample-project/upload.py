import os
import sys

# ── Config ────────────────────────────────────────────────────────────────────
NESTJS_URL = "http://localhost:9001"
CHUNK_SIZE = 4 * 1024 * 1024   # 4 MB read buffer (keeps memory low)


def upload_file(file_path: str) -> dict:
    """
    Upload a file to the NestJS /upload endpoint (multipart/form-data).
    Streams the file in chunks to keep memory usage flat for large files.
    """
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    import http.client
    import mimetypes
    import uuid

    file_name = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    mime_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    boundary = uuid.uuid4().hex

    # Build multipart preamble and epilogue
    preamble = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
        f"Content-Type: {mime_type}\r\n"
        f"\r\n"
    ).encode()
    epilogue = f"\r\n--{boundary}--\r\n".encode()

    content_length = len(preamble) + file_size + len(epilogue)

    parsed = NESTJS_URL.replace("http://", "").replace("https://", "")
    host   = parsed.rstrip("/")

    conn = http.client.HTTPConnection(host)
    conn.putrequest("POST", "/upload")
    conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
    conn.putheader("Content-Length", str(content_length))
    conn.endheaders()

    # Stream: preamble → file chunks → epilogue
    conn.send(preamble)

    sent = 0
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            conn.send(chunk)
            sent += len(chunk)
            progress = sent / file_size * 100
            print(f"\r  uploading... {sent / 1024 / 1024:.1f} / {file_size / 1024 / 1024:.1f} MB  [{progress:.1f}%]", end="", flush=True)

    conn.send(epilogue)
    print()  # newline after progress

    resp = conn.getresponse()
    body = resp.read().decode()
    conn.close()

    if resp.status not in (200, 201):
        raise RuntimeError(f"Upload failed [{resp.status}]: {body}")

    import json
    return json.loads(body)


def get_url(object_name: str) -> str:
    """GET /upload/{objectName}/url — refresh a presigned download URL."""
    import http.client, json
    host = NESTJS_URL.replace("http://", "").replace("https://", "")
    conn = http.client.HTTPConnection(host)
    conn.request("GET", f"/upload/{object_name}/url")
    resp = conn.getresponse()
    body = json.loads(resp.read())
    conn.close()
    return body["data"]["url"]


def delete_file(object_name: str) -> None:
    """DELETE /upload/{objectName}"""
    import http.client
    host = NESTJS_URL.replace("http://", "").replace("https://", "")
    conn = http.client.HTTPConnection(host)
    conn.request("DELETE", f"/upload/{object_name}")
    resp = conn.getresponse()
    resp.read()
    conn.close()
    if resp.status != 200:
        raise RuntimeError(f"Delete failed [{resp.status}]")


def list_files(prefix: str = "") -> list:
    """GET /upload[?prefix=...] — list all uploaded files."""
    import http.client, json, urllib.parse
    host = NESTJS_URL.replace("http://", "").replace("https://", "")
    qs   = f"?prefix={urllib.parse.quote(prefix)}" if prefix else ""
    conn = http.client.HTTPConnection(host)
    conn.request("GET", f"/upload{qs}")
    resp = conn.getresponse()
    body = json.loads(resp.read())
    conn.close()
    return body.get("data", [])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python upload.py <file_path>")
        print("")
        print("Examples:")
        print("  python upload.py /path/to/video.mp4")
        print("  python upload.py /path/to/large-file.zip")
        sys.exit(1)

    file_path = sys.argv[1]

    print(f"[upload] {file_path}  →  {NESTJS_URL}/upload")

    try:
        result = upload_file(file_path)
        data   = result.get("data", {})
        print(f"\n  object : {data.get('objectName')}")
        print(f"  size   : {data.get('size', 0) / 1024 / 1024:.1f} MB")
        print(f"  etag   : {data.get('etag')}")
        print(f"  url    : {data.get('url')}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
