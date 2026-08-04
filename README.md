# Shotstack Cookbook

Example applications and companion code for Shotstack guides and tutorials.

Clone this repository, or open the directory of the example you want. Each example has its own README. The README gives the API keys and the setup steps for that example.

## Examples

- [first-render](examples/first-render) submits an Edit, polls the render status, and prints the output URL, in Node.js and Python. Companion code for [Render your first video with the Shotstack API](https://shotstack.io/learn/render-your-first-video-shotstack-api/).
- [instagram-ai-video](examples/instagram-ai-video) generates a script, voiceover and background image with AI, renders a 1080x1920 video, and publishes it as an Instagram Reel. Companion code for [How to automate Instagram posts with AI video](https://shotstack.io/learn/automate-instagram-posts-with-ai-video/).
- [rapidreels](examples/rapidreels) creates faceless short-form videos using generative AI. [View demo](https://shotstack.io/demos/social-media-video-maker/).
- [reelestate](examples/reelestate) turns static real estate images into fully edited video slideshows. [View demo](https://shotstack.io/demos/real-estate-video-listing-maker/).

## Contributing

To make a new example, copy [`examples/_template`](examples/_template). Then read [STANDARDS.md](STANDARDS.md). It gives the rules for API keys, failures, README structure, and the checks to do before you make a pull request.

## Editing with an AI agent

Install the Shotstack CLI and its skill before you use a coding agent, such as Claude Code, on these examples:

```bash
npm install -g @shotstack/cli
npx skills add shotstack/shotstack-cli
```

The skill gives the agent the rules to write Edit JSON. These rules are easy to get wrong. The `shotstack validate <file>` command then checks a template on your computer. It does not need an API key, and it does not use render credits. For more data, see the [agent guide](https://shotstack.io/docs/guide/agents/cli/).
