# Scheduled video automation

A worker that renders one product video for each new item in a feed, on a cron schedule. It keeps a history file, so repeated runs skip known items. It waits for the hosted MP4 and can receive completion callbacks instead of polling. At the end you get one hosted video URL per feed item, recorded in `state.json`.

Related guide: [How to automate video creation on a schedule with the Shotstack API](https://shotstack.io/learn/automate-video-creation-on-a-schedule/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and its production API key. Production renders use credits. Rates are on the [pricing page](https://shotstack.io/pricing/).
- Node.js 20.6 or later. The code uses only built-in modules. There are no packages to install.
- Linux or WSL with Bash, `cron` and `flock` for the scheduled run. The Node scripts also run on macOS and Windows.
- A public HTTPS URL, only for the callback step. The guide uses `cloudflared` for local tests.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/scheduled-video-automation
cp .env.example .env
```

Add your production API key to `.env`. Then save the template to your account:

```bash
export SHOTSTACK_API_KEY="your_api_key"
curl --request POST 'https://api.shotstack.io/edit/v1/templates' \
  --header "x-api-key: $SHOTSTACK_API_KEY" \
  --header 'Content-Type: application/json' \
  --data-binary @- <<EOF
{ "name": "Scheduled product video", "template": $(cat template.json) }
EOF
```

Copy the `id` from the response into `SHOTSTACK_TEMPLATE_ID` in `.env`. Then create an empty history file:

```bash
echo '{}' > state.json
```

## Run

Render the item in `feed.json` and wait for the hosted MP4:

```bash
node --env-file=.env videos.mjs --wait
```

Run it again. The worker skips the item because `state.json` lists it. Add a second object to `feed.json` with a new `id`. Run again to render only the new item.

Other commands:

```bash
node --env-file=.env videos.mjs                 # submit new items, check pending items that are due
node --env-file=.env videos.mjs --check --now   # check all pending items, submit nothing
node --env-file=.env videos.mjs --retry sku-1002   # resubmit a rejected, failed or unknown item after you fix its data
```

To run on a schedule, make `run.sh` executable and add it to `crontab -e`. `run.sh` takes the same flags as `videos.mjs` and uses `flock`, so two runs never overlap. Once cron is active, use `./run.sh` for every manual command too. A direct `node` run bypasses the lock. Use absolute paths. The `PATH` line tells cron where to find `node`. If `command -v node` prints a directory that is not in it, add that directory:

```text
PATH=/usr/local/bin:/usr/bin:/bin
0 * * * * /absolute/path/scheduled-video-automation/run.sh >> /absolute/path/scheduled-video-automation/worker.log 2>&1
1-59 * * * * /absolute/path/scheduled-video-automation/run.sh --check >> /absolute/path/scheduled-video-automation/worker.log 2>&1
```

To receive completion callbacks instead of polling, generate a secret:

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Add the secret and your public HTTPS URL to `.env`:

```text
WEBHOOK_SECRET=the_generated_hex_string
CALLBACK_URL=https://your-public-host/webhook
```

Start the receiver. Then update the saved template, so future renders call it:

```bash
node --env-file=.env webhook.mjs
node --env-file=.env enable-callback.mjs
```

## What happens

`videos.mjs` reads `feed.json`, or the JSON array at `FEED_URL` when it is set. Each item needs a unique `id`, a `title` and one to four HTTPS image URLs. For each new item, the worker submits a template render with the title and images as merge fields. It records the render ID in `state.json` with status `pending`. It submits at most three new items per run and keeps at most ten renders pending.

On each run the worker checks pending renders. It checks a render when its callback marker exists in `inbox/`, or 15 minutes after the last check. With `--now` it checks every pending render. When the render is `done` and the MP4 is `ready`, the entry becomes `done` with the hosted `url`. A render takes about one minute.

`webhook.mjs` listens on `127.0.0.1:3000`. It accepts a POST to `/webhook` only with the correct `token`. It reads the render ID from the event and writes an empty marker file to `inbox/`. `enable-callback.mjs` adds the callback URL, with the token, to your saved template.

If the API key or the template ID is wrong, each script prints one line and stops without changing `state.json`. When the API refuses an item, the worker saves it as `rejected` with the API's error message. It continues with the next item and exits with code 1. When an item fails for another reason, such as a network error, the worker saves it as `unknown`. The next run does not resubmit either. Fix the cause and use `--retry` with the item ID. A render that reports no hosted file within 24 hours becomes `failed`, so it stops holding a pending slot.
