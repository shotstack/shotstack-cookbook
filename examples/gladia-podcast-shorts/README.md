# Gladia podcast to vertical shorts

Cut a long recording into short vertical clips. The script sends one audio URL
to Gladia, reads the transcript with speaker labels and word timings, picks the
segments that say the most, and renders each one as a 1080x1920 MP4 with
captions and a speaker tag. You get the clips in `output/` and a manifest that
records where each one starts in the original recording.

The subtitles are cut from the transcript the script already has, so the render
does not transcribe again and consumes no generation credits.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your
  **production** API key
- A [Gladia account](https://app.gladia.io) and an API key
- A public link to an audio file, one to three hours long
- Node.js 20 or later

Each run transcribes the recording once and renders one video per clip.
Set `SHOTSTACK_ENV=stage` in `.env` and use your sandbox key for free
watermarked test renders.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/gladia-podcast-shorts
cp .env.example .env
```

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

Set `AUDIO_URL` to your recording. Set `KEYWORDS` to the topics you want the
clips to cover, separated by commas. Set `BACKGROUND_URL` to a public video if
you want moving footage behind the captions.

## Run

```bash
node podcast-shorts.mjs
```

## What happens

The script asks Gladia to transcribe the recording with diarization, then polls
every five seconds until the status is `done`. It builds every window of
consecutive speech up to `CLIP_SECONDS` long, scores each window by how much is
said in it, and keeps the highest scoring windows that do not overlap. For each
one it uploads a subtitle file to the Shotstack Ingest API, renders a vertical
video that trims the source audio to that window, and downloads the MP4.

Run the script again and it reuses the transcript, so only the renders repeat.
To change how many clips you get, set `CLIP_COUNT` in `.env`.
