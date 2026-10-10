import assert from 'node:assert/strict';
import { join } from 'node:path';

// Real rendered controls + authenticated HTTP + actual SSE parsing. The only
// fixture is the server-side provider transport; no real API key or model call.
export async function exerciseServerAI(page, { route, clickControl, fillControl, artifactDir }) {
  const shared = '[aria-label="本次页面使用部署者的基础模型"]';
  const requests = [];
  const observe = request => { if (request.method() === 'POST' && request.url().endsWith('/api/chat')) requests.push(JSON.parse(request.postData())); };
  page.on('request', observe);
  try {
    await route(page, '/coach'); await page.waitForSelector(shared);
    assert.equal(await page.$eval(shared, el => el.checked), false);
    assert.equal(await page.evaluate(() => document.body.textContent.includes('https://api.deepseek.com/v1/chat/completions')), true);
    await clickControl(page, shared);
    await fillControl(page, 'textarea[aria-label="输入消息"]', 'Synthetic shared consent browser message');
    const reply = page.waitForResponse(response => response.url().endsWith('/api/chat') && response.request().method() === 'POST');
    await clickControl(page, '[aria-label="发送消息"]');
    assert.equal((await reply).status(), 200);
    await page.waitForFunction(() => document.body.textContent.includes('Synthetic shared provider response'));
    assert.equal(requests.length, 1); assert.equal(requests[0].serverAI.consent, true); assert.match(requests[0].serverAI.configurationId, /^[a-f0-9]{64}$/);
    assert.equal(requests[0].aiConnection, undefined);
    await page.screenshot({ path: join(artifactDir, 'server-ai-explicit-consent-response.png'), fullPage: true });
    const desktopViewport = page.viewport();
    try {
      await page.setViewport({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
      await page.screenshot({ path: join(artifactDir, 'server-ai-explicit-consent-mobile.png'), fullPage: true });
    } finally { await page.setViewport(desktopViewport); }
    await route(page, '/settings'); await route(page, '/coach'); await page.waitForSelector(shared);
    assert.equal(await page.$eval(shared, el => el.checked), false);
    await fillControl(page, 'textarea[aria-label="输入消息"]', '查看待办');
    await clickControl(page, '[aria-label="发送消息"]');
    await page.waitForFunction(() => document.body.textContent.includes('规则回复'));
    assert.equal(requests.length, 2); assert.equal(requests[1].serverAI, undefined); assert.equal(requests[1].aiConnection, undefined);
    await page.screenshot({ path: join(artifactDir, 'server-ai-page-reset-rules.png'), fullPage: true });
  } finally { page.off('request', observe); }
}
