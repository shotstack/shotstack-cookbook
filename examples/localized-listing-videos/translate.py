"""Fill in missing translations in languages.json with a language model.

The first entry in languages.json is the source language. For every other
entry with an empty script, headline or cta, this script asks Gemini to
translate the source entry and writes the result back to languages.json.
Fields that already have text are never changed, so a translation you have
reviewed stays as it is. To translate a field again, empty it and rerun.

Pass language codes to translate only those, e.g. `python translate.py de`.
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
    parts = resp.json()["candidates"][0]["content"]["parts"]
    text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
    result = json.loads(text)
    return {field: result[field].strip() for field in FIELDS}


def main():
    if not API_KEY:
        raise RuntimeError(f"Set the {API_KEY_NAME} environment variable first.")
    languages = json.loads(LANGUAGES_PATH.read_text(encoding="utf-8"))
    source, targets = languages[0], languages[1:]
    if not all(source.get(field) for field in FIELDS):
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
        missing = [field for field in FIELDS if not language.get(field)]
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
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
