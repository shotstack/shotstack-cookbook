# In-app video creation

One promo video, three ways for a user to create it in your app: an embedded Studio SDK editor, a
quick form, and a single button with no interface at all. All three paths submit to the same render
proxy. The proxy holds the API key, records which user owns each render, validates user-supplied
asset URLs, and rate limits each user.

Companion code for [Add video creation to your app without building an editor](https://shotstack.io/learn/add-video-creation-to-your-app/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- Node.js 20 or later
- A browser with WebGL for the editor tab. If WebGL is not available, the app shows a message and
  the other two tabs still work.

Sandbox renders are watermarked, and your account needs at least one credit to use the environment.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/in-app-video-creation
npm install
```

Copy the environment file. Add your sandbox key to `.env`.

```bash
cp .env.example .env
```

## Run

The example runs as two processes. Open two terminals.

In terminal 1, load the environment file and start the render proxy. Only this process reads the
API key. Start it first:

```bash
set -a
source .env
set +a
npm run server
```

In terminal 2, start the web app:

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

## What happens

The render proxy starts on port 8787 and the web app on port 5173. The app shows three tabs above
one shared gallery:

- **Editor** mounts the Studio SDK with the edit in `public/promo.json`. Change the video, then
  click **Render this edit**. The app saves a draft on every change and restores it on reload.
  **Start over** discards the draft.
- **Quick form** sends three form fields as merge values for the template in `template.json`. The
  proxy creates the template on the first form render and prints the template id. Set
  `SHOTSTACK_TEMPLATE_ID` to reuse a template between restarts.
- **One click** builds the Edit JSON in code and submits it. No editor and no form.

Each path shows its progress in a status line. A sandbox render finishes in under a minute. When a
render is done, the app adds the video to the gallery. The gallery only shows renders that belong
to the current user, because the proxy records the owner of every render before it responds.

The proxy limits each user to 10 renders per hour. Set `RATE_LIMIT` to change the cap. The proxy
rejects user-supplied asset URLs that are not HTTPS, resolve to a private address, or are larger
than 100 MB.

The proxy renders in the sandbox by default. To render without the watermark, set
`SHOTSTACK_ENV=v1` and use your production key. Templates belong to the environment they were
created in, so the proxy creates a new one on the first form render in each environment.

The webhook receiver at `/hooks/render` does not fire on localhost, so the app polls instead. To
test the webhook, expose the proxy through a tunnel and set `callback` on a render. See the guide
for details.
