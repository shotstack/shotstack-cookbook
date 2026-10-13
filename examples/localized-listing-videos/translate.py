"""Fill in missing translations in languages.json with a language model.

The first entry in languages.json is the source language. For every other
entry with an empty script, headline or cta, this script asks Gemini to
translate the source entry and writes the result back to languages.json.
Fields that already have text are never changed, so a translation you have
reviewed stays as it is. To translate a field again, empty it and rerun.

Pass language codes to translate only those, e.g. `python3 translate.py de`.
"""

import json
import os
import sys
from pathlib import Path

import requests

MODEL = os.environ.get("GEMINI_MODEL") or "gemini-flash-latest"
API_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
)
API_KEY_NAME = "GEMINI_API_KEY"
API_KEY = os.environ.get(API_KEY_NAME)
LANGUAGES_PATH = Path(__file__).resolve().parent / "languages.json"
FIELDS = ("script", "headline", "cta")

INSTRUCTIONS = """\
Translate the copy for a narrated video from the language with code "{source}"
into the language with code "{target}".

- "script" is read aloud by a text-to-speech voice. Write it to be spoken:
  spell out numbers, prices, dates and abbreviations the way a speaker says them.
- Keep the script close to the length of the source. The video lasts as long as
  the voice-over.
- "headline" and "cta" (the call to action) appear on screen. Keep them as short
  as the source.
- Keep brand and product names as they are, unless the target language normally
  writes them in its own script, such as katakana in Japanese.
- Address the viewer politely and formally.

Return the translated "script", "headline" and "cta" as JSON.

Source copy:
"""


def read_json(path):
    """Read a JSON file, or stop with one line that names the file."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as err:
        raise RuntimeError(f"{path.name} is not valid JSON: {err}") from None


def read_languages(path):
    """Read languages.json and check that each entry has a language code."""
    languages = read_json(path)
    if not isinstance(languages, list) or not languages:
        raise RuntimeError(f"{path.name} must be a list with at least one language.")
    for number, language in enumerate(languages, start=1):
        if not isinstance(language, dict) or not language.get("code"):
            raise RuntimeError(f"Entry {number} in {path.name} has no code.")
    codes = [language["code"] for language in languages]
    repeated = sorted({code for code in codes if codes.count(code) > 1})
    if repeated:
        raise RuntimeError(
            f"Codes used more than once in {path.name}: {', '.join(repeated)}"
        )
    return languages


def filled(language, field):
    """True if the field has text. render.py uses the same test."""
    return bool(str(language.get(field) or "").strip())


def translate(source, target_code):
    """Translate the source entry's script, headline and cta into one language."""
    prompt = INSTRUCTIONS.format(source=source["code"], target=target_code)
    copy = {field: source[field] for field in FIELDS}
    prompt += json.dumps(copy, ensure_ascii=False, indent=2)
    resp = requests.post(
        API_URL,
        headers={"x-goog-api-key": API_KEY},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {field: {"type": "STRING"} for field in FIELDS},
                    "required": list(FIELDS),
                },
            },
        },
        timeout=60,
    )
    if not resp.ok:
        try:
            detail = resp.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            detail = resp.text.strip()[:200]
        raise RuntimeError(
            f"[{target_code}] translation failed ({resp.status_code}): {detail}"
        )
    try:
        body = resp.json()
        parts = body["candidates"][0]["content"]["parts"]
        text = "".join(
            part.get("text", "") for part in parts if not part.get("thought")
        )
        result = json.loads(text)
        if not all(filled(result, field) for field in FIELDS):
            raise ValueError("empty field")
        return {field: result[field].strip() for field in FIELDS}
    except Exception:
        # A blocked prompt has no candidates. A cut-off reply is not valid JSON.
        raise RuntimeError(
            f"[{target_code}] Gemini returned no usable translation "
            f"({finish_reason(resp)}). Run the script again. If it fails again, "
            "change the source text."
        ) from None


def finish_reason(resp):
    """Return why Gemini gave no usable reply, such as SAFETY or MAX_TOKENS."""
    try:
        body = resp.json()
        feedback = body.get("promptFeedback") or {}
        return feedback.get("blockReason") or body["candidates"][0]["finishReason"]
    except Exception:
        return "unknown reason"


def main():
    if not API_KEY:
        raise RuntimeError(f"Set the {API_KEY_NAME} environment variable first.")
    languages = read_languages(LANGUAGES_PATH)
    source, targets = languages[0], languages[1:]
    if not all(filled(source, field) for field in FIELDS):
        raise RuntimeError(
            f"The first entry ({source['code']}) needs a script, headline and cta."
        )
    only = set(sys.argv[1:])
    unknown = only - {language["code"] for language in targets}
    if unknown:
        raise RuntimeError(
            f"Not a translation target in languages.json: {', '.join(sorted(unknown))}"
        )

    for language in targets:
        code = language["code"]
        if only and code not in only:
            continue
        missing = [field for field in FIELDS if not filled(language, field)]
        if not missing:
            print(f"[{code}] already translated, skipping")
            continue
        translated = translate(source, code)
        for field in missing:
            language[field] = translated[field]
        # Save after each language, so a later failure keeps the earlier results.
        text = json.dumps(languages, indent=2, ensure_ascii=False) + "\n"
        LANGUAGES_PATH.write_text(text, encoding="utf-8")
        print(f"[{code}] translated {', '.join(missing)}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(1) from None
    except requests.ConnectionError:
        print(
            "Could not reach Gemini. Check your network connection "
            "and run the script again.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
