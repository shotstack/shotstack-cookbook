# Bulk videos from a CSV

Render one video per row of a CSV from a single reusable template: create the template with merge
fields, generate and validate a 100-row dataset, submit one template render per row at a safe pace,
and track every render in a resumable manifest. The submit loop is implemented twice, in Node.js and
in Python. An optional AI step has Claude write each row's headline and text-to-image prompt, which
the same pipeline validates like any other input.

Companion code for [Generate videos in bulk with an API and an AI agent](https://shotstack.io/learn/bulk-create-videos-from-csv/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) with your **sandbox** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- Node.js 18 or later, or Python 3 for the submit loop
- Optional, for the AI step: an [Anthropic API key](https://platform.claude.com/)

Sandbox renders are watermarked, and your account needs at least one credit to use the environment.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/bulk-csv-videos
npm install
```

Copy `.env.example` to `.env` and fill in your keys, or export them:

```bash
export SHOTSTACK_API_KEY="your_sandbox_api_key"
export SHOTSTACK_ENV="stage"
```

## Run

1. Create the template and keep the returned template id:

```bash
curl --fail-with-body \
  --request POST \
  "https://api.shotstack.io/edit/stage/templates" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --header "x-api-key: ${SHOTSTACK_API_KEY}" \
  --data-binary @template.json
```

2. Generate the 100-row dataset:

```bash
node generate-data.mjs
```

3. Preflight three rows, then submit and poll (Node or Python):

```bash
export SHOTSTACK_TEMPLATE_ID="your_stage_template_id"
SHOTSTACK_ROW_LIMIT=3 node bulk-render.mjs submit
node bulk-render.mjs status
```

```bash
SHOTSTACK_ROW_LIMIT=3 python3 bulk_render.py submit
python3 bulk_render.py status
```

Remove `SHOTSTACK_ROW_LIMIT` for the full batch. `node bulk-render.mjs summary` (or the Python
equivalent) reads the local manifest without calling any API.

4. Optional AI step — Claude writes each row's headline and image prompt, the script validates them,
and the render loop runs unchanged on the new file:

```bash
export ANTHROPIC_API_KEY="your_anthropic_api_key"
node generate-data-ai.mjs
CSV_PATH=products-ai.csv node bulk-render.mjs submit
```

## Notes

- Templates belong to the environment they were created in. Re-create the template with your
  production key and `SHOTSTACK_ENV=v1` before a production run; the ids will differ.
- The manifest (`batch-results.json`) makes reruns safe: rows with a render id are skipped, and
  only confirmed failures are retried with `SHOTSTACK_RETRY_FAILED=true`.
- Do not run the Node and Python submitters against the same manifest at the same time.
