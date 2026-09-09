# In-app video creation

Three ways for a user to create the same promo video in your app: an embedded editor, a form, and one
button with no interface. All three submit to one render proxy. The proxy holds the API key, records
the owner of each render, checks user-supplied asset URLs, and rate limits each user.

Related guide: [Add video creation to your app without building an editor](https://shotstack.io/learn/add-video-creation-to-your-app/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) and your **sandbox** API key
- Node.js 20 or later
- A browser with WebGL for the editor tab. Without WebGL, the other two tabs still work.

Sandbox renders are watermarked. Your account needs at least one credit to use the sandbox.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/in-app-video-creation
npm install
```

Copy the environment file. Add your sandbox key to `.env`. Leave the other variables empty.

```bash
cp .env.example .env
```

## Run

The example runs as two processes. Open two terminals.

In terminal 1, load the environment file and start the render proxy. Only this process reads the
API key.

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

The render proxy starts on port 8787. The web app starts on port 5173. The app shows three tabs
above one shared gallery:

- **Editor** mounts the Studio SDK with the edit in `public/promo.json`. Change the video, then click
  **Render this edit**. The app saves a draft on each change and restores it on reload. **Start over**
  discards the draft.
- **Quick form** sends three form fields as merge values for the template in `template.json`. The
  proxy creates the template on the first form render and prints the template id. Set
  `SHOTSTACK_TEMPLATE_ID` in `.env` to reuse that template after a restart.
- **One click** builds the Edit JSON in code and submits it. No editor and no form.

Each tab shows its progress in a status line. A sandbox render finishes in under a minute. When a
render is done, the app adds the video to the gallery. The gallery shows only the renders of the
current user, because the proxy records the owner of each render before it responds. The proxy reads
the user id from an `x-demo-user` header as a stand-in for your auth. Replace it with your own session
check before real users use the app.

The proxy limits each user to 10 renders per hour. Set `RATE_LIMIT` to change the cap. The proxy
rejects an asset URL that is not HTTPS, that redirects, that resolves to a private address, or that
is larger than 100 MB.

The proxy renders in the sandbox by default. To render without the watermark, set `SHOTSTACK_ENV=v1`
and use your production key. A template belongs to the environment that created it. The proxy
creates a new template on the first form render in each environment.

The webhook receiver at `/hooks/render` does not fire on localhost, so the app polls instead. To test
the webhook, expose the proxy through a tunnel and set `callback` on a render. See the guide.
