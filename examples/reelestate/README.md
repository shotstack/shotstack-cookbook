# ReelEstate

ReelEstate is an application that turns static real estate images into fully edited real estate video slideshows.

View demo: https://shotstack.io/demos/real-estate-video-listing-maker/

## Getting Started

### Install dependencies

First, install the required dependencies:

```bash
yarn
```

### Configure API keys

You require a Shotstack production API key. Copy `.env.local.example` to `.env.local` and add your key:

```bash
cp .env.local.example .env.local
```

### Run development server

You can run a development server on localhost:

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Editing with an AI agent

If you are working on this example with Claude Code or another coding agent, install the Shotstack CLI and its skill first:

```bash
npm install -g @shotstack/cli
npx skills add shotstack/shotstack-cli
```

The skill gives the agent the Edit JSON authoring conventions, which are easy to get wrong from instinct. `shotstack validate <file>` then lints a template offline, no API key and no render credits. See the [agent guide](https://shotstack.io/docs/guide/agents/cli/).
