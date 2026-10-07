// Native empty-account reminder RED baseline. No app imports or injected state.
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { readExistingAccount } from './audit-initial-session-outcomes.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { captureReturnChecks, decodeCaptureEvidence } from './audit-capture-return-outcomes.mjs';
import { acknowledgedPreferences, exactPreferenceAck, PREFERENCE_STATE_KEY, validPreferenceWire, wirePreferenceChanges } from './audit-preference-contract.mjs';
import { chatRecoveryChecks } from './audit-chat-input-recovery.mjs';

const TITLE = '今天还有什么想记录的吗？';
const BODY = '一天快结束了，回顾一下今天发生的事，用一句话记录下来吧。';
const ACTIONS = [{ label: '去记录', type: 'chat' }, { label: '今天够了', type: 'dismiss' }];
const BUSINESS = ['todos', 'expenses', 'quickNotes', 'diary', 'habits', 'habitCheckins', 'schedules', 'goalRecords'];
const DELIVERY = `pushDelivery:evening_review:${TITLE}`;
const BELL = 'main button[aria-label^="教练洞察"]';
const TIME = '[data-component="time-preference"]:has(#evening-review-time)';
const PROFILES = [{ width: 1280, height: 900, phone: '13900008971', action: '去记录' }, { width: 360, height: 800, phone: '13900008972', action: '今天够了' }];
const settings = facts => facts.local.settings;
const setting = (facts, key) => settings(facts).find(row => row.key === key);
// Existing ACK helpers only need settings rows. Keep their read-only shape,
// using the decoded source rather than the ordinary CDP/JSON rows.
const preferenceSource = facts => ({ tables: [{ name: 'settings', rows: settings(facts) }] });
const sameRows = (a, b) => equal([...a].sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key))), [...b].sort((x, y) => String(x.id ?? x.key).localeCompare(String(y.id ?? y.key))));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function businessClock(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const part = name => parts.find(row => row.type === name).value;
  return { day: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
function insideQuiet(time, values) {
  return values.quietEnabled && (values.quietStart <= values.quietEnd ? time >= values.quietStart && time < values.quietEnd : time >= values.quietStart || time < values.quietEnd);
}
function clockStillCurrent(frozen, instant) {
  const current = businessClock(instant), minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return current.day === frozen.day && Math.abs(minutes(current.time) - minutes(frozen.time)) <= 30;
}
function project(raw) {
  assert.ok(raw && Array.isArray(raw.tables) && Array.isArray(raw.schema));
  assert.equal(new Set(raw.tables.map(row => row.name)).size, raw.tables.length);
  const local = {}, keys = {};
  for (const table of raw.tables) {
    local[table.name] = decodeCaptureEvidence(table.losslessRows); keys[table.name] = decodeCaptureEvidence(table.keys);
    assert.ok(Array.isArray(local[table.name]) && Array.isArray(keys[table.name]) && local[table.name].length === keys[table.name].length, 'Complete lossless rows and keys required');
    assert.ok(keys[table.name].every((key, index, all) => !all.slice(0, index).some(prior => equal(prior, key))), 'Physical source keys must be unique');
  }
  for (const name of [...BUSINESS, 'settings', 'outbox', 'coachPushes', 'coachInsights']) assert.ok(Array.isArray(local[name]), `Missing source table ${name}`);
  for (const [name, key] of [['settings', 'key'], ['coachPushes', 'id']]) assert.ok(equal(keys[name], local[name].map(row => row[key])), `Exact ${name} physical keys required`);
  return { databaseName: raw.databaseName, version: raw.version, schema: raw.schema, local, keys };
}
function complete(facts) {
  assert.ok(facts.owner && facts.databaseName === `youtrace:user:${facts.owner}:schedule-v1`);
  assert.ok(Number.isFinite(facts.startedAt) && Number.isFinite(facts.finishedAt) && facts.finishedAt >= facts.startedAt);
  for (const name of [...BUSINESS, 'outbox', 'coachInsights', 'coachPushes', 'settings']) assert.ok(Array.isArray(facts.local[name]), `Missing source ${name}`);
  assert.ok(captureReturnChecks.completeLedgerPage(facts.cloud.ledger, '0') && !facts.cloud.ledger.hasMore, 'New empty account requires a complete ledger from zero, never a partial source');
  assert.ok(Array.isArray(facts.cloud.pushes.pushes) && facts.cloud.pushes.pushes.length < 50, 'Push API cap cannot prove completeness');
  assert.ok(Array.isArray(facts.cloud.insights.insights) && facts.cloud.insights.insights.length < 100, 'Insight API cap cannot prove completeness');
  const insightIds = facts.cloud.insights.insights.map(row => row?.id);
  assert.ok(insightIds.every(id => typeof id === 'string' && id.length > 0) && new Set(insightIds).size === insightIds.length, 'Cloud insight IDs must be present and unique');
  chatRecoveryChecks.validateChatSources(facts.cloud.chat);
  return facts;
}
function empty(facts, { pushes = false } = {}) {
  complete(facts);
  return [...BUSINESS, 'outbox', ...(pushes ? ['coachPushes'] : [])].every(name => facts.local[name].length === 0) && facts.cloud.ledger.events.length === 0 && facts.cloud.pushes.pushes.length === 0 && facts.cloud.chat.rawSessions.sessions.length === 0;
}
function differences(before, after) {
  return [...new Set([...settings(before), ...settings(after)].map(row => row.key))].sort().flatMap(key => equal(setting(before, key), setting(after, key)) ? [] : [{ key, before: setting(before, key), after: setting(after, key) }]);
}
function preserved(before, after, { writes = {}, pushRows = before.local.coachPushes, remoteSettings = before.cloud.preferences } = {}) {
  complete(before); complete(after);
  if (before.owner !== after.owner || before.databaseName !== after.databaseName || before.version !== after.version || !equal(before.schema, after.schema) || !equal(Object.keys(before.local).sort(), Object.keys(after.local).sort())) return false;
  if (!equal({ ...before.cloud, preferences: remoteSettings }, after.cloud)) return false;
  if (!sameRows(pushRows, after.local.coachPushes) || !equal(after.keys.coachPushes, after.local.coachPushes.map(row => row.id)) || !equal(after.keys.settings, after.local.settings.map(row => row.key))) return false;
  if (!Object.keys(before.local).filter(name => !['settings', 'coachPushes'].includes(name)).every(name => equal(before.local[name], after.local[name]) && equal(before.keys[name], after.keys[name]))) return false;
  if (!Object.entries(writes).every(([key, value]) => equal(setting(after, key), { key, value }) && (!setting(before, key) || Object.keys(setting(before, key)).sort().join(',') === 'key,value'))) return false;
  return differences(before, after).every(diff => {
    if (Object.hasOwn(writes, diff.key)) return true;
    if (diff.key !== 'lastPullAt' || !equal(Object.keys(diff.after ?? {}).sort(), ['key', 'value']) || diff.before && !equal(Object.keys(diff.before).sort(), ['key', 'value'])) return false;
    return iso(diff.after.value) && Date.parse(diff.after.value) >= before.startedAt && Date.parse(diff.after.value) <= after.finishedAt && (!diff.before || iso(diff.before.value) && Date.parse(diff.after.value) >= Date.parse(diff.before.value));
  });
}
function preferenceChanged(before, after, key, value, requests, responses) {
  const old = setting(before, PREFERENCE_STATE_KEY)?.value, next = setting(after, PREFERENCE_STATE_KEY)?.value, changes = wirePreferenceChanges({ [key]: value });
  if (!acknowledgedPreferences(preferenceSource(before), before.cloud.preferences) || !acknowledgedPreferences(preferenceSource(after), after.cloud.preferences)) return false;
  const remoteSettings = { ...before.cloud.preferences, revision: after.cloud.preferences.revision, settings: { ...before.cloud.preferences.settings, ...changes } };
  if (!equal(after.cloud.preferences, remoteSettings) || BigInt(after.cloud.preferences.revision) !== BigInt(before.cloud.preferences.revision) + 1n) return false;
  if (!Number.isSafeInteger(next.localRevision) || next.localRevision <= old.localRevision || !equal(next, { ...old, localRevision: next.localRevision, server: { ...old.server, revision: after.cloud.preferences.revision, settings: { ...old.server.settings, [key]: value } } })) return false;
  if (!requests.length || !requests.every(row => validPreferenceWire(row?.body) && row.account === before.owner && row.body.baseRevision === before.cloud.preferences.revision && equal(row.body.changes, changes)) || new Set(requests.map(row => row.body.mutationId)).size !== 1 || !exactPreferenceAck(requests, responses, before.owner, after.cloud.preferences)) return false;
  return preserved(before, after, { writes: { [key]: value, [PREFERENCE_STATE_KEY]: next }, remoteSettings });
}
function delivered(before, after, clock, window) {
  if (!empty(before, { pushes: true }) || !empty(after) || after.local.coachPushes.length !== 1 || !clockStillCurrent(clock, window.after)) return false;
  const row = after.local.coachPushes[0]; if (typeof row.id !== 'string') return false;
  const match = /^push-(\d+)-[a-z0-9]+$/.exec(row.id), idTime = match && Number(match[1]);
  if (!Number.isSafeInteger(idTime) || idTime < window.before || idTime > window.after || !Number.isSafeInteger(row.createdAt) || row.createdAt < idTime || row.createdAt > window.after) return false;
  if (!equal(row, { id: row.id, type: 'evening_review', title: TITLE, body: BODY, actions: ACTIONS, read: false, acted: false, origin: 'local', createdAt: row.createdAt })) return false;
  for (const [key, value] of Object.entries({ pushControlDate: clock.day, pushControlCount: 0, todayPositiveCount: 0 })) if (setting(before, key) && !equal(setting(before, key), { key, value })) return false;
  if (setting(before, DELIVERY) || setting(before, 'consecutiveIgnores') && setting(before, 'consecutiveIgnores').value !== 0 || setting(before, 'silenceUntil') && setting(before, 'silenceUntil').value !== null) return false;
  return preserved(before, after, { pushRows: [row], writes: { pushControlDate: clock.day, pushControlCount: 1, todayPositiveCount: 0, [DELIVERY]: clock.day } });
}
function opened(before, after) {
  const original = before.local.coachPushes[0], current = after.local.coachPushes[0];
  return Boolean(before.local.coachPushes.length === 1 && original && current && typeof original.read === 'boolean' && typeof current.read === 'boolean' && (!original.read || current.read) && equal(current, { ...original, read: current.read }) && preserved(before, after, { pushRows: [current] }));
}
function feedback(before, after, action, composer) {
  const target = before.local.coachPushes[0], ignores = setting(before, 'consecutiveIgnores')?.value ?? 0;
  if (before.local.coachPushes.length !== 1 || !target || !empty(after) || !Number.isSafeInteger(ignores) || ignores < 0) return false;
  const writes = { consecutiveIgnores: action === '去记录' ? 0 : ignores + 1 };
  if (action === '去记录') {
    const key = composer?.key; if (typeof key !== 'string') return false;
    const context = setting(after, `${key}:context`)?.value;
    if (!/^capture-input:[a-f0-9]{32}$/.test(key) || setting(before, key) || setting(before, `${key}:context`) || !context || !Number.isSafeInteger(context.capturedAt) || context.capturedAt < composer.before || context.capturedAt > composer.after || !equal(context, { capturedAt: context.capturedAt, timeZone: 'Asia/Shanghai', date: businessClock(context.capturedAt).day }) || context.date !== composer.day) return false;
    writes[key] = ''; writes[`${key}:context`] = context;
  } else if (action !== '今天够了') return false;
  return preserved(before, after, { writes, pushRows: action === '去记录' ? [{ ...target, read: true, acted: true }] : [] });
}
export const reminderEntryChecks = { title: TITLE, body: BODY, actions: ACTIONS, profiles: PROFILES, business: BUSINESS, delivery: DELIVERY, project, complete, empty, differences, preserved, preferenceChanged, delivered, opened, feedback, businessClock, insideQuiet, clockStillCurrent };

async function bounded(promise, name) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name}: incomplete read after 5 seconds`)), 5000); })]); }
  finally { clearTimeout(timer); }
}

export async function runReminderEntry(h) {
  const { isolated, login, pointer, waitPath, apiFor, capture, observe, sleep, actions, artifacts, writeFile, join } = h;
  for (const config of PROFILES) await isolated(`Y3-reminder-entry-${config.width}`, { width: config.width, height: config.height }, async page => {
    const label = `Y3-reminder-entry-${config.width}`;
    let api, stage = 'login', failureSaved = false;
    const requests = [], responses = [], pending = [], briefs = [], generations = [], briefByRequest = new Map(), generationByRequest = new Map();
    const save = (name, value) => writeFile(join(artifacts, `${label}-${name}.json`), JSON.stringify({ syntheticOnly: true, observedAt: new Date().toISOString(), stage, ...value }, null, 2));
    const onRequest = request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/coach/brief' && request.method() === 'GET') { const row = { startedAt: Date.now(), finishedAt: null }; briefs.push(row); briefByRequest.set(request, row); }
      if (path === '/api/coach/generate-brief' && request.method() === 'POST') { const row = { startedAt: Date.now(), finishedAt: null }; generations.push(row); generationByRequest.set(request, row); }
      if (path === '/api/user/settings' && request.method() === 'PATCH') requests.push({ body: JSON.parse(request.postData()), account: request.headers()['x-youtrace-account'] });
    };
    const onFinished = request => { for (const map of [briefByRequest, generationByRequest]) { const row = map.get(request); if (row) row.finishedAt = Date.now(); } };
    const onResponse = response => {
      const brief = briefByRequest.get(response.request()); if (brief) brief.status = response.status();
      const generated = generationByRequest.get(response.request()); if (generated) { generated.status = response.status(); pending.push(bounded(response.json(), 'native brief response body').then(body => { generated.body = body; }, error => { generated.error = error.message; })); }
      if (new URL(response.url()).pathname === '/api/user/settings' && response.request().method() === 'PATCH') { const row = { status: response.status(), request: JSON.parse(response.request().postData()) }; responses.push(row); pending.push(bounded(response.json(), 'settings ACK body').then(body => { row.body = body; }, error => { row.error = error.message; })); }
    };
    async function facts(name) {
      const startedAt = Date.now(), get = path => bounded(api(path), `source GET ${path}`);
      const [raw, ledger, pushes, insights, preferences, rawSessions] = await Promise.all([page.evaluate(readExistingAccount, api.ownerId), get('/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=500'), get('/coach/pushes'), get('/coach/insights?limit=100'), get('/user/settings'), get('/chat/sessions')]);
      assert.ok(Array.isArray(rawSessions.sessions) && rawSessions.sessions.length < 20);
      const rawMessages = Object.fromEntries(await Promise.all(rawSessions.sessions.map(async row => [row.id, await get(`/chat/sessions/${encodeURIComponent(row.id)}/messages`)])));
      await save(`${name}-raw`, { raw, ledger, pushes, insights, preferences, rawSessions, rawMessages });
      const value = { owner: api.ownerId, startedAt, finishedAt: Date.now(), raw, ...project(raw), cloud: { ledger, pushes, insights, preferences, chat: { rawSessions, rawMessages } } };
      await save(name, { source: value }); return complete(value);
    }
    async function exact(selector, text) {
      return page.evaluate(({ selector, text }) => {
        const nodes = [...document.querySelectorAll(selector)].filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (text === undefined || el.textContent.trim() === text); });
        if (nodes.length !== 1) throw new Error(`Expected one ordinary control: ${selector} ${text ?? ''}`);
        const parts = []; for (let el = nodes[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
        return `body > ${parts.join(' > ')}`;
      }, { selector, text });
    }
    async function read(selector, name, text) {
      const resolved = await exact(selector, text); let box;
      for (let index = 0; index < 7; index++) {
        box = await page.evaluate(initialSessionGeometry, resolved); assert.ok(box.unique);
        if (box.visible) break;
        const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, config.height - 20)), deltaY = box.rect.y + box.rect.height / 2 - y;
        if (Math.abs(deltaY) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY }); actions.push({ kind: 'native-wheel-reminder-reading', selector, x, y, deltaY }); }
        await sleep(125);
      }
      const content = await page.$eval(resolved, el => ({ text: el.textContent.trim(), tag: el.tagName, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      const completeText = /^(INPUT|TEXTAREA)$/.test(content.tag) || content.scrollWidth <= content.clientWidth && content.scrollHeight <= content.clientHeight;
      await save(`${name}-reading`, { selector: resolved, box, content }); await capture(page, `${label}-${name}`); assert.ok(box.visible && completeText && (text === undefined || content.text === text), 'Complete exact painted, clipped and foreground reading required'); return resolved;
    }
    async function tap(selector, text) { const resolved = await read(selector, `control-${actions.length}`, text); await pointer(page, resolved); }
    async function home() { await tap(config.width === 360 ? 'nav[aria-label="主导航"] button[aria-label="首页"]' : 'aside nav button', config.width === 360 ? undefined : '首页'); await waitPath(page, '/'); }
    async function settled(name, expected = {}) {
      let value; const end = Date.now() + 6000;
      do { value = await facts(name); if (acknowledgedPreferences(preferenceSource(value), value.cloud.preferences) && Object.entries(expected).every(([key, wanted]) => equal(setting(value, key)?.value, wanted))) { await Promise.all(pending); return value; } await sleep(100); } while (Date.now() < end);
      throw new Error('Complete ordinary settings acknowledgement not observed; no Home delivery claim');
    }
    async function change(before, key, value, selector, text) {
      if (equal(setting(before, key)?.value, value)) return before;
      const offset = requests.length; await tap(selector, text); const after = await settled(`settings-${key}`, { [key]: value });
      assert.ok(preferenceChanged(before, after, key, value, requests.slice(offset), responses), 'Only exact native preference mutation and full same-owner ACK may precede Home');
      await save(`settings-${key}-ack`, { before: before.cloud.preferences, after: after.cloud.preferences, requests: requests.slice(offset), responses, differences: differences(before, after) }); return after;
    }
    async function setCurrentTime(before, clock) {
      const selector = '#evening-review-time', wanted = clock.time;
      if (await page.$eval(selector, el => el.value) === wanted) return before;
      await tap(selector);
      // Same segmented native ArrowLeft/ArrowUp/Tab technique as the preference
      // journey. Read actual value after each key; support 12/24-hour segments.
      for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft'); }
      const targetHour = Number(wanted.slice(0, 2)), seen = new Set(); let meridiem = false;
      for (let i = 0; i < 25; i++) {
        const hour = Number((await page.$eval(selector, el => el.value)).slice(0, 2));
        if (hour === targetHour) break;
        if (seen.has(hour)) { meridiem = true; break; } seen.add(hour); await page.keyboard.press('ArrowUp');
      }
      if (meridiem) for (let i = 0; i < 12; i++) { if (Number((await page.$eval(selector, el => el.value)).slice(0, 2)) % 12 === targetHour % 12) break; await page.keyboard.press('ArrowUp'); }
      await page.keyboard.press('ArrowRight');
      const minute = Number((await page.$eval(selector, el => el.value)).slice(3)), delta = (Number(wanted.slice(3)) - minute + 60) % 60;
      for (let i = 0; i < Math.min(delta, 60 - delta); i++) { await page.keyboard.press(delta <= 30 ? 'ArrowUp' : 'ArrowDown'); }
      if (meridiem) { await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); }
      await page.keyboard.press('Tab'); assert.equal(await page.$eval(selector, el => el.value), wanted, 'Native time segments must show actual current Beijing minute before Save');
      actions.push({ kind: 'native-segmented-reminder-time', before: before.cloud.preferences.settings.eveningReviewTime, after: wanted });
      return change(before, 'eveningReviewTime', wanted, `${TIME} button`, '保存晚间复盘时间');
    }
    async function reminderSurface() {
      return page.evaluate(({ title, body, labels }) => {
        const path = node => { const parts = []; for (let el = node; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(row => row.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); } return `body > ${parts.join(' > ')}`; };
        const titles = [...document.querySelectorAll('main p, main h1, main h2, main h3')].filter(el => el.textContent === title);
        if (titles.length !== 1) return { found: false, titleCount: titles.length };
        for (let root = titles[0].parentElement; root && root.tagName !== 'MAIN'; root = root.parentElement) {
          const bodies = [...root.querySelectorAll('p')].filter(el => el.textContent === body), buttons = labels.map(label => [...root.querySelectorAll('button')].filter(el => el.textContent.trim() === label));
          if (bodies.length === 1 && buttons.every(rows => rows.length === 1)) return { found: true, title: path(titles[0]), body: path(bodies[0]), actions: buttons.map(rows => ({ selector: path(rows[0]), text: rows[0].textContent.trim(), disabled: rows[0].disabled })) };
        }
        return { found: false, titleCount: titles.length };
      }, { title: TITLE, body: BODY, labels: ACTIONS.map(row => row.label) });
    }
    async function finishedBrief(offset) {
      const end = Date.now() + 5000;
      do { if (briefs.slice(offset).some(row => row.status === 200 && row.finishedAt)) return; await sleep(75); } while (Date.now() < end);
      throw new Error('Ordinary Home brief HTTP completion not observed; return/delivery observation incomplete');
    }
    page.on('request', onRequest); page.on('response', onResponse); page.on('requestfinished', onFinished);
    try {
      await login(page, config.phone, `Synthetic Reminder ${config.width}`); await finishedBrief(0); api = await bounded(apiFor(page), 'native owner read');
      let prepared = await settled('initial-home-source'); assert.ok(empty(prepared, { pushes: true }));
      assert.equal(generations.length, 1, 'One native initial Home brief must finish before source freeze');
      const generated = generations[0]; assert.ok(generated.status === 200 && generated.finishedAt && !generated.error);
      const originalBrief = prepared.cloud.insights.insights.find(row => row.id === generated.body?.insight?.id);
      assert.ok(originalBrief && equal(originalBrief, generated.body.insight) && prepared.local.coachInsights.some(row => row.id === originalBrief.id && row.origin === 'cloud' && row.createdAt === Date.parse(originalBrief.createdAt)), 'Actual POST, complete GET and already-cached original brief must agree');
      await save('initial-home-complete', { generations, briefs, originalBriefId: originalBrief.id, source: prepared });
      stage = 'ordinary-settings';
      if (config.width === 360) { await tap('nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await tap('nav[aria-label="全部功能"] a[href="/settings"]'); }
      else await tap('aside nav button', '设置');
      await waitPath(page, '/settings'); const settingsArrival = await settled('settings-arrival-source'); assert.ok(preserved(prepared, settingsArrival)); prepared = settingsArrival;
      prepared = await change(prepared, 'coachPushEnabled', true, '[role=switch][aria-label="教练推送"]');
      prepared = await change(prepared, 'eveningReviewEnabled', true, '[role=switch][aria-label="晚间复盘"]');
      prepared = await change(prepared, 'coachPushFrequency', 1, '[role=radio][aria-label="每天最多1条"]');
      const sampledAt = await page.evaluate(() => Date.now()), clock = businessClock(sampledAt);
      assert.equal(businessClock(Date.now()).day, clock.day);
      if (insideQuiet(clock.time, prepared.cloud.preferences.settings)) prepared = await change(prepared, 'quietHours', { ...setting(prepared, 'quietHours').value, enabled: false }, '[role=switch][aria-label="免打扰时段"]');
      prepared = await setCurrentTime(prepared, clock);
      await read('#evening-review-time', 'saved-time'); assert.equal(await page.$eval('#evening-review-time', el => el.value), clock.time);
      await read('[data-component="preference-sync"] [role=status]', 'complete-settings-ack', '账号偏好已同步');
      for (const [key, value] of Object.entries({ coachPushEnabled: true, eveningReviewEnabled: true, coachPushFrequency: 1, eveningReviewTime: clock.time })) assert.ok(equal(setting(prepared, key)?.value, value), `Persisted local reminder setting differs: ${key}`);
      for (const [key, value] of Object.entries({ coachPushEnabled: true, eveningReviewEnabled: true, pushLimit: 1, eveningReviewTime: clock.time })) assert.ok(equal(prepared.cloud.preferences.settings[key], value), `Acknowledged cloud reminder setting differs: ${key}`);
      assert.equal(insideQuiet(clock.time, prepared.cloud.preferences.settings), false, 'Declared real minute remains outside the configured quiet interval');
      assert.ok(empty(prepared, { pushes: true })); assert.ok(clockStillCurrent(clock, Date.now()));
      await save('declaration', { clock, sampledAt, expected: { title: TITLE, body: BODY, actions: ACTIONS, action: config.action }, source: prepared, boundary: 'Current real Beijing minute; app-open local evening_review only. Ordinary settings ACK is separate from delivery. No clock, counter, qualification or store writes.' });
      stage = 'home-local-delivery'; const window = { before: Date.now(), after: null }; await home();
      await page.waitForSelector(`${BELL}[aria-label="教练洞察，1条未读"]`, { timeout: 5000 });
      const frozen = await facts('delivered-full-source'); window.after = Date.now(); assert.ok(delivered(prepared, frozen, clock, window));
      const target = frozen.local.coachPushes[0]; await read('section[aria-label="第一次记录"] h2', 'empty-home');
      await read(BELL, 'home-unread-one'); assert.equal(await page.$eval(BELL, el => el.getAttribute('aria-label')), '教练洞察，1条未读');
      await observe(page, `${label}-app-open-local-delivery`, true, JSON.stringify({ id: target.id, clock, window, sameDeviceCount: 1, cloudPushes: 0, boundary: 'Not background delivery or a real evening schedule; no zero-limit/quiet-delivery coverage' }));
      stage = 'original-bell-entry'; await tap(BELL);
      await page.waitForFunction(title => [...document.querySelectorAll('main h1, main h2, main h3, main p')].some(el => el.textContent === title) || Boolean(document.querySelector('[data-component="current-record-observations"]')), { timeout: 4000 }, TITLE);
      const surface = await reminderSurface(), arrived = await facts('bell-arrival-full-source');
      await save('bell-arrival', { targetId: target.id, surface, path: new URL(page.url()).pathname, differences: differences(frozen, arrived), sourcePreserved: opened(frozen, arrived) });
      if (!surface.found || surface.actions.some(row => row.disabled)) {
        failureSaved = true; await observe(page, `${label}-bell-reaches-complete-reminder`, false, JSON.stringify({ targetId: target.id, surface, stoppedAt: 'Original bell did not expose this unique reminder title/body/actions. No fallback URL, hidden entry, action or return claim.' }));
        await save('first-failure', { targetId: target.id, surface, source: arrived }); assert.ok(preserved(frozen, arrived)); return;
      }
      assert.ok(opened(frozen, arrived));
      await read(surface.title, 'reminder-title', TITLE); await read(surface.body, 'reminder-body', BODY);
      for (const action of surface.actions) await read(action.selector, `reminder-${action.text}`, action.text);
      const beforeAction = await facts('before-action-full-source'); assert.ok(opened(arrived, beforeAction));
      stage = 'explicit-reminder-action'; const actionWindow = { before: Date.now(), after: null, day: clock.day };
      await tap(surface.actions.find(row => row.text === config.action).selector);
      if (config.action === '去记录') {
        await waitPath(page, '/quick-note'); await page.waitForFunction(() => [...document.querySelectorAll('[data-component="capture-composer"] [role=status]')].some(el => el.textContent === '原文已保留在本机'), { timeout: 4000 });
        await read('#capture-input', 'empty-usable-composer'); assert.ok(await page.$eval('#capture-input', el => el.value === '' && !el.disabled));
        assert.equal(await page.$eval('[data-component="capture-composer"] footer button:last-child', el => el.disabled), true);
        actionWindow.key = await page.evaluate(owner => sessionStorage.getItem(`youtrace:input:${owner}`), api.ownerId);
      }
      let feedbackReady = false; const feedbackEnd = Date.now() + 4000;
      do { const local = project(await page.evaluate(readExistingAccount, api.ownerId)), row = local.local.coachPushes.find(row => row.id === target.id); feedbackReady = config.action === '去记录' ? row?.read === true && row?.acted === true : !row; if (feedbackReady) break; await sleep(75); } while (Date.now() < feedbackEnd);
      assert.ok(feedbackReady, 'Actual local reminder action did not finish; no resend or replacement action');
      const afterAction = await facts('action-full-source'); actionWindow.after = Date.now(); assert.ok(feedback(frozen, afterAction, config.action, actionWindow));
      await save('action-result', { targetId: target.id, action: config.action, actionWindow, differences: differences(frozen, afterAction), boundary: 'Ordinary empty composer adds exactly its two local input keys; no business Save, draft review, credentials or account-permission claim' });
      const briefOffset = briefs.length;
      if (config.action === '去记录') await tap('[data-component="capture-composer"] button[aria-label="返回"]');
      if (new URL(page.url()).pathname !== '/') await home(); else await waitPath(page, '/');
      stage = 'ordinary-return'; await read(BELL, 'home-unread-cleared'); assert.equal(await page.$eval(BELL, el => el.getAttribute('aria-label')), '教练洞察');
      await finishedBrief(briefOffset);
      // Observe one normal Home init through its real brief HTTP completion,
      // then retain a bounded quiet interval; this is not a worker/reload claim.
      await sleep(350); const returned = await facts('returned-full-source');
      assert.ok(clockStillCurrent(clock, Date.now()) && preserved(afterAction, returned));
      assert.equal(setting(returned, 'pushControlCount').value, 1); assert.equal(setting(returned, DELIVERY).value, clock.day);
      await observe(page, `${label}-exact-action-and-home-return`, true, JSON.stringify({ targetId: target.id, action: config.action, unread: 0, sameDayCount: 1, noAdditionalPush: true, emptyBusinessSources: empty(returned), boundary: 'This ordinary same-document Home return only; no provider, background, reload or all-notification coverage' }));
    } catch (error) {
      if (!failureSaved) { failureSaved = true; await capture(page, `${label}-first-failure`).catch(() => undefined); await save('first-failure', { error: error.message, path: new URL(page.url()).pathname }); }
      if (api) await facts('failure-source').catch(sourceError => save('failure-source-incomplete', { error: sourceError.message, passed: false }));
      throw error;
    } finally {
      page.off('request', onRequest); page.off('response', onResponse); page.off('requestfinished', onFinished); await Promise.all(pending); await save('settings-wire', { requests, responses, briefs, generations, boundary: 'Settings PATCH ACK and native brief evidence only; not a cloud push or background delivery receipt' });
    }
  });
}
