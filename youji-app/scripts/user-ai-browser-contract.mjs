// Actual browser controls and authenticated API writes. Only fixture credentials
// are entered; no probe or model message is submitted, so external calls are zero.
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function exerciseUserAI(page, { route, clickControl, clickButton, fillControl, artifactDir }) {
  const panel = 'section[aria-label="我的 AI 连接"]';
  let probes = 0, chats = 0;
  const observe = request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/ai-connection/probe')) probes++;
    if (request.method() === 'POST' && request.url().endsWith('/api/chat')) chats++;
  };
  page.on('request', observe);
  try {
    await route(page, '/settings');
    await page.waitForSelector(`${panel} fieldset:not([disabled])`);
    assert.equal(await page.$eval(`${panel} select`, el => el.value), '');
    assert.equal(await page.$eval(`${panel} input[placeholder]`, el => el.value), '');
    assert.equal(await page.$eval(`${panel} input[type=password]`, el => el.value), '');
    await clickControl(page, `${panel} select`);
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.$eval(`${panel} select`, el => el.value), 'deepseek');
    await fillControl(page, `${panel} input[placeholder]`, 'synthetic-user-selected-model');
    await fillControl(page, `${panel} input[type=password]`, 'FIXTURE-BROWSER-NOT-A-REAL-KEY');
    assert.equal(await page.$eval('[aria-label="允许对话外发"]', el => el.checked), false);
    await clickControl(page, '[aria-label="允许对话外发"]');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/ai-connection') && response.request().method() === 'PUT');
    await clickButton(page, '添加我的模型', panel);
    const response = await saved; assert.equal(response.status(), 200);
    const data = await response.json(); assert.equal(data.connection.providerId, 'deepseek');
    assert.equal(JSON.stringify(data).includes('FIXTURE-BROWSER-NOT-A-REAL-KEY'), false);
    await page.waitForFunction(selector => document.querySelector(`${selector} input[type=password]`)?.value === '', {}, panel);
    assert.equal(probes, 0); assert.equal(chats, 0);
    await page.screenshot({ path: join(artifactDir, 'user-ai-saved-connection.png'), fullPage: true });
    await route(page, '/coach');
    await page.waitForSelector('[aria-label="本次页面使用我的模型"]');
    assert.equal(await page.$eval('[aria-label="本次页面使用我的模型"]', el => el.checked), false);
    assert.equal(probes, 0); assert.equal(chats, 0);
    await page.screenshot({ path: join(artifactDir, 'user-ai-coach-default.png'), fullPage: true });
    await clickControl(page, '[aria-label="本次页面使用我的模型"]');
    assert.equal(await page.$eval('[aria-label="本次页面使用我的模型"]', el => el.checked), true);
    await page.waitForSelector('[aria-label="本次页面使用部署者的基础模型"]');
    await clickControl(page, '[aria-label="本次页面使用部署者的基础模型"]');
    assert.equal(await page.$eval('[aria-label="本次页面使用我的模型"]', el => el.checked), false);
    assert.equal(await page.$eval('[aria-label="本次页面使用部署者的基础模型"]', el => el.checked), true);
    await route(page, '/settings'); await route(page, '/coach');
    await page.waitForSelector('[aria-label="本次页面使用我的模型"]');
    assert.equal(await page.$eval('[aria-label="本次页面使用我的模型"]', el => el.checked), false);
    assert.equal(probes, 0); assert.equal(chats, 0);
    await route(page, '/settings');
    await page.waitForSelector('[aria-label="确认删除模型连接"]');
    await clickControl(page, '[aria-label="确认删除模型连接"]');
    const removed = page.waitForResponse(response => response.url().endsWith('/api/ai-connection/remove') && response.request().method() === 'POST');
    await clickButton(page, '删除我的连接', panel);
    assert.equal((await removed).status(), 200);
    await page.waitForFunction(selector => document.querySelector(`${selector} select`)?.value === '', {}, panel);
    await route(page, '/coach');
    await page.waitForFunction(() => document.body.textContent.includes('当前使用本地规则回复，未调用外部模型。'));
    assert.equal(probes, 0); assert.equal(chats, 0);
    await page.screenshot({ path: join(artifactDir, 'user-ai-coach-local-rules.png'), fullPage: true });
  } finally { page.off('request', observe); }
}
