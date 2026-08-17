# First render

The very basics of the Shotstack API, and the loop every other example in this cookbook builds on:
submit an Edit, poll the render status, and get the output URL. The same flow is implemented twice,
in Node.js and in Python. Start here if you have never rendered a video with Shotstack before.

Companion code for [Render your first video with the Shotstack API](https://shotstack.io/learn/render-your-first-video-shotstack-api/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- Node.js 20 or later, or Python 3.8 or later with
  [requests](https://pypi.org/project/requests/) 2 or later

Sandbox renders are watermarked and don't consume credits, but your account needs at least one
credit to use the environment.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/first-render
```

Copy the environment file. Add your sandbox key to `.env`.

```bash
cp .env.example .env
```

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

## Run

Node.js:

```bash
node render.mjs
```

Python:

```bash
python3 -m pip install requests
python3 render.py
```

## What happens

Both scripts read `edit.json` (a five-second "Hello World" rich-text video), submit it to the
sandbox render endpoint, poll every five seconds until the render reaches `done` or `failed`, and
print the temporary output URL. A sandbox render finishes in under a minute. The URL expires after
24 hours; see the guide for retrieving the CDN-hosted copy through the Serve API.
