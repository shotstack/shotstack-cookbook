# AI content pipeline

Make an on-brand 9:16 video for each product in a store's product export. A brand guide in `brand.json` sets the colors, font, layout limits, voice rules, backdrops, motion and music. You get one MP4 file for each product in `out/`. A sheet in `out/approval.csv` lists each video, or the reason why the pipeline held it.

Related guide: [AI content pipeline automation with video creation for brands](https://shotstack.io/learn/ai-content-pipeline-automation-brands/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **production** API key
- An [Anthropic API key](https://platform.claude.com/). To use another model that can read images, change `askClaude()`.
- Node.js 22.9 or later. Node 20 is end of life.
- ffmpeg on your PATH. The pipeline uses it to take frames from each clip. It was tested with ffmpeg 8.1.

AI generation always uses production credits, also with a sandbox key. The pipeline uses the production API. For each product, a run can make at most 2 images and 2 video clips. Each render also generates a voice-over. A run makes one music track for all products. It makes one render for each product. See [pricing](https://shotstack.io/pricing/). A request that is the same as an earlier request returns the stored file at no charge.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/ai-content-pipeline
cp .env.example .env
```

Set `SHOTSTACK_API_KEY` and `ANTHROPIC_API_KEY` in `.env`. The `npm start` command loads this file with `node --env-file-if-exists=.env`.

## Run

Write the template to `out/template.json`. This does not need keys, and it is free:

```bash
npm run dry
```

Show what a run does, then stop. This does not use credits:

```bash
npm start
```

Make a video for each product. This uses credits:

```bash
npm start -- --yes
```

To use another product export, add its path: `npm start -- my-products.csv --yes`. The file needs the same columns as `products.csv`.

## What happens

For each product, the pipeline does these steps:

1. It checks the title, price and detail against the layout limits. They go on screen as they are in the data.
2. Claude writes a short voice-over script. Code checks the script against the voice rules. A script that fails goes back with the reasons. A script gets 3 tries.
3. An image-edit model puts the real product on a brand backdrop. A vision check compares the result with the packshot. A still gets 2 tries.
4. An image-to-video model animates the still. A vision check compares frames from the clip with the packshot. A clip gets 2 tries.
5. Shotstack renders the video from a saved template, with the voice-over, captions and music.

A product that fails a check is held, with the reason, in `out/approval.csv`. The checks are a first filter. A person still approves each video before it is posted. Each render has a permanent public link in the sheet.

Run the pipeline again to continue. It skips each product that has an `out/<handle>.mp4` file. If a video was rendered but not downloaded, it downloads the video from the link in the sheet. It renders the product again only if that link fails. A held row in the sheet is replaced on the next run. A row with a video keeps your review. Keep the six columns of the sheet. You can add columns. Do not edit the sheet while the pipeline runs. To make a product again, delete its video file and its rows in the sheet. The first run saves the template and keeps its id in `out/template.id`. Later runs update that template.

To use another store, change `brand.json`, not the code. A product type with no motion line, or a badge with no label, is held with a message that says what to add. A missing key in `brand.json` stops the run with the name of the key.
