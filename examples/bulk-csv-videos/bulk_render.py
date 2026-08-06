#!/usr/bin/env python3

import csv
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


COMMAND = sys.argv[1] if len(sys.argv) > 1 else "submit"
VALID_COMMANDS = {"submit", "status", "summary"}

if COMMAND not in VALID_COMMANDS:
    raise SystemExit("Usage: python3 bulk_render.py [submit|status|summary]")

API_KEY = os.environ.get("SHOTSTACK_API_KEY")
ENVIRONMENT = os.environ.get("SHOTSTACK_ENV", "stage")
TEMPLATE_ID = os.environ.get("SHOTSTACK_TEMPLATE_ID")
CSV_PATH = Path(os.environ.get("CSV_PATH", "products.csv"))
MANIFEST_PATH = Path(os.environ.get("MANIFEST_PATH", "batch-results.json"))
REQUEST_INTERVAL_MS = int(os.environ.get("SHOTSTACK_REQUEST_INTERVAL_MS", "1000"))
ROW_LIMIT = int(os.environ.get("SHOTSTACK_ROW_LIMIT", "0"))
RETRY_FAILED = os.environ.get("SHOTSTACK_RETRY_FAILED") == "true"
MAX_RATE_LIMIT_RETRIES = 3
EDIT_BASE = os.environ.get(
    "SHOTSTACK_EDIT_BASE", f"https://api.shotstack.io/edit/{ENVIRONMENT}"
).rstrip("/")
SERVE_BASE = os.environ.get(
    "SHOTSTACK_SERVE_BASE", f"https://api.shotstack.io/serve/{ENVIRONMENT}"
).rstrip("/")

if ENVIRONMENT not in {"stage", "v1"}:
    raise SystemExit("SHOTSTACK_ENV must be stage or v1.")

if REQUEST_INTERVAL_MS < 0:
    raise SystemExit("SHOTSTACK_REQUEST_INTERVAL_MS must be zero or greater.")

if ROW_LIMIT < 0:
    raise SystemExit("SHOTSTACK_ROW_LIMIT must be a non-negative integer.")

if COMMAND != "summary" and not API_KEY:
    raise SystemExit("Set SHOTSTACK_API_KEY before running this command.")

if COMMAND == "submit" and not TEMPLATE_ID:
    raise SystemExit("Set SHOTSTACK_TEMPLATE_ID before submitting renders.")


def sleep_between_requests():
    if REQUEST_INTERVAL_MS > 0:
        time.sleep(REQUEST_INTERVAL_MS / 1000)


