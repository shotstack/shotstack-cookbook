#!/usr/bin/env python3
"""Turn a long recording into short, vertical, captioned clips with the Shotstack API.

    python clips.py RECORDING_URL [--limit N] [--repick]

Step 1 imports the recording with Shotstack's Ingest API and gets its transcript.
Step 2 asks Claude to pick the best moments and saves them to moments.json.
Step 3 renders each moment twice: once to cut it out and fit it into a vertical
frame, and once to add captions generated from the cut's own audio.
Step 4 does that for every moment and downloads the finished clips.

Everything for one recording goes in clips/<name>/. Progress is saved to
manifest.json in that folder after every step, so running the same command again
picks up where the last run stopped instead of repeating work.

Environment variables:
    SHOTSTACK_API_KEY   your Shotstack API key
    ANTHROPIC_API_KEY   your Anthropic API key (only needed to pick moments)
    SHOTSTACK_ENV       "v1" for production (the default) or "stage" for the sandbox
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import namedtuple
from pathlib import Path
from urllib.parse import urlparse

import requests

SHOTSTACK_ENV = os.environ.get("SHOTSTACK_ENV") or "v1"
INGEST = f"https://api.shotstack.io/ingest/{SHOTSTACK_ENV}"
EDIT = f"https://api.shotstack.io/edit/{SHOTSTACK_ENV}"
HEADERS = {
    "x-api-key": os.environ.get("SHOTSTACK_API_KEY", ""),
    "Accept": "application/json",
}

CLIP_COUNT = 5
MIN_SECONDS, MAX_SECONDS = 15, 60

POLL_SECONDS = 10
IMPORT_TIMEOUT = 60 * 60  # stop waiting for the import and transcript after an hour
RENDER_TIMEOUT = 60 * 60  # and for the renders


def fail(message):
    sys.exit(f"\nStopped: {message}")


def clock(seconds):
    """1234.5 -> '20:34'"""
    minutes, seconds = divmod(int(seconds), 60)
    return f"{minutes}:{seconds:02d}"


class Manifest(dict):
    """What's been done for one recording, saved to manifest.json after every change."""

    def __init__(self, path, url):
        try:
            saved = json.loads(path.read_text()) if path.exists() else {"url": url}
        except ValueError:
            saved = None
        if not isinstance(saved, dict) or not isinstance(saved.get("url"), str):
            fail(f"{path} is not a valid manifest. Fix it, or delete it to start over.")
        super().__init__(saved)
        self.path = path
        if self["url"] != url:
            # nothing was done for the old URL, like after a failed import
            if set(self) == {"url"}:
                self["url"] = url
            else:
                fail(
                    f"{path.parent} belongs to a different recording: {self['url']}. "
                    "Delete or rename that folder to start over with this URL."
                )

    def save(self):
        self.path.write_text(json.dumps(self, indent=2))


# ---------------------------------------- Shotstack requests


class ApiError(Exception):
    """Shotstack answered with an error."""


class Unresolved(Exception):
    """A submit request that may or may not have reached Shotstack."""


def error_detail(body):
    """The reason in an error body: Ingest sends errors[0].detail, Edit sends
    response.error or message."""
    if not isinstance(body, dict):
        return ""
    errors = body.get("errors")
    first = errors[0] if isinstance(errors, list) and errors else None
    response = body.get("response")
    for value in (
        first.get("detail") if isinstance(first, dict) else None,
        response.get("error") if isinstance(response, dict) else None,
        body.get("message"),
    ):
        if isinstance(value, str) and value:
            return value
    return ""


def check(response):
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code in (401, 403):
        kind = "production" if SHOTSTACK_ENV == "v1" else "sandbox"
        fail(
            f"Shotstack refused the API key ({response.status_code} "
            f"{error_detail(body)}). SHOTSTACK_API_KEY must be your {kind} key."
        )
    if response.status_code >= 400:
        reason = error_detail(body) or response.reason
        raise ApiError(f"{response.status_code} from {response.url}: {reason}")
    if not isinstance(body, dict):
        raise ApiError(f"{response.url} did not send a JSON object")
    return body


def post_json(url, body):
    """POST once. Sending the same submit twice could start a duplicate job."""
    try:
        response = requests.post(url, headers=HEADERS, json=body, timeout=60)
    except requests.RequestException as error:
        raise Unresolved(f"{type(error).__name__}") from error
    # A server error can come after the job was created, so it isn't sent again either.
    if response.status_code >= 500:
        raise Unresolved(f"HTTP {response.status_code}")
    return check(response)


