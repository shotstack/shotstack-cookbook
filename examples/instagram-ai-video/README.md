# Instagram AI video demo

Automate Instagram Reels end-to-end with a single Node.js function: `createAndPostReel(topic)`.

```text
Topic
  -> Generate script and caption with OpenAI
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
- Instagram Professional account (Business or Creator) linked to a Facebook Page
- Meta app with `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `pages_show_list` permissions and a long-lived access token

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/instagram-ai-video
npm install
cp .env.example .env   # then fill in your keys
node index.js
```

The demo run at the bottom of `index.js` creates and publishes a Reel about "the future of remote work" — change the topic or import `createAndPostReel` into your own workflow.

## Notes

- Instagram accounts are limited to 100 API-published posts per 24-hour moving period.
- Shotstack render URLs expire after 24 hours — publish promptly or transfer output to hosting with the [Serve API](https://shotstack.io/docs/guide/serving-assets/hosting/).

## License

MIT
