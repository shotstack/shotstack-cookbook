# Localized listing videos

Render one property listing video in English, Spanish, German and Japanese
from one saved template. Use it for listings that you sell to buyers in other
countries. Each language gets its own AI voice-over, captions,
headline and call to action. You get one MP4 file for each language in
`output/`.

Related guide: [Video localization API: render one template in multiple languages](https://shotstack.io/learn/video-localization-api/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your
  **production** API key
- Python 3.8 or later, with `requests` 2.18 or later
- A video that is longer than your longest voice-over, as a file or at a
  public URL
- Optional: a [Gemini API key](https://aistudio.google.com/apikey) for
  `translate.py`

The scripts use the production API. Each render generates a voice-over and
captions, and uses credits.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/localized-listing-videos
python3 -m pip install requests
cp .env.example .env
```

Set `SHOTSTACK_API_KEY` in `.env`. Then load the file. Do this in each new
terminal, and each time you change `.env`:

```bash
set -a
source .env
set +a
```

If your video is a file on your computer, upload it. The script prints the
URL of the uploaded video:

```bash
python3 upload_footage.py path/to/footage.mp4
```

In `template.json`, replace `PASTE_FOOTAGE_URL_HERE` with the URL of your
video. Then save the template to your account:

```bash
python3 save_template.py
```

Set `SHOTSTACK_TEMPLATE_ID` in `.env` to the ID that the script prints. Then
load `.env` again.

## Run

Render Japanese first to test the setup. Then render the other languages:

```bash
python3 render.py ja
python3 render.py
```

To translate with a language model, use `translate.py`. It reads the first
entry in `languages.json` as the source language. For each other language,
keep `code`, `model` and `voice`. Make `script`, `headline` and `cta` empty.

Set `GEMINI_API_KEY` in `.env`. Load `.env` again. Then run:

```bash
python3 translate.py
python3 render.py
```

`translate.py` fills only empty fields. Ask a speaker of each language to read
the translations before you render them.

## What happens

`render.py` starts one render for each language in `languages.json`. Then it
prints the status of each render until it is done. It saves each video as
`output/<code>.mp4`.

The script writes each render ID to `output/renders.json`. When you run it
again, it skips the videos that are done and not changed. It continues the
renders that did not finish. It starts new renders for new, changed or failed
languages.

Sometimes Shotstack does not answer a render request in time. The script then
names the language. The render can still start. If you run the script again,
that language renders again and uses credits again.

If you save the template again, the template gets a new ID. Then all the
languages render again.

The template loads the Noto Sans JP font from the Noto CJK repository. This
font shows Japanese and the accented letters of Spanish and German.
