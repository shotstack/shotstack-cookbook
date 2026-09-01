# Multi-client video automation

One master template renders branded promo videos for three fictional clients, in three aspect
ratios each: nine videos from one loop. Each client is a record with their own headline, font,
footage, music and brand mark. A JSON-lines file records which render belongs to which client,
because the API has no endpoint that lists renders.

Companion code for [A guide to automating video content production for multiple clients](https://shotstack.io/learn/automating-video-production-multiple-clients/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- Node.js 20 or later

Sandbox renders are watermarked, and your account needs at least one credit to use the environment.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/multi-client-video-automation
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

Create the template and keep the returned template id:

```bash
curl --fail-with-body \
  --request POST \
  "https://api.shotstack.io/edit/stage/templates" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --header "x-api-key: ${SHOTSTACK_API_KEY}" \
  --data-binary @template.json
```

```bash
export SHOTSTACK_TEMPLATE_ID="your_template_id"
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

Run `status.mjs` again until every render shows `done`.

## What happens

`render.mjs` expands each client record into merge fields, submits one template render per client
and aspect ratio (nine in total), and appends one line per render to `renders.jsonl` with the
render id, client and variant. It ends with the count of submitted renders.

`status.mjs` reads `renders.jsonl` and checks each render once. A `done` render prints its video
URL. A sandbox render finishes in under a minute.

`renders.jsonl` only appends. Delete the file to start a new batch.

The scripts render in the sandbox by default. To render in production, set `SHOTSTACK_ENV=v1` and
put your production key in `.env`. Re-create the template with that key. Templates belong to the
environment they were created in, and the ids differ.
