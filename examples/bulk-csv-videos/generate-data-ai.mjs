import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
const CSV_IN = process.env.CSV_PATH ?? 'products.csv';
const CSV_OUT = process.env.CSV_AI_PATH ?? 'products-ai.csv';
const MAX_HEADLINE_LENGTH = 55;
const MAX_PROMPT_LENGTH = 300;

const fail = message => {
  console.error(message);
  process.exit(1);
};

if (!API_KEY) {
  fail('Set ANTHROPIC_API_KEY before running this script.');
}

let csvText;

try {
  csvText = await readFile(CSV_IN, 'utf8');
} catch (error) {
  if (error.code === 'ENOENT') {
    fail(
      `Cannot find ${CSV_IN}. Run node generate-data.mjs first, or set CSV_PATH.`
    );
  }
  throw error;
}

const rows = parse(csvText, {
  bom: true,
  columns: true,
  skip_empty_lines: true,
  trim: true
});

const schema = {
  type: 'object',
  properties: {
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row_id: { type: 'string' },
          headline: {
            type: 'string',
            description: `Marketing headline, ${MAX_HEADLINE_LENGTH} characters or fewer`
          },
          image_prompt: {
            type: 'string',
            description: `Text-to-image prompt for a product background, ${MAX_PROMPT_LENGTH} characters or fewer`
          }
        },
        required: ['row_id', 'headline', 'image_prompt'],
        additionalProperties: false
      }
    }
  },
  required: ['headlines'],
  additionalProperties: false
};

const products = rows.map(({ row_id, product_name, price }) => ({
  row_id,
  product_name,
  price
}));

let response;

try {
  response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema }
      },
      messages: [
        {
          role: 'user',
          content: [
            'For each product below, write one short marketing headline and one text-to-image prompt.',
            `Every headline must be ${MAX_HEADLINE_LENGTH} characters or fewer, plain text, no quotes or emoji.`,
            `Every image prompt must be ${MAX_PROMPT_LENGTH} characters or fewer and describe a clean product background photo.`,
            'Return exactly one entry per row_id.',
            '',
            JSON.stringify(products)
          ].join('\n')
        }
      ]
    }),
    signal: AbortSignal.timeout(120_000)
  });
} catch (error) {
  fail(`Could not reach the Anthropic API: ${error.message}`);
}

if (!response.ok) {
  fail(`Anthropic API error ${response.status}: ${await response.text()}`);
}

const body = await response.json();

if (body.stop_reason === 'refusal') {
  fail('The model declined the request; keep the original headlines.');
}
if (body.stop_reason === 'max_tokens') {
  fail('The response was truncated. Raise max_tokens or send fewer rows.');
}

const text = body.content.find(block => block.type === 'text')?.text ?? '{}';
const generated = new Map(
  (JSON.parse(text).headlines ?? []).map(item => [item.row_id, item])
);

// Validate the model's output with the same rules as any other input.
let headlines = 0;
let prompts = 0;
for (const row of rows) {
  const item = generated.get(row.row_id);
  const headline = item?.headline?.trim();
  const imagePrompt = item?.image_prompt?.trim();

  if (headline && headline.length <= MAX_HEADLINE_LENGTH) {
    row.headline = headline;
    headlines += 1;
  }

  if (imagePrompt && imagePrompt.length <= MAX_PROMPT_LENGTH) {
    row.image_prompt = imagePrompt;
    prompts += 1;
  } else {
    // Deterministic fallback so the text-to-image asset always has a prompt.
    row.image_prompt = `Studio product photo of ${row.product_name} on a plain background`;
  }
}

const columns = [
  'row_id',
  'product_name',
  'headline',
  'price',
  'image_url',
  'brand_color',
  'image_prompt'
];
const csvEscape = value => {
  const textValue = String(value);
  return /[",\n]/.test(textValue)
    ? `"${textValue.replaceAll('"', '""')}"`
    : textValue;
};
const csv = [
  columns.join(','),
  ...rows.map(row => columns.map(column => csvEscape(row[column])).join(','))
].join('\n');

await writeFile(CSV_OUT, `${csv}\n`, 'utf8');
console.log(
  `Wrote ${CSV_OUT}: ${headlines}/${rows.length} headlines and ${prompts}/${rows.length} image prompts AI-generated.`
);
