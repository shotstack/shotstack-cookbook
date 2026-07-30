# Shotstack Cookbook

Example applications and companion code for Shotstack guides and tutorials.

Clone this repo, or head into the folder for the example you want. Each example has its own README with the API keys and setup steps it needs.

## Examples

- [instagram-ai-video](examples/instagram-ai-video) generates a script, voiceover and background image with AI, renders a 1080x1920 video, and publishes it as an Instagram Reel. Companion code for [How to automate Instagram posts with AI video](https://shotstack.io/learn/automate-instagram-posts-with-ai-video/).
- [rapidreels](examples/rapidreels) creates faceless short-form videos using generative AI. [View demo](https://shotstack.io/demos/social-media-video-maker/).
- [reelestate](examples/reelestate) turns static real estate images into fully edited video slideshows. [View demo](https://shotstack.io/demos/real-estate-video-listing-maker/).

## Editing with an AI agent

If you are working on these examples with Claude Code or another coding agent, install the Shotstack CLI and its skill first:

```bash
npm install -g @shotstack/cli
npx skills add shotstack/shotstack-cli
```

The skill gives the agent the Edit JSON authoring conventions, which are easy to get wrong from instinct. `shotstack validate <file>` then lints a template offline, no API key and no render credits. See the [agent guide](https://shotstack.io/docs/guide/agents/cli/).
