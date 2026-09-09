# Multi-client video automation

One master template renders a branded promo video for three fictional clients, in three aspect
ratios each: nine videos from one loop. Each client is a record with a headline, font, footage,
music and brand mark. A JSON Lines file records which render belongs to which client, because the
API has no endpoint that lists renders.

Related guide: [A guide to automating video content production for multiple clients](https://shotstack.io/learn/automating-video-production-multiple-clients/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
- Node.js 20 or later
- curl

Sandbox renders are watermarked. Your account needs at least one credit to use the sandbox.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/multi-client-video-automation
```

Copy the environment file. Add your sandbox key to `.env`. Leave `SHOTSTACK_ENV` empty to use the
sandbox.

```bash
cp .env.example .env
```

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

Create the template in the same environment as `SHOTSTACK_ENV`. The command uses the sandbox when
`SHOTSTACK_ENV` is empty:

```bash
curl --fail-with-body \
  --request POST \
  "https://api.shotstack.io/edit/${SHOTSTACK_ENV:-stage}/templates" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --header "x-api-key: ${SHOTSTACK_API_KEY}" \
  --data-binary @template.json
```

Copy the `id` from the response into `SHOTSTACK_TEMPLATE_ID` in `.env`. Then load the file again:

```bash
set -a
source .env
set +a
```

## Run

Submit all nine renders:

```bash
node render.mjs
```

Then check them:

```bash
node status.mjs
```

Run `status.mjs` again until each render shows `done`.

## What happens

`render.mjs` expands each client record into merge fields. It submits one template render per client
and aspect ratio, nine in total. It appends one line per render to `renders.jsonl` with the render id,
client and variant. It ends with the count of submitted renders.

`status.mjs` reads `renders.jsonl` and checks each render once. A `done` render prints its video URL.
A sandbox render finishes in under a minute.

`renders.jsonl` only appends. Delete the file to start a new batch.

To render in production, set `SHOTSTACK_ENV=v1` and put your production key in `.env`. Create the
template again with that key. A template belongs to the environment that created it.
