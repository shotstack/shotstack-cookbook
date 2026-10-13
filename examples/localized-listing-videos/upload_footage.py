"""Upload a local video file to Shotstack's Ingest API and print its hosted URL.

Usage: python3 upload_footage.py path/to/footage.mp4
"""

import os
import sys
import time

import requests

API = "https://api.shotstack.io/ingest/v1"
POLL_SECONDS = 5
TIMEOUT_SECONDS = 15 * 60


def error_detail(resp):
    """Return the API's error message as one line."""
    # A rejected key comes back as {"errors": [...]}. Other Shotstack errors
    # come back as {"message": ..., "response": ...}.
    try:
        body = resp.json()
        if body.get("errors"):
            detail = body["errors"][0].get("detail") or body["errors"][0].get("title")
        else:
            detail = body.get("response")
            if isinstance(detail, dict):
                detail = detail.get("error") or detail.get("message")
            detail = detail or body.get("message")
    except Exception:
        detail = None
    return str(detail) if detail else resp.text.strip()[:200] or resp.reason


def check(resp, action):
    if not resp.ok:
        raise RuntimeError(
            f"Could not {action} ({resp.status_code}): {error_detail(resp)}"
        )
    return resp


def main():
    api_key = os.environ.get("SHOTSTACK_API_KEY")
    if not api_key:
        raise RuntimeError("Set the SHOTSTACK_API_KEY environment variable first.")
    if len(sys.argv) != 2:
        raise RuntimeError("Usage: python3 upload_footage.py <path-to-video>")
    path = sys.argv[1]
    if not os.path.isfile(path):
        raise RuntimeError(f"File not found: {path}")
    headers = {"x-api-key": api_key}

    # 1. Ask for a signed upload URL (valid for one hour).
    response = requests.post(f"{API}/upload", headers=headers, timeout=30)
    upload = check(response, "request an upload URL")
    data = upload.json()["data"]
    source_id, signed_url = data["id"], data["attributes"]["url"]

    # 2. Send the file to the signed URL with a plain PUT request.
    with open(path, "rb") as video:
        check(requests.put(signed_url, data=video, timeout=900), "upload the file")

    # 3. Wait until Shotstack has stored the file, then print its URL.
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        response = requests.get(
            f"{API}/sources/{source_id}", headers=headers, timeout=30
        )
        action = f"check source {source_id}"
        attributes = check(response, action).json()["data"]["attributes"]
        status = attributes["status"]
        if status == "ready":
            print(attributes["source"])
            return
        if status in ("failed", "deleted", "overwritten"):
            raise RuntimeError(f"Ingest {status} for source {source_id}")
        time.sleep(POLL_SECONDS)
    raise RuntimeError(
        f"Source {source_id} was not ready after {TIMEOUT_SECONDS} seconds. "
        "Do not upload the file again. "
        f"Get its status later with GET {API}/sources/{source_id}"
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(1) from None
    except requests.ConnectionError:
        print(
            "Could not reach Shotstack. Check your network connection "
            "and run the script again.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
