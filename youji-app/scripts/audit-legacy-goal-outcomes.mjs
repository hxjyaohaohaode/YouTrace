// Y6L RED journey, synthetic fixtures only. Native execution is hosted-CI only.
// Historical version-10 seeding is declared test setup after native registration
// verifies the owner. It is not UI-created content or evidence of running old JS.
// Current-generation retained-source fixtures and actual old-physical DB writes
// are distinct scenarios. No app/auth store calls, cookie injection or API writes.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { goalOutcomeChecks } from './audit-goal-outcomes.mjs';

const WORKSPACE = '[data-component="goal-workspace"]';
const RECOVERY = '[data-component="goal-source-recovery"]';
const NAME = 'Synthetic 旧有方向';
const DATE = '[role=dialog] [data-component="goal-editor"] input[type=date]';
const goalSettings = facts => facts.current.settings.filter(row => /^(goal-|sync-(version|conflict):goals:)/.test(row.key));
const sortRows = rows => [...rows].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)));
const setting = (facts, key) => facts.current.settings.find(row => row.key === key)?.value;
const currentGoal = (facts, id) => facts.current.goalRecords.find(row => row.id === id);
const sourceGoal = (facts, id) => facts.current.goals.find(row => row.id === id);
const pendingGoal = (facts, id) => facts.current.outbox.filter(row => row.entity === 'goals' && (row.payload === id || row.payload?.id === id));
const sameRows = (a, b) => isDeepStrictEqual(sortRows(a), sortRows(b));
function preserved(before, after) {
  return sameRows(before.current.goalRecords, after.current.goalRecords) && sameRows(before.current.goals, after.current.goals) &&
    isDeepStrictEqual(before.physical, after.physical) && sameRows(goalSettings(before), goalSettings(after)) &&
    isDeepStrictEqual(before.current.outbox, after.current.outbox) && isDeepStrictEqual(before.events, after.events);
}
function neighborUnchanged(before, after, id) {
  return isDeepStrictEqual(currentGoal(before, id), currentGoal(after, id)) && isDeepStrictEqual(sourceGoal(before, id), sourceGoal(after, id)) &&
    isDeepStrictEqual(before.server.find(row => row.id === id), after.server.find(row => row.id === id)) &&
    isDeepStrictEqual(before.current.settings.filter(row => row.key.endsWith(`:${id}`)), after.current.settings.filter(row => row.key.endsWith(`:${id}`))) &&
    isDeepStrictEqual(pendingGoal(before, id), pendingGoal(after, id));
}
function fixture(suffix) {
  return [
    { id: `synthetic-legacy-A-${suffix}`, title: NAME, description: 'Synthetic A 每周读书的原始计划', level: 'short', domain: '学习', priority: 'high', progress: 25, targetDate: '2026-11-30', createdAt: 1000, updatedAt: 2000, privateMemo: { sentinel: `SYNTHETIC_PRIVATE_A_${suffix}`, text: '不在上传预览中的原始私有字段', nested: [null, '', { preserve: true }] } },
    { id: `synthetic-legacy-B-${suffix}`, title: NAME, description: 'Synthetic B 每天运动的原始计划', level: 'long', domain: '健康', priority: 'low', progress: 75, targetDate: '', createdAt: 3000, updatedAt: 4000, privateMemo: { sentinel: `SYNTHETIC_PRIVATE_B_${suffix}`, text: 'B 的原稿必须完整保留', nested: [0, false, { preserve: 'B' }] } },
  ];
}
// Decode the actual tagged download, never JSON-search for a sentinel and call
// that full preservation. Unknown encodings fail closed. Fixture values are plain
// objects/arrays, but references, sparse entries and undefined are preserved.
function decodeRecovery(encoded) {
  const references = new Map();
  const decode = item => {
    if (item === null || typeof item !== 'object') return item;
    if (Object.hasOwn(item, '$ref')) { assert.ok(references.has(item.$ref), 'Recovery reference must already exist'); return references.get(item.$ref); }
    if (item.$type === 'undefined') return undefined;
    if (item.$type === 'bigint') return BigInt(item.value);
    if (item.$type === 'number') return item.value === '-0' ? -0 : Number(item.value);
    let result;
    if (item.$type === 'Array') result = new Array(item.length);
    else if (item.$type === 'Object') result = {};
    else if (item.$type === 'Date') result = new Date(decode(item.value));
    else if (item.$type === 'Map') result = new Map();
    else if (item.$type === 'Set') result = new Set();
    else throw new Error(`Unsupported lossless download type: ${item.$type}`);
    assert.ok(Number.isInteger(item.$id) && !references.has(item.$id), 'Unique encoded object identity'); references.set(item.$id, result);
    if (item.$type === 'Object' || item.$type === 'Array') for (const [key, value] of item.entries) Object.defineProperty(result, key, { value: decode(value), enumerable: true, writable: true, configurable: true });
    if (item.$type === 'Map') for (const [key, value] of item.entries) result.set(decode(key), decode(value));
    if (item.$type === 'Set') for (const value of item.values) result.add(decode(value));
    return result;
  };
  return decode(encoded);
}
const goalDownloadRows = encoded => decodeRecovery(encoded).find(table => table.name === 'goals')?.rows;
function rawTableMatches(tables, name, expected, key = 'id') {
  const table = tables.find(row => row.name === name);
  return Boolean(table && Array.isArray(table.keys) && Array.isArray(table.rows)) &&
    isDeepStrictEqual(table.keys, table.rows.map(row => row[key])) && sameRows(table.rows, expected);
}
function physicalRowsMatch(snapshot, expected) {
  const table = snapshot?.tables?.find(row => row.name === 'goals');
  return Boolean(table && Array.isArray(table.rows)) && table.keyPath === 'id' && table.rows.every(row => row.key === row.value.id) && sameRows(table.rows.map(row => row.value), expected);
}
function wireSafe(wire, originals) {
  const text = JSON.stringify(wire);
  const permitted = new Set(['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate', 'createdAt', 'baseVersion']);
  return !text.includes('privateMemo') && originals.every(row => !text.includes(row.privateMemo.sentinel)) && wire.every(request => {
    if (request.path !== '/api/sync/push') return true;
    let body; try { body = JSON.parse(request.body); } catch { return false; }
    return !body.goals || Array.isArray(body.goals) && body.goals.every(goal => goal && typeof goal === 'object' && Object.entries(goal).every(([key, value]) => permitted.has(key) && (value === null || ['number', 'string'].includes(typeof value))));
  });
}
function serverMatches(source, server, owner) {
  return Boolean(server) && server.userId === owner && ['id', 'title', 'description', 'level', 'domain', 'priority', 'progress', 'targetDate'].every(key => isDeepStrictEqual(source[key], server[key])) &&
    Date.parse(server.createdAt) === source.createdAt && !Object.hasOwn(server, 'privateMemo');
}
export const legacyGoalOutcomeChecks = { fixture, preserved, neighborUnchanged, decodeRecovery, rawTableMatches, physicalRowsMatch, wireSafe, serverMatches, pendingGoal };

