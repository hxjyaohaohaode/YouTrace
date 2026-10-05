// Y6 native Goal outcomes; original unchanged-9a9 RED remains at 0f77be6. Hosted CI only.
// Business records originate exclusively in rendered controls. IndexedDB reads
// and GET-only HTTP snapshots observe the full canonical sources; bounded native
// put/delete fault injection never seeds a record or touches an app/auth store.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const NAME = 'Synthetic 自主方向';
const WORKSPACE = '[data-component="goal-workspace"]';
const EDITOR = '[role=dialog] [data-component="goal-editor"]';
const TITLE = `${EDITOR} input[placeholder="想完成什么？"]`;
const DESCRIPTION = `${EDITOR} input[placeholder="补充说明..."]`;
const DATE = `${EDITOR} input[type=date]`;
const validVersion = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const version = (facts, id) => facts.local.settings.find(row => row.key === `sync-version:goals:${id}`)?.value;
const goalSettings = local => local.settings.filter(row => /^(?:sync-(?:version|conflict):goals:|goal-)/.test(row.key));
const normalFeedback = messages => !messages.some(row => row.role === 'alert' || /列表暂未刷新|请刷新核对|无需重复提交/.test(row.text));
const sameRows = (left, right) => isDeepStrictEqual([...left].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key))), [...right].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key))));
function preserved(before, after) {
  return sameRows(before.local.goalRecords, after.local.goalRecords) && sameRows(before.server, after.server) &&
    sameRows(goalSettings(before.local), goalSettings(after.local)) && isDeepStrictEqual(before.local.outbox, after.local.outbox) && isDeepStrictEqual(before.events, after.events);
}
// Compare complete records, including unknown fields. Allowed changes are named,
// never achieved by deleting metadata from a source or rewriting expected input.
function onlyChanges(before, after, allowed) {
  return Boolean(before && after) && [...new Set([...Object.keys(before), ...Object.keys(after)])].every(key => allowed.includes(key) || Object.hasOwn(before, key) === Object.hasOwn(after, key) && isDeepStrictEqual(before[key], after[key]));
}
function neighborUnchanged(before, after, id) {
  return isDeepStrictEqual(before.local.goalRecords.find(row => row.id === id), after.local.goalRecords.find(row => row.id === id)) &&
    isDeepStrictEqual(before.server.find(row => row.id === id), after.server.find(row => row.id === id)) && version(before, id) === version(after, id);
}
function sameInputs(left, right) {
  return Boolean(left && right) && ['title', 'description', 'targetDate', 'choices'].every(key => isDeepStrictEqual(left[key], right[key]));
}
function goalRowsFromLedger(events) {
  const current = new Map(); let previous = 0n;
  for (const event of events) {
    assert.ok(validVersion(event.seq) && BigInt(event.seq) > previous, 'Canonical change ledger must be ordered and complete'); previous = BigInt(event.seq);
    if (event.entity !== 'goals') continue;
    assert.ok(['upsert', 'delete'].includes(event.operation), 'Unknown Goal change operation');
    if (event.operation === 'delete') current.delete(event.entityId);
    else { assert.equal(event.data?.id, event.entityId, 'Keep raw server payload identity; never manufacture a replacement ID'); current.set(event.entityId, event.data); }
  }
  return [...current.values()].sort((left, right) => left.id.localeCompare(right.id));
}
export const goalOutcomeChecks = { validVersion, version, preserved, onlyChanges, neighborUnchanged, sameInputs, goalRowsFromLedger, normalFeedback };

