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
