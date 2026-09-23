import { readFileSync } from 'node:fs';

const secret = process.env.WEBHOOK_SECRET || '';
if (!/^[a-f0-9]{64}$/i.test(secret)) {
  console.error('Set WEBHOOK_SECRET in .env first');
  process.exit(1);
}
const callback = URL.parse(process.env.CALLBACK_URL || '');
if (callback?.protocol !== 'https:') {
  console.error('Set CALLBACK_URL in .env to a public HTTPS URL');
  process.exit(1);
}
callback.searchParams.set('token', secret);
const template = JSON.parse(readFileSync('template.json', 'utf8'));
template.callback = callback.href;

const response = await fetch(
  `https://api.shotstack.io/edit/v1/templates/${process.env.SHOTSTACK_TEMPLATE_ID}`,
  {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.SHOTSTACK_API_KEY
    },
    body: JSON.stringify({ name: 'Scheduled product video', template }),
    signal: AbortSignal.timeout(30_000)
  }
);
if (!response.ok) {
  await response.body?.cancel();
  console.error(
    [401, 403].includes(response.status)
      ? 'The API rejected the key. Check SHOTSTACK_API_KEY in .env'
      : `Template update: HTTP ${response.status}`
  );
  process.exit(1);
}
console.log('Callback enabled for future renders');
