# Hedra spokesperson ad with cutaways

Turn a portrait and a voice recording into a finished ad. The script sends both
to the Hedra Character-3 model, waits for the lip-synced clip, then renders it
with product shots cutting over the top, captions, and an end card that appears
when the character stops speaking. You get one MP4 in `output/`.

The cutaways come from `broll.csv`, so you change what the ad shows without
touching the code.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your
  **production** API key
- A [Hedra account](https://hedra.com) and an API key, which is a
  `key_id:secret` pair
- A public link to a portrait image, and one to a voice recording
- Node.js 20 or later

One run generates one Hedra video and one Shotstack render. The captions are
transcribed from the character's speech, which consumes generation credits.
Remove the first track in `template.json` to render without captions. The
video must contain speech: with no spoken audio, the render fails.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/hedra-spokesperson-ad
cp .env.example .env
```

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

Edit `prompt.txt` to describe how the character should look and move. Edit
`broll.csv`: one row per cutaway, with a public image `url`, the second it
starts, how long it stays, and an optional `effect`. Keep every cutaway inside
the length of the Hedra video, or it covers the end card.

## Run

```bash
node spokesperson-ad.mjs
```

## What happens

The script submits a job to the Hedra Character-3 model and polls every five
seconds until it is complete. This takes two to six minutes for one minute of
audio. It puts the Hedra output URL into the merge fields of `template.json`,
adds one clip per row of `broll.csv` on the cutaway track, and renders. The end
card starts with `"start": "auto"`, so it follows the character clip whatever
length Hedra returns.

Run the script again and it reuses the character clip, so only the render
repeats. That makes it cheap to try different cutaways.