def row_hash(row):
    payload = json.dumps(
        row,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def response_message(body):
    if not isinstance(body, dict):
        return str(body)
    response = body.get("response")
    if isinstance(response, dict):
        return response.get("error") or response.get("message") or str(response)
    return body.get("message") or str(body)


def save_manifest(manifest):
    manifest["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    temporary_path = MANIFEST_PATH.with_name(f"{MANIFEST_PATH.name}.tmp")
    temporary_path.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(temporary_path, MANIFEST_PATH)


def load_manifest(create=False):
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

        if manifest.get("environment") != ENVIRONMENT:
            raise RuntimeError(
                f"{MANIFEST_PATH} belongs to {manifest.get('environment')}, "
                f"not {ENVIRONMENT}."
            )

        if (
            TEMPLATE_ID
            and manifest.get("templateId")
            and manifest["templateId"] != TEMPLATE_ID
        ):
            raise RuntimeError(f"{MANIFEST_PATH} belongs to a different template.")

        return manifest

    if not create:
        raise FileNotFoundError(MANIFEST_PATH)

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "version": 1,
        "environment": ENVIRONMENT,
        "templateId": TEMPLATE_ID,
        "createdAt": now,
        "updatedAt": now,
        "rows": [],
    }


def load_rows():
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as csv_file:
        rows = list(csv.DictReader(csv_file))

    required_columns = [
        "row_id",
        "product_name",
        "headline",
        "price",
        "image_url",
        "brand_color",
    ]
    seen_ids = set()
    errors = []

    for index, row in enumerate(rows, start=2):
        for column in required_columns:
            if not row.get(column):
                errors.append(f"Line {index}: {column} is required.")

        row_id = row.get("row_id", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", row_id):
            errors.append(
                f"Line {index}: row_id may contain only letters, numbers, _ and -."
            )

        if row_id in seen_ids:
            errors.append(f"Line {index}: duplicate row_id {row_id}.")
        seen_ids.add(row_id)

        if len(row.get("product_name", "")) > 40:
            errors.append(
                f"Line {index}: product_name must be 40 characters or fewer."
            )

        if len(row.get("headline", "")) > 55:
            errors.append(f"Line {index}: headline must be 55 characters or fewer.")

        if len(row.get("price", "")) > 20:
            errors.append(f"Line {index}: price must be 20 characters or fewer.")

        image_url = urlparse(row.get("image_url", ""))
        if image_url.scheme != "https" or not image_url.netloc:
            errors.append(f"Line {index}: image_url must be a valid HTTPS URL.")

        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", row.get("brand_color", "")):
            errors.append(
                f"Line {index}: brand_color must be a six-digit hex color."
            )

    if errors:
        raise ValueError("CSV validation failed:\n" + "\n".join(errors))

    return rows[:ROW_LIMIT] if ROW_LIMIT > 0 else rows


def merge_fields(row):
    return [
        {"find": "PRODUCT_NAME", "replace": row["product_name"]},
        {"find": "HEADLINE", "replace": row["headline"]},
        {"find": "PRICE", "replace": row["price"]},
        {"find": "IMAGE_URL", "replace": row["image_url"]},
        {"find": "BRAND_COLOR", "replace": row["brand_color"]},
    ]


def request_json(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {
        "Accept": "application/json",
        "x-api-key": API_KEY,
    }
    if data is not None:
        headers["Content-Type"] = "application/json"

    request = Request(url, data=data, headers=headers, method=method)

    try:
        with urlopen(request, timeout=30) as response:
            text = response.read().decode()
            body = json.loads(text) if text else {}
            return response.status, body, response.headers
    except HTTPError as error:
        text = error.read().decode()
        try:
            body = json.loads(text) if text else {}
        except json.JSONDecodeError:
            body = {"message": text}
        return error.code, body, error.headers


def retry_delay(headers, retry_number):
    retry_after = headers.get("Retry-After") if headers else None
    if retry_after and retry_after.isdigit():
        return int(retry_after)
    return 60 * (2**retry_number)


def submit_template(row):
    payload = {"id": TEMPLATE_ID, "merge": merge_fields(row)}

    for retry in range(MAX_RATE_LIMIT_RETRIES + 1):
        try:
            status_code, body, headers = request_json(
                "POST", f"{EDIT_BASE}/templates/render", payload
            )
        except (URLError, TimeoutError, OSError) as error:
            return {
                "kind": "unknown",
                "error": f"No definitive API response: {error}",
            }

        if status_code == 429:
            if retry == MAX_RATE_LIMIT_RETRIES:
                return {
                    "kind": "rejected",
                    "statusCode": 429,
                    "error": response_message(body),
                }
            delay = retry_delay(headers, retry)
            print(f"Rate limited. Waiting {delay} seconds.", file=sys.stderr)
            time.sleep(delay)
            continue

        render_id = (
            body.get("response", {}).get("id") if isinstance(body, dict) else None
        )
        if status_code == 201 and render_id:
            return {"kind": "accepted", "renderId": render_id}

        if 400 <= status_code < 500:
            return {
                "kind": "rejected",
                "statusCode": status_code,
                "error": response_message(body),
            }

        return {
            "kind": "unknown",
            "statusCode": status_code,
            "error": f"Unexpected response: {response_message(body)}",
        }

    raise RuntimeError("Unreachable")


def submit_rows():
    rows = load_rows()
    manifest = load_manifest(create=True)
    print(f"Validated {len(rows)} rows from {CSV_PATH}.")

    for index, row in enumerate(rows, start=1):
        entry = next(
            (item for item in manifest["rows"] if item["rowId"] == row["row_id"]),
            None,
        )

        if entry and entry.get("status") == "submitting":
            entry["status"] = "unknown"
            entry["error"] = (
                "The previous process stopped during submission. "
                "Check the dashboard before retrying."
            )
            save_manifest(manifest)

        if entry and entry.get("status") == "unknown":
            print(
                f"[{row['row_id']}] skipped: previous outcome is unknown.",
                file=sys.stderr,
            )
            continue

        can_retry = RETRY_FAILED and entry and entry.get("status") in {
            "failed",
            "submission_failed",
        }
        current_hash = row_hash(row)

        if (
            entry
            and entry.get("inputHash")
            and entry["inputHash"] != current_hash
            and not can_retry
        ):
            raise RuntimeError(
                f"Row {row['row_id']} changed after its first submission. "
                "Use a new row_id, or retry it only after confirming the "
                "previous request failed."
            )

        if entry and entry.get("renderId") and not can_retry:
            print(f"[{row['row_id']}] skipped: already has a render ID.")
            continue

        if (
            entry
            and entry.get("status") == "submission_failed"
            and not can_retry
        ):
            print(
                f"[{row['row_id']}] skipped: set SHOTSTACK_RETRY_FAILED=true."
            )
            continue

        if entry is None:
            entry = {"rowId": row["row_id"], "attempts": 0}
            manifest["rows"].append(entry)

        if can_retry:
            if entry.get("renderId"):
                entry["previousRenderIds"] = [
                    *entry.get("previousRenderIds", []),
                    entry["renderId"],
                ]
            entry.pop("renderId", None)
            entry.pop("temporaryUrl", None)
            entry.pop("hostedUrl", None)
            entry.pop("hostingStatus", None)
            entry.pop("statusUpdatedAt", None)
            entry.pop("completedAt", None)
            entry.pop("submittedAt", None)
            entry.pop("statusCode", None)

        entry["inputHash"] = current_hash
        entry["status"] = "submitting"
        entry["error"] = None
        entry["attempts"] = entry.get("attempts", 0) + 1
        entry["lastAttemptAt"] = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        )
        save_manifest(manifest)

        result = submit_template(row)

        if result["kind"] == "accepted":
            entry["renderId"] = result["renderId"]
            entry["status"] = "queued"
            entry["submittedAt"] = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            )
            print(
                f"[{index}/{len(rows)}] {row['row_id']} -> {result['renderId']}"
            )
        elif result["kind"] == "rejected":
            entry["status"] = "submission_failed"
            entry["statusCode"] = result.get("statusCode")
            entry["error"] = result["error"]
            print(
                f"[{row['row_id']}] rejected: {result['error']}",
                file=sys.stderr,
            )
        else:
            entry["status"] = "unknown"
            entry["statusCode"] = result.get("statusCode")
            entry["error"] = result["error"]
            print(
                f"[{row['row_id']}] unknown outcome: {result['error']}",
                file=sys.stderr,
            )

        save_manifest(manifest)
        sleep_between_requests()

    print_summary(manifest)


def update_statuses():
    manifest = load_manifest()

    for entry in manifest["rows"]:
        if (
            not entry.get("renderId")
            or entry.get("status") == "failed"
            or (entry.get("status") == "done" and entry.get("hostedUrl"))
        ):
            continue

        if entry.get("status") != "done":
            try:
                status_code, body, _ = request_json(
                    "GET",
                    f"{EDIT_BASE}/render/{entry['renderId']}?data=false",
                )
                response = body.get("response", {}) if isinstance(body, dict) else {}

                if 200 <= status_code < 300 and response.get("status"):
                    entry["status"] = response["status"]
                    entry["error"] = response.get("error") or None
                    entry["temporaryUrl"] = response.get("url")
                    entry["statusUpdatedAt"] = response.get("updated")

                    if entry["status"] in {"done", "failed"}:
                        entry["completedAt"] = response.get("updated")
                else:
                    print(
                        f"[{entry['rowId']}] status lookup failed: "
                        f"{status_code} {response_message(body)}",
                        file=sys.stderr,
                    )
            except (URLError, TimeoutError, OSError) as error:
                print(
                    f"[{entry['rowId']}] status lookup failed: {error}",
                    file=sys.stderr,
                )

        if entry.get("status") == "done" and not entry.get("hostedUrl"):
            try:
                status_code, body, _ = request_json(
                    "GET",
                    f"{SERVE_BASE}/assets/render/{entry['renderId']}",
                )
                assets = body.get("data", []) if isinstance(body, dict) else []

                if 200 <= status_code < 300 and isinstance(assets, list):
                    video = next(
                        (
                            asset.get("attributes", {})
                            for asset in assets
                            if asset.get("attributes", {}).get("status") == "ready"
                            and asset.get("attributes", {})
                            .get("filename", "")
                            .endswith(".mp4")
                        ),
                        None,
                    )
                    first_asset = (
                        assets[0].get("attributes", {}) if assets else {}
                    )
                    entry["hostingStatus"] = (
                        "ready" if video else first_asset.get("status", "pending")
                    )
                    entry["hostedUrl"] = video.get("url") if video else None
                else:
                    entry["hostingStatus"] = "pending"
            except (URLError, TimeoutError, OSError):
                entry["hostingStatus"] = "pending"

        save_manifest(manifest)
        sleep_between_requests()

    print_summary(manifest)


def print_summary(manifest):
    counts = {}
    for entry in manifest["rows"]:
        status = entry.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1

    print("status\tcount")
    for status in sorted(counts):
        print(f"{status}\t{counts[status]}")

    hosted = sum(bool(row.get("hostedUrl")) for row in manifest["rows"])
    print(f"Hosted videos ready: {hosted}/{len(manifest['rows'])}")


if COMMAND == "submit":
    submit_rows()
elif COMMAND == "status":
    update_statuses()
else:
    print_summary(load_manifest())
