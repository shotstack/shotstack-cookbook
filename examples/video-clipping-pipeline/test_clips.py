"""Tests for the resume logic of clips.py. They do not call Shotstack or Claude.

Run them from this directory: python3 -m unittest
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

import clips

RECORDING = "https://example.com/talk.mp4"
MOMENT = {"start": 61.0, "end": 91.0, "title": "A moment"}
URL = "https://cdn.shotstack.io/au/stage/owner/render.mp4"


def http_error(status_code):
    response = requests.Response()
    response.status_code = status_code
    return requests.HTTPError(f"{status_code} for {URL}", response=response)


class FakeEdit:
    """Stands in for the Edit API. Every render it accepts is done at once,
    unless its ID is in `failed`."""

    def __init__(self):
        self.submits = []
        self.post_errors = []
        self.failed = set()

    def post_json(self, url, body):
        if self.post_errors:
            raise self.post_errors.pop(0)
        self.submits.append(body)
        return {"response": {"id": f"render-{len(self.submits)}"}}

    def get_json(self, url):
        render_id = url.rsplit("/", 1)[-1]
        if render_id in self.failed:
            return {"response": {"status": "failed", "error": "test failure"}}
        return {"response": {"status": "done", "url": URL}}


class Resume(unittest.TestCase):
    """A run that stops part way must not pay for a render twice."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        manifest = clips.Manifest(self.folder / "manifest.json", RECORDING)
        manifest.update(source_url=RECORDING, duration=3600)
        manifest.save()
        self.edit = FakeEdit()
        self.downloads = []
        self.download_errors = []
        replacements = {
            "post_json": self.edit.post_json,
            "get_json": self.edit.get_json,
            "download": self.download,
        }
        for name, value in replacements.items():
            patcher = mock.patch.object(clips, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        sleep = mock.patch.object(clips.time, "sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def download(self, url, path):
        if self.download_errors:
            raise self.download_errors.pop(0)
        self.downloads.append(url)
        Path(path).write_bytes(b"video")

    def run_clips(self):
        """One run of the render step, from the manifest on disk. Returns the job."""
        manifest = clips.Manifest(self.folder / "manifest.json", RECORDING)
        with contextlib.redirect_stdout(io.StringIO()):
            todo = clips.render_clips([MOMENT], manifest, self.folder)
        return todo[0][2]

    def test_a_clip_takes_two_renders_and_one_download(self):
        job = self.run_clips()
        self.assertEqual(clips.clip_state(job), "done")
        self.assertEqual(len(self.edit.submits), 2)
        self.assertEqual(len(self.downloads), 1)

    def test_a_submit_that_did_not_complete_is_not_sent_again(self):
        self.edit.post_errors = [clips.Unresolved("ReadTimeout")]
        self.assertEqual(clips.clip_state(self.run_clips()), "unresolved")
        self.assertEqual(clips.clip_state(self.run_clips()), "unresolved")
        self.assertEqual(self.edit.submits, [])

    def test_a_refused_submit_is_sent_again_on_the_next_run(self):
        self.edit.post_errors = [clips.ApiError("429 from the Edit API")]
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 2)

    def test_a_failed_download_does_not_render_again(self):
        self.download_errors = [requests.ConnectionError("network down")]
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 2)

    def test_a_deleted_file_renders_the_captions_again(self):
        self.download_errors = [http_error(404)]
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        # cut, captions, captions again: the cut is new enough to use again
        self.assertEqual(len(self.edit.submits), 3)
        self.assertIn("fonts", self.edit.submits[2]["timeline"])

    def test_an_old_cut_is_rendered_again_before_its_captions(self):
        self.download_errors = [http_error(404)]
        self.run_clips()
        manifest = clips.Manifest(self.folder / "manifest.json", RECORDING)
        for job in manifest["renders"].values():
            job["cut"]["submitted"] -= clips.CUT_MAX_AGE + 1
        manifest.save()
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 4)
        self.assertNotIn("fonts", self.edit.submits[2]["timeline"])

    def test_a_failed_captions_render_redoes_only_the_captions(self):
        self.edit.failed = {"render-2"}
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.edit.failed = set()
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        # The third render is the captions again (it loads the font), not a new cut
        self.assertEqual(len(self.edit.submits), 3)
        self.assertIn("fonts", self.edit.submits[2]["timeline"])


class CheckPicks(unittest.TestCase):
    """How Claude's quotes become start and end times."""

    def test_a_repeated_phrase_uses_the_shortest_span(self):
        lines = [
            clips.Cue(0, 10, "So the next thing is setup."),
            clips.Cue(10, 300, "Then a long part."),
            clips.Cue(300, 310, "So the next thing is testing."),
            clips.Cue(310, 330, "And that is why tests matter."),
        ]
        pick = {
            "first_words": "So the next thing is",
            "last_words": "why tests matter",
            "title": "Tests",
        }
        moments, _ = clips.check_picks([pick], lines, 400)
        self.assertEqual(moments, [{"start": 300, "end": 330, "title": "Tests"}])

    def test_accented_words_match(self):
        lines = [clips.Cue(0, 20, "Über die Prüfung."), clips.Cue(20, 40, "Schön.")]
        pick = {"first_words": "über die", "last_words": "schön", "title": "Prüfung"}
        moments, _ = clips.check_picks([pick], lines, 100)
        self.assertEqual(len(moments), 1)


class ReadMoments(unittest.TestCase):
    """A moments.json written by hand."""

    def read(self, moments):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "moments.json"
            path.write_text(json.dumps(moments))
            with contextlib.redirect_stderr(io.StringIO()):
                return clips.read_moments(path, 3600)

    def test_overlapping_moments_are_refused(self):
        with self.assertRaises(SystemExit):
            self.read(
                [
                    {"start": 10, "end": 40, "title": "a"},
                    {"start": 30, "end": 60, "title": "b"},
                ]
            )

    def test_an_empty_list_is_refused(self):
        with self.assertRaises(SystemExit):
            self.read([])


class PostJson(unittest.TestCase):
    """How a submit request is classified."""

    def post(self, status_code, body=b"{}"):
        response = requests.Response()
        response.status_code = status_code
        response._content = body
        response.url = "https://api.shotstack.io/edit/stage/render"
        with mock.patch.object(clips.requests, "post", return_value=response):
            return clips.post_json(response.url, {})

    def test_a_server_error_is_not_sent_again(self):
        with self.assertRaises(clips.Unresolved):
            self.post(502)

    def test_a_network_error_is_not_sent_again(self):
        error = requests.ConnectionError("network down")
        with mock.patch.object(clips.requests, "post", side_effect=error):
            with self.assertRaises(clips.Unresolved):
                clips.post_json("https://api.shotstack.io/edit/stage/render", {})

    def test_a_refusal_names_the_reason(self):
        body = b'{"message": "Bad Request", "response": {"error": "bad trim"}}'
        with self.assertRaises(clips.ApiError) as raised:
            self.post(400, body)
        self.assertIn("bad trim", str(raised.exception))

    def test_a_reply_with_no_render_id_is_not_sent_again(self):
        with mock.patch.object(clips, "post_json", return_value={"response": {}}):
            with self.assertRaises(clips.Unresolved):
                clips.submit({}, "clip 1")


if __name__ == "__main__":
    unittest.main()