export async function runGoalOutcomes(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Y6 is hosted-CI only; never retry a restricted local listener/browser');
  const { isolated, login, fill, dateInput, waitPath, capture, observe, segment, apiFor, localRows, settledRows, saveRecordEvidence, businessDate, sleep, actions, artifacts, writeFile, join, surfaceNames } = h;
  assert.equal(typeof businessDate, 'function', 'Driver must supply its explicit business-date helper');
  const limitations = [
    '9a9 has no GET /goals route. Current server Goal rows are reconstructed from the complete GET-only sync/pull ledger; raw events and tombstones are retained',
    'No legacy migration/enrollment/recovery fixture: a fresh account is not evidence of old-user recovery',
    'No native second-tab stale-dialog race: supplied isolated helper records one page only; module actor/race contracts remain separate',
    'Postcommit display read failure is a bounded exact-account/exact-target committed-put then four-table readonly fixture; native legacy enrollment/copy read-failure recovery is not covered',
    'No signout/clear/account-generation race, arbitrary scale, real mobile OS, screen reader, live model/provider or production claim',
    '100% is only a reversible user-entered progress value; a future plan date is not proof of work performed',
  ];
  await writeFile(join(artifacts, 'Y6-scope.json'), JSON.stringify({ kind: 'native-goal-user-result-candidate', redEvidenceCommit: '0f77be644dbd1fc45becbc7223acd8e078cadfa4', applicationBaseline: '9a9fdc12818e9ba03a3768c34155ce036b76a439', syntheticOnly: true, widths: [1280, 360], limitations }, null, 2));

  // This function is evaluated in Chromium only. It observes actual ancestor
  // clipping, painted opacity, fixed bottom navigation and foreground hit tests.
  function geometry(selector) {
    const nodes = [...document.querySelectorAll(selector)];
    if (nodes.length !== 1) return { unique: false, count: nodes.length, visible: false };
    const el = nodes[0], rect = el.getBoundingClientRect(), dialog = el.closest('[role=dialog]');
    const navs = dialog ? [] : [...document.querySelectorAll('nav[aria-label="主导航"]')].filter(node => !node.contains(el)).map(node => node.getBoundingClientRect()).filter(box => box.width >= innerWidth / 2 && box.height > 0 && box.top > innerHeight / 2 && box.bottom >= innerHeight - 1);
    const clip = { left: 0, top: 0, right: innerWidth, bottom: Math.min(innerHeight, ...navs.map(box => box.top)) };
    let scroller = null, painted = getComputedStyle(el).visibility === 'visible' && Number(getComputedStyle(el).opacity) >= 0.99;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
      painted = painted && css.visibility === 'visible' && Number(css.opacity) >= 0.99;
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right); }
      if (!scroller && /(auto|scroll)/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight) scroller = { tag: parent.tagName, role: parent.getAttribute('role'), scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight };
    }
    const centerHit = el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    const editableValue = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    const textNotTruncated = editableValue || el.scrollWidth <= el.clientWidth + 1;
    // A native single-line value may horizontally scroll while being edited.
    // Exact input preservation is checked separately from readable static copy.
    return { unique: true, text: el.innerText, rect: rect.toJSON(), clip, scroller, centerHit, painted, textNotTruncated,
      visible: painted && centerHit && textNotTruncated && rect.width > 0 && rect.height > 0 && rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom };
  }
  async function read(page, selector) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await page.evaluate(geometry, selector); assert.equal(box.unique, true, `Expected one actual readable region: ${selector}`);
      if (box.visible) return box;
      const x = Math.max(box.clip.left + 8, Math.min(box.rect.x + box.rect.width / 2, box.clip.right - 8));
      const y = Math.max(20, Math.min((box.clip.top + box.clip.bottom) / 2, page.viewport().height - 20));
      const delta = box.rect.y + box.rect.height / 2 - y;
      if (Math.abs(delta) > 1) {
        await page.mouse.move(x, y); await page.mouse.wheel({ deltaY: delta });
        actions.push({ kind: 'native-wheel-read-goal', surface: surfaceNames.get(page), selector, pointer: { x, y }, deltaY: delta, clip: box.clip, scroller: box.scroller });
      }
      await sleep(150);
    }
    return page.evaluate(geometry, selector);
  }
  async function exactSelector(page, selector, text) {
    return page.evaluate(({ selector, text }) => {
      const matches = [...document.querySelectorAll(selector)].filter(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (text === undefined || el.textContent.trim() === text);
      });
      if (matches.length !== 1) throw new Error(`Expected one rendered control, found ${matches.length}: ${selector} / ${text ?? ''}`);
      const parts = []; for (let el = matches[0]; el && el !== document.body; el = el.parentElement) {
        const siblings = [...el.parentElement.children].filter(node => node.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`);
      }
      return 'body > ' + parts.join(' > ');
    }, { selector, text });
  }
  async function tap(page, selector, text) {
    await page.bringToFront(); const exact = await exactSelector(page, selector, text), box = await read(page, exact);
    assert.ok(box.visible, `Actual control is clipped, unpainted, obscured or text-truncated: ${selector} ${text ?? ''}`);
    assert.equal(await page.$eval(exact, el => Boolean(el.disabled)), false, 'A disabled control is not an attempted action');
    const x = box.rect.x + box.rect.width / 2, y = box.rect.y + box.rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.click(x, y);
    actions.push({ kind: 'native-pointer-goal', surface: surfaceNames.get(page), selector, resolvedSelector: exact, text, x, y, actualClip: box.clip, path: new URL(page.url()).pathname });
  }
  async function input(page, selector, text) {
    assert.ok((await read(page, selector)).visible, 'Input must actually be readable before native fill');
    await fill(page, selector, text);
  }
  async function setDate(page, value) {
    assert.ok((await read(page, DATE)).visible, 'Date must actually be readable before native segmented input');
    if (value) await dateInput(page, DATE, value);
    else {
      await tap(page, DATE); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await page.keyboard.press('Tab');
      actions.push({ kind: 'native-clear-optional-goal-date', surface: surfaceNames.get(page), selector: DATE, actual: await page.$eval(DATE, el => el.value) });
      assert.equal(await page.$eval(DATE, el => el.value), '', 'Native clear must empty the actual date control, not assign input.value');
    }
  }
  async function choose(page, label, wanted) {
    const selector = await page.evaluate(label => {
      const labels = [...document.querySelectorAll('[role=dialog] label')].filter(el => el.childNodes[0]?.textContent.trim() === label && el.querySelector('select'));
      if (labels.length !== 1) throw new Error(`Cannot identify one visible ${label} select`);
      const el = labels[0].querySelector('select'), parts = [];
      for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
      return 'body > ' + parts.join(' > ');
    }, label);
    const options = await page.$eval(selector, el => [...el.options].map(option => ({ value: option.value, text: option.text })));
    const index = options.findIndex(option => option.value === wanted); assert.ok(index >= 0);
    await tap(page, selector); await page.keyboard.press('Home'); for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    assert.equal(await page.$eval(selector, el => el.value), wanted, 'Native select must reach the intended visible choice');
    actions.push({ kind: 'native-goal-select', surface: surfaceNames.get(page), label, chosen: options[index], selector });
  }
  async function closeDialogs(page) {
    for (let i = 0; i < 3 && await page.$('[role=dialog]'); i++) { await page.bringToFront(); await page.keyboard.press('Escape'); actions.push({ kind: 'native-escape-between-goal-segments', surface: surfaceNames.get(page) }); await sleep(300); }
    assert.equal(await page.$('[role=dialog]'), null, 'Close only through actual dialog behavior');
  }
  async function home(page) {
    await closeDialogs(page);
    if (page.viewport().width === 360) await tap(page, 'nav[aria-label="主导航"] button[aria-label="首页"]');
    else await tap(page, 'aside nav button', '首页');
    await waitPath(page, '/');
  }
  async function enter(page, { directory = false, firstUse = false } = {}) {
    if (new URL(page.url()).pathname !== '/') await home(page);
    if (directory) {
      await tap(page, 'nav[aria-label="主导航"] button[aria-label="全部功能"]'); await waitPath(page, '/more');
      const entry = 'nav[aria-label="全部功能"] a[href="/goal"]';
      const reading = await read(page, entry); if (firstUse) await observe(page, `${surfaceNames.get(page)}-visible-directory-discovery`, reading.visible && /目标/.test(reading.text) && /进度/.test(reading.text), JSON.stringify(reading));
      await tap(page, entry);
    } else {
      const summary = '也可以直接安排任务、记账或查看其他功能';
      if (await page.$$eval('summary', (rows, text) => rows.some(el => el.textContent.trim() === text && !el.parentElement.open), summary)) await tap(page, 'summary', summary);
      const entry = 'main a[aria-label="目标"]';
      const reading = await read(page, entry); if (firstUse) await observe(page, `${surfaceNames.get(page)}-visible-home-discovery`, reading.visible, JSON.stringify(reading));
      await tap(page, entry);
    }
    await waitPath(page, '/goal'); await page.waitForSelector('button[aria-label="新建目标"]');
  }
  async function filter(page, text) { await tap(page, '[role=group][aria-label="目标类型筛选"] button', text); await sleep(300); }
  async function card(page, visibleIdentity) {
    // Select by actual title AND visible description/domain, never by DB id,
    // array position, a hidden React key or the nearest same-name control.
    const candidates = await page.evaluate(identity => [...document.querySelectorAll('[data-component="goal-card"]')].map(el => {
      const parts = []; for (let node = el; node && node !== document.body; node = node.parentElement) { const siblings = [...node.parentElement.children].filter(row => row.tagName === node.tagName); parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`); }
      return { selector: 'body > ' + parts.join(' > '), title: el.querySelector('h2')?.innerText, text: el.innerText,
        matches: el.querySelector('h2')?.innerText === identity.title && [...el.querySelectorAll('p')].some(p => p.innerText === identity.description) && [...el.querySelectorAll('span')].some(span => span.innerText === identity.domain) };
    }), { title: visibleIdentity.title, description: visibleIdentity.description, domain: visibleIdentity.domain });
    const matches = candidates.filter(row => row.matches);
    if (matches.length !== 1) {
      await observe(page, `${surfaceNames.get(page)}-visible-goal-identity-gap`, false, JSON.stringify({ intendedVisibleIdentity: { title: visibleIdentity.title, description: visibleIdentity.description, domain: visibleIdentity.domain }, candidates }));
      throw new Error('Goal is missing or visually ambiguous; no hidden ID or remembered position substitutes for its visible identity');
    }
    const reading = await read(page, matches[0].selector); assert.ok(reading.visible, 'The exact goal identity must be readable before choosing a control');
    return matches[0].selector;
  }
  async function ledger(api) {
    const events = []; let cursor = '0';
    for (let i = 0; i < 20; i++) {
      const result = await api(`/sync/pull?protocol=2&features=goals-v1&cursor=${cursor}&limit=500`); assert.ok(Array.isArray(result.events)); events.push(...result.events);
      if (!result.hasMore) return events;
      assert.notEqual(result.nextCursor, cursor); cursor = result.nextCursor;
    }
    throw new Error('Read-only change ledger exceeded its bounded page count');
  }
  async function facts(page, api, label, ids = [], extra = {}) {
    const local = await settledRows(page, api); assert.ok(Array.isArray(local.goalRecords), 'Driver localRows must include goalRecords in its readonly transaction');
    const allEvents = await ledger(api), events = allEvents.filter(row => row.entity === 'goals'), server = goalRowsFromLedger(allEvents);
    const serverVersions = Object.fromEntries(events.map(event => [event.entityId, event.seq]));
    const result = { local, server, events, serverVersions };
    // Retain raw full records, unknown fields, timestamps, all settings/outbox
    // and complete read-only ledger alongside the convenience per-record view.
    await writeFile(join(artifacts, `${label}-full-source.json`), JSON.stringify({ syntheticOnly: true, capturedAt: new Date().toISOString(), ...result, allEvents, serverReadSource: 'Latest complete GET /sync/pull Goal upsert payloads minus actual delete events; no /goals route exists on 9a9', ...extra }, null, 2));
    await saveRecordEvidence(label, local, { goals: server }, { goals: ids }, { ...extra, fullSourceArtifact: `${label}-full-source.json`, serverGoalEvents: events });
    return result;
  }
  async function editorValues(page) {
    return page.$eval(EDITOR, el => ({ title: el.querySelector('input[placeholder="想完成什么？"]').value, description: el.querySelector('input[placeholder="补充说明..."]').value, targetDate: el.querySelector('input[type=date]').value, choices: [...el.querySelectorAll('select')].map(node => ({ label: node.closest('label')?.childNodes[0]?.textContent.trim(), value: node.value })), text: el.innerText }));
  }
  async function edit(page, identity) {
    await closeDialogs(page); await filter(page, '全部'); const root = await card(page, identity);
    await tap(page, `${root} button[aria-label=${JSON.stringify(`编辑目标 ${identity.title}`)}]`); await page.waitForSelector(EDITOR);
    assert.equal(await page.$eval('[role=dialog] h3', el => el.innerText), '编辑目标');
    const actual = await editorValues(page);
    assert.equal(actual.title, identity.title); assert.equal(actual.description, identity.description);
    await capture(page, `${surfaceNames.get(page)}-selected-visible-editor`);
    return actual;
  }
  async function setEditor(page, values) {
    await input(page, TITLE, values.title); await input(page, DESCRIPTION, values.description); await setDate(page, values.targetDate);
    if (values.level) await choose(page, '类型', values.level);
    if (values.domain) await choose(page, '领域', values.domain);
    if (values.priority) await choose(page, '优先级', values.priority);
  }
  async function saveEditor(page) {
    const editing = await page.$eval('[role=dialog] h3', el => el.innerText === '编辑目标');
    await tap(page, '[role=dialog] button', editing ? '保存修改' : '创建'); await page.waitForSelector('[role=dialog]', { hidden: true });
  }
  async function create(page, api, label, values) {
    await closeDialogs(page); const before = await facts(page, api, `${label}-before-create`);
    await tap(page, 'button[aria-label="新建目标"]'); await page.waitForSelector(EDITOR); await setEditor(page, values);
    const actual = await editorValues(page); await capture(page, `${label}-complete-user-chosen-input`); await saveEditor(page);
    const after = await facts(page, api, `${label}-created`), newLocal = after.local.goalRecords.filter(row => !before.local.goalRecords.some(old => old.id === row.id)), newServer = after.server.filter(row => !before.server.some(old => old.id === row.id));
    assert.equal(newLocal.length, 1, 'Creation must have exactly one new local record'); const row = newLocal[0];
    const matches = candidate => candidate && candidate.title === values.title && candidate.description === values.description && candidate.targetDate === values.targetDate && candidate.level === values.level && candidate.domain === values.domain && candidate.priority === values.priority && candidate.progress === 0;
    await observe(page, `${label}-native-created-fields-zero-manual-progress-cloud-ack`, newServer.length === 1 && newServer[0].id === row.id && matches(row) && matches(newServer[0]) && row.syncScope === 'account' && after.local.outbox.length === 0 && validVersion(version(after, row.id)) && version(after, row.id) === after.serverVersions[row.id], JSON.stringify({ actualInput: actual, localId: row.id, serverIds: newServer.map(item => item.id), expected: values, note: 'A future planned date starts at zero and does not assert an actual accomplishment' }));
    await saveRecordEvidence(`${label}-created-exact-id`, after.local, { goals: after.server }, { goals: [row.id] });
    await normalReaderFeedback(page, after, row, label);
    return row;
  }
  async function manualMeaning(page, label) {
    const selector = `${WORKSPACE} > p:first-of-type`; const reading = await read(page, selector);
    await observe(page, `${label}-manual-reversible-progress-and-cloud-meaning-readable`, reading.visible && /手动/.test(reading.text) && /调回|调整|撤销/.test(reading.text) && /云端确认/.test(reading.text) && /本机/.test(reading.text), JSON.stringify({ reading, note: 'Read actual visible explanatory text; neither 100% nor a future plan date proves work automatically happened' }));
  }
  async function syncMeaning(page, api, identity, label) {
    const root = await card(page, identity), reading = await read(page, root), current = await facts(page, api, label, [identity.id]);
    const pending = current.local.outbox.some(row => row.entity === 'goals' && (row.payload === identity.id || row.payload?.id === identity.id));
    const conflict = current.local.settings.some(row => row.key === `sync-conflict:goals:${identity.id}`), row = current.local.goalRecords.find(item => item.id === identity.id);
    const acknowledged = !pending && !conflict && row?.syncScope === 'account' && validVersion(version(current, identity.id)) && version(current, identity.id) === current.serverVersions[identity.id] && current.server.some(item => item.id === identity.id);
    const local = row?.syncScope !== 'account', blocked = current.local.outbox.some(item => item.entity === 'goals' && (item.payload === identity.id || item.payload?.id === identity.id) && item.status === 'blocked');
    const expected = conflict ? '需要比较版本' : blocked ? '需要检查' : local ? '仅本机' : acknowledged ? '已同步' : '待同步';
    await observe(page, `${label}-visible-status-matches-real-durability`, reading.visible && reading.text.includes(expected) && (!reading.text.includes('已同步') || acknowledged), JSON.stringify({ expected, acknowledged, pending, conflict, rawLocalScope: row?.syncScope, canonicalVersion: version(current, identity.id), reading, note: 'This normal account journey observes only statuses it actually reaches; local-only and conflict presentation are not awarded coverage' }));
  }
  async function progress(page, api, identity, neighbor, value, label) {
    await closeDialogs(page); await filter(page, '全部'); const before = await facts(page, api, `${label}-before`, [identity.id, ...(neighbor ? [neighbor.id] : [])]);
    const root = await card(page, identity); await tap(page, `${root} button[aria-label="将目标进度设为 ${value}%"]`);
    await page.waitForFunction(({ selector, value }) => document.querySelector(`${selector} [role=progressbar]`)?.getAttribute('aria-valuenow') === String(value), { timeout: 7000 }, { selector: root, value });
    const after = await facts(page, api, label, [identity.id, ...(neighbor ? [neighbor.id] : [])]), a = after.local.goalRecords.find(row => row.id === identity.id), b = after.server.find(row => row.id === identity.id);
    const rawLocalUnchanged = onlyChanges(before.local.goalRecords.find(row => row.id === identity.id), a, ['progress', 'updatedAt']);
    const rawServerUnchanged = onlyChanges(before.server.find(row => row.id === identity.id), b, ['progress', 'updatedAt']);
    const reading = await read(page, await card(page, identity));
    const controlState = await page.$$eval(`${await card(page, identity)} [aria-label="手动调整目标进度"] button`, rows => rows.map(el => ({ text: el.innerText, pressed: el.getAttribute('aria-pressed') })));
    await observe(page, `${label}-actual-visible-manual-value`, reading.visible && reading.text.includes(`${value}%`) && controlState.filter(row => row.pressed === 'true').length === 1 && controlState.some(row => row.text === `${value}%` && row.pressed === 'true'), JSON.stringify({ reading, controlState, manuallyChosen: value }));
    const newer = validVersion(version(before, identity.id)) && validVersion(version(after, identity.id)) && BigInt(version(after, identity.id)) > BigInt(version(before, identity.id)) && version(after, identity.id) === after.serverVersions[identity.id];
    await observe(page, `${label}-exact-id-manual-value-and-server-ack`, a?.progress === value && b?.progress === value && rawLocalUnchanged && rawServerUnchanged && newer && after.local.outbox.length === 0 && before.local.goalRecords.length === after.local.goalRecords.length && before.server.length === after.server.length && (!neighbor || neighborUnchanged(before, after, neighbor.id)), JSON.stringify({ id: identity.id, value, localRawProgress: a?.progress, serverRawProgress: b?.progress, beforeVersion: version(before, identity.id), afterVersion: version(after, identity.id), rawLocalUnchanged, rawServerUnchanged, note: 'Same-ID raw values, complete-field preservation, and cloud ACK; no auto-completion inference' }));
    await normalReaderFeedback(page, after, identity, label);
    return after;
  }
  async function summary(page, api, label, filterText = '全部') {
    await closeDialogs(page); await filter(page, filterText);
    const current = await facts(page, api, `${label}-denominator-source`), selector = `${WORKSPACE} h1 + p`, reading = await read(page, selector);
    const all = current.local.goalRecords, valid = all.filter(row => Number.isFinite(row.progress) && row.progress >= 0 && row.progress <= 100), done = valid.filter(row => row.progress === 100).length, average = valid.length ? Math.round(valid.reduce((sum, row) => sum + row.progress, 0) / valid.length) : 0;
    const displayed = await page.$$eval('[data-component="goal-card"]', nodes => nodes.map(node => ({ title: node.querySelector('h2')?.innerText, text: node.innerText })));
    const actualCount = reading.text.match(/(\d+)\s*\/\s*(\d+)/), actualAverage = reading.text.match(/平均进度\s*(\d+)%/);
    const correctAll = actualCount?.[1] === String(done) && actualCount?.[2] === String(all.length) && actualAverage?.[1] === String(average);
    const filtered = all.filter(row => filterText === '全部' || row.level === ({ 短期: 'short', 中期: 'medium', 长期: 'long' })[filterText]);
    const filteredValid = filtered.filter(row => Number.isFinite(row.progress) && row.progress >= 0 && row.progress <= 100), filteredDone = filteredValid.filter(row => row.progress === 100).length;
    const filteredAverage = filteredValid.length ? Math.round(filteredValid.reduce((sum, row) => sum + row.progress, 0) / filteredValid.length) : 0;
    const correctDisplayed = actualCount?.[1] === String(filteredDone) && actualCount?.[2] === String(filtered.length) && actualAverage?.[1] === String(filteredAverage) && displayed.length === filtered.length;
    const scopeCopies = await page.$$eval(`${WORKSPACE} > p, ${WORKSPACE} h1 + p`, rows => rows.map(el => el.innerText));
    const allScope = /(?:全部|所有)目标[^。\n]*(?:平均|进度|完成)|(?:平均|进度|完成)[^。\n]*(?:全部|所有)目标/;
    const displayedScope = /(?:当前分类|本分类|筛选后|当前显示)[^。\n]*(?:目标|平均|进度|完成)|(?:平均|进度|完成)[^。\n]*(?:当前分类|本分类|筛选后|当前显示)/;
    const declared = scopeCopies.filter(text => allScope.test(text) || displayedScope.test(text));
    let scopeReading = null;
    if (declared.length === 1) { const scopeSelector = await exactSelector(page, `${WORKSPACE} > p, ${WORKSPACE} h1 + p`, declared[0]); scopeReading = await read(page, scopeSelector); }
    const scopeAgrees = Boolean(scopeReading?.visible && (allScope.test(scopeReading.text) && correctAll || displayedScope.test(scopeReading.text) && correctDisplayed));
    await observe(page, `${label}-actual-count-average-denominator`, reading.visible && (filterText === '全部' ? correctAll : correctAll || correctDisplayed), JSON.stringify({ reading, allGoalCount: all.length, validGoalCount: valid.length, manuallySet100Count: done, average, filteredGoalCount: filtered.length, filteredDone, filteredAverage, rawValues: all.map(row => ({ id: row.id, level: row.level, progress: row.progress })), selectedFilter: filterText, displayed, scopeCopies }));
    if (filterText !== '全部') await observe(page, `${label}-filtered-summary-scope-explicit`, scopeAgrees, JSON.stringify({ reading, scopeReading, scopeCopies, selectedFilter: filterText, displayedCount: displayed.length, actualSummaryCovers: correctAll ? 'all goals' : correctDisplayed ? 'displayed goals' : 'unestablished', note: 'Either all-goal or displayed-goal calculations are acceptable when the actual readable scope agrees. A correct hidden formula or adjacent selected filter is not an explicit denominator explanation.' }));
    await filter(page, '全部');
  }
  async function changeAndCheck(page, api, target, neighbor, values, label) {
    const before = await facts(page, api, `${label}-before`, [target.id, neighbor.id]); await edit(page, target); await setEditor(page, values); const actualInput = await editorValues(page); await saveEditor(page);
    const after = await facts(page, api, label, [target.id, neighbor.id]), local = after.local.goalRecords.find(row => row.id === target.id), server = after.server.find(row => row.id === target.id);
    const expectedDate = values.targetDate || null, fieldsMatch = row => row?.title === values.title && row?.description === values.description && row?.targetDate === expectedDate && ['level', 'domain', 'priority'].every(key => values[key] === undefined || row?.[key] === values[key]);
    const allowed = ['title', 'description', 'targetDate', 'updatedAt', ...['level', 'domain', 'priority'].filter(key => values[key] !== undefined)];
    const exactOnly = onlyChanges(before.local.goalRecords.find(row => row.id === target.id), local, allowed) && onlyChanges(before.server.find(row => row.id === target.id), server, allowed);
    const newer = validVersion(version(before, target.id)) && validVersion(version(after, target.id)) && BigInt(version(after, target.id)) > BigInt(version(before, target.id)) && version(after, target.id) === after.serverVersions[target.id];
    await observe(page, `${label}-same-id-fields-and-cloud-ack`, fieldsMatch(local) && fieldsMatch(server) && exactOnly && newer && neighborUnchanged(before, after, neighbor.id) && before.local.goalRecords.length === after.local.goalRecords.length && before.server.length === after.server.length && after.local.outbox.length === 0, JSON.stringify({ targetId: target.id, neighborId: neighbor.id, actualInput, expectedDate, local, server, exactOnly, newer }));
    assert.ok(local, 'Edited target must remain in the canonical local source'); Object.assign(target, local);
    const root = await card(page, target), reading = await read(page, root);
    await observe(page, `${label}-visible-date-agrees-with-raw-null-or-date`, reading.visible && (expectedDate ? reading.text.includes(`计划日期 ${expectedDate}`) : !/计划日期/.test(reading.text)) && local.targetDate === expectedDate && server?.targetDate === expectedDate, JSON.stringify({ reading, localTargetDate: local.targetDate, serverTargetDate: server?.targetDate, note: 'Clearing is a real nullable date, not an empty UI over a retained server date' }));
    await normalReaderFeedback(page, after, target, label);
    return after;
  }
  async function cancelEditor(page, api, target, neighbor, label) {
    await closeDialogs(page); const before = await facts(page, api, `${label}-before`, [target.id, neighbor.id]);
    await edit(page, target); const originalInput = await editorValues(page);
    await input(page, TITLE, 'Synthetic 未提交方向'); await input(page, DESCRIPTION, 'Synthetic 取消这份改动'); await setDate(page, businessDate(21));
    await choose(page, '类型', 'medium'); await choose(page, '领域', '职业'); await choose(page, '优先级', 'low');
    const draft = await editorValues(page); await capture(page, `${label}-chosen-but-uncommitted-editor`);
    await tap(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
    const after = await facts(page, api, label, [target.id, neighbor.id]);
    await observe(page, `${label}-cancel-keeps-complete-source-version-neighbor`, preserved(before, after), JSON.stringify({ originalInput, cancelledInput: draft, note: 'Cancel may discard an edit: the UI did not promise draft retention. This asserts no canonical write, no new version and no neighbor change.' }));
    await edit(page, target); const reopened = await editorValues(page);
    await observe(page, `${label}-reopen-canonical-selected-record`, sameInputs(originalInput, reopened), JSON.stringify({ reopened, exactId: target.id }));
    await tap(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
  }
  async function reopenAndReload(page, api, target, neighbor, label) {
    await closeDialogs(page); const before = await facts(page, api, `${label}-before`, [target.id, neighbor.id]); assert.equal(before.local.outbox.length, 0, 'This reload must start from an actually acknowledged source');
    await filter(page, '长期'); const neighborRoot = await card(page, neighbor); await capture(page, `${label}-distinct-long-type-neighbor`);
    assert.ok((await read(page, neighborRoot)).visible);
    await filter(page, '短期'); await card(page, target); await capture(page, `${label}-selected-short-type-target`);
    await home(page); await enter(page, { directory: page.viewport().width === 360 }); await filter(page, '全部'); await card(page, target);
    await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-acknowledged-goal', surface: surfaceNames.get(page), goalId: target.id }); await waitPath(page, '/goal');
    const after = await facts(page, api, label, [target.id, neighbor.id]);
    await observe(page, `${label}-complete-sources-and-versions-survive`, preserved(before, after) && after.local.outbox.length === 0, JSON.stringify({ exactTargetId: target.id, exactNeighborId: neighbor.id, note: 'Navigation, filter, reload and re-entry neither recreate a goal nor add a mutation' }));
    await card(page, target); await edit(page, target); const values = await editorValues(page);
    await observe(page, `${label}-selected-same-id-editor-found-after-reload`, values.title === target.title && values.description === target.description && values.targetDate === (target.targetDate ?? '') && values.choices.some(row => row.label === '领域' && row.value === target.domain), JSON.stringify({ exactId: target.id, values }));
    await tap(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true });
    await syncMeaning(page, api, target, `${label}-status`);
  }
  function failureSnapshot() { return [...document.querySelectorAll('[role=alert]')].map(node => ({ node, text: node.innerText.trim() })); }
  function newFailureRegions(before) {
    const candidates = [...document.querySelectorAll('[role=alert]')].filter(node => {
      const box = node.getBoundingClientRect(), text = node.innerText.trim();
      return box.width > 0 && box.height > 0 && text && !before.some(old => old.node === node && old.text === text);
    });
    if (!candidates.length) return false;
    return candidates.map(node => {
      const parts = []; for (let el = node; el && el !== document.body; el = el.parentElement) { const siblings = [...el.parentElement.children].filter(item => item.tagName === el.tagName); parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`); }
      return { selector: 'body > ' + parts.join(' > '), text: node.innerText.trim(), dialogTitle: node.closest('[role=dialog]')?.querySelector('h3')?.innerText ?? null };
    });
  }
  async function failureMessage(page, before, label) {
    const handle = await page.waitForFunction(newFailureRegions, { timeout: 7000 }, before).catch(() => null);
    if (!handle) { await capture(page, `${label}-missing-new-failure-region`); return { regions: [], selected: null, reading: null, reason: 'No newly produced real alert region appeared after the attempted write' }; }
    let regions; try { regions = await handle.jsonValue(); } finally { await handle.dispose(); }
    // Goal currently duplicates an edit error outside and inside its modal. Read
    // the foreground copy, retaining both. For delete an outside-only error
    // stays obscured by the retained dialog and must fail the visibility oracle.
    const foreground = regions.filter(region => region.dialogTitle), choices = foreground.length ? foreground : regions;
    if (choices.length !== 1) return { regions, selected: null, reading: null, reason: 'New failure region is ambiguous; no body-text substitution' };
    const selected = choices[0], reading = await read(page, selected.selector); await capture(page, `${label}-actual-new-failure-region`);
    assert.equal(reading.text.trim(), selected.text, 'The actual newly produced failure must still exist when read');
    return { regions, selected, reading };
  }
  async function installFault(page, owner, id, method) {
    await page.evaluate(({ owner, id, method }) => {
      const original = IDBObjectStore.prototype[method]; let timer;
      window.__goalOutcomeFault = { owner, id, method, hits: [], expired: false, restored: false, restoredAt: null, restoredBy: null };
      window.__releaseGoalOutcomeFault = (reason = 'explicit-harness-release') => {
        clearTimeout(timer); IDBObjectStore.prototype[method] = original;
        Object.assign(window.__goalOutcomeFault, { restored: IDBObjectStore.prototype[method] === original, restoredAt: Date.now(), restoredBy: reason });
      };
      timer = setTimeout(() => { window.__goalOutcomeFault.expired = true; window.__releaseGoalOutcomeFault('safety-timeout'); }, 60000);
      IDBObjectStore.prototype[method] = function(value, ...keys) {
        const matchingId = method === 'delete' ? value === id : value?.id === id;
        if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'goalRecords' && this.transaction.mode === 'readwrite' && matchingId) {
          window.__goalOutcomeFault.hits.push({ at: Date.now(), method, id, database: this.transaction.db.name, table: this.name, attemptedSource: method === 'delete' ? value : structuredClone(value) });
          throw new DOMException(`Synthetic exact-goal ${method} quota`, 'QuotaExceededError');
        }
        return original.call(this, value, ...keys);
      };
    }, { owner, id, method });
    actions.push({ kind: `test-only-native-IDB-goal-${method}-quota`, surface: surfaceNames.get(page), goalId: id, scope: 'Exact account database, goalRecords store, readwrite transaction, method and same canonical goal ID only', safetyTimeoutMs: 60000 });
  }
  async function releaseFault(page, label) {
    const fault = await page.evaluate(() => { window.__releaseGoalOutcomeFault(); return window.__goalOutcomeFault; });
    await writeFile(join(artifacts, `${label}-fault.json`), JSON.stringify(fault, null, 2)); actions.push({ kind: 'explicit-release-native-goal-fault', surface: surfaceNames.get(page), ...fault });
    await observe(page, `${label}-explicit-release-before-expiry`, !fault.expired && fault.restored && fault.restoredBy === 'explicit-harness-release' && fault.restoredAt != null, JSON.stringify(fault));
    return fault;
  }
  async function normalReaderFeedback(page, current, identity, label) {
    const local = current.local.goalRecords.find(row => row.id === identity.id), server = current.server.find(row => row.id === identity.id);
    await page.waitForFunction(expected => [...document.querySelectorAll('[data-component="goal-card"]')].some(el => el.querySelector('h2')?.innerText === expected.title && el.innerText.includes(expected.description) && el.innerText.includes(expected.domain) && el.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === String(expected.progress)), { timeout: 7000 }, local);
    const root = await card(page, identity);
    const shownProgress = await page.$eval(`${root} [role=progressbar]`, el => el.getAttribute('aria-valuenow'));
    const messages = await page.$$eval(`${WORKSPACE} [role=status], ${WORKSPACE} [role=alert]`, nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility === 'visible'; }).map(el => ({ role: el.getAttribute('role'), text: el.innerText })));
    const sourceConfirmed = local && server && shownProgress === String(local.progress) && server.progress === local.progress && current.local.outbox.length === 0 && validVersion(version(current, identity.id)) && version(current, identity.id) === current.serverVersions[identity.id];
    await observe(page, `${label}-ordinary-save-has-no-false-read-recovery`, Boolean(sourceConfirmed) && normalFeedback(messages), JSON.stringify({ goalId: identity.id, shownProgress, sourceConfirmed, messages, note: 'After the actual source/ACK and visible value agree, ordinary completion must not leave a failed-refresh instruction. No manual refresh, artificial wait or hidden alert deletion is inserted.' }));
  }
  async function postcommitReadRecovery(page, api, target, neighbor, label) {
    let before, afterCommit, saved, fault, message, intended;
    await segment(page, `${label}-real-commit-then-display-read-failure`, async () => {
      await closeDialogs(page); before = await facts(page, api, `${label}-before`, [target.id, neighbor.id]); assert.equal(before.local.outbox.length, 0);
      await edit(page, target); intended = { title: target.title, description: 'Synthetic 已保存等待显示核对', targetDate: target.targetDate ?? '' }; await setEditor(page, intended);
      await page.evaluate(({ owner, id }) => {
        const put = IDBObjectStore.prototype.put, getAll = IDBObjectStore.prototype.getAll; let timer;
        const wanted = ['goalRecords', 'goals', 'outbox', 'settings'].sort().join('|');
        const audit = window.__goalReadAfterCommitFault = { owner, id, armed: false, writes: [], commits: [], hits: [], expired: false, restored: false, restoredBy: null };
        window.__releaseGoalReadAfterCommitFault = (reason = 'explicit-harness-release') => {
          clearTimeout(timer); IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.getAll = getAll;
          Object.assign(audit, { restored: IDBObjectStore.prototype.put === put && IDBObjectStore.prototype.getAll === getAll, restoredAt: Date.now(), restoredBy: reason });
        };
        timer = setTimeout(() => { audit.expired = true; window.__releaseGoalReadAfterCommitFault('safety-timeout'); }, 60000);
        IDBObjectStore.prototype.put = function(value, ...keys) {
          if (this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'goalRecords' && this.transaction.mode === 'readwrite' && value?.id === id) {
            audit.writes.push({ at: Date.now(), source: structuredClone(value) });
            this.transaction.addEventListener('complete', () => { audit.armed = true; audit.commits.push({ at: Date.now(), id }); }, { once: true });
          }
          return put.call(this, value, ...keys);
        };
        IDBObjectStore.prototype.getAll = function(...args) {
          const stores = [...this.transaction.objectStoreNames];
          if (audit.armed && this.transaction.db.name === `youtrace:user:${owner}:schedule-v1` && this.name === 'goalRecords' && this.transaction.mode === 'readonly' && stores.sort().join('|') === wanted) {
            audit.hits.push({ at: Date.now(), stores, table: this.name, mode: this.transaction.mode });
            throw new DOMException('Synthetic bounded postcommit Goal display read failure', 'UnknownError');
          }
          return getAll.apply(this, args);
        };
      }, { owner: api.ownerId, id: target.id });
      actions.push({ kind: 'synthetic-postcommit-goal-display-read-outage', surface: surfaceNames.get(page), goalId: target.id, safetyTimeoutMs: 60000, scope: 'Arm only after exact target put transaction completes; fail only Goal coherent four-table readonly getAll. Do not block write, ACK, or the separate readonly evidence query.' });
      try {
        const previous = await page.evaluateHandle(failureSnapshot);
        try { await saveEditor(page); message = await failureMessage(page, previous, `${label}-postcommit`); } finally { await previous.dispose(); }
        afterCommit = await facts(page, api, `${label}-committed-during-read-outage`, [target.id, neighbor.id], { actualFailure: message }); saved = afterCommit.local.goalRecords.find(row => row.id === target.id);
        fault = await page.evaluate(() => window.__goalReadAfterCommitFault);
        const server = afterCommit.server.find(row => row.id === target.id), events = afterCommit.events.filter(row => row.entityId === target.id && !before.events.some(old => old.seq === row.seq));
        await observe(page, `${label}-committed-source-server-neighbor-and-single-event`, saved?.description === intended.description && server?.description === intended.description && onlyChanges(before.local.goalRecords.find(row => row.id === target.id), saved, ['description', 'updatedAt']) && onlyChanges(before.server.find(row => row.id === target.id), server, ['description', 'updatedAt']) && neighborUnchanged(before, afterCommit, neighbor.id) && afterCommit.local.goalRecords.length === before.local.goalRecords.length && afterCommit.server.length === before.server.length && afterCommit.local.outbox.length === 0 && version(afterCommit, target.id) === afterCommit.serverVersions[target.id] && events.length === 1 && events[0].operation === 'upsert', JSON.stringify({ intended, saved, server, events, note: 'A real successful commit plus a later display read failure is different from the earlier put quota rollback.' }));
        const notices = await page.$$eval(`${WORKSPACE} [role=status], ${WORKSPACE} [role=alert]`, rows => rows.map(el => el.innerText.trim()));
        let savedReading = message?.reading?.visible && /已保存|写入已完成/.test(message.reading.text) ? message.reading : null;
        if (!savedReading) {
          const savedNotices = notices.filter(text => /已保存|写入已完成/.test(text));
          if (savedNotices.length === 1) savedReading = await read(page, await exactSelector(page, `${WORKSPACE} [role=status], ${WORKSPACE} [role=alert]`, savedNotices[0]));
        }
        await capture(page, `${label}-actual-saved-fact-during-read-outage`);
        const refreshSelector = await exactSelector(page, `${WORKSPACE} button`, '刷新核对'), refreshReading = await read(page, refreshSelector);
        await observe(page, `${label}-read-fault-after-commit-and-usable-recovery`, fault.writes.length === 1 && fault.commits.length === 1 && fault.hits.length > 0 && !fault.expired && fault.hits.every(hit => hit.at >= fault.commits[0].at) && message?.reading?.visible && savedReading?.visible && /已保存|写入已完成/.test(savedReading.text) && refreshReading.visible && !notices.some(text => /这次操作没有保存/.test(text)), JSON.stringify({ fault, actualFailure: message, notices, savedReading, refreshReading }));
      } finally {
        const released = await page.evaluate(() => { window.__releaseGoalReadAfterCommitFault(); return window.__goalReadAfterCommitFault; });
        await writeFile(join(artifacts, `${label}-read-fault.json`), JSON.stringify(released, null, 2));
        actions.push({ kind: 'explicit-release-postcommit-goal-read-outage', surface: surfaceNames.get(page), ...released });
        await observe(page, `${label}-read-fault-explicit-release-before-expiry`, !released.expired && released.restored && released.restoredBy === 'explicit-harness-release', JSON.stringify(released));
      }
    });
    await segment(page, `${label}-real-refresh-no-second-business-write`, async () => {
      assert.ok(afterCommit && saved?.description === intended.description, 'Need a proven committed same-ID source; no retyping or replacement record');
      await tap(page, `${WORKSPACE} button`, '刷新核对');
      await page.waitForFunction(({ workspace, description }) => [...document.querySelectorAll(`${workspace} [data-component="goal-card"]`)].some(el => el.innerText.includes(description)) && ![...document.querySelectorAll(`${workspace} [role=alert]`)].some(el => el.getBoundingClientRect().height > 0), { timeout: 7000 }, { workspace: WORKSPACE, description: intended.description });
      const after = await facts(page, api, `${label}-refreshed`, [target.id, neighbor.id]);
      await observe(page, `${label}-refresh-preserves-exact-saved-rows-version-event-ledger`, preserved(afterCommit, after) && after.local.outbox.length === 0, JSON.stringify({ exactId: target.id, note: 'Refresh does not call Save, repeat the business mutation, create a duplicate or change its canonical version.' }));
      Object.assign(target, saved); const reading = await read(page, await card(page, target));
      await observe(page, `${label}-saved-content-readable-after-actual-refresh`, reading.visible && reading.text.includes(intended.description), JSON.stringify({ reading, exactId: target.id }));
      await normalReaderFeedback(page, after, target, `${label}-after-refresh`);
    });
  }
  async function quotaEdit(page, api, target, neighbor, label) {
    let intended, before, attempted, message, atFailure, fault, retryEligible = false;
    await segment(page, `${label}-quota-put-attempt`, async () => {
      await closeDialogs(page); before = await facts(page, api, `${label}-before`, [target.id, neighbor.id]); assert.equal(before.local.outbox.length, 0);
      await edit(page, target); intended = { title: 'Synthetic 继续阅读', description: 'Synthetic 保留输入再保存', targetDate: businessDate(28) }; await setEditor(page, intended); attempted = await editorValues(page);
      await installFault(page, api.ownerId, target.id, 'put');
      try {
        const previous = await page.evaluateHandle(failureSnapshot);
        try { await tap(page, '[role=dialog] button', '保存修改'); message = await failureMessage(page, previous, `${label}-put`); } finally { await previous.dispose(); }
        atFailure = await facts(page, api, `${label}-uncommitted-attempt`, [target.id, neighbor.id], { attemptedInput: attempted, actualFailure: message });
        fault = await page.evaluate(() => window.__goalOutcomeFault);
        const retained = await page.$(EDITOR) ? await editorValues(page) : null;
        retryEligible = Boolean(retained && sameInputs(attempted, retained) && preserved(before, atFailure));
        await observe(page, `${label}-put-quota-actually-hit-before-commit`, fault.hits.length > 0 && !fault.expired && preserved(before, atFailure), JSON.stringify({ fault, note: 'A CAS refusal before put is not a quota test. Full canonical records/version/outbox/server events must remain unchanged; no metadata is removed to force the fault.' }));
        await observe(page, `${label}-failed-put-preserves-exact-input-and-neighbor`, retryEligible, JSON.stringify({ attemptedInput: attempted, retainedInput: retained, originalId: target.id, neighborId: neighbor.id }));
        await observe(page, `${label}-readable-failed-put-cause-and-next-step`, fault.hits.length > 0 && !fault.expired && message?.reading?.visible === true && /空间不足|存储[^。\n]*(?:不足|已满)|配额/.test(message.selected.text) && /(?:未|没有)保存/.test(message.selected.text) && /重试|再试/.test(message.selected.text), JSON.stringify({ actualFailure: message, note: 'Raw injected English QuotaExceeded text alone is not a readable cause, uncommitted outcome and recovery explanation' }));
      } finally { await releaseFault(page, `${label}-put`); }
    });
    await segment(page, `${label}-put-actual-retry-to-same-id-server`, async () => {
      assert.ok(before && intended && retryEligible, 'No proven preserved source/input to retry; do not manufacture fresh metadata or retype lost input');
      assert.ok(sameInputs(await editorValues(page), attempted), 'Retry must keep the exact entered values; newly produced error copy is recorded separately');
      const buttons = await page.$$eval('[role=dialog] button', rows => rows.filter(el => !el.disabled && /^(重试保存|重试|再试一次|保存修改)$/.test(el.innerText.trim())).map(el => el.innerText.trim()));
      assert.equal(buttons.length, 1, 'Operate one genuine visible retry or normal save control');
      actions.push({ kind: buttons[0] === '保存修改' ? 'native-goal-normal-save-retry' : 'native-goal-explicit-failure-retry', surface: surfaceNames.get(page), goalId: target.id, observedLabel: buttons[0], note: buttons[0] === '保存修改' ? 'No special retry UI claimed; the still-open preserved editor exposes its normal save action' : 'Actual rendered failure retry is operated' });
      await tap(page, '[role=dialog] button', buttons[0]); await page.waitForSelector('[role=dialog]', { hidden: true });
      const after = await facts(page, api, `${label}-retried-and-acknowledged`, [target.id, neighbor.id]), local = after.local.goalRecords.find(row => row.id === target.id), server = after.server.find(row => row.id === target.id);
      const expected = row => row?.title === intended.title && row?.description === intended.description && row?.targetDate === intended.targetDate;
      const intact = onlyChanges(before.local.goalRecords.find(row => row.id === target.id), local, ['title', 'description', 'targetDate', 'updatedAt']) && onlyChanges(before.server.find(row => row.id === target.id), server, ['title', 'description', 'targetDate', 'updatedAt']);
      const newer = validVersion(version(before, target.id)) && validVersion(version(after, target.id)) && BigInt(version(after, target.id)) > BigInt(version(before, target.id)) && version(after, target.id) === after.serverVersions[target.id];
      const events = after.events.filter(row => row.entityId === target.id && !before.events.some(old => old.seq === row.seq));
      await observe(page, `${label}-actual-retry-same-id-single-mutation-and-outbox-zero`, expected(local) && expected(server) && intact && newer && neighborUnchanged(before, after, neighbor.id) && after.local.outbox.length === 0 && before.local.goalRecords.length === after.local.goalRecords.length && before.server.length === after.server.length && events.length === 1 && events[0].operation === 'upsert', JSON.stringify({ id: target.id, intended, local, server, actualNewEvents: events, intact, newer, note: 'An enabled button alone never satisfies recovery: same-ID cloud record, one acknowledged change and empty outbox are required' }));
      assert.ok(local); Object.assign(target, local); await card(page, target);
    });
  }
  async function deleteDialog(page, target, label) {
    await closeDialogs(page); await filter(page, '全部'); const root = await card(page, target); await capture(page, `${label}-visibly-selected-delete-source`);
    await tap(page, `${root} button[aria-label=${JSON.stringify(`删除目标 ${target.title}`)}]`); await page.waitForSelector('[role=dialog]');
    assert.equal(await page.$eval('[role=dialog] h3', el => el.innerText), '删除这个目标？');
    const textSelector = '[role=dialog] p', reading = await read(page, textSelector);
    await observe(page, `${label}-delete-dialog-selected-record-and-scope`, reading.visible && reading.text.includes(target.title) && reading.text.includes(target.description) && reading.text.includes(target.domain) && /其他设备|账号/.test(reading.text), JSON.stringify({ actualConfirmation: reading, clickedVisibleIdentity: { title: target.title, description: target.description, domain: target.domain }, note: 'Same-name deletion needs enough visible identity at confirmation. A title-only dialog is retained as a gap even though this harness clicked the exact visibly identified card.' }));
  }
  async function deletion(page, api, target, neighbor, label) {
    await segment(page, `${label}-cancel-delete`, async () => {
      await closeDialogs(page); const before = await facts(page, api, `${label}-before-cancel`, [target.id, neighbor.id]);
      await deleteDialog(page, target, `${label}-cancel`); await tap(page, '[role=dialog] button', '保留目标'); await page.waitForSelector('[role=dialog]', { hidden: true });
      const after = await facts(page, api, `${label}-cancelled`, [target.id, neighbor.id]);
      await observe(page, `${label}-cancel-delete-preserves-whole-source-version-neighbor`, preserved(before, after), JSON.stringify({ targetId: target.id, neighborId: neighbor.id, note: 'No missing fields, duplicate rows, changed canonical version or same-name collateral change is accepted' }));
    });
    let beforeFault, quotaPreserved = false;
    await segment(page, `${label}-native-delete-quota`, async () => {
      await closeDialogs(page); beforeFault = await facts(page, api, `${label}-before-quota`, [target.id, neighbor.id]); assert.equal(beforeFault.local.outbox.length, 0);
      await deleteDialog(page, target, `${label}-quota`); await installFault(page, api.ownerId, target.id, 'delete');
      try {
        const previous = await page.evaluateHandle(failureSnapshot); let message;
        try { await tap(page, '[role=dialog] button', '确认删除'); message = await failureMessage(page, previous, `${label}-delete`); } finally { await previous.dispose(); }
        const fault = await page.evaluate(() => window.__goalOutcomeFault), after = await facts(page, api, `${label}-quota-attempt`, [target.id, neighbor.id], { fault, actualFailure: message });
        quotaPreserved = preserved(beforeFault, after);
        await observe(page, `${label}-delete-quota-actually-hit-and-rolled-back`, fault.hits.length > 0 && !fault.expired && quotaPreserved, JSON.stringify({ fault, quotaPreserved, note: 'No put/delete hit means this stage remains RED. Never strip source metadata, seed a replacement or confuse saved-but-refresh-failed with uncommitted deletion.' }));
        await observe(page, `${label}-delete-failure-readable-cause-and-retry`, fault.hits.length > 0 && !fault.expired && message?.reading?.visible === true && /空间不足|存储[^。\n]*(?:不足|已满)|配额/.test(message.selected.text) && /重试|再试/.test(message.selected.text), JSON.stringify({ actualFailure: message, note: 'A page alert covered by the still-open delete modal is not an actually readable failure' }));
      } finally { await releaseFault(page, `${label}-delete`); }
    });
    await segment(page, `${label}-normal-delete-retry-through-cloud`, async () => {
      assert.ok(beforeFault && quotaPreserved, 'Do not repeat a deletion with an uncertain or changed canonical source');
      const before = await facts(page, api, `${label}-before-retry`, [target.id, neighbor.id]); assert.ok(preserved(beforeFault, before));
      const modal = await page.$('[role=dialog]');
      if (modal) {
        assert.equal(await page.$eval('[role=dialog] h3', el => el.innerText), '删除这个目标？');
        const retries = await page.$$eval('[role=dialog] button', rows => rows.filter(el => !el.disabled && /^(重试删除|重试|再次删除|确认删除)$/.test(el.innerText.trim())).map(el => el.innerText.trim()));
        assert.equal(retries.length, 1); actions.push({ kind: retries[0] === '确认删除' ? 'native-goal-normal-delete-retry' : 'native-goal-explicit-delete-retry', surface: surfaceNames.get(page), goalId: target.id, actualLabel: retries[0], note: 'The original selected source remains unchanged; normal confirmation is honestly identified when there is no dedicated retry' });
        await tap(page, '[role=dialog] button', retries[0]);
      } else {
        actions.push({ kind: 'native-goal-normal-route-delete-retry', surface: surfaceNames.get(page), goalId: target.id, note: 'Returned to the actual visibly identified goal and its delete confirmation; no special failure retry is claimed' });
        await deleteDialog(page, target, `${label}-retry`); await tap(page, '[role=dialog] button', '确认删除');
      }
      await page.waitForSelector('[role=dialog]', { hidden: true }); const after = await facts(page, api, `${label}-deleted`, [target.id, neighbor.id]);
      const removed = !after.local.goalRecords.some(row => row.id === target.id) && !after.server.some(row => row.id === target.id), tombstones = after.events.filter(row => row.entityId === target.id && row.operation === 'delete' && !before.events.some(old => old.seq === row.seq));
      await observe(page, `${label}-exact-delete-server-tombstone-neighbor-and-outbox-zero`, removed && neighborUnchanged(before, after, neighbor.id) && before.local.goalRecords.length === after.local.goalRecords.length + 1 && before.server.length === after.server.length + 1 && after.local.outbox.length === 0 && tombstones.length === 1 && version(after, target.id) === tombstones[0].seq, JSON.stringify({ exactDeletedId: target.id, neighborId: neighbor.id, removed, tombstones, totalOutbox: after.local.outbox.length }));
      await page.reload({ waitUntil: 'networkidle0' }); actions.push({ kind: 'browser-reload-after-acknowledged-goal-delete', surface: surfaceNames.get(page), goalId: target.id }); await waitPath(page, '/goal');
      const reloaded = await facts(page, api, `${label}-deleted-after-reload`, [target.id, neighbor.id]); await card(page, neighbor);
      await observe(page, `${label}-deleted-id-stays-absent-and-neighbor-discoverable`, !reloaded.local.goalRecords.some(row => row.id === target.id) && !reloaded.server.some(row => row.id === target.id) && neighborUnchanged(after, reloaded, neighbor.id) && reloaded.local.outbox.length === 0, 'Actual reload retains the exact deletion and the untouched same-name-origin neighbor');
    });
  }
  async function run(page) {
    const narrow = page.viewport().width === 360, label = narrow ? 'Y6N' : 'Y6';
    await login(page, narrow ? '13900008862' : '13900008861', `Synthetic ${label}`); const transport = await apiFor(page);
    // Refuse any future accidental write or unrelated API/model call here.
    const api = path => { assert.ok(/^\/sync\/pull\?protocol=2&features=goals-v1&cursor=\d+&limit=500$/.test(path), `Y6 evidence API must remain GET-only and ledger-only: ${path}`); return transport(path, undefined, 'GET'); }; api.ownerId = transport.ownerId;
    await enter(page, { directory: narrow, firstUse: true });
    await observe(page, `${label}-explicitly-untested-boundaries`, null, JSON.stringify(limitsForSurface()));
    let target, neighbor;
    const requirePair = () => assert.ok(target && neighbor, 'Two native same-name goals are prerequisites; no seeded/API substitute');
    const targetValues = { title: NAME, description: 'Synthetic 阅读笔记', targetDate: businessDate(7), level: 'short', domain: '学习', priority: 'high' };
    const neighborValues = { title: NAME, description: 'Synthetic 家庭整理', targetDate: businessDate(35), level: 'long', domain: '生活', priority: 'low' };
    await segment(page, `${label}-read-manual-purpose`, () => manualMeaning(page, label));
    await segment(page, `${label}-create-self-directed-target`, async () => { target = await create(page, api, `${label}-target`, targetValues); });
    await segment(page, `${label}-create-distinct-same-name-neighbor`, async () => { neighbor = await create(page, api, `${label}-neighbor`, neighborValues); });
    await segment(page, `${label}-target-25`, async () => { requirePair(); await progress(page, api, target, neighbor, 25, `${label}-target25`); });
    await segment(page, `${label}-neighbor-50`, async () => { requirePair(); await progress(page, api, neighbor, target, 50, `${label}-neighbor50`); });
    await segment(page, `${label}-mixed-denominator-and-filter`, async () => { requirePair(); await summary(page, api, `${label}-25-and50`); await summary(page, api, `${label}-short-filter-25-and50`, '短期'); });
    await segment(page, `${label}-target-manual-100`, async () => { requirePair(); await progress(page, api, target, neighbor, 100, `${label}-target100`); await summary(page, api, `${label}-100-and50`); });
    await segment(page, `${label}-target-reverse-to25`, async () => { requirePair(); await progress(page, api, target, neighbor, 25, `${label}-target25-reversed`); await summary(page, api, `${label}-reversed25-and50`); });
    await segment(page, `${label}-cancel-exact-editor`, async () => { requirePair(); await cancelEditor(page, api, target, neighbor, `${label}-editor-cancel`); });
    await segment(page, `${label}-edit-current-type-domain-priority`, async () => { requirePair(); await changeAndCheck(page, api, target, neighbor, { title: target.title, description: target.description, targetDate: target.targetDate ?? '', level: 'medium', domain: '职业', priority: 'low' }, `${label}-classification-edited`); await edit(page, target); const reopened = await editorValues(page); await observe(page, `${label}-reopened-changed-type-domain-priority`, reopened.choices.some(row => row.label === '类型' && row.value === 'medium') && reopened.choices.some(row => row.label === '领域' && row.value === '职业') && reopened.choices.some(row => row.label === '优先级' && row.value === 'low'), JSON.stringify({ reopened })); await tap(page, '[role=dialog] button', '取消'); await page.waitForSelector('[role=dialog]', { hidden: true }); });
    await segment(page, `${label}-restore-short-classification-through-editor`, async () => { requirePair(); await changeAndCheck(page, api, target, neighbor, { title: target.title, description: target.description, targetDate: target.targetDate ?? '', level: 'short', domain: '学习', priority: 'high' }, `${label}-classification-restored`); });
    await segment(page, `${label}-edit-title-description-date`, async () => { requirePair(); await changeAndCheck(page, api, target, neighbor, { title: 'Synthetic 阅读方向', description: 'Synthetic 逐章阅读笔记', targetDate: businessDate(14) }, `${label}-edited`); });
    await segment(page, `${label}-clear-optional-date`, async () => { requirePair(); await changeAndCheck(page, api, target, neighbor, { title: target.title, description: target.description, targetDate: '' }, `${label}-date-cleared`); });
    await segment(page, `${label}-exact-record-after-filter-return-reload`, async () => { requirePair(); await reopenAndReload(page, api, target, neighbor, `${label}-return`); });
    if (target && neighbor) {
      await quotaEdit(page, api, target, neighbor, `${label}-storage-write`);
      await postcommitReadRecovery(page, api, target, neighbor, `${label}-committed-read-recovery`);
      // The quota journey may leave a blocked editor; close via actual Escape,
      // and read the canonical same-ID visible fields before the independent
      // deletion task. This is not a write or a silent source normalization.
      await segment(page, `${label}-current-source-for-final-delete`, async () => {
        await closeDialogs(page); const current = await facts(page, api, `${label}-final-source`, [target.id, neighbor.id]);
        const source = current.local.goalRecords.find(row => row.id === target.id); assert.ok(source); Object.assign(target, source);
      });
      await segment(page, `${label}-restore-same-name-through-real-editor`, async () => {
        assert.notEqual(target.description, neighbor.description); assert.notEqual(target.domain, neighbor.domain);
        if (target.title !== neighbor.title) await changeAndCheck(page, api, target, neighbor, { title: neighbor.title, description: target.description, targetDate: target.targetDate ?? '' }, `${label}-same-name-again`);
        const current = await facts(page, api, `${label}-same-name-delete-prerequisite`, [target.id, neighbor.id]);
        assert.equal(current.local.goalRecords.find(row => row.id === target.id)?.title, current.local.goalRecords.find(row => row.id === neighbor.id)?.title);
        await card(page, target); await card(page, neighbor);
      });
      if (target.title === neighbor.title) await deletion(page, api, target, neighbor, `${label}-deletion`);
      else await segment(page, `${label}-same-name-delete-prerequisite-blocked`, async () => { throw new Error('Native title restoration did not produce a same-name pair; do not claim ambiguous-name deletion coverage'); });
    } else await segment(page, `${label}-failure-and-delete-prerequisites-unmet`, async () => { throw new Error('No fully native target/neighbor pair; failure/recovery/delete outcomes remain blocked'); });
  }
  function limitsForSurface() { return { limitations, note: 'Independent failed/blocked segments remain in outcome-report; later task completion never relabels an earlier failure as a pass' }; }
  const media = ['Y6-manual-goal-1280', 'Y6-manual-goal-360'];
  for (const width of [1280, 360]) await isolated(`Y6-manual-goal-${width}`, { width, height: width === 360 ? 800 : 900 }, run);
  return media;
}