def get_json(url):
    """GET a status, retrying network errors, rate limits and server errors."""
    for attempt in range(1, 6):
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
            if response.status_code != 429 and response.status_code < 500:
                return check(response)
        except requests.RequestException:
            pass
        time.sleep(5 * attempt)
    fail(f"GET {url} kept failing. Run the same command again to carry on.")


def download(url, path):
    """Save a file Shotstack hosts. No API key: these are plain file URLs."""
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with open(path, "wb") as file:
            for chunk in response.iter_content(chunk_size=1 << 20):
                file.write(chunk)


# ---------------------------------------- step 1: import and transcribe


def import_recording(url, manifest, folder):
    """Import the recording with the Ingest API and wait for its SRT transcript."""
    if "source_id" not in manifest:
        body = {"url": url, "outputs": {"transcription": {"format": "srt"}}}
        data = post_json(f"{INGEST}/sources", body).get("data")
        if not isinstance(data, dict) or not data.get("id"):
            raise Unresolved("the reply had no source ID")
        manifest["source_id"] = data["id"]
        manifest.save()
    print(f"Importing the recording (source {manifest['source_id']})")

    started, seen = time.time(), None
    while True:
        source = get_json(f"{INGEST}/sources/{manifest['source_id']}")["data"][
            "attributes"
        ]
        transcript = (source.get("outputs") or {}).get("transcription") or {}
        status = (source.get("status"), transcript.get("status"))
        if status != seen:
            print(
                f"  {clock(time.time() - started)}  file: {status[0]}, "
                f"transcript: {status[1] or 'waiting'}"
            )
            seen = status
        if "failed" in status:
            del manifest["source_id"]  # so the next run starts a new import
            manifest.save()
            reason = source.get("error") or "no reason given"
            if not source.get("duration"):
                reason += (
                    ". Shotstack didn't get a video from that URL: "
                    "it must return the file itself"
                )
            fail(f"the import failed ({reason}).")
        if status == ("ready", "ready"):
            break
        if time.time() - started > IMPORT_TIMEOUT:
            fail(
                f"the import is taking over {IMPORT_TIMEOUT // 60} minutes. "
                "Run the same command again to keep waiting."
            )
        time.sleep(POLL_SECONDS)

    # Every render below needs the recording's length, so check it's there first.
    if not source.get("duration"):
        fail(
            "the import has no duration, so the URL may not point to a video. "
            "Check that the URL returns the file itself."
        )
    srt = requests.get(transcript["url"], timeout=60)
    srt.raise_for_status()
    (folder / "transcript.srt").write_text(
        srt.content.decode("utf-8"), encoding="utf-8"
    )
    manifest.update(source_url=source["source"], duration=source["duration"])
    manifest.save()
    saved = folder / "transcript.srt"
    print(f"Imported {clock(source['duration'])} of video and saved {saved}")


Cue = namedtuple("Cue", "start end text")


def parse_srt(text):
    """Read an SRT file into a list of cues, with times in seconds."""

    def seconds(timestamp):
        hours, minutes, secs = timestamp.strip().replace(",", ".").split(":")
        return int(hours) * 3600 + int(minutes) * 60 + float(secs)

    cues = []
    for block in text.replace("\r\n", "\n").strip().split("\n\n"):
        lines = block.strip().split("\n")
        for i, line in enumerate(lines):
            if "-->" in line:
                start, end = line.split("-->")
                cues.append(
                    Cue(
                        seconds(start),
                        seconds(end.split()[0]),
                        " ".join(lines[i + 1 :]),
                    )
                )
                break
    return cues


# ---------------------------------------- step 2: pick the moments

MODEL = "claude-sonnet-5-5"
MAX_TOKENS = 1000
# Sonnet 5.5 can't turn thinking off. "between_tools" is its lowest setting: no
# thinking before it answers, and this request has no tools to think between.
THINKING = {"type": "between_tools"}

PROMPT = f"""\
You pick moments from a talk transcript to turn into short vertical video clips.

The transcript has one sentence per line. Each line starts with the time the
sentence begins, in minutes and seconds.

Pick the {CLIP_COUNT} best moments. A moment is a run of whole, consecutive sentences.
Every moment must:
- last {MIN_SECONDS} to {MAX_SECONDS} seconds (aim for 25 to 45)
- make sense on its own, without anything said earlier or anything shown on a slide
- not overlap any other moment

Prefer moments with a clear point, a strong opinion or a practical tip, and skip
introductions and housekeeping.

For each moment, copy the first six to ten words of its first sentence and the last
six to ten words of its last sentence exactly as they appear in the transcript, and
give it a short title of at most eight words. List the moments from best to worst."""

