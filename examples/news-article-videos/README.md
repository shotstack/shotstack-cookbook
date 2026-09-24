# News article videos

Render one vertical video for each article a newsroom publishes. Each article record has a
headline and two images. One template holds the design. The script fills the template with merge
fields and submits one render per article. When a render finishes, the script writes the video URL
back onto the article, so a rerun only renders new stories. You get one 24 second 1080 x 1920 MP4
per article.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
- Node.js 20 or later

Sandbox renders are watermarked. Your account needs at least one credit to use the sandbox.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/news-article-videos
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

Submit one render per article:

```bash
node render.mjs
```

Then check them:

```bash
node status.mjs
```

Run `status.mjs` again until each render shows `done`.

## What happens

`render.mjs` reads `edit.json` once and `articles.json` once. It checks that each article has a
slug, a headline and two HTTPS image URLs. It reports every problem it finds, then stops. It skips
articles that already have a `videoUrl`. For each remaining article it adds a `merge` array to the
template and submits one render. The first image shows for 12 seconds with a slow zoom. The second
image fades in for the next 12 seconds. The headline rises in over a dark panel at the bottom. A
music track plays under the whole video. The script appends one line per render to
`renders.jsonl` and ends with the count of submitted renders.

`status.mjs` reads `renders.jsonl` and checks each render once. A `done` render prints its video
URL. The script then writes each finished URL into `articles.json` as `videoUrl`. In production,
read the articles from your CMS and write the URL back through its API. A sandbox URL expires
after 24 hours.

To receive a webhook instead of polling, set `CALLBACK_URL` in `.env` to an HTTPS URL on your
server. Shotstack posts to it when each render finishes.

To render your own stories, replace the records in `articles.json`. Image URLs must be public
HTTPS URLs. To change the design, edit `edit.json` and keep the `{{PLACEHOLDER}}` tokens.

`renders.jsonl` only appends. To start a new batch, delete the file and remove the `videoUrl`
fields from `articles.json`.

To render in production, set `SHOTSTACK_ENV=v1` and put your production key in `.env`.
