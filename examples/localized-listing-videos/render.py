"""Render one localized video per language from a saved Shotstack template.

Reads languages.json, submits one template render per language, waits for each
render to finish, and saves the videos to output/<code>.mp4. Each render is
recorded in output/renders.json together with a fingerprint of what it was made
from: the template ID and that language's merge fields.

Running the script again skips videos already finished with the same template
ID and text, picks up renders that were still running (or finished after the
script stopped), and starts new renders for new, changed or failed languages.

Pass language codes to render only those, e.g. `python3 render.py ja`.
"""

import hashlib
import json
import os
import sys
import time
from pathlib import Path

import requests

API = "https://api.shotstack.io/edit/v1"
API_KEY = os.environ.get("SHOTSTACK_API_KEY")
TEMPLATE_ID = os.environ.get("SHOTSTACK_TEMPLATE_ID")
HEADERS = {"x-api-key": API_KEY or ""}
HERE = Path(__file__).resolve().parent
OUTPUT_DIR = HERE / "output"
LOG_PATH = OUTPUT_DIR / "renders.json"
POLL_SECONDS = 5
TIMEOUT_SECONDS = 15 * 60
CONNECTION_RETRIES = 6


def error_detail(resp):
    """Return the API's error message as one line."""
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        return resp.text.strip()[:200]
    # A rejected key comes back as {"errors": [...]}. Other Shotstack errors
    # come back as {"message": ..., "response": ...}.
    if body.get("errors"):
        return body["errors"][0].get("detail") or resp.text.strip()[:200]
    response = body.get("response")
    if isinstance(response, dict):
        response = response.get("error") or response.get("message")
    return str(response or body.get("message") or resp.text.strip()[:200])


def merge_fields(language):
    """Map one languages.json entry to the template's merge fields."""
    return [
        {"find": "SCRIPT", "replace": language["script"]},
        {"find": "MODEL", "replace": language["model"]},
        {"find": "VOICE", "replace": language["voice"]},
        {"find": "HEADLINE", "replace": language["headline"]},
        {"find": "CTA", "replace": language["cta"]},
    ]


