import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const secret = process.env.WEBHOOK_SECRET || '';
if (!/^[a-f0-9]{64}$/i.test(secret)) {
  console.error('Set WEBHOOK_SECRET in .env to the generated hex string');
  process.exit(1);
}
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
mkdirSync('inbox', { recursive: true });

const server = createServer(async (request, response) => {
  const reply = code => {
    response.writeHead(code);
    response.end();
  };
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'POST' || url.pathname !== '/webhook')
      return reply(404);
    const received = Buffer.from(url.searchParams.get('token') || '');
    const expected = Buffer.from(secret);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return reply(403);

    request.setEncoding('utf8');
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 16_384) return reply(413);
    }
    let event;
    try {
      event = JSON.parse(body);
    } catch {
      return reply(400);
    }
    const renderId =
      event?.type === 'edit' && event.action === 'render'
        ? event.id
        : event?.type === 'serve' && event.action === 'copy'
          ? event.render
          : null;
    if (!UUID.test(renderId)) return reply(400);

    try {
      writeFileSync(`inbox/${renderId}`, '', { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    reply(204);
  } catch {
    if (!response.headersSent) reply(500);
  }
});
server.requestTimeout = 8000;
server.headersTimeout = 8000;
server.on('error', error => {
  console.error(
    error.code === 'EADDRINUSE'
      ? 'Port 3000 is in use. Stop the other receiver first'
      : error.message
  );
  process.exit(1);
});
server.listen(3000, '127.0.0.1', () =>
  console.log('Receiver listening on 127.0.0.1:3000')
);
