const key = process.env.SHOTSTACK_API_KEY;
const templateId = process.env.SHOTSTACK_TEMPLATE_ID;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
if (!key || !UUID.test(templateId)) {
  console.error('Set SHOTSTACK_API_KEY and SHOTSTACK_TEMPLATE_ID in .env');
  process.exit(1);
}
const secret = process.env.WEBHOOK_SECRET || '';
if (!/^[a-f0-9]{64}$/i.test(secret)) {
  console.error('Set WEBHOOK_SECRET in .env first');
  process.exit(1);
}
const callbackUrl = process.env.CALLBACK_URL || '';
const callback = URL.canParse(callbackUrl) && new URL(callbackUrl);
if (callback?.protocol !== 'https:') {
  console.error('Set CALLBACK_URL in .env to a public HTTPS URL');
  process.exit(1);
}
callback.searchParams.set('token', secret);

async function api(method, body) {
  const response = await fetch(
    `https://api.shotstack.io/edit/v1/templates/${templateId}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    }
  ).catch(() => {
    console.error(
      'Network error: could not reach api.shotstack.io. Check the connection and try again'
    );
    process.exit(1);
  });
  if (!response.ok) {
    console.error(
      [401, 403].includes(response.status)
        ? 'The API rejected the key. Check SHOTSTACK_API_KEY in .env'
        : response.status === 404
          ? 'Template not found. Check SHOTSTACK_TEMPLATE_ID in .env'
          : `Template ${method}: HTTP ${response.status}`
    );
    process.exit(1);
  }
  return (await response.json()).response;
}

// Update the saved template, not the local file, so edits made in Studio survive.
const saved = await api('GET');
saved.template.callback = callback.href;
await api('PUT', { name: saved.name, template: saved.template });
console.log('Callback enabled for future renders');