def fingerprint(language):
    """Identify a video by the template ID and text it is rendered from."""
    payload = json.dumps(
        {"template": TEMPLATE_ID, "merge": merge_fields(language)},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def submit(language):
    resp = requests.post(
        f"{API}/templates/render",
        headers=HEADERS,
        json={"id": TEMPLATE_ID, "merge": merge_fields(language)},
        timeout=30,
    )
    if resp.status_code in (401, 403):
        # A rejected key fails every language the same way, so stop now.
        raise SystemExit(f"Shotstack rejected the API key: {error_detail(resp)}")
    if not resp.ok:
        raise RuntimeError(f"submit failed ({resp.status_code}): {error_detail(resp)}")
    return resp.json()["response"]["id"]


def get_render(render_id):
    resp = requests.get(f"{API}/render/{render_id}", headers=HEADERS, timeout=30)
    if resp.status_code >= 500 or resp.status_code == 429:
        # A server error or rate limit is retried like a connection problem.
        resp.raise_for_status()
    if not resp.ok:
        raise RuntimeError(
            f"status check failed ({resp.status_code}): {error_detail(resp)}"
        )
    return resp.json()["response"]


def wait_for(code, render_id):
    """Poll until the render is done or failed, printing each new status.

    The render keeps running on Shotstack's side if this script loses its
    connection. Server errors are retried until the timeout. A lost network is
    retried CONNECTION_RETRIES times, then the script stops and the next run
    picks the render up.
    """
    deadline = time.monotonic() + TIMEOUT_SECONDS
    last_status = None
    connection_failures = 0
    while time.monotonic() < deadline:
        try:
            render = get_render(render_id)
        except requests.RequestException as err:
            if isinstance(err, requests.ConnectionError):
                connection_failures += 1
                if connection_failures > CONNECTION_RETRIES:
                    raise
            print(f"[{code}] connection problem, retrying ({type(err).__name__})")
            time.sleep(POLL_SECONDS)
            continue
        connection_failures = 0
        if render["status"] != last_status:
            last_status = render["status"]
            print(f"[{code}] {last_status}")
        if last_status == "done":
            return render["url"]
        if last_status == "failed":
            raise RuntimeError(f"render failed: {render.get('error')}")
        time.sleep(POLL_SECONDS)
    raise RuntimeError(
        f"render {render_id} did not finish within {TIMEOUT_SECONDS} seconds"
    )


def can_resume(render_id):
    """True if a render from an earlier run is still running or has finished."""
    try:
        return get_render(render_id)["status"] != "failed"
    except requests.ConnectionError:
        raise  # the network is down; main() stops with one line
    except requests.RequestException:
        return True  # no answer yet; wait_for() keeps trying
    except RuntimeError:
        return False  # for example, Shotstack no longer knows this render ID


def download(url, path):
    # The render URL is temporary, so save the file as soon as it is ready.
    # Write to a .part file first so an interrupted download is never mistaken
    # for a finished video on the next run.
    partial = path.with_name(path.name + ".part")
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        with open(partial, "wb") as out:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                out.write(chunk)
    partial.replace(path)


def failed_entry(render_id, fp):
    return {"render_id": render_id, "fingerprint": fp, "status": "failed"}


def save_log(log):
    # Write to a temporary file first, so a stopped script cannot leave half a log.
    temporary = LOG_PATH.with_name(LOG_PATH.name + ".tmp")
    temporary.write_text(json.dumps(log, indent=2), encoding="utf-8")
    temporary.replace(LOG_PATH)


def main():
    if not API_KEY:
        raise RuntimeError("Set the SHOTSTACK_API_KEY environment variable first.")
    if not TEMPLATE_ID:
        raise RuntimeError(
            "Set the SHOTSTACK_TEMPLATE_ID environment variable first. "
            "Run save_template.py to get the ID."
        )
    languages = json.loads((HERE / "languages.json").read_text(encoding="utf-8"))
    only = set(sys.argv[1:])
    if only:
        unknown = only - {language["code"] for language in languages}
        if unknown:
            raise SystemExit(f"Not in languages.json: {', '.join(sorted(unknown))}")
        languages = [language for language in languages if language["code"] in only]
    # Each render uses credits, so stop before any render if a field is empty.
    fields = ("model", "voice", "script", "headline", "cta")
    incomplete = [
        language["code"]
        for language in languages
        if not all(language.get(field) for field in fields)
    ]
    if incomplete:
        raise RuntimeError(
            f"Empty fields in languages.json for: {', '.join(incomplete)}. "
            "Set model and voice. Run translate.py to fill script, headline and cta."
        )
    OUTPUT_DIR.mkdir(exist_ok=True)
    log = {}
    if LOG_PATH.exists():
        log = json.loads(LOG_PATH.read_text(encoding="utf-8"))

    # Start (or pick up) every render first so they run at the same time.
    pending = {}
    failed = []
    for language in languages:
        code = language["code"]
        fp = fingerprint(language)
        entry = log.get(code, {})
        unchanged = entry.get("fingerprint") == fp
        video_exists = (OUTPUT_DIR / f"{code}.mp4").exists()
        if unchanged and entry.get("status") == "done" and video_exists:
            print(f"[{code}] already rendered, skipping")
            continue
        render_id = entry.get("render_id")
        # A "done" entry with no video means the file was deleted. Its temporary
        # URL may have expired, so render it again.
        resumable = unchanged and render_id and entry.get("status") != "done"
        if resumable and can_resume(render_id):
            print(f"[{code}] picking up render {entry['render_id']}")
            pending[code] = (entry["render_id"], fp)
            continue
        try:
            render_id = submit(language)
        except requests.ConnectionError:
            raise
        except requests.Timeout:
            # Shotstack may have accepted the render. A new run would pay twice.
            raise SystemExit(
                f"[{code}] Shotstack did not answer in time. The render may have "
                "started. If you run the script again, it starts another render."
            ) from None
        except (RuntimeError, requests.RequestException) as err:
            print(f"[{code}] {err}")
            failed.append(code)
            continue
        pending[code] = (render_id, fp)
        log[code] = {"render_id": render_id, "fingerprint": fp, "status": "submitted"}
        save_log(log)
        print(f"[{code}] queued as {render_id}")

    for code, (render_id, fp) in pending.items():
        try:
            url = wait_for(code, render_id)
            download(url, OUTPUT_DIR / f"{code}.mp4")
            log[code] = {"render_id": render_id, "fingerprint": fp, "status": "done"}
            print(f"[{code}] saved to output/{code}.mp4")
        except requests.ConnectionError:
            # Keep the "submitted" entry, so the next run picks the render up.
            raise
        except requests.HTTPError as err:
            failed.append(code)
            print(f"[{code}] download failed: {err}")
            if err.response is not None and err.response.status_code < 500:
                # The temporary URL has probably expired, so forget this render
                # and start a new one next run.
                log.pop(code, None)
            else:
                # A server error is temporary: keep the render, so the next run
                # downloads it again without paying for a new render.
                log[code] = failed_entry(render_id, fp)
        except (RuntimeError, requests.RequestException) as err:
            log[code] = failed_entry(render_id, fp)
            failed.append(code)
            print(f"[{code}] {err}")
        save_log(log)

    if failed:
        raise SystemExit(
            f"Not rendered: {', '.join(failed)}. Run the script again to retry them."
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # Renders already started keep running. The next run picks them up.
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