MOMENTS_SCHEMA = {
    "type": "object",
    "properties": {
        "moments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "first_words": {"type": "string"},
                    "last_words": {"type": "string"},
                    "title": {"type": "string"},
                },
                "required": ["first_words", "last_words", "title"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["moments"],
    "additionalProperties": False,
}


def sentences(cues):
    """Join the transcript's short subtitle lines into whole sentences, so every
    moment starts and ends on a sentence boundary."""
    result, parts, start = [], [], None
    for cue in cues:
        if start is None:
            start = cue.start
        parts.append(cue.text.strip())
        if cue.text.rstrip().endswith((".", "?", "!")):
            result.append(Cue(start, cue.end, " ".join(parts)))
            parts, start = [], None
    if parts:
        result.append(Cue(start, cues[-1].end, " ".join(parts)))
    return result


def transcript_text(lines):
    """The transcript for the prompt: one sentence per line, with its start time."""
    return "\n".join(
        f"[{int(line.start // 60)}:{int(line.start % 60):02d}] {line.text}"
        for line in lines
    )


def words(text):
    """Lowercase words without punctuation, so a quote matches however it's
    punctuated."""
    return re.findall(r"[a-z0-9]+", text.lower().replace("'", "").replace("’", ""))


def locate(quote, lines, after=0):
    """Find a quote in the transcript, from line `after` on. Returns the indexes of
    the lines where it starts and ends, or None if it isn't there."""
    target = words(quote)
    stream = [(word, i) for i, line in enumerate(lines) for word in words(line.text)]
    for k in range(len(stream) - len(target) + 1):
        if (
            target
            and stream[k][1] >= after
            and [w for w, _ in stream[k : k + len(target)]] == target
        ):
            return stream[k][1], stream[k + len(target) - 1][1]
    return None


def ask_claude(client, messages):
    """One request to Claude. Structured outputs make the reply JSON that matches
    the schema."""
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        thinking=THINKING,
        system=PROMPT,
        messages=messages,
        output_config={"format": {"type": "json_schema", "schema": MOMENTS_SCHEMA}},
    )
    if response.stop_reason != "end_turn":
        fail(
            f"Claude stopped early ({response.stop_reason}), "
            "so its reply isn't complete."
        )
    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)["moments"]


def check_picks(picks, lines, duration):
    """Find each moment's quotes in the transcript, turn them into start and end
    times, and check the rules. Returns the moments that pass, best first, and a
    list of problems."""
    moments, problems = [], []
    if len(picks) < CLIP_COUNT:
        problems.append(f"there are {len(picks)} moments, not {CLIP_COUNT}")
    for n, pick in enumerate(picks, 1):
        where = f'moment {n} ("{pick["title"]}")'
        found = locate(pick["first_words"], lines)
        if not found:
            problems.append(
                f'{where}: the transcript doesn\'t contain "{pick["first_words"]}"'
            )
            continue
        first = found[0]
        found = locate(pick["last_words"], lines, after=first)
        if not found:
            problems.append(
                f'{where}: the transcript doesn\'t contain "{pick["last_words"]}" '
                "after its first words"
            )
            continue
        last = found[1]
        start, end = lines[first].start, lines[last].end
        if not MIN_SECONDS <= end - start <= MAX_SECONDS:
            problems.append(
                f"{where}: lasts {end - start:.1f} seconds, "
                f"not {MIN_SECONDS} to {MAX_SECONDS}"
            )
            continue
        if not 0 <= start < end <= duration:
            problems.append(f"{where}: runs past the end of the recording")
            continue
        overlap = next(
            (m for m in moments if start < m["end"] and m["start"] < end), None
        )
        if overlap:
            problems.append(f'{where}: overlaps "{overlap["title"]}"')
            continue
        moments.append({"start": start, "end": end, "title": pick["title"].strip()})
    return moments[:CLIP_COUNT], problems


