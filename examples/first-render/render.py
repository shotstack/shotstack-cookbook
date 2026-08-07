import json
import os
import sys
import time
from pathlib import Path

import requests

API_BASE_URL = "https://api.shotstack.io/edit/stage"
POLL_INTERVAL_SECONDS = 5
MAX_WAIT_SECONDS = 10 * 60


def shotstack_request(method, path, api_key, **kwargs):
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

    try:
        body = response.json()
    except requests.exceptions.JSONDecodeError as error:
        raise RuntimeError(
            "Shotstack returned a non-JSON response "
            f"with status {response.status_code}."
        ) from error

    if not response.ok:
        raise RuntimeError(
            f"Shotstack returned {response.status_code}: {json.dumps(body)}"
        )

    return body


def submit_render(edit, api_key):
    result = shotstack_request("POST", "/render", api_key, json=edit)
    render_id = result.get("response", {}).get("id")

    if not render_id:
        raise RuntimeError(
            f"The response did not contain a render ID: {json.dumps(result)}"
        )

    return render_id


def wait_for_render(render_id, api_key):
    started_at = time.monotonic()

    while time.monotonic() - started_at < MAX_WAIT_SECONDS:
        result = shotstack_request("GET", f"/render/{render_id}", api_key)
        render = result.get("response", {})
        status = render.get("status")

        if not status:
            raise RuntimeError(f"Unexpected status response: {json.dumps(result)}")

        print(f"Render status: {status}")

        if status == "done":
            return render

        if status == "failed":
            raise RuntimeError(
                render.get("error") or "The render failed without an error message."
            )

        time.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(f"Render {render_id} did not finish within 10 minutes.")


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
    except (
        OSError,
        KeyError,
        ValueError,
        RuntimeError,
        TimeoutError,
        requests.RequestException,
    ) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
