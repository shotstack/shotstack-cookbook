# RapidReels

RapidReels is an application that allows you to create faceless TikTok videos using generative AI.

View demo: https://shotstack.io/demos/social-media-video-maker/

## Getting Started

### Install dependencies

First, install the required dependencies:

```bash
yarn
```

### Configure API keys

You require a Shotstack and OpenAI production API key. Copy `.env.local.example` to `.env.local` and add your keys:

```bash
cp .env.local.example .env.local
```

Set `OPENAI_MODEL` to override the default text model.

### Run development server

You can run a development server on localhost:

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Build for production

To run the app anywhere you can host a Node.js process:

```bash
yarn build
yarn start
```

The API keys stay server-side in `pages/api`, so never expose them to the browser.

## How it works

Three staged OpenAI calls, then one Shotstack render:

1. Three voiceover variants are generated and the model picks its own strongest hook.
2. A character and art-style spec is derived from the winning script.
3. Six image prompts are written, each re-stating that spec verbatim so the generated images stay one consistent look instead of six unrelated ones.

The render template is assembled per story type in `constants/template.ts`. The headline uses a `rich-text` asset, the subtitles a `rich-caption` transcribed from the generated voiceover via `alias://voiceover`, and the six images alternate across two tracks so consecutive clips can cross-fade. Display fonts are loaded per story type from `constants/fonts.ts`.