def pick_moments(client, lines, duration):
    """Ask Claude for moments, and ask once more if too few of them pass the checks."""
    messages = [{"role": "user", "content": transcript_text(lines)}]
    picks = ask_claude(client, messages)
    moments, problems = check_picks(picks, lines, duration)
    if len(moments) < CLIP_COUNT:
        print("Asking Claude to fix these:" + "".join(f"\n  - {p}" for p in problems))
        messages += [
            {"role": "assistant", "content": json.dumps({"moments": picks})},
            {
                "role": "user",
                "content": "Some of those moments break the rules:\n"
                + "\n".join(f"- {p}" for p in problems)
                + f"\nSend the full list of {CLIP_COUNT} moments again, "
                "with these fixed.",
            },
        ]
        picks = ask_claude(client, messages)
        moments, problems = check_picks(picks, lines, duration)
    return moments, problems


def read_moments(path, duration):
    """Read moments.json and check that every moment fits the recording."""
    try:
        moments = json.loads(path.read_text())
    except ValueError:
        moments = None
    number = (int, float)
    if not isinstance(moments, list) or not all(
        isinstance(m, dict)
        and isinstance(m.get("title"), str)
        and isinstance(m.get("start"), number)
        and isinstance(m.get("end"), number)
        and 0 <= m["start"] < m["end"] <= duration
        for m in moments
    ):
        fail(
            f"{path} must be a list of moments, each with a title and a start and end "
            "in seconds inside the recording. Fix it, or delete it to pick again."
        )
    return moments


def get_moments(lines, manifest, folder, repick):
    """Reuse moments.json while nothing that shapes the pick has changed;
    otherwise pick again.

    moments.json is the contract between the picker and the renders: a list of
    {"start", "end", "title"} with times in seconds. Edit it by hand, or write it
    with a different picker, and the renders use it as it is."""
    path = folder / "moments.json"
    picked_with = hashlib.sha256(
        json.dumps(
            [
                transcript_text(lines),
                MODEL,
                MAX_TOKENS,
                THINKING,
                PROMPT,
                MOMENTS_SCHEMA,
            ]
        ).encode()
    ).hexdigest()[:16]
    if (
        path.exists()
        and not repick
        and manifest.get("picked_with") in (None, picked_with)
    ):
        print(f"Using the moments in {path}")
        return read_moments(path, manifest["duration"])

    if not os.environ.get("ANTHROPIC_API_KEY"):
        fail("set ANTHROPIC_API_KEY so Claude can pick the moments.")
    try:
        import anthropic  # only this step needs it
    except ImportError:
        fail("install the anthropic package (pip install -r requirements.txt).")
    print(f"Asking {MODEL} for {CLIP_COUNT} moments from {len(lines)} sentences")
    try:
        moments, problems = pick_moments(
            anthropic.Anthropic(), lines, manifest["duration"]
        )
    except anthropic.AuthenticationError:
        fail("Anthropic refused the API key. Check ANTHROPIC_API_KEY.")
    except anthropic.APIConnectionError:
        fail("could not reach the Claude API. Check your network and run again.")
    except anthropic.APIError as error:
        fail(f"the Claude API returned an error: {error}")
    for problem in problems:
        print(f"  left out: {problem}")
    path.write_text(json.dumps(moments, indent=2))
    manifest["picked_with"] = picked_with
    manifest.save()
    for n, moment in enumerate(moments, 1):
        span = f"{clock(moment['start'])} to {clock(moment['end'])}"
        print(f"  {n}. {moment['title']} ({span})")
    if not moments:
        fail(
            "none of the moments passed the checks. "
            f"Change the prompt, or write {path} by hand."
        )
    if len(moments) < CLIP_COUNT:
        print(
            f"Only {len(moments)} moments passed the checks. Run with --repick to try "
            f"again, or edit {path} by hand."
        )
    return moments


# ---------------------------------------- step 3: render one clip


def cut_edit(source_url, moment):
    """Render 1: cut the moment out of the recording and fit it into a vertical
    frame."""
    return {
        "timeline": {
            "background": "#000000",
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "video",
                                "src": source_url,
                                "trim": moment["start"],
                            },
                            "start": 0,
                            "length": round(moment["end"] - moment["start"], 3),
                            "fit": "contain",
                        }
                    ]
                },
            ],
        },
        "output": {"format": "mp4", "size": {"width": 1080, "height": 1920}},
    }


# Roboto, loaded so the bold weights below apply. A loaded font can be referred
# to by its name or by its file name, and this uses the file name. Copy font URLs
# verbatim from Google Fonts: the version and file name change over time.
ROBOTO_URL = "https://fonts.gstatic.com/s/roboto/v50/KFOmCnqEu92Fr1Me5WZLCzYlKw.ttf"
ROBOTO = "KFOmCnqEu92Fr1Me5WZLCzYlKw"


