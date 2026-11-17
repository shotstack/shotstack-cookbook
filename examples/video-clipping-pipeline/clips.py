#!/usr/bin/env python3
"""Turn a long recording into short, vertical, captioned clips with the Shotstack API.

    python clips.py RECORDING_URL [--limit N] [--repick]

Step 1 imports the recording with Shotstack's Ingest API and gets its transcript.
Step 2 asks an AI model to pick the best moments and saves them to moments.json.
Step 3 renders each moment once: it cuts the moment out of the recording, fits it
into a vertical frame, and adds a title and captions made from the transcript.
Step 4 does that for every moment and downloads the finished clips.

Everything for one recording goes in clips/<name>/. Progress is saved to
manifest.json in that folder after every step, so running the same command again
picks up where the last run stopped instead of repeating work.

Environment variables:
    SHOTSTACK_API_KEY   your Shotstack API key
    SHOTSTACK_ENV       "v1" for production (the default) or "stage" for the sandbox
    AI_BASE_URL         the OpenAI-compatible API of your AI provider
    AI_API_KEY          your API key for that provider
    AI_MODEL            the model that picks the moments
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
AI_BASE_URL = os.environ.get("AI_BASE_URL", "").rstrip("/")
AI_API_KEY = os.environ.get("AI_API_KEY", "")
AI_MODEL = os.environ.get("AI_MODEL", "")

CLIP_COUNT = 5
MIN_SECONDS, MAX_SECONDS = 15, 60

POLL_SECONDS = 10
UPLOAD_POLL_SECONDS = 2
IMPORT_TIMEOUT = 60 * 60  # stop waiting for the import and transcript after an hour
RENDER_TIMEOUT = 60 * 60  # and for the renders
UPLOAD_TIMEOUT = 2 * 60  # and for a caption file to be ready
AI_TIMEOUT = 5 * 60  # one request to the AI model


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
    """The reason in an error body. Shotstack's Ingest API sends errors[0].detail,
    its Edit API sends response.error or message, and OpenAI-compatible APIs send
    error.message."""
    if isinstance(body, list) and body:
        body = body[0]
    if not isinstance(body, dict):
        return ""
    errors = body.get("errors")
    first = errors[0] if isinstance(errors, list) and errors else None
    response = body.get("response")
    error = body.get("error")
    for value in (
        first.get("detail") if isinstance(first, dict) else None,
        response.get("error") if isinstance(response, dict) else None,
        error.get("message") if isinstance(error, dict) else error,
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


def upload_text(text):
    """Upload a small text file with the Ingest API and return its URL. An upload
    doesn't cost anything, so a failed one is sent again on the next run."""
    try:
        data = post_json(f"{INGEST}/upload", {}).get("data")
    except Unresolved as error:
        raise ApiError(f"the upload request didn't complete ({error})") from error
    attributes = data.get("attributes") if isinstance(data, dict) else None
    if not isinstance(attributes, dict) or not attributes.get("url"):
        raise ApiError("the upload reply had no upload URL")
    # The upload URL has no file name, so the content type tells Shotstack the type.
    requests.put(
        attributes["url"],
        data=text.encode("utf-8"),
        headers={"Content-Type": "text/plain"},
        timeout=60,
    ).raise_for_status()
    started = time.time()
    while time.time() - started < UPLOAD_TIMEOUT:
        source = get_json(f"{INGEST}/sources/{data['id']}")["data"]["attributes"]
        if source.get("status") == "ready":
            return source["source"]
        if source.get("status") == "failed":
            reason = source.get("error") or "no reason given"
            raise ApiError(f"Shotstack couldn't read the caption file ({reason})")
        time.sleep(UPLOAD_POLL_SECONDS)
    raise ApiError(
        f"the caption file wasn't ready after {UPLOAD_TIMEOUT // 60} minutes"
    )


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
give it a short title of at most eight words. List the moments from best to worst.

Reply with JSON only, in this form:
{{"moments": [{{"first_words": "...", "last_words": "...", "title": "..."}}]}}"""


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
    return "\n".join(f"[{clock(line.start)}] {line.text}" for line in lines)


def words(text):
    """Lowercase words without punctuation, so a quote matches however it's
    punctuated."""
    return re.findall(r"[^\W_]+", text.lower().replace("'", "").replace("’", ""))


def find(target, stream, after=0):
    """Yield (first line, last line) for each place the words in `target` occur in
    the transcript's (word, line) stream, from line `after` on."""
    for k in range(len(stream) - len(target) + 1):
        if (
            target
            and stream[k][1] >= after
            and [w for w, _ in stream[k : k + len(target)]] == target
        ):
            yield stream[k][1], stream[k + len(target) - 1][1]


