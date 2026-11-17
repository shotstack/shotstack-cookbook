# Video clipping pipeline

Turn a long recording into five short vertical clips with captions. Shotstack
imports the recording and makes a transcript. Claude picks the best moments.
Shotstack cuts each moment and adds a title and captions. You get the MP4
files in `clips/<name>/`.

Related guide: [Build a video clipping pipeline with the Shotstack API](https://shotstack.io/learn/video-clipping-api-pipeline/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your
  **production** API key
- An [Anthropic API key](https://platform.claude.com/settings/keys). Claude
  picks the moments.
- Python 3.9 or later
- A public URL that gives the video file, not a web page

Each clip uses two renders. Production renders use credits. Rates are on the
[pricing page](https://shotstack.io/pricing/). Set `SHOTSTACK_ENV=stage` in
`.env` and use your sandbox key for free watermarked test renders.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/video-clipping-pipeline
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Set `SHOTSTACK_API_KEY` and `ANTHROPIC_API_KEY` in `.env`. Then load the file.
Do this in each new terminal, and each time you change `.env`:

```bash
set -a
source .env
set +a
```

## Run

Render the first clip only, to examine the result:

```bash
python clips.py "https://ftp.fau.de/fosdem/2025/k1105/fosdem-2025-5235-beyond-the-readme-crafting-a-better-developer-experience-for-open-source-projects.mp4" --limit 1
```

Then run the same command without `--limit 1` to render all the clips. To use
your own recording, replace the URL.

## What happens

The script imports the recording with the Ingest API and waits for the
transcript. Then it sends the transcript to Claude, one sentence on each line.
Claude gives the first and last words of five moments. The script finds these
words in the transcript. It makes sure that each moment is 15 to 60 seconds
long and does not overlap another moment. It asks Claude one more time to fix
the moments that fail. It saves the moments in `moments.json`.

Each clip uses two renders. The first render cuts the moment and puts it in a
1080x1920 frame. The second render adds the title and captions from the audio
of the cut. The script downloads each clip to `clip-MMmSSs.mp4`, named by its
start time in the recording.

With the demo recording, which is 52 minutes long, the import takes about 4
minutes. Each clip takes 2 to 4 minutes, and the clips render at the same time.

The script saves its progress in `manifest.json`. Run the same command again
to continue after a stop. It does not import the recording or pick the
moments again. To pick new moments, add `--repick`. To choose the moments
yourself, edit `moments.json`.

If a render request does not complete, the render can start anyway. The
script does not send that request again. It tells you to look in your
Shotstack dashboard. If no render started, delete the entry for that clip
under `"renders"` in `manifest.json`. Then run the command again.

The demo recording is "Beyond the README: Crafting a Better Developer
Experience for Open Source Projects" by Lorna Mitchell, FOSDEM 2025, licensed
CC BY 2.0 BE.