def caption_edit(cut_url, title):
    """Render 2: add a title and captions generated from the cut's own audio.

    The title sits in the black band above the video. The captions come from the
    clip named "clip" through an alias. They sit in the band under the video, with
    the word being spoken in yellow."""
    return {
        "timeline": {
            "background": "#000000",
            "fonts": [{"src": ROBOTO_URL}],
            "tracks": [
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "rich-text",
                                "text": title,
                                "font": {
                                    "family": ROBOTO,
                                    "size": 76,
                                    "weight": 800,
                                    "color": "#ffffff",
                                },
                                "align": {"horizontal": "center", "vertical": "middle"},
                            },
                            "start": 0,
                            "length": "end",
                            "position": "top",
                            "offset": {"y": -0.12},
                            "width": 960,
                            "height": 360,
                        }
                    ]
                },
                {
                    "clips": [
                        {
                            "asset": {
                                "type": "rich-caption",
                                "src": "alias://clip",
                                "font": {
                                    "family": ROBOTO,
                                    "size": 64,
                                    "weight": 700,
                                    "color": "#ffffff",
                                },
                                "active": {"font": {"color": "#ffd84d"}},
                            },
                            "start": 0,
                            "length": "end",
                            "position": "bottom",
                            "offset": {"y": 0.08},
                            "width": 960,
                            "height": 400,
                        }
                    ]
                },
                {
                    "clips": [
                        {
                            "alias": "clip",
                            "asset": {"type": "video", "src": cut_url},
                            "start": 0,
                            "length": "auto",
                        }
                    ]
                },
            ],
        },
        "output": {"format": "mp4", "size": {"width": 1080, "height": 1920}},
    }


def submit(edit, label):
    """Queue one render and return a record to track it by."""
    response = post_json(f"{EDIT}/render", edit).get("response")
    render_id = response.get("id") if isinstance(response, dict) else None
    if not render_id:
        raise Unresolved("the reply had no render ID")
    print(f"  {label}: queued ({render_id})")
    return {"id": render_id, "status": "queued", "submitted": time.time()}


def finished(render, label):
    """Check a render that isn't finished yet. True once it's done."""
    if render["status"] not in ("done", "failed"):
        info = get_json(f"{EDIT}/render/{render['id']}")["response"]
        if info["status"] != render["status"]:
            took = clock(time.time() - render["submitted"])
            print(f"  {label}: {info['status']} after {took}")
        render["status"] = info["status"]
        if info["status"] == "done" and not info.get("url"):
            render["status"] = "failed"
            render["error"] = "the render is done but has no URL"
        elif info["status"] == "done":
            render["url"] = info["url"]
        elif info["status"] == "failed":
            render["error"] = info.get("error") or "no reason given"
    return render["status"] == "done"


def advance(job, moment, source_url, path, label):
    """Take one clip a step further: cut and reframe, then captions, then download."""
    if "cut" not in job:
        job["cut"] = submit(cut_edit(source_url, moment), f"{label} cut")
        return
    if not finished(job["cut"], f"{label} cut"):
        return
    if "captions" not in job:
        # Render URLs can be deleted after 24 hours, so caption each cut as soon as
        # it's ready.
        job["captions"] = submit(
            caption_edit(job["cut"]["url"], moment["title"]), f"{label} captions"
        )
        return
    if not finished(job["captions"], f"{label} captions"):
        return
    try:
        # This URL can be deleted after 24 hours too
        download(job["captions"]["url"], path)
    except requests.HTTPError as error:
        status = getattr(error.response, "status_code", None)
        if status in (403, 404, 410):
            job["error"] = f"the rendered file is gone (HTTP {status})"
            job["fix"] = (
                'Delete this clip\'s entry under "renders" in manifest.json '
                "and run again to render it again."
            )
            return
        raise
    job["file"] = str(path)
    print(f"  {label}: saved {path}")


# ---------------------------------------- step 4: render all the clips


def clip_state(job):
    if "file" in job:
        return "done"
    if "unresolved" in job:
        return "unresolved"
    if "error" in job or "failed" in (
        job.get("cut", {}).get("status"),
        job.get("captions", {}).get("status"),
    ):
        return "failed"
    return "working"