export async function runLegacyGoalOutcomes(h, { scenarioSet = 'all' } = {}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Y6L native audit is hosted-CI only');
  assert.ok(['all', 'enrollment', 'source'].includes(scenarioSet), 'Unknown legacy Goal scenario set');
  const { isolated, login, waitPath, capture, observe, segment, apiFor, sleep, actions, artifacts, writeFile, join, surfaceNames, origin } = h;
  assert.ok(origin?.startsWith('http://127.0.0.1:'), 'Require explicit disposable CI origin');
  const media = [], peerMedia = [], recordings = [];
  await writeFile(join(artifacts, 'Y6L-scope.json'), JSON.stringify({ kind: 'legacy-account-local-goal-native-RED', scenarioSet, scopeNote: 'Fixture/requirement list describes the shared package contract; only this selected scenario set executes, as recorded in Y6L-media.json and outcome-report.json', applicationBaseline: 'ccba25822b92cf7de890ccf29d93679c6d794940', syntheticOnly: true, widths: [1280, 360], fixtures: ['Native registration verifies owner; separate browser profile gets synthetic historical account-local physical DB version 10; native existing-account OTP login performs actual generation migration', 'Separate declared current-generation retained goals-source fixture for compare/copy/keep; it does not represent old JavaScript writing to a new generation', 'Actual synthetic late old-physical database change is disclosed and exported separately; no automatic merge acceptance'], requirements: ['No automatic upload; initially unchecked distinguishable A/B; exact destination; selected A cancel/quota/retry and B full-byte preservation', 'Original empty-string date is attempted unchanged, then explicitly corrected through visible controls; original remains downloadable', 'Exact native transactional quota rollback; bounded committed-copy display read failure; explicit refresh and reload keep one ID', 'Actual stale peer comparison after explicit copy deletion cannot resurrect', 'All downloads decoded and compared in full; no unknown private fields in actual request bodies'], limitations: ['No production or real private data', 'No manual-human, real mobile OS or screen-reader acceptance', 'Existing native fresh-account Y6 evidence remains separate', 'A failed product outcome remains RED; no fixture normalization, timestamp stripping or internal store call repairs a path'] }, null, 2));

  // Chromium-only read: clipping against every overflow ancestor and fixed nav,
  // painted opacity, text width and foreground hit testing, as in native Y6.
  function geometry(selector) {
    const nodes = [...document.querySelectorAll(selector)];
    if (nodes.length !== 1) return { unique: false, count: nodes.length, visible: false };
    const el = nodes[0], rect = el.getBoundingClientRect(), dialog = el.closest('[role=dialog]');
    const navs = dialog ? [] : [...document.querySelectorAll('nav[aria-label="主导航"]')].filter(node => !node.contains(el)).map(node => node.getBoundingClientRect()).filter(box => box.width >= innerWidth / 2 && box.height > 0 && box.top > innerHeight / 2 && box.bottom >= innerHeight - 1);
    const clip = { left: 0, top: 0, right: innerWidth, bottom: Math.min(innerHeight, ...navs.map(box => box.top)) };
    // A viewport-fixed navigation bar escapes static overflow ancestors. Keep
    // ordinary/modal clipping unchanged and fail closed for transformed or
    // specially contained ancestors; do not grant a fractional-pixel tolerance.
    const fixedNav = el.closest('nav[aria-label="主导航"]'), navAncestors = [];
    if (fixedNav && getComputedStyle(fixedNav).position === 'fixed') for (let parent = fixedNav.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      navAncestors.push({ tag: parent.tagName, transform: css.transform, perspective: css.perspective, filter: css.filter, backdropFilter: css.backdropFilter, contain: css.contain, willChange: css.willChange, containerType: css.containerType, contentVisibility: css.contentVisibility, clipPath: css.clipPath, maskImage: css.maskImage });
    }
    const viewportFixedNav = Boolean(fixedNav && getComputedStyle(fixedNav).position === 'fixed') && navAncestors.every(css =>
      [css.transform, css.perspective, css.filter, css.backdropFilter, css.clipPath, css.maskImage].every(value => !value || value === 'none') &&
      !/layout|paint|strict|content/.test(css.contain) && !/transform|perspective|filter|contain/.test(css.willChange) &&
      (!css.containerType || css.containerType === 'normal') && (!css.contentVisibility || css.contentVisibility === 'visible'));
    let scroller = null, painted = getComputedStyle(el).visibility === 'visible' && Number(getComputedStyle(el).opacity) >= 0.99;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
      painted = painted && css.visibility === 'visible' && Number(css.opacity) >= 0.99;
      const clipsThisTarget = !viewportFixedNav || parent === fixedNav || fixedNav.contains(parent);
      if (clipsThisTarget && /(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      if (clipsThisTarget && /(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
      if (clipsThisTarget && !scroller && /(auto|scroll)/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight) scroller = { tag: parent.tagName, role: parent.getAttribute('role'), scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight };
    }
    const centerHit = el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    const textNotTruncated = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.scrollWidth <= el.clientWidth + 1;
    return { unique: true, text: el.innerText, rect: rect.toJSON(), clip, scroller, centerHit, painted, textNotTruncated, viewportFixedNav, navAncestors,
      visible: painted && centerHit && textNotTruncated && rect.width > 0 && rect.height > 0 && rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom };
  }
  async function read(page, selector) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(geometry, selector); assert.equal(box.unique, true, `Expected one readable region: ${selector}`);
      if (box.visible) return box;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8)), y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20));
      const delta = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(delta) > 1) { await page.mouse.move(x, y); await page.mouse.wheel({ deltaY: delta }); actions.push({ kind: 'native-wheel-legacy-goal', surface: surfaceNames.get(page), selector, pointer: { x, y }, deltaY: delta, clip: box.clip, scroller: box.scroller }); }
      await sleep(150);
    }
    return page.evaluate(geometry, selector);
  }
  async function exact(page, selector, text) {
    return page.evaluate(({ selector, text }) => {
      const matches = [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text); });
      if (matches.length !== 1) throw new Error(`Expected one rendered control, found ${matches.length}: ${selector} / ${text ?? ''}`);
      const parts = []; for (let el = matches[0]; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      return 'body > ' + parts.join(' > ');
    }, { selector, text });
  }
  async function tap(page, selector, text) {
    await page.bringToFront(); const resolved = await exact(page, selector, text), box = await read(page, resolved);
    assert.ok(box.visible, `Actual control is clipped, unpainted, obscured or truncated: ${selector} ${text ?? ''}`);
    assert.equal(await page.$eval(resolved, el => Boolean(el.disabled)), false, 'A disabled control is not an attempted action');
    const x = box.rect.x + box.rect.width / 2, y = box.rect.y + box.rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.click(x, y);
    actions.push({ kind: 'native-pointer-legacy-goal', surface: surfaceNames.get(page), selector, resolvedSelector: resolved, text, x, y, actualClip: box.clip, path: new URL(page.url()).pathname });
  }
  async function fill(page, selector, text) {
    await tap(page, selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.sendCharacter(text);
    assert.equal(await page.$eval(selector, el => el.value), text); actions.push({ kind: 'native-text-legacy-goal', surface: surfaceNames.get(page), selector, syntheticText: text });
  }
  async function close(page) {
    if (await page.$('[role=dialog]')) { await tap(page, '[role=dialog] button[aria-label="关闭"]'); await page.waitForSelector('[role=dialog]', { hidden: true }); }
  }
  async function navigate(page, path) {
    await close(page);
    if (new URL(page.url()).pathname === path) return;
    if (page.viewport().width === 360) {
      await tap(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more'); await tap(page, `nav[aria-label="全部功能"] a[href="${path}"]`);
    } else await tap(page, 'aside nav button', path === '/goal' ? '目标' : '设置');
    await waitPath(page, path);
    if (path === '/goal') await page.waitForSelector('[data-component="goal-card"]');
  }
  async function readableText(page, selector, text) { const resolved = await exact(page, selector, text), reading = await read(page, resolved); await capture(page, `${surfaceNames.get(page)}-read-${text.slice(0, 12)}`); return reading; }
  async function visibleIdentity(page, selector, identity) {
    const result = await page.evaluate(({ selector, identity }) => {
      const rows = [...document.querySelectorAll(selector)].map(el => {
        const text = el.innerText, parts = [];
        for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
        return { text, selector: 'body > ' + parts.join(' > '), match: text.includes(identity.title) && text.includes(identity.description) && text.includes(identity.domain) && text.includes(`${identity.progress}%`) };
      }); return { rows, matches: rows.filter(row => row.match) };
    }, { selector, identity: { title: identity.title, description: identity.description, domain: identity.domain, progress: identity.progress } });
    if (result.matches.length !== 1) { await observe(page, `${surfaceNames.get(page)}-visible-identity-gap`, false, JSON.stringify(result)); throw new Error('Cannot distinguish the intended source by visible title/description/domain/progress; no hidden ID fallback'); }
    const resolved = result.matches[0].selector, reading = await read(page, resolved); assert.ok(reading.visible, 'Full chosen identity must be readable'); return resolved;
  }
  async function existingLogin(page, phone, ownerId) {
    await page.goto(`${origin}/login`, { waitUntil: 'networkidle0' }); actions.push({ kind: 'initial-existing-account-login-url', surface: surfaceNames.get(page), path: '/login', authentication: 'Native OTP controls, no cookie/auth/store injection' });
    await page.waitForSelector('#login-phone'); await fill(page, '#login-phone', phone);
    const sent = page.waitForResponse(response => response.url().endsWith('/api/auth/send-code') && response.request().method() === 'POST');
    await tap(page, 'button', '获取验证码'); const challenge = await (await sent).json(); assert.ok(challenge.devCode);
    // Receipt of HTTP bytes can precede React's rendered next step. Wait for
    // the real control, then retain the original painted/clip/hit checks.
    await page.waitForSelector('#login-code', { visible: true, timeout: 7000 });
    await fill(page, '#login-code', challenge.devCode); await tap(page, 'button', '验证');
    await page.waitForFunction(() => location.pathname === '/onboarding' || location.pathname === '/' && Boolean(document.querySelector('aside nav,nav[aria-label="主导航"]')), { polling: 100, timeout: 15000 });
    if (new URL(page.url()).pathname === '/onboarding') {
      for (let step = 0; step < 4; step++) { await capture(page, `${surfaceNames.get(page)}-existing-account-new-device-onboarding-${step + 1}`); await tap(page, 'button', step < 3 ? '下一步' : '开始使用'); await sleep(650); }
      actions.push({ kind: 'native-existing-account-new-profile-onboarding', surface: surfaceNames.get(page), steps: 4, note: 'Actual first-visit controls; no localStorage flag injection' });
    }
    await waitPath(page, '/');
    const api = await apiFor(page); assert.equal(api.ownerId, ownerId, 'Existing OTP identity must equal native registration owner');
    await observe(page, `${surfaceNames.get(page)}-existing-native-login-owner`, true, JSON.stringify({ ownerId, auth: 'Real native OTP existing-account flow; no registration form expected' })); return api;
  }
  async function seedHistorical(page, owner, rows) {
    await page.goto(`${origin}/data-info`, { waitUntil: 'networkidle0' });
    const seeded = await page.evaluate(({ owner, rows }) => new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}`, 10); let created = false;
      request.onupgradeneeded = () => { created = true; const goals = request.result.createObjectStore('goals', { keyPath: 'id' }); for (const key of ['level', 'domain', 'priority']) goals.createIndex(key, key); request.result.createObjectStore('settings', { keyPath: 'key' }); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const database = request.result; if (!created) { database.close(); reject(new Error('Fixture requires a separate empty profile')); return; } const tx = database.transaction('goals', 'readwrite'); for (const row of rows) tx.objectStore('goals').add(row); tx.oncomplete = () => { const result = { name: database.name, version: database.version }; database.close(); resolve(result); }; tx.onerror = () => { database.close(); reject(tx.error); }; };
    }), { owner, rows });
    actions.push({ kind: 'declared-synthetic-historical-account-local-version10-fixture', surface: surfaceNames.get(page), ownerVerifiedByNativeRegistration: owner, seeded, rows, excludedClaims: 'Not UI-created records; not real user data; not execution of old JavaScript' });
    await writeFile(join(artifacts, `${surfaceNames.get(page)}-historical-fixture.json`), JSON.stringify({ syntheticOnly: true, owner, ...seeded, rows }, null, 2));
  }
  async function snapshot(page, owner, physical = false) {
    return page.evaluate(({ owner, physical }) => new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}${physical ? '' : ':schedule-v1'}`);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Expected existing account database')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly'), result = { databaseName: db.name, version: db.version };
        for (const name of names) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result; }; }
        tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }), { owner, physical });
  }
  async function ledger(api) {
    const events = []; let cursor = '0';
    for (let i = 0; i < 20; i++) {
      const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`);
      assert.equal(result.protocol, 2); assert.ok(result.features.includes('goals-v1')); assert.ok(Array.isArray(result.events)); events.push(...result.events);
      goalOutcomeChecks.goalRowsFromLedger(events); assert.equal(result.nextCursor, events.at(-1)?.seq ?? '0', 'Full ledger cursor cannot skip events');
      if (!result.hasMore) return events; assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor;
    }
    throw new Error('Complete GET-only ledger exceeds bounded page count');
  }
  async function facts(page, api, label) {
    const [current, physical, events] = await Promise.all([snapshot(page, api.ownerId), snapshot(page, api.ownerId, true), ledger(api)]);
    const value = { current, physical, events, server: goalOutcomeChecks.goalRowsFromLedger(events) };
    await writeFile(join(artifacts, `${label}-full-source.json`), JSON.stringify({ syntheticOnly: true, capturedAt: new Date().toISOString(), ownerId: api.ownerId, serverSource: 'Complete unmodified GET-only sync/pull ledger; no goals REST endpoint', ...value }, null, 2)); return value;
  }
  async function waitOutcome(page, api, id, { requireAck = false } = {}) {
    for (let i = 0; i < 50; i++) { const current = await snapshot(page, api.ownerId), pending = current.outbox.filter(row => row.entity === 'goals' && (row.payload === id || row.payload?.id === id)); if ((!requireAck && pending.some(row => row.status === 'blocked')) || (!pending.length && current.settings.some(row => row.key === `sync-version:goals:${id}`))) return; await sleep(200); }
  }
  async function download(page, label, button) {
    const path = join(artifacts, `${label}-download`); await mkdir(path, { recursive: true }); await page.browserContext().setDownloadBehavior({ policy: 'allow', downloadPath: path });
    await tap(page, 'button', button); let file;
    for (let i = 0; i < 70; i++) { const names = (await readdir(path)).filter(name => name.endsWith('.json')); assert.ok(names.length <= 1, 'One actual download per requested action'); if (names.length) { try { file = { name: names[0], json: JSON.parse(await readFile(join(path, names[0]), 'utf8')) }; break; } catch { /* Actual browser download still finishing. */ } } await sleep(100); }
    assert.ok(file, 'Actual completed browser download required'); actions.push({ kind: 'actual-browser-download', surface: surfaceNames.get(page), path, file: file.name, button }); return file.json;
  }
  function watchWire(page) {
    const requests = [], listeners = [];
    const add = surface => { const listener = request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/') && request.method() !== 'GET') requests.push({ at: new Date().toISOString(), surface: surfaceNames.get(surface), path: url.pathname, method: request.method(), body: request.postData() ?? null }); }; surface.on('request', listener); listeners.push([surface, listener]); };
    add(page); return { requests, add, stop: () => { for (const [surface, listener] of listeners) surface.off('request', listener); } };
  }
  async function openEnrollment(page, identity, account, label) {
    await tap(page, 'button', '选择同步旧目标'); await page.waitForSelector('[role=dialog] input[type=checkbox]');
    const selected = await page.$$eval('[role=dialog] input[type=checkbox]', nodes => nodes.map(el => el.checked));
    const destination = await readableText(page, '[role=dialog] p', `目的账号：${account.nickname}（${account.phone.slice(0, 3)}****${account.phone.slice(-4)}）`);
    const target = await visibleIdentity(page, '[role=dialog] label', identity);
    const disclosureTexts = await page.$$eval('[role=dialog] p', rows => rows.map(el => el.innerText).filter(text => !text.startsWith('目的账号'))), disclosure = [];
    for (const text of disclosureTexts) disclosure.push(await readableText(page, '[role=dialog] p', text));
    const fullText = disclosure.filter(row => row.visible).map(row => row.text).join('\n');
    const groups = { title: /标题/, description: /描述/, level: /类型|分类/, domain: /领域/, priority: /优先级/, progress: /进度/, targetDate: /计划日期|日期/, id: /目标编号|目标标识|识别编号/, createdAt: /创建时间/ };
    const missing = Object.entries(groups).filter(([, pattern]) => !pattern.test(fullText)).map(([field]) => field);
    await observe(page, `${label}-actual-upload-fields-fully-disclosed`, missing.length === 0 && disclosure.every(row => row.visible), JSON.stringify({ disclosure, requiredWireFields: Object.keys(groups), missing, note: 'Exclusive only-upload wording must accurately disclose business fields plus identifier/creation metadata; unknown privateMemo remains local' }));
    await observe(page, `${label}-unchecked-exact-destination-readable`, destination.visible && selected.length > 0 && selected.every(value => value === false), JSON.stringify({ verifiedOwner: account.owner, destination, selected, visibleIdentity: identity.description }));
    await tap(page, `${target} input[type=checkbox]`); assert.equal(await page.$eval(`${target} input`, el => el.checked), true);
    assert.equal(await page.$$eval('[role=dialog] input[type=checkbox]', nodes => nodes.filter(el => el.checked).length), 1, 'Exactly the chosen visible A/B row is selected');
    await capture(page, `${label}-actual-selected-row`);
    const targetReading = await read(page, target);
    return { disclosure, targetReading, noDateMeaning: targetReading.visible && /未设置|无计划日期|不设(?:置)?日期|没有计划日期/.test(targetReading.text) };
  }
  async function installFault(page, owner, { kind, expected, sourceId }) {
    await page.evaluate(({ owner, kind, expected, sourceId }) => {
      const put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add, getAll = IDBObjectStore.prototype.getAll;
      const audit = window.__legacyGoalFault = { owner, kind, sourceId, expected, hits: [], writes: [], commits: [], reads: [], expired: false, restored: false, installedAt: Date.now(), deadline: Date.now() + 60000 };
      let timer;
      const matches = value => value && (kind === 'enroll-quota' ? value.id === expected.id : typeof value.id === 'string' && value.id !== sourceId) &&
        JSON.stringify(Object.keys(value).filter(key => key !== 'id').sort()) === JSON.stringify(Object.keys(expected).filter(key => key !== 'id').sort()) && Object.keys(expected).every(key => key === 'id' || JSON.stringify(value[key]) === JSON.stringify(expected[key]));
      window.__releaseLegacyGoalFault = (reason = 'explicit-harness-release') => { clearTimeout(timer); IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.add = add; IDBObjectStore.prototype.getAll = getAll; Object.assign(audit, { restored: IDBObjectStore.prototype.put === put && IDBObjectStore.prototype.add === add && IDBObjectStore.prototype.getAll === getAll, restoredAt: Date.now(), restoredBy: reason }); };
      timer = setTimeout(() => { audit.expired = true; window.__releaseLegacyGoalFault('safety-timeout'); }, 60000);
      const write = (original, method) => function(value, ...keys) {
        if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'goalRecords' && this.transaction.mode === 'readwrite' && matches(value) && method === (kind === 'enroll-quota' ? 'put' : 'add')) {
          const evidence = { at: Date.now(), method, database: this.transaction.db.name, table: this.name, source: structuredClone(value) };
          if (kind.endsWith('quota')) { audit.hits.push(evidence); throw new DOMException('Synthetic exact legacy-goal mutation quota', 'QuotaExceededError'); }
          audit.writes.push(evidence); this.transaction.addEventListener('complete', () => { audit.commits.push({ at: Date.now(), id: value.id }); }, { once: true });
        }
        return original.call(this, value, ...keys);
      };
      IDBObjectStore.prototype.put = write(put, 'put'); IDBObjectStore.prototype.add = write(add, 'add');
      IDBObjectStore.prototype.getAll = function(...args) {
        const stores = [...this.transaction.objectStoreNames].sort();
        if (kind === 'copy-postcommit-read' && audit.commits.length && this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'goalRecords' && this.transaction.mode === 'readonly' && stores.join('|') === 'goalRecords|goals|outbox|settings') {
          audit.reads.push({ at: Date.now(), table: this.name, stores, mode: this.transaction.mode }); throw new DOMException('Synthetic committed-copy display read outage', 'UnknownError');
        }
        return getAll.apply(this, args);
      };
    }, { owner, kind, expected, sourceId });
    actions.push({ kind: 'test-only-exact-native-IDB-legacy-goal-fault', surface: surfaceNames.get(page), owner, fault: kind, expected, sourceId, safetyTimeoutMs: 60000 });
  }
  async function release(page, label) {
    const fault = await page.evaluate(() => { window.__releaseLegacyGoalFault(); return window.__legacyGoalFault; });
    await writeFile(join(artifacts, `${label}-fault.json`), JSON.stringify(fault, null, 2)); actions.push({ kind: 'explicit-release-legacy-goal-fault', surface: surfaceNames.get(page), ...fault });
    await observe(page, `${label}-explicit-release-before-bounded-expiry`, !fault.expired && fault.restored && fault.restoredBy === 'explicit-harness-release' && fault.restoredAt < fault.deadline, JSON.stringify(fault)); return fault;
  }
  async function alert(page, label) {
    await page.waitForSelector('[role=dialog] [role=alert]'); const selector = await exact(page, '[role=dialog] [role=alert]'), reading = await read(page, selector);
    await observe(page, `${label}-readable-error-retained-choice`, reading.visible && /原目标|原稿/.test(reading.text) && /重试/.test(reading.text), JSON.stringify(reading)); return reading;
  }
  async function baseline(page, api, originals, label) {
    await navigate(page, '/goal'); const before = await facts(page, api, `${label}-migrated`);
    for (const row of originals) { const root = await visibleIdentity(page, '[data-component="goal-card"]', row), reading = await read(page, root); await observe(page, `${label}-visible-local-${row.id.includes('-A-') ? 'A' : 'B'}`, reading.visible && reading.text.includes('仅本机'), JSON.stringify(reading)); }
    await observe(page, `${label}-migration-preserves-originals-no-upload`, originals.every(row => isDeepStrictEqual(before.physical.goals.find(goal => goal.id === row.id), row) && isDeepStrictEqual(sourceGoal(before, row.id), row) && isDeepStrictEqual(setting(before, `goal-source-snapshot:${row.id}`), row) && isDeepStrictEqual(currentGoal(before, row.id), { ...row, syncScope: 'local' })) && before.current.goalRecords.length === 2 && before.current.outbox.length === 0 && before.server.length === 0 && before.events.every(event => event.entity !== 'goals'), JSON.stringify({ originalEmptyDate: originals[1].targetDate, sourceArtifact: `${label}-migrated-full-source.json` })); return before;
  }
  async function historicalEnrollment(page, api, originals, account, label, wire) {
    const [a, b] = originals, before = await baseline(page, api, originals, label);
    await segment(page, `${label}-selected-A-cancel`, async () => {
      await openEnrollment(page, a, account, label); await tap(page, '[role=dialog] button', '暂不上传'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const after = await facts(page, api, `${label}-cancelled`); await observe(page, `${label}-selected-cancel-preserves-source-queue-backup-cloud`, preserved(before, after), 'Actual selected A was cancelled; all raw source records, B, Goal settings/backups, queue and cloud ledger must match');
    });
    let retry = false;
    await segment(page, `${label}-selected-A-native-quota`, async () => {
      await close(page); await openEnrollment(page, a, account, label); const preFault = await facts(page, api, `${label}-pre-quota`);
      await installFault(page, api.ownerId, { kind: 'enroll-quota', expected: { ...a, syncScope: 'account' }, sourceId: a.id });
      try {
        await tap(page, '[role=dialog] button', '确认上传 1 个目标'); await alert(page, `${label}-quota`);
        const fault = await page.evaluate(() => window.__legacyGoalFault), failed = await facts(page, api, `${label}-quota-rollback`);
        const selected = await page.$$eval('[role=dialog] input[type=checkbox]', nodes => nodes.filter(node => node.checked).map(node => node.closest('label').innerText));
        retry = fault.hits.length === 1 && !fault.expired && preserved(preFault, failed) && selected.length === 1 && selected[0].includes(a.description);
        await observe(page, `${label}-quota-exact-selected-mutation-and-atomic-rollback`, retry, JSON.stringify({ fault, selected, allSourceQueueBackupEqual: preserved(preFault, failed), neighborByteEqual: neighborUnchanged(preFault, failed, b.id) }));
      } finally { await release(page, `${label}-enroll`); }
    });
    await segment(page, `${label}-A-actual-retry`, async () => {
      assert.ok(retry, 'Retry requires exact native fault, atomic rollback and still-selected visible A');
      await tap(page, '[role=dialog] button', '确认上传 1 个目标'); await page.waitForSelector('[role=dialog]', { hidden: true }); await waitOutcome(page, api, a.id);
      const after = await facts(page, api, `${label}-A-retry`), backup = setting(after, `goal-local-copy:${a.id}`), version = setting(after, `sync-version:goals:${a.id}`);
      const reading = await read(page, await visibleIdentity(page, '[data-component="goal-card"]', a));
      await observe(page, `${label}-A-same-id-ACK-B-byte-unchanged`, isDeepStrictEqual(currentGoal(after, a.id), { ...a, syncScope: 'account' }) && serverMatches(a, after.server.find(row => row.id === a.id), api.ownerId) && after.server.length === 1 && neighborUnchanged(before, after, b.id) && after.current.outbox.length === 0 && goalOutcomeChecks.validVersion(version) && version === after.events.filter(event => event.entity === 'goals' && event.entityId === a.id).at(-1)?.seq && reading.visible && reading.text.includes('已同步'), JSON.stringify({ reading, backup, sourceArtifact: `${label}-A-retry-full-source.json` }));
      await observe(page, `${label}-A-original-private-fields-preserved-no-hidden-wire`, backup?.ownerId === api.ownerId && isDeepStrictEqual(backup.original, { ...a, syncScope: 'local' }) && isDeepStrictEqual(backup.enrolled, { ...a, syncScope: 'account' }) && isDeepStrictEqual(after.physical, before.physical) && sameRows(after.current.goals, originals) && wireSafe(wire.requests, originals), JSON.stringify({ backup, actualRequests: wire.requests }));
    });
    await segment(page, `${label}-download-originals-and-true-old-physical-late-change`, async () => {
      await close(page); await navigate(page, '/settings'); const beforeExport = await facts(page, api, `${label}-before-download`);
      const downloaded = await download(page, `${label}-full-backup`, '导出数据'), raw = decodeRecovery(downloaded.rawTables);
      const rawRows = name => raw.find(table => table.name === name)?.rows;
      await observe(page, `${label}-actual-complete-backup-originals-and-queue`, downloaded.format === 'youtrace-local-backup' && downloaded.ownerId === api.ownerId && rawTableMatches(raw, 'goals', originals) && rawTableMatches(raw, 'goalRecords', beforeExport.current.goalRecords) && rawTableMatches(raw, 'settings', rawRows('settings'), 'key') && sameRows(rawRows('settings').filter(row => /^(goal-|sync-(version|conflict):goals:)/.test(row.key)), goalSettings(beforeExport)) && rawTableMatches(raw, 'outbox', beforeExport.current.outbox, 'seq'), 'Downloaded authoritative rawTables preserves original keys and all privateMemo/date/timestamp fields, exact local records, backups and pending queue');
      const late = { ...a, title: 'Synthetic 真实旧物理库后续修改', progress: 88, updatedAt: 9000 };
      await mutateSource(page, api.ownerId, [late], true, `${label}-actual-old-physical`);
      await tap(page, 'button', '检查旧窗口修改'); await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(el => /发现 \d+ 类旧版资料与升级时不同/.test(el.textContent)));
      const noticeText = await page.$$eval('p', rows => rows.find(row => /旧窗口后续修改不会自动导入本窗口/.test(row.innerText))?.innerText);
      const notice = await readableText(page, 'p', noticeText), afterLate = await facts(page, api, `${label}-late-source-not-merged`);
      const exported = await download(page, `${label}-separate-old-source`, '导出升级前保留资料');
      const baselineSource = decodeRecovery(exported.baseline), lateSource = decodeRecovery(exported.source);
      await observe(page, `${label}-old-physical-disclosure-and-separate-lossless-download`, notice.visible && exported.format === 'youtrace-account-generation-recovery' && exported.ownerId === api.ownerId && exported.status.changedTables.includes('goals') && physicalRowsMatch(baselineSource, originals) && physicalRowsMatch(lateSource, [late, b]) && sameRows(beforeExport.current.goalRecords, afterLate.current.goalRecords) && sameRows(beforeExport.current.goals, afterLate.current.goals) && isDeepStrictEqual(beforeExport.events, afterLate.events) && wireSafe(wire.requests, originals), JSON.stringify({ notice, status: exported.status, claim: 'Separate preserved original keys/rows only; no auto merge or imported recovery claim' }));
    });
    await segment(page, `${label}-original-empty-date-attempt-and-explicit-correction`, async () => {
      await navigate(page, '/goal'); const beforeB = await facts(page, api, `${label}-B-original-empty-date`); assert.equal(currentGoal(beforeB, b.id).targetDate, '', 'Do not normalize the historical fixture before the actual attempt');
      const preview = await openEnrollment(page, b, account, `${label}-B`); await tap(page, '[role=dialog] button', '确认上传 1 个目标'); await page.waitForSelector('[role=dialog]', { hidden: true }); await waitOutcome(page, api, b.id);
      const attempted = await facts(page, api, `${label}-B-attempted-empty-date`), reading = await read(page, await visibleIdentity(page, '[data-component="goal-card"]', b));
      const canonicalNoDate = { ...b, targetDate: null }, initialAck = serverMatches(canonicalNoDate, attempted.server.find(row => row.id === b.id), api.ownerId) && !pendingGoal(attempted, b.id).length;
      await observe(page, `${label}-B-no-date-ordinary-enrollment-reaches-truthful-ACK`, initialAck && preview.noDateMeaning && reading.visible && reading.text.includes('已同步'), JSON.stringify({ originalTargetDate: '', desiredCanonicalDate: null, preview, reading, pending: pendingGoal(attempted, b.id), note: 'A future explicit no-date confirmation may normalize to canonical null and pass directly; a rejected unchanged empty string remains RED' }));
      if (initialAck) {
        await observe(page, `${label}-B-explicit-no-date-confirmation-keeps-original`, preview.noDateMeaning && goalOutcomeChecks.onlyChanges(currentGoal(beforeB, b.id), currentGoal(attempted, b.id), ['syncScope', 'targetDate']) && isDeepStrictEqual(sourceGoal(attempted, b.id), b) && isDeepStrictEqual(setting(attempted, `goal-local-copy:${b.id}`)?.original, { ...b, syncScope: 'local' }) && neighborUnchanged(beforeB, attempted, a.id), JSON.stringify({ original: b, current: currentGoal(attempted, b.id), server: attempted.server.find(row => row.id === b.id) }));
      } else {
      const instructions = await page.$$eval(`${WORKSPACE} p,${WORKSPACE} [role=alert],${WORKSPACE} a`, rows => {
        const candidates = rows.filter(el => !el.closest('[data-component="goal-card"]'));
        return candidates.filter(el => !candidates.some(child => child !== el && el.contains(child) && child.innerText === el.innerText)).map(el => {
          const parts = [];
          for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
          return { text: el.innerText, selector: 'body > ' + parts.join(' > ') };
        }).filter(row => /日期|同步|检查|修改/.test(row.text));
      });
      const correctiveText = instructions.filter(row => /日期/.test(row.text) && /重新|修改|校正|清空|设置|编辑/.test(row.text));
      const correctionReadings = [];
      for (const { text, selector } of correctiveText) {
        if (await page.$eval(selector, el => el.innerText).catch(() => null) !== text) continue;
        const reading = await read(page, selector); correctionReadings.push(reading);
        await capture(page, `${label}-date-correction-guidance-read`);
      }
      await observe(page, `${label}-B-failed-date-has-understandable-correction-guidance`, correctionReadings.some(row => row.visible), JSON.stringify({ instructions, correctionReadings, note: 'The following explicit editor experiment does not manufacture missing instructions for an ordinary reader' }));
      const card = await visibleIdentity(page, '[data-component="goal-card"]', b); await tap(page, `${card} button[aria-label=${JSON.stringify(`编辑目标 ${b.title}`)}]`); await page.waitForSelector(DATE);
      assert.equal(await page.$eval(DATE, el => el.value), '');
      await tap(page, DATE); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.press('Tab');
      actions.push({ kind: 'explicit-native-confirm-empty-plan-date', surface: surfaceNames.get(page), originalValue: '', desiredSavedValue: null, note: 'User chooses the visible optional no-date value, then Save; source fixture is never changed' });
      await capture(page, `${label}-B-explicit-no-date-correction`); await tap(page, '[role=dialog] button', '保存修改'); await page.waitForSelector('[role=dialog]', { hidden: true }); await waitOutcome(page, api, b.id, { requireAck: true });
      const corrected = await facts(page, api, `${label}-B-corrected-empty-date`), current = currentGoal(corrected, b.id), server = corrected.server.find(row => row.id === b.id);
      const expected = { ...b, targetDate: null };
      const correctedReading = await read(page, await visibleIdentity(page, '[data-component="goal-card"]', b));
      await observe(page, `${label}-B-user-correction-recovers-same-id-with-original-preserved`, current?.targetDate === null && goalOutcomeChecks.onlyChanges(currentGoal(attempted, b.id), current, ['targetDate', 'updatedAt']) && serverMatches(expected, server, api.ownerId) && !pendingGoal(corrected, b.id).length && isDeepStrictEqual(sourceGoal(corrected, b.id), b) && isDeepStrictEqual(setting(corrected, `goal-local-copy:${b.id}`)?.original, { ...b, syncScope: 'local' }) && neighborUnchanged(attempted, corrected, a.id) && correctedReading.visible && correctedReading.text.includes('已同步'), JSON.stringify({ desiredOutcome: 'Explicit visible no-date correction reaches cloud ACK without changing ID or original backup; a stuck invalid predecessor remains RED', current, server, correctedReading, queue: pendingGoal(corrected, b.id) }));
      }
      await navigate(page, '/settings'); const exported = await download(page, `${label}-B-original-after-correction`, '导出数据');
      const raw = decodeRecovery(exported.rawTables);
      await observe(page, `${label}-B-actual-download-keeps-original-empty-date-privateMemo`, rawTableMatches(raw, 'goals', originals) && isDeepStrictEqual(goalDownloadRows(exported.rawTables).find(row => row.id === b.id), b), 'Authoritative downloaded retained goals source keeps B and its original key exactly, including empty date and unknown fields, after explicit correction');
    });
  }

  async function mutateSource(page, owner, rows, physical, label) {
    await page.evaluate(({ owner, rows, physical }) => new Promise((resolve, reject) => {
      const request = indexedDB.open(`youtrace:user:${owner}${physical ? '' : ':schedule-v1'}`);
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Fixture mutation requires an existing source database')); }; request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction('goals', 'readwrite'); for (const row of rows) tx.objectStore('goals').put(row); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
    }), { owner, rows, physical });
    actions.push({ kind: physical ? 'declared-synthetic-actual-old-physical-late-write' : 'declared-synthetic-current-generation-retained-source-fixture', surface: surfaceNames.get(page), label, database: `youtrace:user:${owner}${physical ? '' : ':schedule-v1'}`, store: 'goals', rows, scope: physical ? 'Old physical source only; current content must remain unchanged' : 'Test source fixture only; no claim that old JavaScript accesses this generation' });
  }
  async function openComparison(page, changed, current, label, account) {
    await tap(page, `${RECOVERY} button`, `比较旧窗口目标：${changed.title}`); await page.waitForSelector('[role=dialog]');
    const destination = await readableText(page, '[role=dialog] p', `当前账号：${account.nickname}`);
    const meaningTexts = await page.$$eval('[role=dialog] p', rows => rows.map(el => el.innerText).filter(text => /生成副本|保留当前目标/.test(text))), meanings = [];
    for (const text of meaningTexts) meanings.push(await readableText(page, '[role=dialog] p', text));
    const meaning = meanings.filter(row => row.visible).map(row => row.text).join('\n');
    await observe(page, `${label}-verified-account-copy-keep-meaning-readable`, destination.visible && meanings.length > 0 && meanings.every(row => row.visible) && /新的本机目标/.test(meaning) && /不上传/.test(meaning) && /不改云端/.test(meaning) && /保留当前目标.*归档/.test(meaning) && /保留原稿和处理记录/.test(meaning), JSON.stringify({ destination, meanings, verifiedOwner: account.owner, note: 'Visible unique synthetic nickname is bound by actual OTP verification; no hidden ID is used to choose the source' }));
    const source = await visibleIdentity(page, '[role=dialog] section', changed), sourceReading = await read(page, source); await capture(page, `${label}-source-section-readable`);
    const currentSection = await visibleIdentity(page, '[role=dialog] section', current), currentReading = await read(page, currentSection); await capture(page, `${label}-current-section-readable`);
    await observe(page, `${label}-source-current-comparison-readable`, sourceReading.visible && currentReading.visible && sourceReading.text.includes('旧窗口原稿') && currentReading.text.includes('当前目标'), JSON.stringify({ sourceReading, currentReading }));
  }
  async function retainedSourceScenario(page, api, originals, account, label, wire) {
    const [a, b] = originals, before = await baseline(page, api, originals, label);
    await navigate(page, '/settings');
    const changed = { ...a, title: 'Synthetic 明确选择生成副本', description: 'Synthetic 保留来源 A 的后续稿', progress: 50, updatedAt: 6000 };
    const kept = { ...b, title: 'Synthetic 明确选择保留当前', description: 'Synthetic 保留来源 B 的后续稿', progress: 100, updatedAt: 7000 };
    await mutateSource(page, api.ownerId, [changed, kept], false, label); await navigate(page, '/goal');
    const setup = await facts(page, api, `${label}-declared-retained-source`);
    await observe(page, `${label}-declared-source-does-not-cover-current-or-upload`, sameRows(before.current.goalRecords, setup.current.goalRecords) && sameRows(setup.current.goals, [changed, kept]) && isDeepStrictEqual(before.physical, setup.physical) && !setup.current.outbox.length && !setup.server.length, 'Current-generation retained-source fixture is distinct from old physical database and leaves current goals/queue/cloud unchanged');
    await segment(page, `${label}-copy-cancel`, async () => { await openComparison(page, changed, a, label, account); await close(page); const cancelled = await facts(page, api, `${label}-copy-cancelled`); await observe(page, `${label}-copy-cancel-source-queue-backup-unchanged`, preserved(setup, cancelled), 'Closing actual compare dialog performs no copy/receipt/snapshot/queue mutation'); });
    let retry = false, committed, copy, peer, peerRecorder, peerName;
    try {
      await segment(page, `${label}-copy-native-quota`, async () => {
        await close(page); await openComparison(page, changed, a, label, account); const preFault = await facts(page, api, `${label}-copy-pre-quota`);
        await installFault(page, api.ownerId, { kind: 'copy-quota', expected: { ...changed, syncScope: 'local' }, sourceId: changed.id });
        try {
          await tap(page, '[role=dialog] button', '生成本机副本'); await alert(page, `${label}-copy-quota`);
          const fault = await page.evaluate(() => window.__legacyGoalFault), after = await facts(page, api, `${label}-copy-quota-rollback`);
          retry = fault.hits.length === 1 && !fault.expired && preserved(preFault, after);
          await observe(page, `${label}-copy-quota-rolls-back-new-ID-receipt-snapshot`, retry, JSON.stringify({ fault, fullSourceQueueBackupEqual: preserved(preFault, after) }));
        } finally { await release(page, `${label}-copy-quota`); }
      });
      await segment(page, `${label}-peer-opens-actual-stale-comparison`, async () => {
        assert.ok(retry, 'Require retained live comparison after actual failed copy');
        peer = await page.browserContext().newPage(); peerName = `${label}-stale-peer`; surfaceNames.set(peer, peerName); peerMedia.push(peerName); wire.add(peer);
        await peer.setViewport(page.viewport()); await peer.emulateTimezone('Asia/Shanghai'); peer.setDefaultTimeout(10000); await peer.bringToFront();
        peerRecorder = await peer.screencast({ path: join(artifacts, `${peerName}.webm`), fps: 12, quality: 35 }); recordings.push(peerRecorder);
        // A real browser new tab of an already authenticated profile. This has
        // no cookie copy/injection and no replacement account/store mutation.
        await peer.goto(`${origin}/`, { waitUntil: 'networkidle0' }); actions.push({ kind: 'native-profile-peer-entry', surface: peerName, path: '/', auth: 'Existing browser profile session, no injected cookies' }); await navigate(peer, '/goal'); await openComparison(peer, changed, a, peerName, account);
        const targets = [];
        for (const item of [page, peer]) { const session = await item.createCDPSession(), { targetInfo } = await session.send('Target.getTargetInfo'); targets.push({ surface: surfaceNames.get(item), targetId: targetInfo.targetId, url: item.url() }); await session.detach(); }
        await writeFile(join(artifacts, `${label}-peer-targets.json`), JSON.stringify({ targets, trace: `${label}-trace.json`, note: 'One existing browser-wide trace includes both targets; peer has continuous video. Separately opened comparison is a stale view, not a same-intent replay claim.' }, null, 2));
      });
      await segment(page, `${label}-copy-retry-real-commit-then-display-read-failure`, async () => {
        assert.ok(retry, 'No unproven retry'); await page.bringToFront();
        await installFault(page, api.ownerId, { kind: 'copy-postcommit-read', expected: { ...changed, syncScope: 'local' }, sourceId: changed.id });
        try {
          await tap(page, '[role=dialog] button', '生成本机副本'); await page.waitForSelector('[role=dialog]', { hidden: true });
          await page.waitForFunction(recovery => [...document.querySelectorAll(`${recovery} [role=status]`)].some(el => /处理已保存在本机/.test(el.textContent)), { timeout: 7000 }, RECOVERY);
          committed = await facts(page, api, `${label}-copy-durable-read-fault`); const added = committed.current.goalRecords.filter(row => !setup.current.goalRecords.some(old => old.id === row.id)); assert.equal(added.length, 1); copy = added[0];
          const fault = await page.evaluate(() => window.__legacyGoalFault), receipt = committed.current.settings.find(row => row.key.startsWith('goal-source-recovery:') && row.value.copyId === copy.id)?.value;
          const notice = await read(page, await exact(page, `${RECOVERY} [role=status]`)), refresh = await read(page, await exact(page, `${RECOVERY} button`, '刷新核对'));
          await observe(page, `${label}-copy-committed-once-fault-after-commit-readable-refresh`, fault.writes.length === 1 && fault.commits.length === 1 && fault.commits[0].id === copy.id && fault.reads.length > 0 && fault.reads.every(row => row.at >= fault.commits[0].at) && !fault.expired && notice.visible && /已保存在本机/.test(notice.text) && /无需重复处理/.test(notice.text) && refresh.visible && !notice.text.includes('这次操作没有保存'), JSON.stringify({ fault, notice, refresh, copyId: copy.id }));
          await observe(page, `${label}-copy-exact-new-local-record-receipt-originals-unchanged`, copy.id !== changed.id && goalOutcomeChecks.onlyChanges(changed, copy, ['id', 'syncScope']) && copy.syncScope === 'local' && receipt?.ownerId === api.ownerId && receipt.choice === 'copy' && isDeepStrictEqual(receipt.source, changed) && isDeepStrictEqual(receipt.previousSource, a) && isDeepStrictEqual(receipt.current, { ...a, syncScope: 'local' }) && isDeepStrictEqual(setting(committed, `goal-source-snapshot:${a.id}`), changed) && neighborUnchanged(setup, committed, b.id) && isDeepStrictEqual(currentGoal(setup, a.id), currentGoal(committed, a.id)) && isDeepStrictEqual(setup.physical, committed.physical) && sameRows(setup.current.goals, committed.current.goals) && !committed.current.outbox.length && !committed.server.length && wireSafe(wire.requests, originals), JSON.stringify({ copy, receipt, sourceArtifact: `${label}-copy-durable-read-fault-full-source.json` }));
        } finally { await release(page, `${label}-copy-read`); }
      });
      await segment(page, `${label}-actual-refresh-reload-same-copy`, async () => {
        assert.ok(copy && committed, 'Need real durable copy before read recovery');
        await tap(page, `${RECOVERY} button`, '刷新核对'); await page.waitForFunction(description => [...document.querySelectorAll('[data-component="goal-card"]')].some(el => el.innerText.includes(description)), { timeout: 7000 }, changed.description);
        const refreshed = await facts(page, api, `${label}-copy-refreshed`), reading = await read(page, await visibleIdentity(page, '[data-component="goal-card"]', copy));
        await observe(page, `${label}-refresh-only-keeps-same-copy-no-duplicate-or-event`, preserved(committed, refreshed) && reading.visible && reading.text.includes('仅本机'), JSON.stringify({ copyId: copy.id, reading }));
        await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'explicit-reload-after-actual-copy-read-recovery', surface: surfaceNames.get(page), copyId: copy.id }); await page.waitForSelector('[data-component="goal-card"]');
        const reloaded = await facts(page, api, `${label}-copy-reloaded`); await visibleIdentity(page, '[data-component="goal-card"]', copy);
        await observe(page, `${label}-reload-keeps-same-copy-no-duplicate`, preserved(refreshed, reloaded) && reloaded.current.goalRecords.filter(row => row.id === copy.id).length === 1, JSON.stringify({ copyId: copy.id, count: reloaded.current.goalRecords.length }));
      });
      await segment(page, `${label}-keep-current-with-downloadable-source-and-receipt`, async () => {
        await close(page); const beforeKeep = await facts(page, api, `${label}-before-keep`); await openComparison(page, kept, b, `${label}-keep`, account); await tap(page, '[role=dialog] button', '保留当前目标'); await page.waitForSelector('[role=dialog]', { hidden: true });
        const after = await facts(page, api, `${label}-kept`), receipt = after.current.settings.find(row => row.key.startsWith('goal-source-recovery:') && row.value.id === b.id)?.value;
        await observe(page, `${label}-keep-current-archives-choice-without-copy-or-upload`, sameRows(beforeKeep.current.goalRecords, after.current.goalRecords) && sameRows(beforeKeep.current.goals, after.current.goals) && isDeepStrictEqual(beforeKeep.physical, after.physical) && isDeepStrictEqual(beforeKeep.events, after.events) && !after.current.outbox.length && receipt?.choice === 'keep' && receipt.copyId === null && receipt.ownerId === api.ownerId && isDeepStrictEqual(receipt.source, kept) && isDeepStrictEqual(receipt.previousSource, b) && isDeepStrictEqual(setting(after, `goal-source-snapshot:${b.id}`), kept), JSON.stringify({ receipt }));
        await navigate(page, '/settings'); const exported = await download(page, `${label}-copy-keep-backup`, '导出数据'), raw = decodeRecovery(exported.rawTables), rows = name => raw.find(table => table.name === name)?.rows;
        await observe(page, `${label}-download-includes-source-current-copy-and-decisions`, rawTableMatches(raw, 'goals', after.current.goals) && rawTableMatches(raw, 'goalRecords', after.current.goalRecords) && rawTableMatches(raw, 'settings', rows('settings'), 'key') && sameRows(rows('settings').filter(row => row.key.startsWith('goal-')), after.current.settings.filter(row => row.key.startsWith('goal-'))) && rawTableMatches(raw, 'outbox', after.current.outbox, 'seq') && exported.ownerId === api.ownerId, 'Actual authoritative download preserves original keys, arbitrary private fields and all full decision/source/snapshot records'); await navigate(page, '/goal');
      });
      await segment(page, `${label}-delete-copy-then-actual-stale-peer-choice`, async () => {
        assert.ok(copy && peer, 'Need durable copy and already-opened native peer comparison'); await close(page); const target = await visibleIdentity(page, '[data-component="goal-card"]', copy);
        await tap(page, `${target} button[aria-label=${JSON.stringify(`删除目标 ${copy.title}`)}]`); await page.waitForSelector('[role=dialog]');
        await visibleIdentity(page, '[role=dialog] p', copy); await tap(page, '[role=dialog] button', '确认删除'); await page.waitForSelector('[role=dialog]', { hidden: true });
        const deleted = await facts(page, api, `${label}-copy-deleted`); assert.equal(currentGoal(deleted, copy.id), undefined, 'Explicit native deletion must commit');
        await peer.bringToFront(); await capture(peer, `${label}-stale-comparison-before-repeat`); await tap(peer, '[role=dialog] button', '生成本机副本'); await peer.waitForSelector('[role=dialog] [role=alert]');
        const errorReading = await read(peer, await exact(peer, '[role=dialog] [role=alert]')), repeated = await facts(peer, api, `${label}-stale-choice-rejected`);
        await observe(peer, `${label}-stale-opened-comparison-cannot-resurrect-deleted-copy`, errorReading.visible && /重新比较|变化|重试/.test(errorReading.text) && preserved(deleted, repeated) && !currentGoal(repeated, copy.id) && !repeated.current.goalRecords.some(row => row.description === copy.description), JSON.stringify({ errorReading, deletedCopyId: copy.id, note: 'Actual earlier peer comparison has a distinct intent; this is stale-view non-resurrection, not a same-intent replay claim' }));
      });
    } finally {
      if (peerRecorder) { await capture(peer, `${label}-peer-final`).catch(() => undefined); await peerRecorder.stop(); recordings.splice(recordings.indexOf(peerRecorder), 1); }
      if (peer && !peer.isClosed()) await peer.close(); await page.bringToFront();
    }
  }
  async function ambiguousSourceScenario(page, api, originals, label) {
    await baseline(page, api, originals, label); await navigate(page, '/settings');
    const changed = originals.map((row, i) => ({ ...row, progress: i ? 50 : 100, updatedAt: row.updatedAt + 5000 })); await mutateSource(page, api.ownerId, changed, false, label); await navigate(page, '/goal');
    const before = await facts(page, api, `${label}-same-name-comparison-before`);
    const choices = await page.$$eval(`${RECOVERY} button`, rows => rows.map(el => ({ text: el.innerText, label: el.getAttribute('aria-label'), title: el.getAttribute('title') })));
    const readings = [];
    // Index is only used to document each indistinguishable rendered choice,
    // never to select one or trigger a business action.
    for (let index = 0; index < choices.length; index++) { const reading = await read(page, `${RECOVERY} > button:nth-of-type(${index + 1})`); readings.push(reading); await capture(page, `${label}-ambiguous-choice-${index + 1}`); }
    const distinguishable = changed.every(row => choices.filter(choice => choice.text.includes(row.description) && choice.text.includes(row.domain) && choice.text.includes(`${row.progress}%`)).length === 1);
    await observe(page, `${label}-same-name-source-choices-distinguishable-before-selection`, distinguishable && readings.every(row => row.visible), JSON.stringify({ choices, readings, expectedVisibleIdentities: changed.map(({ title, description, domain, progress }) => ({ title, description, domain, progress })), note: 'No hidden record ID or array-position selection may substitute for visible source context' }));
    if (distinguishable) { const selector = await visibleIdentity(page, `${RECOVERY} button`, changed[0]); await tap(page, selector); await visibleIdentity(page, '[role=dialog] section', changed[0]); await close(page); }
    const after = await facts(page, api, `${label}-same-name-comparison-after`); await observe(page, `${label}-ambiguous-unselected-source-remains-unchanged`, preserved(before, after), 'If the real choices are indistinguishable, record RED and leave both untouched; independent fixtures cover copy/keep');
  }

  let accountIndex = 10;
  const scenarios = scenarioSet === 'enrollment' ? ['enrollment'] : scenarioSet === 'source' ? ['retained', 'ambiguous'] : ['enrollment', 'retained', 'ambiguous'];
  for (const width of [1280, 360]) for (const scenario of scenarios) {
    const label = `Y6L-${scenario}-${width}`, registration = `${label}-register`, viewport = { width, height: width === 360 ? 800 : 900 };
    const phone = `139000087${accountIndex++}`, nickname = `Synthetic L${accountIndex}`, originals = fixture(`${scenario}-${width}`); let owner;
    media.push(registration); await isolated(registration, viewport, async page => { await login(page, phone, nickname); const api = await apiFor(page); owner = api.ownerId; await observe(page, `${registration}-verified-owner`, true, JSON.stringify({ ownerId: owner, phone, nickname, nativeRegistration: true })); });
    media.push(label); await isolated(label, viewport, async page => {
      assert.ok(owner, 'Historical fixture requires verified actual native registration'); await seedHistorical(page, owner, originals);
      const wire = watchWire(page);
      try {
        const api = await existingLogin(page, phone, owner), readOnly = path => { assert.ok(path.startsWith('/sync/pull?'), 'Audit cloud evidence is GET-only sync ledger'); return api(path); }; readOnly.ownerId = api.ownerId;
        if (scenario === 'enrollment') await historicalEnrollment(page, readOnly, originals, { owner, phone, nickname }, label, wire);
        else if (scenario === 'retained') await retainedSourceScenario(page, readOnly, originals, { owner, phone, nickname }, label, wire);
        else await ambiguousSourceScenario(page, readOnly, originals, label);
      } finally {
        await writeFile(join(artifacts, `${label}-actual-wire.json`), JSON.stringify(wire.requests, null, 2));
        const safeWire = wireSafe(wire.requests, originals), goalFieldsExercised = wire.requests.some(row => { try { return row.path === '/api/sync/push' && JSON.parse(row.body)?.goals?.length > 0; } catch { return false; } });
        await observe(page, `${label}-no-privateMemo-ever-transmitted`, safeWire ? goalFieldsExercised ? true : null : false, goalFieldsExercised ? 'Actual Goal request bodies from main and recorded peer surfaces were retained and checked against allowed fields and private sentinels' : 'No Goal upsert body was observed; this is context only, not exercised field-filter or recovery acceptance. Any captured private-field transmission still fails.'); wire.stop();
      }
    });
  }
  assert.equal(recordings.length, 0, 'Every opened peer recording must have finished');
  await writeFile(join(artifacts, 'Y6L-media.json'), JSON.stringify({ main: media, peerVideos: peerMedia, peerTraces: 'Each peer is covered by its scenario browser-wide trace plus explicit target IDs' }, null, 2));
  return { media, peerMedia };
}
