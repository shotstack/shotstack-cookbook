# Sports highlight videos

Turn a full match recording and a list of goals into one vertical highlight video. The match
record has a source video URL and one entry per goal, with the second in the recording where its
highlight starts. The script trims a 10 second clip at each goal and joins the clips in one render.
It crops the landscape footage to fill a vertical frame and adds music under the match sound. You
get one 1080 x 1920 MP4 per match.

Related guide: [Automate sports video highlights using an API](https://shotstack.io/learn/automated-sports-highlight-video-api/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
- Node.js 20 or later

Sandbox renders are watermarked. Your account needs at least one credit to use the sandbox.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/sports-highlight-videos
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

Submit the render:

```bash
node render.mjs
```

Then check it:

```bash
node status.mjs
```

Run `status.mjs` again until the render shows `done`.

## What happens

`render.mjs` reads `match.json` and checks that it has a match id, an HTTPS source URL and at least
one goal with a time in seconds. It reports every problem it finds, then stops. It builds one Edit
JSON with one clip per goal, 10 seconds each, trimmed from the same source video with the `trim`
property. Each clip starts when the previous one ends. The script crops each clip from the center of
the frame to fill 1080 x 1920. The match sound plays at a lower volume, with a music track under it.
The script appends one line to `renders.jsonl`.

`status.mjs` reads `renders.jsonl` and checks the render once. A `done` render prints its video
URL. The sample source video is a 99 minute match of about 700 MB. Shotstack downloads the full
file before it renders, so this render takes longer than a render of a short clip.

The sample match is the recording that the related guide uses. Each goal starts about 3 seconds
before the build-up, so the clip shows the attack, the goal and the celebration. To render your own
match, replace the source URL with a public HTTPS URL. Then list the goals. For each goal, set `at`
to the second in the recording where its highlight starts. To change the clip length, edit
`edit.mjs`.

`renders.jsonl` only appends. Delete the file to start a new batch.

To render in production, set `SHOTSTACK_ENV=v1` and put your production key in `.env`.
