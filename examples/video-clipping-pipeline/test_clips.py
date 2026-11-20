"""Tests for clips.py. They do not call Shotstack or an AI provider.

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
CUES = [clips.Cue(61.0, 70.0, "First words here."), clips.Cue(70.0, 91.0, "The end.")]
URL = "https://cdn.shotstack.io/au/stage/owner/render.mp4"


def http_error(status_code):
    response = requests.Response()
    response.status_code = status_code
    return requests.HTTPError(f"{status_code} for {URL}", response=response)


def quietly(function, *args):
    with contextlib.redirect_stdout(io.StringIO()):
        with contextlib.redirect_stderr(io.StringIO()):
            return function(*args)


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
        self.uploads = []
        self.downloads = []
        self.download_errors = []
        replacements = {
            "post_json": self.edit.post_json,
            "get_json": self.edit.get_json,
            "upload_text": self.upload_text,
            "download": self.download,
        }
        for name, value in replacements.items():
            patcher = mock.patch.object(clips, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        sleep = mock.patch.object(clips.time, "sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def upload_text(self, text):
        self.uploads.append(text)
        return "https://example.com/captions.srt"

    def download(self, url, path):
        if self.download_errors:
            raise self.download_errors.pop(0)
        self.downloads.append(url)
        Path(path).write_bytes(b"video")

    def run_clips(self, moment=MOMENT):
        """One run of the render step, from the manifest on disk. Returns the job."""
        manifest = clips.Manifest(self.folder / "manifest.json", RECORDING)
        todo = quietly(clips.render_clips, [moment], CUES, manifest, self.folder)
        return todo[0][2]

    def test_a_run_stopped_during_the_submit_does_not_send_it_again(self):
        self.edit.post_errors = [KeyboardInterrupt()]
        with self.assertRaises(KeyboardInterrupt):
            self.run_clips()
        self.assertEqual(clips.clip_state(self.run_clips()), "unresolved")
        self.assertEqual(self.edit.submits, [])

    def test_a_new_title_makes_the_clip_again(self):
        self.run_clips()
        self.run_clips(dict(MOMENT, title="A better title"))
        self.assertEqual(len(self.edit.submits), 2)

    def test_a_deleted_clip_file_is_downloaded_again(self):
        Path(self.run_clips()["file"]).unlink()
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 1)
        self.assertEqual(len(self.downloads), 2)

    def test_a_clip_takes_one_upload_one_render_and_one_download(self):
        job = self.run_clips()
        self.assertEqual(clips.clip_state(job), "done")
        self.assertEqual(len(self.uploads), 1)
        self.assertEqual(len(self.edit.submits), 1)
        self.assertEqual(len(self.downloads), 1)
        tracks = self.edit.submits[0]["timeline"]["tracks"]
        captions = tracks[1]["clips"][0]["asset"]
        self.assertEqual(captions["type"], "rich-caption")
        self.assertEqual(captions["src"], "https://example.com/captions.srt")

    def test_a_submit_that_did_not_complete_is_not_sent_again(self):
        self.edit.post_errors = [clips.Unresolved("ReadTimeout")]
        self.assertEqual(clips.clip_state(self.run_clips()), "unresolved")
        self.assertEqual(clips.clip_state(self.run_clips()), "unresolved")
        self.assertEqual(self.edit.submits, [])

    def test_a_refused_submit_is_sent_again_on_the_next_run(self):
        self.edit.post_errors = [clips.ApiError("429 from the Edit API")]
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 1)
        self.assertEqual(len(self.uploads), 1)  # the captions are kept

    def test_a_failed_download_does_not_render_again(self):
        self.download_errors = [requests.ConnectionError("network down")]
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 1)

    def test_a_deleted_file_is_rendered_again(self):
        self.download_errors = [http_error(404)]
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 2)
        self.assertEqual(len(self.uploads), 1)

    def test_a_failed_render_is_rendered_again(self):
        self.edit.failed = {"render-1"}
        self.assertEqual(clips.clip_state(self.run_clips()), "failed")
        self.edit.failed = set()
        self.assertEqual(clips.clip_state(self.run_clips()), "done")
        self.assertEqual(len(self.edit.submits), 2)


class ClipSrt(unittest.TestCase):
    def test_the_captions_are_timed_from_the_start_of_the_clip(self):
        cues = [
            clips.Cue(59.0, 62.0, "Before and in."),
            clips.Cue(62.0, 70.5, "Inside."),
            clips.Cue(95.0, 99.0, "After."),
        ]
        self.assertEqual(
            clips.clip_srt(cues, MOMENT),
            "1\n00:00:00,000 --> 00:00:01,000\nBefore and in.\n\n"
            "2\n00:00:01,000 --> 00:00:09,500\nInside.\n",
        )


class UploadText(unittest.TestCase):
    def test_the_file_is_sent_as_text(self):
        signed = {"data": {"id": "src-1", "attributes": {"url": "https://s3/upload"}}}
        ready = {"data": {"attributes": {"status": "ready", "source": "https://s3/f"}}}
        put = mock.Mock()
        with mock.patch.object(
            clips, "post_json", return_value=signed
        ), mock.patch.object(clips, "get_json", return_value=ready), mock.patch.object(
            clips.requests, "put", put
        ):
            self.assertEqual(
                clips.upload_text("1\n00:00:00,000 --> 00:00:01,000\nHi\n"),
                "https://s3/f",
            )
        self.assertEqual(
            put.call_args.kwargs["headers"], {"Content-Type": "text/plain"}
        )

    def test_an_upload_that_did_not_complete_is_tried_again_later(self):
        error = clips.Unresolved("ConnectionError")
        with mock.patch.object(clips, "post_json", side_effect=error):
            with self.assertRaises(clips.ApiError):
                clips.upload_text("text")


class ReadReply(unittest.TestCase):
    PICK = {"first_words": "a b", "last_words": "c d", "title": "T"}

    def test_json_in_a_code_block_is_read(self):
        reply = "```json\n" + json.dumps({"moments": [self.PICK]}) + "\n```"
        self.assertEqual(clips.read_reply(reply), [self.PICK])

    def test_a_reply_that_is_not_json_is_refused(self):
        self.assertIsNone(clips.read_reply("Here are the best moments: ..."))

    def test_a_moment_without_a_title_is_refused(self):
        reply = json.dumps({"moments": [{"first_words": "a", "last_words": "b"}]})
        self.assertIsNone(clips.read_reply(reply))


def chat_response(status_code, body):
    response = requests.Response()
    response.status_code = status_code
    response._content = json.dumps(body).encode()
    return response


def chat_reply(text):
    return chat_response(
        200, {"choices": [{"message": {"content": text}, "finish_reason": "stop"}]}
    )


class AskAi(unittest.TestCase):
    def setUp(self):
        sleep = mock.patch.object(clips.time, "sleep")
        sleep.start()
        self.addCleanup(sleep.stop)

    def ask(self, *responses):
        """Ask once, with the AI provider sending these responses in turn. Returns
        the reply text, or the ApiError message, and the mocked post."""
        with mock.patch.object(clips.requests, "post", side_effect=responses) as post:
            try:
                return clips.ask_ai([{"role": "user", "content": "hi"}]), post
            except clips.ApiError as error:
                return str(error), post

    def test_the_reply_text_is_returned(self):
        text, post = self.ask(chat_reply("{}"))
        self.assertEqual(text, "{}")
        self.assertTrue(post.call_args.args[0].endswith("/chat/completions"))

    def test_a_rate_limit_is_tried_again(self):
        limited = chat_response(429, {"error": {"message": "Rate limit"}})
        text, post = self.ask(limited, chat_reply("{}"))
        self.assertEqual(text, "{}")
        self.assertEqual(post.call_count, 2)

    def test_a_refused_key_names_the_setting(self):
        message, _ = self.ask(
            chat_response(401, {"error": {"message": "Incorrect API key"}})
        )
        self.assertIn("refused AI_API_KEY", message)
        self.assertIn("Incorrect API key", message)

    def test_a_reply_that_was_cut_off_is_an_error(self):
        body = {"choices": [{"message": {"content": "{"}, "finish_reason": "length"}]}
        message, _ = self.ask(chat_response(200, body))
        self.assertIn("cut off", message)


class PickMoments(unittest.TestCase):
    LINES = [clips.Cue(0, 10, "One two three four."), clips.Cue(10, 30, "Five six.")]
    PICK = {"first_words": "one two", "last_words": "five six", "title": "T"}

    def test_a_failed_second_request_keeps_the_first_answer(self):
        first = json.dumps({"moments": [self.PICK]})
        error = clips.ApiError("the AI provider answered 503")
        with mock.patch.object(clips, "ask_ai", side_effect=[first, error]):
            moments, _ = quietly(clips.pick_moments, self.LINES, 100)
        self.assertEqual(moments, [{"start": 0, "end": 30, "title": "T"}])


class CheckPicks(unittest.TestCase):
    """How the AI model's quotes become start and end times."""

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
            return quietly(clips.read_moments, path, 3600)

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
                quietly(clips.submit, {}, "clip 1")

    def test_an_accepted_request_with_an_unreadable_reply_is_not_sent_again(self):
        with self.assertRaises(clips.Unresolved):
            self.post(201, b"<html>gateway</html>")


if __name__ == "__main__":
    unittest.main()
