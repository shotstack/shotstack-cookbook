# Automotive inventory videos

Render one vertical video for each vehicle in a dealer inventory. Each vehicle record has a stock
id, specifications, a price and a list of photos. The script builds the Edit JSON in code, with
one clip for each photo, so the video is as long as the vehicle has photos. You get one
1080 x 1920 MP4 per vehicle, and a file that records which render belongs to which stock id.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
- Node.js 20 or later

Sandbox renders are watermarked. Your account needs at least one credit to use the sandbox.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/automotive-inventory-videos
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

Submit one render per vehicle:

```bash
node render.mjs
```

Then check them:

```bash
node status.mjs
```

Run `status.mjs` again until each render shows `done`.

## What happens

`render.mjs` reads `vehicles.json` and checks that each vehicle has every field and at least one
photo. It reports every problem it finds, then stops. For each vehicle it builds an Edit JSON and
submits one render. The video shows the photos in sequence, 3.2 seconds each, cropped to fill the
vertical frame. Each photo fades in, and the pan or zoom changes from one photo to the next. A
vehicle with one or two photos gets at least six seconds. A card with the year, make, model, trim,
price, odometer, transmission and fuel type slides in at the bottom. The dealer name is at the
top. A music track plays under the whole video. The script appends one line per render to
`renders.jsonl` and ends with the count of submitted renders.

`status.mjs` reads `renders.jsonl` and checks each render once. A `done` render prints its video
URL.

The card and the dealer name are `html5` assets. The script writes the vehicle data into their
HTML before the render. To render your own inventory, replace the records in `vehicles.json`.
Photo URLs must be public HTTPS URLs. To change the layout, edit `edit.mjs`.

`renders.jsonl` only appends. Delete the file to start a new batch.

To render in production, set `SHOTSTACK_ENV=v1` and put your production key in `.env`.
