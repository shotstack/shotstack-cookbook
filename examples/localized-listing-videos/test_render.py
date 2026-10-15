"""Tests for the resume logic of render.py. They do not call Shotstack.

Run them from this directory: python3 -m unittest
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

import render

LANGUAGE = {
    "code": "ja",
    "model": "elevenlabs-multilingual-v2",
    "voice": "Rachel",
    "script": "script",
    "headline": "headline",
    "cta": "cta",
}
URL = "https://cdn.shotstack.io/au/v1/render/ja.mp4"


def http_error(status_code):
    """Return the error that requests raises for a response with this status.

    None makes an error with no response, as a broken connection can raise.
    """
    if status_code is None:
        return requests.HTTPError(f"no response for {URL}")
    response = requests.Response()
    response.status_code = status_code
    return requests.HTTPError(f"{status_code} for {URL}", response=response)


def download_stub(errors):
    """Fail the first downloads with the given errors, then save the video."""

    def download(url, path):
        if errors:
            raise errors.pop(0)
        path.write_bytes(b"video")

    return mock.Mock(side_effect=download)


class ResumeAfterDownloadFailure(unittest.TestCase):
    """A render that is done must not be paid for twice."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output_dir = Path(temp.name)
        self.submit = mock.Mock(side_effect=["render-1", "render-2"])
        replacements = {
            "API_KEY": "test-key",
            "TEMPLATE_ID": "test-template",
            "OUTPUT_DIR": self.output_dir,
            "LOG_PATH": self.output_dir / "renders.json",
            "read_languages": lambda path: [dict(LANGUAGE)],
            "submit": self.submit,
            "get_render": lambda render_id: {"status": "done", "url": URL},
        }
        for name, value in replacements.items():
            patcher = mock.patch.object(render, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        argv = mock.patch.object(sys, "argv", ["render.py"])
        argv.start()
        self.addCleanup(argv.stop)

    def run_main(self):
        """Run main() and return its exit message, or None if it finished."""
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                render.main()
            except SystemExit as stop:
                return str(stop)
        return None

    def read_log(self):
        return json.loads((self.output_dir / "renders.json").read_text("utf-8"))

    def assert_download_is_retried(self, status_code):
        download = download_stub([http_error(status_code)])
        with mock.patch.object(render, "download", download):
            first = self.run_main()
            log_after_failure = self.read_log()
            second = self.run_main()

        self.assertIn("Not rendered: ja", first)
        self.assertEqual(log_after_failure["ja"]["render_id"], "render-1")
        self.assertEqual(log_after_failure["ja"]["status"], "failed")
        self.assertIsNone(second)
        self.assertEqual(self.submit.call_count, 1)
        video = self.output_dir / "ja.mp4"
        self.assertEqual(download.call_args_list, [mock.call(URL, video)] * 2)
        self.assertTrue(video.exists())
        self.assertEqual(
            self.read_log()["ja"],
            {
                "render_id": "render-1",
                "fingerprint": render.fingerprint(LANGUAGE),
                "status": "done",
            },
        )

    def test_rate_limited_download_keeps_the_render(self):
        self.assert_download_is_retried(429)

    def test_server_error_keeps_the_render(self):
        self.assert_download_is_retried(503)

    def test_request_timeout_keeps_the_render(self):
        self.assert_download_is_retried(408)

    def test_error_without_response_keeps_the_render(self):
        self.assert_download_is_retried(None)

    def test_expired_url_starts_a_new_render(self):
        download = download_stub([http_error(404)])
        with mock.patch.object(render, "download", download):
            first = self.run_main()
            self.assertNotIn("ja", self.read_log())
            second = self.run_main()

        self.assertIn("Not rendered: ja", first)
        self.assertIsNone(second)
        self.assertEqual(self.submit.call_count, 2)
        self.assertEqual(self.read_log()["ja"]["render_id"], "render-2")


if __name__ == "__main__":
    unittest.main()
