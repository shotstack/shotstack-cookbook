# First render

Render your first video with the Shotstack API: submit an Edit, poll the render status, and get the
output URL. The same flow is implemented twice, in Node.js and in Python.

Companion code for [Render your first video with the Shotstack API](https://shotstack.io/learn/render-your-first-video-shotstack-api/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- Node.js 18 or later, or Python 3 with [requests](https://pypi.org/project/requests/)

Sandbox renders are watermarked and don't consume credits, but your account needs at least one
credit to use the environment.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/first-render
```

Set your sandbox key:

```bash
export SHOTSTACK_API_KEY="your_sandbox_api_key"
```

Or copy `.env.example` to `.env` and use Node's built-in env-file support (Node run only).

## Run

Node.js:

```bash
node render.mjs             # with SHOTSTACK_API_KEY exported
node --env-file=.env render.mjs
```

Python:

```bash
python3 -m pip install requests
python3 render.py
```

Both scripts read `edit.json` (a five-second "Hello World" rich-text video), submit it to the
sandbox render endpoint, poll every five seconds until the render reaches `done` or `failed`, and
print the temporary output URL. The URL expires after 24 hours; see the guide for retrieving the
CDN-hosted copy through the Serve API.
