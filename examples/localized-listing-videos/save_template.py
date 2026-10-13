"""Save template.json as a Shotstack template and print the template ID."""

import json
import os
import sys
from pathlib import Path

import requests

API = "https://api.shotstack.io/edit/v1"
HERE = Path(__file__).resolve().parent


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


def main():
    api_key = os.environ.get("SHOTSTACK_API_KEY")
    if not api_key:
        raise RuntimeError("Set the SHOTSTACK_API_KEY environment variable first.")

    template_text = (HERE / "template.json").read_text(encoding="utf-8")
    if "PASTE_FOOTAGE_URL_HERE" in template_text:
        raise RuntimeError(
            "Replace PASTE_FOOTAGE_URL_HERE in template.json "
            "with your footage URL first."
        )

    resp = requests.post(
        f"{API}/templates",
        headers={"x-api-key": api_key},
        json={"name": "Localized listing video", "template": json.loads(template_text)},
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(
            f"Could not save the template ({resp.status_code}): {error_detail(resp)}"
        )

    print(resp.json()["response"]["id"])


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
