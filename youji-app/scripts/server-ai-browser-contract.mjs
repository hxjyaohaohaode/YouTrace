import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { sampleStableCoachEvidence, coachEvidenceFailures } from './coach-evidence-layout-contract.mjs';

// Real rendered controls + authenticated HTTP + actual SSE parsing. The only
// fixture is the server-side provider transport; no real API key or model call.
export async function exerciseServerAI(page, { route, clickControl, fillControl, artifactDir }) {
  const shared = '[aria-label="本次页面使用部署者的基础模型"]';
  const requests = [];
  async function captureSettled(name, expectedResponse, expectedWidth = page.viewport().width) {
    let geometry;
    try {
      const sample = await page.waitForFunction(sampleStableCoachEvidence, { timeout: 20000, polling: 'raf' }, expectedResponse);
      geometry = await sample.jsonValue(); await sample.dispose();
    } catch (error) {
      geometry = await page.evaluate(() => window.__youtraceCoachEvidenceSample?.snapshot ?? null);
      await writeFile(join(artifactDir, `${name}-layout.json`), JSON.stringify({ passed: false, geometry, failure: 'Readiness timeout' }, null, 2));
      throw error;
    }
    const failures = coachEvidenceFailures(geometry);
    if (geometry.viewport.width !== expectedWidth) failures.push('Captured viewport differs from the requested evidence width');
    await writeFile(join(artifactDir, `${name}-layout.json`), JSON.stringify({ passed: failures.length === 0, geometry, failures }, null, 2));
    assert.deepEqual(failures, [], JSON.stringify(geometry));
    await page.screenshot({ path: join(artifactDir, `${name}.png`), fullPage: true });
  }
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
    await captureSettled('server-ai-explicit-consent-response', 'Synthetic shared provider response');
    const desktopViewport = page.viewport();
    try {
      await page.setViewport({ width: 390, height: 844 });
      await captureSettled('server-ai-explicit-consent-mobile', 'Synthetic shared provider response', 390);
    } finally { await page.setViewport(desktopViewport); }
    await route(page, '/settings'); await route(page, '/coach'); await page.waitForSelector(shared);
    assert.equal(await page.$eval(shared, el => el.checked), false);
    await fillControl(page, 'textarea[aria-label="输入消息"]', '查看待办');
    await clickControl(page, '[aria-label="发送消息"]');
    await page.waitForFunction(() => document.body.textContent.includes('规则回复'));
    assert.equal(requests.length, 2); assert.equal(requests[1].serverAI, undefined); assert.equal(requests[1].aiConnection, undefined);
    await captureSettled('server-ai-page-reset-rules', '规则回复');
  } finally { page.off('request', observe); }
}
