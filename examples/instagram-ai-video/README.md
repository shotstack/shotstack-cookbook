# Instagram AI video

Automate Instagram Reels end-to-end with a single Node.js function: `createAndPostReel(topic)`.

```text
Topic
  -> Generate script, hook and caption with OpenAI
  -> Generate voiceover with ElevenLabs
  -> Upload voiceover to Shotstack Ingest
  -> Generate background image with a GPT Image model
  -> Upload image to Shotstack Ingest
  -> Render a 1080x1920 MP4 with Shotstack
  -> Publish the rendered video as an Instagram Reel
```

This is the companion code for the Shotstack tutorial [How to automate Instagram posts with AI video](https://shotstack.io/learn/automate-instagram-posts-with-ai-video/).

## What you'll need

- [Shotstack API key](https://dashboard.shotstack.io/register) — production key required for the Instagram publish step
- OpenAI API key — Chat API (script + caption) and GPT Image model (background)
- ElevenLabs API key — text-to-speech voiceover
- Node.js 20.6 or newer, for the built-in `--env-file` support

Only needed if you want to publish:

- Instagram Professional account (Business or Creator) linked to a Facebook Page
- Meta app with `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `pages_show_list` permissions and a long-lived access token

## Getting Started

### Install dependencies

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/instagram-ai-video
npm install
```

### Configure API keys

Copy `.env.example` to `.env` and add your keys:

```bash
cp .env.example .env
```

### Render a Reel

```bash
node --env-file=.env index.js "the future of remote work"
```

This renders the video and prints the URL so you can watch it before anything is
posted. To publish it to the connected Instagram account, add `--publish`:

```bash
node --env-file=.env index.js "the future of remote work" --publish
```

To use it in your own workflow, import the function instead:

```js
import { createAndPostReel } from './index.js';

const { videoUrl } = await createAndPostReel('the future of remote work');
```

## Notes

- Instagram accounts are limited to 100 API-published posts per 24-hour moving period.
- Shotstack render URLs expire after 24 hours — publish promptly or transfer output to hosting with the [Serve API](https://shotstack.io/docs/guide/serving-assets/hosting/).
- The on-screen hook loads a Google Font via `timeline.fonts` to get a bolder weight than the built-in font set offers. When loading a font this way, `font.family` must match the font file's basename or it silently won't apply.
