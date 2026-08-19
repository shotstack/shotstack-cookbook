# Bulk videos from a CSV

Render one video per row of a CSV from a single reusable template: create the template with merge
fields, generate and validate a 100-row dataset, submit one template render per row at a safe pace,
and track every render in a resumable manifest. The submit loop is implemented twice, in Node.js and
in Python. An optional AI step has Claude write each row's headline and image prompt, which the same
pipeline validates like any other input.

Companion code for [Generate videos in bulk with an API and an AI agent](https://shotstack.io/learn/bulk-create-videos-from-csv-and-ai/).

## Requirements

- A [Shotstack account](https://dashboard.shotstack.io/register) with your **sandbox** API key
  (dashboard menu under your account name, top right, under **API Keys**)
- Node.js 20 or later. The dataset scripts are Node.js only.
- Python 3, only if you use the Python submit loop instead of the Node.js one.
- Optional, for the AI step: an [Anthropic API key](https://platform.claude.com/)

Sandbox renders are watermarked, and your account needs at least one credit to use the environment.

## Setup

```bash
git clone https://github.com/shotstack/shotstack-cookbook.git
cd shotstack-cookbook/examples/bulk-csv-videos
npm install
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

4. Optional AI step. Claude writes each row's headline and image prompt. The script validates them.
   The render loop runs unchanged on the new file.

   This step uses `template-ai.json`. Its image asset takes a `prompt` instead of a `src`, so
   Shotstack generates a different image for each row. Create that template first and keep its id:

```bash
curl --fail-with-body \
  --request POST \
  "https://api.shotstack.io/edit/stage/templates" \
  --header "Accept: application/json" \
  --header "Content-Type: application/json" \
  --header "x-api-key: ${SHOTSTACK_API_KEY}" \
  --data-binary @template-ai.json
```

Use a separate manifest. The AI-written rows differ from rows already tracked in
`batch-results.json`:

```bash
export ANTHROPIC_API_KEY="your_anthropic_api_key"
export SHOTSTACK_TEMPLATE_ID="your_ai_template_id"
node generate-data-ai.mjs
CSV_PATH=products-ai.csv MANIFEST_PATH=batch-results-ai.json node bulk-render.mjs submit
```

Generated images cost credits, and each row generates one image. Start with
`SHOTSTACK_ROW_LIMIT=3`.

## What happens

`submit` validates the CSV, queues one template render per row, and records every render in the
manifest. `status` checks each render once and retrieves the hosted video URL for finished renders.
Run `status` again until the counts stop changing. Each command ends with a status table and the
count of hosted videos. The first three rows finish in under a minute. The full batch takes several
minutes at the default one-request-per-second pace.

Templates belong to the environment they were created in. Re-create the template with your
production key and `SHOTSTACK_ENV=v1` before a production run. The ids will differ.

The manifest (`batch-results.json`) makes reruns safe. Rows with a render id are skipped. Only
confirmed failures are retried with `SHOTSTACK_RETRY_FAILED=true`.

A row marked `unknown` means the process stopped before the API confirmed the request. Check the
render dashboard first. To retry the row, delete its entry from the manifest and run `submit` again.

Do not run the Node.js and Python submitters against the same manifest at the same time.
