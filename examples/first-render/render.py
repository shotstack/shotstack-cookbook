import json
import os
import sys
import time
from pathlib import Path

import requests

# The sandbox environment. The API names it "stage".
API_BASE_URL = "https://api.shotstack.io/edit/stage"
POLL_INTERVAL_SECONDS = 5
MAX_WAIT_SECONDS = 10 * 60


def shotstack_request(method, path, api_key, **kwargs):
    try:
        response = requests.request(
            method,
            f"{API_BASE_URL}{path}",
            headers={
                "Accept": "application/json",
                "x-api-key": api_key,
            },
            timeout=30,
            **kwargs,
        )
    except requests.RequestException as error:
        raise RuntimeError(
            "Could not reach the Shotstack API. "
            "Check your network connection and try again."
        ) from error

    try:
        body = response.json()
    except ValueError:
        body = None

    if not response.ok:
        try:
            detail = body["errors"][0]["detail"]
        except (TypeError, KeyError, IndexError):
            if body is None:
                detail = response.text
            else:
                detail = json.dumps(body, separators=(",", ":"))
        raise RuntimeError(f"Shotstack returned {response.status_code}: {detail}")

    if not isinstance(body, dict):
        raise RuntimeError(
            "Shotstack returned a non-JSON response "
            f"with status {response.status_code}."
        )

    return body


def submit_render(edit, api_key):
    result = shotstack_request("POST", "/render", api_key, json=edit)
    render_id = (result.get("response") or {}).get("id")

    if not render_id:
        raise RuntimeError(
            "The response did not contain a render ID: "
            f"{json.dumps(result, separators=(',', ':'))}"
        )

    return render_id


def wait_for_render(render_id, api_key):
    started_at = time.monotonic()

    while time.monotonic() - started_at < MAX_WAIT_SECONDS:
        result = shotstack_request("GET", f"/render/{render_id}", api_key)
        render = result.get("response") or {}
        status = render.get("status")

        if not status:
            raise RuntimeError(
                "Unexpected status response: "
                f"{json.dumps(result, separators=(',', ':'))}"
            )

        print(f"Render status: {status}")

        if status == "done":
            if not render.get("url"):
                raise RuntimeError("The render finished without an output URL.")
            return render

        if status == "failed":
            raise RuntimeError(
                render.get("error") or "The render failed without an error message."
            )

        time.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(
        f"Render {render_id} did not finish "
        f"within {MAX_WAIT_SECONDS // 60} minutes."
    )


def main():
    api_key = os.environ.get("SHOTSTACK_API_KEY")

    if not api_key:
        raise RuntimeError("Set the SHOTSTACK_API_KEY environment variable first.")

    edit_path = Path(__file__).with_name("edit.json")
    edit = json.loads(edit_path.read_text(encoding="utf-8"))
    render_id = submit_render(edit, api_key)

    print(f"Queued render: {render_id}")

    render = wait_for_render(render_id, api_key)
    print(f"Temporary output URL: {render['url']}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # KeyboardInterrupt is not an Exception, and this script sleeps in the
        # poll loop, so it is easy to hit. Exit without a traceback.
        raise SystemExit(1) from None
    except Exception as error:
        # Catch Exception rather than a list of classes. One line, no traceback.
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