def render_clips(moments, manifest, folder):
    """Submit every clip's renders and poll until each clip is done or has failed.

    Each clip is two render requests, tracked by ID."""
    jobs = manifest.setdefault("renders", {})
    todo = []
    for n, moment in enumerate(moments, 1):
        job = jobs.setdefault(f"{moment['start']:.3f}-{moment['end']:.3f}", {})
        if clip_state(job) == "failed":  # a new run tries failed clips again
            job.pop("error", None)
            job.pop("fix", None)
            if job.get("cut", {}).get("status") == "failed":
                job.pop("cut")
                job.pop("captions", None)
            if job.get("captions", {}).get("status") == "failed":
                job.pop("captions")
        minutes, seconds = divmod(int(moment["start"]), 60)
        todo.append((n, moment, job, folder / f"clip-{minutes:02d}m{seconds:02d}s.mp4"))
    manifest.save()

    print(f"Rendering {len(todo)} clip{'' if len(todo) == 1 else 's'}")
    started = time.time()
    while True:
        for n, moment, job, path in todo:
            if clip_state(job) != "working":
                continue
            try:
                advance(job, moment, manifest["source_url"], path, f"clip {n}")
            except Unresolved as error:
                # Don't resubmit: the render may have started, and a retry could
                # duplicate it.
                job["unresolved"] = f"the submit request didn't complete ({error})"
            except (ApiError, requests.RequestException) as error:
                job["error"] = str(error)
            manifest.save()
        if all(clip_state(job) != "working" for _, _, job, _ in todo):
            return todo
        if time.time() - started > RENDER_TIMEOUT:
            fail(
                f"renders are still going after {RENDER_TIMEOUT // 60} minutes. "
                "Run the same command again to keep waiting; nothing that's "
                "already been submitted will be submitted again."
            )
        time.sleep(POLL_SECONDS)


def report(todo):
    print("\nClips:")
    for n, moment, job, path in todo:
        where = f"{clock(moment['start'])} to {clock(moment['end'])}"
        if clip_state(job) == "done":
            print(f"  {n}. {moment['title']} ({where}): {path}")
        elif clip_state(job) == "unresolved":
            print(
                f"  {n}. {moment['title']} ({where}): not sure a render started, "
                f"because {job['unresolved']}. Check your Shotstack dashboard. "
                "If nothing started, delete this clip's entry under "
                '"renders" in manifest.json and run again.'
            )
        else:
            reasons = [job.get("error")] + [
                job.get(stage, {}).get("error") for stage in ("cut", "captions")
            ]
            reason = "; ".join(r for r in reasons if r)
            fix = job.get("fix", "Run the same command again to retry it.")
            print(f"  {n}. {moment['title']} ({where}): failed ({reason}). {fix}")


def main():
    parser = argparse.ArgumentParser(
        description="Turn a long recording into short, captioned, vertical clips."
    )
    parser.add_argument("url", help="a URL that returns the recording file itself")
    parser.add_argument(
        "--limit",
        type=int,
        default=CLIP_COUNT,
        metavar="N",
        help="render only the first N moments this run",
    )
    parser.add_argument(
        "--repick",
        action="store_true",
        help="ask Claude for new moments even if moments.json is up to date",
    )
    args = parser.parse_args()

    if args.limit < 1:
        fail("--limit must be at least 1.")
    if SHOTSTACK_ENV not in ("v1", "stage"):
        fail('SHOTSTACK_ENV must be "v1" (production) or "stage" (sandbox).')
    if not HEADERS["x-api-key"]:
        fail("set SHOTSTACK_API_KEY first.")

    name = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(urlparse(args.url).path).stem)[
        :40
    ].strip("-")
    folder = (
        Path("clips")
        / f"{name or 'recording'}{'' if SHOTSTACK_ENV == 'v1' else '-sandbox'}"
    )
    folder.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(folder / "manifest.json", args.url)

    try:
        if "source_url" not in manifest:
            import_recording(args.url, manifest, folder)
        lines = sentences(
            parse_srt((folder / "transcript.srt").read_text(encoding="utf-8"))
        )
        moments = get_moments(lines, manifest, folder, args.repick)
        todo = render_clips(moments[: args.limit], manifest, folder)
    except Unresolved as error:
        fail(
            f"a request didn't complete ({error}). It may still have reached "
            "Shotstack, so check your dashboard before running this again."
        )
    except ApiError as error:
        fail(str(error))
    report(todo)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        fail("interrupted. Run the same command again to carry on.")
    except Exception as error:  # one line instead of a stack trace
        fail(f"{type(error).__name__}: {error}")
