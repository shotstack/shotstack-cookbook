# ElevenLabs voice-over video

Narrate a video in a cloned voice. The script clones a voice from a short audio sample with
the ElevenLabs Voice Cloning API, generates the voice-over with that voice, uploads it to
Shotstack, and renders a captioned video. You get one MP4 with your voice, background footage,
and captions transcribed from the voice. The script moves the audio between the two APIs.
You do not handle a file.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **production** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- An [ElevenLabs account](https://elevenlabs.io/app/settings/api-keys) and an API key.
  Voice cloning needs a paid ElevenLabs plan (Starter or above). Without one, skip the
  cloning step and use a voice from the ElevenLabs voice library.
- Node.js 20 or later

Production renders consume Shotstack credits. For free watermarked test renders, change `v1`
to `stage` in `voiceover.mjs` and use your sandbox key. The caption track transcribes the
voice-over, which consumes generation credits. Remove the first track in `edit.json` to render
without captions and without generation credits.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/elevenlabs-voiceover-video
```

Copy the environment file. Add your keys to `.env`.

```bash
cp .env.example .env
```

Choose the voice. Do one of these:

- Set `ELEVENLABS_VOICE_SAMPLE` in `.env` to the path of a clean voice recording,
  one to three minutes of MP3 or WAV. The script clones it and uses the clone.
- Set `ELEVENLABS_VOICE_ID` in `.env` to a voice you already have, cloned or from the
  [voice library](https://elevenlabs.io/app/voice-library).
- Set neither. The script uses George from the ElevenLabs default library.

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

## Run

```bash
node voiceover.mjs
```

## What happens

If `ELEVENLABS_VOICE_SAMPLE` is set, the script first sends the sample to the ElevenLabs
Voice Cloning API and receives a new voice ID. Then it sends the script text to ElevenLabs
and receives an MP3 voice-over in the chosen voice. It uploads the MP3 to the Shotstack
Ingest API and waits until the source is ready. It puts the source URL into `edit.json`,
submits the render, and polls every five seconds until the render reaches `done` or `failed`.
Then it prints the temporary output URL. The full run takes two to four minutes. The URL
expires after 24 hours.

To change the spoken text, edit the `SCRIPT` constant at the top of `voiceover.mjs`.