def ask_ai(messages):
    """One request to the AI model through the OpenAI-compatible chat API, which
    OpenAI, Anthropic, Google Gemini and many other providers offer. Returns the
    text of the reply."""
    url = f"{AI_BASE_URL}/chat/completions"
    try:
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {AI_API_KEY}"},
            json={"model": AI_MODEL, "messages": messages},
            timeout=AI_TIMEOUT,
        )
    except requests.RequestException as error:
        fail(
            f"could not reach {url} ({type(error).__name__}). "
            "Check AI_BASE_URL and your network."
        )
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code in (401, 403):
        fail(
            f"the AI provider refused AI_API_KEY ({response.status_code} "
            f"{error_detail(body)})."
        )
    if response.status_code >= 400:
        reason = error_detail(body) or response.reason
        fail(
            f"the AI provider answered {response.status_code} ({reason}). "
            "Check AI_BASE_URL and AI_MODEL."
        )
    try:
        choice = body["choices"][0]
        text = choice["message"]["content"]
    except (TypeError, KeyError, IndexError):
        fail(f"{url} didn't send a chat reply. Check AI_BASE_URL.")
    if choice.get("finish_reason") == "length":
        fail("the AI model's reply was cut off. Try another AI_MODEL.")
    return text or ""


def read_reply(reply):
    """The moments in the AI model's reply, or None if it isn't the JSON asked for.
    Some models put the JSON in a code block, so this reads from the first { to the
    last }."""
    try:
        picks = json.loads(reply[reply.find("{") : reply.rfind("}") + 1])["moments"]
    except (ValueError, KeyError, TypeError):
        return None
    fields = ("first_words", "last_words", "title")
    if not isinstance(picks, list) or not all(
        isinstance(p, dict) and all(isinstance(p.get(f), str) for f in fields)
        for p in picks
    ):
        return None
    return picks


def check_picks(picks, lines, duration):
    """Find each moment's quotes in the transcript, turn them into start and end
    times, and check the rules. Returns the moments that pass, best first, and a
    list of problems."""
    stream = [(word, i) for i, line in enumerate(lines) for word in words(line.text)]
    moments, problems = [], []
    if len(picks) < CLIP_COUNT:
        problems.append(f"there are {len(picks)} moments, not {CLIP_COUNT}")
    for n, pick in enumerate(picks, 1):
        where = f'moment {n} ("{pick["title"]}")'
        starts = [first for first, _ in find(words(pick["first_words"]), stream)]
        if not starts:
            problems.append(
                f'{where}: the transcript doesn\'t contain "{pick["first_words"]}"'
            )
            continue
        # The first words can occur more than once. Pair each place with the next
        # place the last words occur, and keep the shortest span.
        spans = []
        for first in starts:
            found = next(find(words(pick["last_words"]), stream, after=first), None)
            if found:
                spans.append((lines[first].start, lines[found[1]].end))
        if not spans:
            problems.append(
                f'{where}: the transcript doesn\'t contain "{pick["last_words"]}" '
                "after its first words"
            )
            continue
        start, end = min(spans, key=lambda span: span[1] - span[0])
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


def check_reply(reply, lines, duration):
    picks = read_reply(reply)
    if picks is None:
        return [], ["the reply isn't the JSON that was asked for"]
    return check_picks(picks, lines, duration)


def pick_moments(lines, duration):
    """Ask the AI model for moments, and ask once more if too few of them pass the
    checks."""
    messages = [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": transcript_text(lines)},
    ]
    reply = ask_ai(messages)
    moments, problems = check_reply(reply, lines, duration)
    if len(moments) < CLIP_COUNT:
        print(
            "Asking the AI model to fix these:"
            + "".join(f"\n  - {p}" for p in problems)
        )
        messages += [
            {"role": "assistant", "content": reply},
            {
                "role": "user",
                "content": "Some of those moments break the rules:\n"
                + "\n".join(f"- {p}" for p in problems)
                + f"\nSend the full list of {CLIP_COUNT} moments again, "
                "with these fixed, as JSON only.",
            },
        ]
        retried = check_reply(ask_ai(messages), lines, duration)
        if len(retried[0]) > len(moments):  # keep the first answer if it was better
            moments, problems = retried
    return moments, problems


def read_moments(path, duration):
    """Read moments.json and check that the moments fit the recording and don't
    overlap."""
    try:
        moments = json.loads(path.read_text())
    except ValueError:
        moments = None
    number = (int, float)
    valid = (
        isinstance(moments, list)
        and len(moments) > 0
        and all(
            isinstance(m, dict)
            and isinstance(m.get("title"), str)
            and isinstance(m.get("start"), number)
            and isinstance(m.get("end"), number)
            and 0 <= m["start"] < m["end"] <= duration
            for m in moments
        )
    )
    if valid:
        spans = sorted((m["start"], m["end"]) for m in moments)
        valid = all(a[1] <= b[0] for a, b in zip(spans, spans[1:]))
    if not valid:
        fail(
            f"{path} must be a list of moments that don't overlap, each with a title "
            "and a start and end in seconds inside the recording. Fix it, or delete "
            "it to pick again."
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
        json.dumps([transcript_text(lines), AI_BASE_URL, AI_MODEL, PROMPT]).encode()
    ).hexdigest()[:16]
    if (
        path.exists()
        and not repick
        and manifest.get("picked_with") in (None, picked_with)
    ):
        print(f"Using the moments in {path}")
        return read_moments(path, manifest["duration"])

    if not (AI_BASE_URL and AI_API_KEY and AI_MODEL):
        fail(
            "set AI_BASE_URL, AI_API_KEY and AI_MODEL so an AI model can pick the "
            "moments. The README gives the values for common providers."
        )
    print(f"Asking {AI_MODEL} for {CLIP_COUNT} moments from {len(lines)} sentences")
    moments, problems = pick_moments(lines, manifest["duration"])
    for problem in problems:
        print(f"  left out: {problem}")
    if not moments:
        fail(
            "none of the moments passed the checks. Run again to ask again, "
            f"or write {path} by hand."
        )
    path.write_text(json.dumps(moments, indent=2))
    manifest["picked_with"] = picked_with
    manifest.save()
    for n, moment in enumerate(moments, 1):
        span = f"{clock(moment['start'])} to {clock(moment['end'])}"
        print(f"  {n}. {moment['title']} ({span})")
    if len(moments) < CLIP_COUNT:
        print(
            f"Only {len(moments)} moments passed the checks. Run with --repick to try "
            f"again, or edit {path} by hand."
        )
    return moments


