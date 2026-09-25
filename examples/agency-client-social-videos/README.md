# Agency client social videos

Render one short vertical video for each client an agency manages, from that client's own photos
and video clips. Each client record has a name, a brand color, a brand mark and a list of media.
The script builds the Edit JSON in code, with one clip for each item, so the video is as long as
the client has media. You get one 1080 x 1920 MP4 per client, and a file that records which render
belongs to which client.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
- Node.js 20 or later

Sandbox renders are watermarked. Your account needs at least one credit to use the sandbox.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/agency-client-social-videos
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

Submit one render per client:

```bash
node render.mjs
```

Then check them:

```bash
node status.mjs
```

Run `status.mjs` again until each render shows `done`.

## What happens

`render.mjs` reads `clients.json` and checks each client. A client needs a slug, a name, a hex
brand color, an SVG brand mark and at least one media item. Each media item needs a type, image or
video, and an HTTPS URL. The script reports every problem it finds, then stops. For each client it
builds an Edit JSON and submits one render. The media plays in sequence, 4 seconds each,
cropped to fill the vertical frame. Images get a slow zoom. Video clips play without their own
sound. The video ends on a two second card in the brand color with the brand mark. A music track
plays under the whole video. The script appends one line per render to `renders.jsonl` and ends
with the count of submitted renders.

`status.mjs` reads `renders.jsonl` and checks each render once. A `done` render prints its video
URL.

To render your own clients, replace the records in `clients.json`. Media URLs must be public HTTPS
URLs. To change the timing or the end card, edit `edit.mjs`.

`renders.jsonl` only appends. Delete the file to start a new batch.

To render in production, set `SHOTSTACK_ENV=v1` and put your production key in `.env`.
