# fal ad variations, in three formats

Render a set of social ads from one product brief. The script reads
`variations.csv`, generates three stills per row with the FLUX.1 [dev] model on
fal, then renders each row from one template in 9:16, 1:1 and 16:9. You get
nine MP4 files in `output/` and a manifest that records every render.

The script is resumable. It skips a render that is already in the manifest, and
it reuses images it generated earlier, so a second run costs nothing at fal.

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your
  **production** API key
- A [fal account](https://fal.ai/dashboard/keys) and an API key
- Node.js 20 or later

Each row generates three images at fal. Nine renders consume Shotstack credits.
Set `SHOTSTACK_ENV=stage` in `.env` and use your sandbox key for free
watermarked test renders.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/fal-ad-variations
cp .env.example .env
```

Load the file into your shell. Do this in each new terminal:

```bash
set -a
source .env
set +a
```

Edit `variations.csv`. Each row is one ad: an `id`, an image `prompt`, a
`headline`, a `cta` and an `accent` colour.

## Run

```bash
node ad-variations.mjs
```

## What happens

The script reads each row of `variations.csv` and sends the prompt to fal. It
puts the three image URLs and the row's text into the merge fields of
`template.json`, then submits one render per output format. It polls every five
seconds until each render reaches `done` or `failed`, downloads the MP4 to
`output/`, and writes `output/manifest.json` after every step.

Run the script again to render only what is missing. Delete a row from
`manifest.json` to force that render again. To change the look, edit
`template.json`: the `{{HEADLINE}}`, `{{CTA}}`, `{{ACCENT}}` and `{{IMG1}}`
tokens are replaced at render time by the `merge` field.
