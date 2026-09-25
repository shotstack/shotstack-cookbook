# Rime multilingual dub

Make one video speak several languages. The script reads `translations.csv`,
asks Rime for a voice-over in each language, then renders the same source video
with the original audio silenced, the new voice in its place, and captions
burned in. You get one MP4 per language in `output/`.

You supply the translated lines. The script does not translate anything, so
nothing is guessed on your behalf.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your
  **production** API key
- A [Rime account](https://rime.ai) and an API key
- A public link to the video you want to dub
- Node.js 20 or later

Each row generates one voice-over at Rime and one Shotstack render. The captions
are transcribed from the new voice-over, which consumes generation credits.
Remove the first track in `template.json` to render without captions.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/rime-multilingual-dub
cp .env.example .env
```

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

Set `SOURCE_VIDEO` to your video. Edit `translations.csv`: one row per language,
with the Rime `speaker` voice and the translated `text`. The voices are listed
in the [Rime documentation](https://docs.rime.ai).

## Run

```bash
node multilingual-dub.mjs
```

## What happens

For each row the script sends the text to Rime and receives an MP3. It uploads
the MP3 to the Shotstack Ingest API and waits until the source is ready. It puts
the audio URL and the source video into the merge fields of `template.json`,
then renders a 1080p video where the original audio is set to zero volume and
the new voice plays over it. Each MP4 is downloaded to `output/`.

Keep the voice-over close to the length of the original video. The voice track
is capped to the length of the source video, so a line that runs long is cut
off at the end of the picture rather than extending the render.
