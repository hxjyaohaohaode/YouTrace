// Immediate current-plan adjustment only. Historical rule scheduling is a
// separate unsupported capability; this journey never awards it a pass.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export async function runCurrentFrequencyJourney(page, api, target, neighbor, label, h) {
  const { card, facts, preserved, pointer, readControl, readable, capture, observe, segment, actions, writeFile, join, artifacts, home, enter, closeDialogs, sleep } = h;
  let savedFacts;
  const previewSelector = '[role=dialog] [aria-label="频率调整预览"]';
  const version = result => result.local.settings.find(row => row.key === `sync-version:habits:${target.id}`)?.value;
  async function openDaily() {
    const root = await card(page, target);
    await pointer(page, `${root} button[aria-label=${JSON.stringify(`调整频率 ${target.name}`)}]`);
    await page.waitForSelector('[role=dialog]');
    assert.equal(await page.$eval('[role=dialog] h3', el => el.textContent), '调整当前频率');
    await pointer(page, '[role=dialog] [aria-label="选择频率"] button', '每天');
    await readControl(page, previewSelector);
    const preview = await readable(page, previewSelector);
    const policy = await page.$eval('[role=dialog] [aria-label="频率调整范围说明"]', el => el.innerText);
    await observe(page, `${label}-immediate-current-frequency-preview`, preview.visible && /立即/.test(preview.text) && /保存前：本周已完成/.test(preview.text) && /保存后：今天尚未记录/.test(preview.text) && /历史打卡日期保持原样/.test(policy) && /不支持指定未来生效日期/.test(policy), JSON.stringify({ preview, policy, scope: 'Immediate change to current progress only; no future-effective or historical target-score claim' }));
    await capture(page, `${label}-immediate-preview-before-save`);
    const scopeSelector = '[role=dialog] [aria-label="频率调整范围说明"]';
    await readControl(page, scopeSelector); const scopeReading = await readable(page, scopeSelector); await capture(page, `${label}-immediate-scope-before-save`);
    await observe(page, `${label}-immediate-scope-readable-before-choice-commit`, scopeReading.visible && /历史打卡日期保持原样/.test(scopeReading.text) && /不支持指定未来生效日期/.test(scopeReading.text), JSON.stringify({ scopeReading }));
  }
  await segment(page, `${label}-immediate-frequency-cancel`, async () => {
    const before = await facts(page, api, `${label}-frequency-before-cancel`, [target.id, neighbor.id]);
    await openDaily(); await pointer(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const after = await facts(page, api, `${label}-frequency-after-cancel`, [target.id, neighbor.id]);
    await observe(page, `${label}-cancel-preserves-rule-version-and-every-date`, preserved(before, after) && version(before) === version(after), 'Native cancel leaves complete same-ID parent/child sources, same-name neighbor and canonical version unchanged');
  });
  await segment(page, `${label}-immediate-frequency-quota-retry`, async () => {
    const before = await facts(page, api, `${label}-frequency-before-fault`, [target.id, neighbor.id]);
    await openDaily();
    await page.evaluate(({ owner, id }) => {
      const original = IDBObjectStore.prototype.put; let timer;
      window.__habitFrequencyFault = { owner, id, hits: [], expired: false, restored: false, restoredAt: null, restoredBy: null };
      window.__restoreHabitFrequency = (reason = 'explicit-harness-release') => { clearTimeout(timer); IDBObjectStore.prototype.put = original; Object.assign(window.__habitFrequencyFault, { restored: IDBObjectStore.prototype.put === original, restoredAt: Date.now(), restoredBy: reason }); };
      timer = setTimeout(() => { window.__habitFrequencyFault.expired = true; window.__restoreHabitFrequency('safety-timeout'); }, 30000);
      IDBObjectStore.prototype.put = function(value, ...keys) { if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'habits' && this.transaction.mode === 'readwrite' && value?.id === id) { window.__habitFrequencyFault.hits.push({ at: Date.now(), id, frequency: value.frequency }); throw new DOMException('Synthetic exact current-frequency quota', 'QuotaExceededError'); } return original.call(this, value, ...keys); };
    }, { owner: api.ownerId, id: target.id });
    actions.push({ kind: 'test-only-IDB-current-frequency-put-quota', habitId: target.id, scope: 'Exact account DB, parent ID and native put only; no record injection' });
    try {
      await pointer(page, '[role=dialog] button', '保存'); await page.waitForSelector('[role=dialog] [role=alert]');
      await readControl(page, '[role=dialog] [role=alert]'); const reading = await readable(page, '[role=dialog] [role=alert]');
      const fault = await page.evaluate(() => window.__habitFrequencyFault);
      const selected = await page.$$eval('[role=dialog] [aria-label="选择频率"] button', rows => rows.filter(el => el.getAttribute('aria-pressed') === 'true').map(el => el.textContent));
      const after = await facts(page, api, `${label}-frequency-failed-state`, [target.id, neighbor.id], { fault });
      await capture(page, `${label}-frequency-quota-retained-choice`);
      await observe(page, `${label}-quota-preserves-original-and-selected-new-frequency`, fault.hits.length > 0 && !fault.expired && reading.visible && /空间不足.*没有保存/.test(reading.text) && /所选频率仍保留/.test(reading.text) && isDeepStrictEqual(selected, ['每天']) && preserved(before, after) && version(before) === version(after), JSON.stringify({ reading, selected, fault, originalFrequency: before.local.habits.find(row => row.id === target.id)?.frequency }));
    } finally {
      const fault = await page.evaluate(() => { window.__restoreHabitFrequency(); return window.__habitFrequencyFault; });
      await writeFile(join(artifacts, `${label}-frequency-fault.json`), JSON.stringify(fault, null, 2));
      actions.push({ kind: 'restore-test-IDB-current-frequency-put', habitId: target.id, ...fault });
      assert.ok(fault.restored && !fault.expired && fault.restoredBy === 'explicit-harness-release', 'The exact fault must be explicitly released, never expire into success');
    }
    // Same still-open dialog, original source and chosen daily intent; no reload
    // or write API is used to manufacture a fresh source after failure.
    await readControl(page, '[role=dialog] > div:last-child > button:last-child');
    await pointer(page, '[role=dialog] button', '重试保存');
    actions.push({ kind: 'native-current-frequency-visible-retry', habitId: target.id, observedLabel: '重试保存' });
    await page.waitForSelector('[role=dialog]', { hidden: true });
    const after = await facts(page, api, `${label}-frequency-saved-daily`, [target.id, neighbor.id]); savedFacts = after;
    const old = before.local.habits.find(row => row.id === target.id), next = after.local.habits.find(row => row.id === target.id);
    const { frequency: _oldFrequency, updatedAt: _oldUpdated, ...oldRest } = old;
    const { frequency: _newFrequency, updatedAt: _newUpdated, ...newRest } = next;
    const server = after.server.find(row => row.id === target.id);
    const canonicalServer = row => { const { frequency, updatedAt, done, streak, recentCheckins, period, ...canonical } = row; return canonical; };
    const unchangedServerSource = isDeepStrictEqual(canonicalServer(before.server.find(row => row.id === target.id)), canonicalServer(server));
    const unchangedLocalNeighbor = isDeepStrictEqual(before.local.habits.find(row => row.id === neighbor.id), after.local.habits.find(row => row.id === neighbor.id));
    await observe(page, `${label}-same-id-current-rule-only-cloud-ack`, next.frequency === 'daily' && server?.frequency === 'daily' && unchangedServerSource && unchangedLocalNeighbor && before.local.habits.length === after.local.habits.length && before.server.length === after.server.length && isDeepStrictEqual(oldRest, newRest) && next.updatedAt > old.updatedAt && BigInt(version(after)) > BigInt(version(before)) && isDeepStrictEqual(before.local.habitCheckins, after.local.habitCheckins) && isDeepStrictEqual(before.checkins, after.checkins) && isDeepStrictEqual(before.server.find(row => row.id === neighbor.id), after.server.find(row => row.id === neighbor.id)) && after.local.outbox.length === 0, JSON.stringify({ id: target.id, unchangedServerSource, unchangedLocalNeighbor, beforeVersion: version(before), afterVersion: version(after), localUpdatedAt: next.updatedAt, serverUpdatedAt: server?.updatedAt, note: 'Observed local/server audit clocks stay separate; no timestamp is asserted to be a future-effective rule boundary' }));
  });
  await segment(page, `${label}-current-frequency-home-history-reopen`, async () => {
    await closeDialogs(page); await home(page);
    const cards = await page.$$eval('main button', rows => rows.filter(el => /习惯打卡/.test(el.innerText)).map(el => el.innerText));
    assert.equal(cards.length, 1);
    const homeSelector = await page.evaluate(() => { const el = [...document.querySelectorAll('main button')].find(row => /习惯打卡/.test(row.innerText)), parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(sibling => sibling.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); } return 'body > ' + parts.join(' > '); });
    await readControl(page, homeSelector); const homeReading = await readable(page, homeSelector); await capture(page, `${label}-current-daily-mixed-home`);
    await observe(page, `${label}-home-separates-current-daily-and-weekly`, homeReading.visible && /今日 0\/1.*本周 1\/1/.test(cards[0]), JSON.stringify({ cards, homeReading }));
    await enter(page); const root = await card(page, target); await readControl(page, root); const reading = await readable(page, root);
    await observe(page, `${label}-historical-dates-stay-labelled-actual-records`, reading.visible && /今天尚未记录/.test(reading.text) && /近7天实际记录/.test(reading.text) && !/完成率/.test(reading.text), JSON.stringify({ reading }));
    await pointer(page, `${root} button[aria-label=${JSON.stringify(`调整频率 ${target.name}`)}]`); await page.waitForSelector('[role=dialog]');
    const selected = await page.$$eval('[role=dialog] [aria-label="选择频率"] button', rows => rows.filter(el => el.getAttribute('aria-pressed') === 'true').map(el => el.textContent));
    await readControl(page, '[role=dialog] [aria-label="上次修改时间"]'); const changed = await readable(page, '[role=dialog] [aria-label="上次修改时间"]');
    assert.ok(savedFacts, 'The same source must have saved before reopening can prove its timestamp');
    const expectedUpdatedAt = savedFacts.local.habits.find(row => row.id === target.id).updatedAt;
    const expectedTime = await page.evaluate(value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), expectedUpdatedAt);
    await capture(page, `${label}-reopened-current-frequency-and-change-time`);
    await observe(page, `${label}-reopened-current-daily-with-change-time`, isDeepStrictEqual(selected, ['每天']) && changed.visible && changed.text.includes(expectedTime), JSON.stringify({ selected, changed, expectedUpdatedAt, expectedTime }));
    await pointer(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
    await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-current-frequency', habitId: target.id }); await sleep(200);
    const final = await facts(page, api, `${label}-frequency-after-reload`, [target.id, neighbor.id]);
    assert.ok(preserved(savedFacts, final) && version(savedFacts) === version(final), 'Reopening/cancelling and reloading must not add another change or alter any date');
    await observe(page, `${label}-same-current-frequency-survives-reload`, final.local.habits.find(row => row.id === target.id)?.frequency === 'daily' && final.server.find(row => row.id === target.id)?.frequency === 'daily' && final.checkins.some(row => row.habitId === target.id && row.date === '2026-10-06' && row.done) && !final.checkins.some(row => row.habitId === target.id && row.date === '2026-10-07' && row.done) && final.local.outbox.length === 0, 'Current daily rule survives native reload; Tuesday remains factual and Wednesday remains unmarked');
  });
}
