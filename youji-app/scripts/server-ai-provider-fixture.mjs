// Only loaded by the isolated browser suite's child server, never production.
// Synthetic official-endpoint transport keeps real API routing/auth/SSE intact.
if (process.env.NODE_ENV !== 'test' || process.env.SERVER_AI_API_KEY !== 'FIXTURE-BROWSER-SHARED-NOT-A-REAL-KEY') throw Error('Refusing provider fixture outside its isolated test server');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.href === 'https://api.deepseek.com/v1/chat/completions') {
    if (init?.redirect !== 'error') throw Error('Expected redirects disabled');
    const body = JSON.parse(String(init?.body));
    if (body.model !== 'deepseek-synthetic-browser' || body.max_tokens !== 1024 || body.thinking?.type !== 'disabled') throw Error('Unexpected shared provider contract');
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Synthetic shared provider response' } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return originalFetch(input, init);
  throw Error('External network is disabled in the synthetic browser provider fixture');
};
