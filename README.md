# Shotstack Cookbook

Example applications and companion code for Shotstack guides and tutorials.

Clone this repository, or open the directory of the example you want. Each example has its own README. The README gives the API keys and the setup steps for that example.

## Examples

- [agency-client-social-videos](examples/agency-client-social-videos) renders one short vertical video per agency client from that client's own photos and video clips, ending on a card in the client's brand color. The Edit JSON is built in code, one clip per media item.
- [automotive-inventory-videos](examples/automotive-inventory-videos) renders one vertical video per vehicle in a dealer inventory from a JSON feed: the photos in sequence with a pan or zoom on each, and an animated specification card. The Edit JSON is built in code, one clip per photo.
- [bulk-csv-videos](examples/bulk-csv-videos) renders one video per row of a CSV from a single template with merge fields, tracked in a resumable manifest, with an optional AI step where Claude writes each row's headline and image prompt. Companion code for [Generate videos in bulk with an API and an AI agent](https://shotstack.io/learn/bulk-create-videos-from-csv-and-ai/).
- [elevenlabs-voiceover-video](examples/elevenlabs-voiceover-video) narrates a video in an ElevenLabs voice, cloned from your own sample if you want, uploads the audio through the Ingest API and renders a captioned video.
- [fal-ad-variations](examples/fal-ad-variations) generates product stills with FLUX.1 [dev] on fal and renders each row of a CSV brief as a social ad in 9:16, 1:1 and 16:9 from one template. A manifest makes repeated runs skip finished renders.
- [first-render](examples/first-render) the very basics: submit an Edit, poll the render status, and print the output URL, in Node.js and Python. Start here if you are new to the API. Companion code for [Render your first video with the Shotstack API](https://shotstack.io/learn/render-your-first-video-shotstack-api/).
- [gladia-podcast-shorts](examples/gladia-podcast-shorts) transcribes a long recording with Gladia, picks the strongest segments, and renders each one as a vertical clip with captions and a speaker tag.
- [hedra-spokesperson-ad](examples/hedra-spokesperson-ad) turns a portrait and a voice recording into a lip-synced Hedra clip, then renders an ad with product cutaways from a CSV, captions and an end card.
- [in-app-video-creation](examples/in-app-video-creation) lets a user create the same promo video three ways: an embedded Studio SDK editor, a quick form, and a one-click headless render, all through one render proxy that keeps the API key server-side. Companion code for [Add video creation to your app without building an editor](https://shotstack.io/learn/add-video-creation-to-your-app/).
- [instagram-ai-video](examples/instagram-ai-video) generates a script, voiceover and background image with AI, renders a 1080x1920 video, and publishes it as an Instagram Reel. Companion code for [How to automate Instagram posts with AI video](https://shotstack.io/learn/automate-instagram-posts-with-ai-video/).
- [multi-client-video-automation](examples/multi-client-video-automation) renders branded promo videos for three clients in three aspect ratios from one master template, and records which render belongs to which client. Companion code for [A guide to automating video content production for multiple clients](https://shotstack.io/learn/automating-video-production-multiple-clients/).
- [rapidreels](examples/rapidreels) creates faceless short-form videos using generative AI. [View demo](https://shotstack.io/demos/social-media-video-maker/).
- [reelestate](examples/reelestate) turns static real estate images into fully edited video slideshows. [View demo](https://shotstack.io/demos/real-estate-video-listing-maker/).
- [rime-multilingual-dub](examples/rime-multilingual-dub) dubs one video into several languages with Rime voice-overs, replacing the original audio and burning in captions, one render per language.
- [scheduled-video-automation](examples/scheduled-video-automation) renders one product video per new feed item on a cron schedule. A history file makes repeated runs skip known items, and completion callbacks can replace polling. Companion code for [How to automate video creation on a schedule with the Shotstack API](https://shotstack.io/learn/automate-video-creation-on-a-schedule/).
- [sports-highlight-videos](examples/sports-highlight-videos) trims a 10 second clip at each goal of a full match recording and joins them in one vertical render, cropped from the landscape footage. Extends [Automate sports video highlights using an API](https://shotstack.io/learn/automated-sports-highlight-video-api/).

## Contributing

To make a new example, copy [`examples/_template`](examples/_template). Then read [STANDARDS.md](STANDARDS.md). It gives the rules for API keys, failures, README structure, and the checks to do before you make a pull request.

## Editing with an AI agent

Install the Shotstack CLI and its skill before you use a coding agent, such as Claude Code, on these examples:

```bash
npm install -g @shotstack/cli
npx skills add shotstack/shotstack-cli
```

The skill gives the agent the rules to write Edit JSON. These rules are easy to get wrong. The `shotstack validate <file>` command then checks a template on your computer. It does not need an API key, and it does not use render credits. For more data, see the [agent guide](https://shotstack.io/docs/guide/agents/cli/).
