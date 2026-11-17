# Automate After Effects templates

Turn a Bodymovin (Lottie) export of an After Effects design into a Shotstack template. Then render one video for each row of a CSV file. You get one MP4 file for each row in the `videos` directory.

Related guide: [Automate After Effects templates with Lottie and the Shotstack API](https://shotstack.io/learn/automate-after-effects-templates/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and its production API key. Production renders use credits. The rates are on the [pricing page](https://shotstack.io/pricing/).
- Node.js 22 or later. The code uses only built-in modules. There are no packages to install.
- After Effects and the Bodymovin extension, only to change the design. The rendering does not use After Effects.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/automate-after-effects-templates
```

Download the footage and the music. The Mixkit license does not let us include these files:

- Footage: [A barista preparing coffee with milk and ice](https://mixkit.co/free-stock-video/a-barista-preparing-coffee-with-milk-and-ice-796/). Download the Full HD version. Save it as `footage.mp4`.
- Music: an MP3 file from [Mixkit's happy music](https://mixkit.co/free-stock-music/happy/). Save it as `music.mp3`.

You can use your own footage and music instead. Keep the same file names.

Copy the environment file. Add your API key to `.env`:

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

Upload the footage, the music and the logo. Then save the template and render one video for each row of `data.csv`:

```bash
node setup-assets.js
node create-template.js
node render-videos.js
```

To try a design change, update the template from the navy version of the card. Then render one row:

```bash
node update-template.js product-card-v2.json
node render-videos.js one-row.csv
```

## What happens

`setup-assets.js` uploads the three files to the Ingest API and writes their URLs to `assets.json`. The uploads take about one minute.

`create-template.js` builds the template from `product-card.json` and saves it to your account. It writes the template ID to `template-id.txt`.

`render-videos.js` sends one render request for each row, one request each second. Each video is 6 seconds long at 1920 x 1080. The renders take about one minute. The script downloads each video to `videos/` and writes the status of each row to `render-results.json`.

The script skips a row if a value is longer than the limit in `MAX_LENGTH`. If you run the script again, it does not render the rows that it downloaded before. It also gets the renders that it sent but did not download.

The `after-effects` directory has the After Effects projects for both versions of the card. To change the design, export it again with Bodymovin. Turn off the Glyphs setting. Keep the names of the text layers `PRODUCT` and `PRICE`.