# ---------------------------------------- step 3: render one clip


def clip_srt(cues, moment):
    """The transcript's cues inside one moment, as an SRT file timed from the start
    of the clip. The captions come from this file, so nothing is transcribed again."""

    def stamp(seconds):
        """62.5 -> '00:01:02,500'"""
        minutes, ms = divmod(round(seconds * 1000), 60000)
        return (
            f"{minutes // 60:02d}:{minutes % 60:02d}:{ms // 1000:02d},{ms % 1000:03d}"
        )

    inside = [c for c in cues if c.end > moment["start"] and c.start < moment["end"]]
    return "\n".join(
        f"{n}\n{stamp(max(c.start - moment['start'], 0))} --> "
        f"{stamp(min(c.end, moment['end']) - moment['start'])}\n{c.text}\n"
        for n, c in enumerate(inside, 1)
    )


# Roboto, a variable font, loaded so the bold weights below apply. A loaded font
# can be referred to by its name or by its file name, and this uses the file name.
# Copy font URLs verbatim from Google Fonts: the version and file name change.
ROBOTO_URL = "https://fonts.gstatic.com/s/roboto/v50/KFOmCnqEu92Fr1Me5WZLCzYlKw.ttf"
ROBOTO = "KFOmCnqEu92Fr1Me5WZLCzYlKw"


def clip_edit(source_url, moment, captions_url):
    """The one render for one clip. It cuts the moment out of the recording and fits
    it into a vertical frame. The title sits in the black band above the video, and
    the captions sit in the band under it, with the word being spoken in yellow."""
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
                                "text": moment["title"],
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
                                "src": captions_url,
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


def advance(job, moment, source_url, cues, path, label):
    """Take one clip a step further: upload its captions and render it, then
    download it."""
    if "render" not in job:
        if "captions" not in job:
            srt = clip_srt(cues, moment)
            if not srt:
                fail(f"{label} has no words in the transcript. Edit moments.json.")
            job["captions"] = upload_text(srt)
        job["render"] = submit(clip_edit(source_url, moment, job["captions"]), label)
        return
    if not finished(job["render"], label):
        return
    try:
        # Render URLs can be deleted after 24 hours, so each clip is downloaded as
        # soon as it's done.
        download(job["render"]["url"], path)
    except requests.HTTPError as error:
        status = getattr(error.response, "status_code", None)
        if status in (403, 404, 410):
            del job["render"]  # the file is gone, so the next run renders it again
            job["error"] = f"the rendered file is gone (HTTP {status})"
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
    if "error" in job or job.get("render", {}).get("status") == "failed":
        return "failed"
    return "working"


def render_clips(moments, cues, manifest, folder):
    """Submit every clip's render and poll until each clip is done or has failed.

    Each clip is one render request, tracked by ID."""
    jobs = manifest.setdefault("renders", {})
    todo = []
    for n, moment in enumerate(moments, 1):
        job = jobs.setdefault(f"{moment['start']:.3f}-{moment['end']:.3f}", {})
        if clip_state(job) == "failed":  # a new run tries failed clips again
            job.pop("error", None)
            if job.get("render", {}).get("status") == "failed":
                del job["render"]
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
                advance(job, moment, manifest["source_url"], cues, path, f"clip {n}")
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
            reasons = [job.get("error"), job.get("render", {}).get("error")]
            reason = "; ".join(r for r in reasons if r)
            print(
                f"  {n}. {moment['title']} ({where}): failed ({reason}). "
                "Run the same command again to retry it."
            )


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
        help="ask the AI model for new moments even if moments.json is up to date",
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
        cues = parse_srt((folder / "transcript.srt").read_text(encoding="utf-8"))
        moments = get_moments(sentences(cues), manifest, folder, args.repick)
        todo = render_clips(moments[: args.limit], cues, manifest, folder)
    except Unresolved as error:
        fail(
            f"a request didn't complete ({error}). Check your network. The request "
            "may still have reached Shotstack, so look in your dashboard before you "
            "run this again."
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
