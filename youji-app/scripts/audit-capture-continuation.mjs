// Appended to the existing two hosted Capture profiles. Original controls create
// and select all drafts; no business/API seeding, product import or forced click.
import assert from 'node:assert/strict';
import { captureReturnChecks as checks } from './audit-capture-return-outcomes.mjs';
import { captureCatalogEditorState, captureCatalogEntrySelector, assertCaptureCatalogUnchanged, installCaptureCatalogWriteAudit } from './audit-capture-catalog.mjs';
import { initialSessionGeometry } from './audit-initial-session-controls.mjs';
import { assertCaptureContinuationCommitted, assertCaptureContinuationProof, assertCaptureHistoryReload, captureExplicitEmptyInputs } from './audit-capture-continuation-oracle.mjs';
const REVIEW = '[data-component="capture-review"]', COMPOSER = '[data-component="capture-composer"]', CHILD = `${REVIEW}[aria-labelledby="continuation-review-title"]`, MODAL = '[role="dialog"]';
export const CAPTURE_CONTINUATION_NEW_RAW = '这是独立空白入口的新合成原文';
export function expectedContinuedO(original, actor) {
  return { ...original, sessionRevision: actor.sessionRevision, sessionActive: actor.sessionActive,
    expenses: original.expenses.map((value, i) => i === 0 ? { ...value, amount: 1735, amountText: '17.35' } : value),
    todos: original.todos.map(value => ({ ...value, confirmed: false })), diary: null, diaryExcludedText: original.diary ?? original.diaryExcludedText };
}
/** Every collection is attempted independently; an evidence failure cannot
 * replace the business/UI error or skip source/ledger/editor capture. */
export async function collectCaptureContinuationFailure(h, original) {
  const failures = [];
  const collect = async (part, work) => { try { await work(); } catch (error) { failures.push({ part, message: String(error?.message ?? error) }); } };
  await collect('first-error', () => h.save('handoff-FIRST-FAILURE', { stage: h.stage, name: original.name, message: original.message }));
  await collect('editor', async () => h.save('handoff-failure-editor', await h.page.evaluate(captureCatalogEditorState, h.owner)));
  await collect('source', () => h.facts('handoff-failure', { settle: false }));
  await collect('ledger', async () => h.save('handoff-failure-ledger', await h.readLedger()));
  await collect('audit', async () => h.save('handoff-failure-write-audit', await h.page.evaluate(() => globalThis.__captureCatalogAudit?.snapshot() ?? null)));
  await collect('screenshot', () => h.capture(h.page, `${h.label}-handoff-FIRST-FAILURE`));
  await collect('collection-log', () => h.save('handoff-failure-collections', { original: { name: original.name, message: original.message }, failures }));
  return failures;
}
export async function runCaptureContinuationNative(h) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only authorized existing hosted CI'); assert.match(h.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const { page, label, owner, current, selected, facts, read, tap, input, save, observe, capture, actions, waitPath, preserve } = h;
  let stage = 'prepare', latest = h.before, activeAudit = false;
  const mark = value => { stage = value; h.mark(`handoff-${value}`); };
  const field = name => `${CHILD} [aria-label=${JSON.stringify(name)}]`;
  const saved = async () => page.waitForFunction(selector => document.querySelector(`${selector} footer [role=status]`)?.textContent.startsWith('确认稿已保留在本机') && !document.querySelector(`${selector} fieldset`)?.disabled, { timeout: 7000 }, CHILD);
  const childReady = async id => {
    await page.waitForFunction(({ selector, id }) => document.querySelector(`${selector} h1`)?.textContent === `继续核对原稿 ${id}` && !document.querySelector('[role=dialog]'), { timeout: 7000 }, { selector: CHILD, id }); await saved();
    assert.equal(await page.$eval(`${CHILD} h1`, el => document.activeElement === el), true, 'The product focuses its actual isolated title');
    await read(`${CHILD} h1`, `继续核对原稿 ${id}`); await capture(page, `${label}-handoff-${stage}-child`);
  };
  const openSelected = async root => {
    await tap(`${root} button[data-capture-catalog-open]`);
    await page.waitForFunction(() => document.querySelector('[role=dialog]')?.textContent.includes('本次读取的主键顺序'), { timeout: 7000 });
    const selector = `${MODAL} button[aria-label=${JSON.stringify(`查看原稿 ${selected.id}`)}]`;
    await tap(selector); await page.waitForSelector(`${MODAL} [aria-label="只读完整原文"]`, { visible: true, timeout: 7000 });
    assert.equal(await page.$eval(`${MODAL} [aria-label="只读完整原文"]`, el => el.textContent), selected.input);
    await read(`${MODAL} [aria-label="已核验原稿只读详情"] > p`, `原编号：${selected.id} · 已核验的本机只读快照`);
    await tap(`${MODAL} button`, '继续核对此稿'); await childReady(selected.id);
  };
  const naturalReturn = async root => {
    await tap(`${CHILD} footer button`, '返回原编辑'); await page.waitForSelector(CHILD, { hidden: true, timeout: 7000 });
    await page.waitForFunction(root => document.activeElement?.matches(`${root} button[data-capture-catalog-open]`) && !document.activeElement.closest('[hidden]'), { timeout: 7000 }, root);
    const selector = await page.evaluate(captureCatalogEntrySelector, root), geometry = await page.evaluate(initialSessionGeometry, selector);
    assert.equal(geometry.visible, true, 'Natural original entry focus is visible without a scroll rescue');
    await save(`handoff-${stage}-natural-focus`, { selector, geometry, active: await page.evaluate(() => ({ text: document.activeElement?.textContent, focusVisible: document.activeElement?.matches(':focus-visible') })) });
    await capture(page, `${label}-handoff-${stage}-returned`);
  };
  const zeroWindow = async (name, work) => {
    const before = await facts(`${name}-before`), editorBefore = await page.evaluate(captureCatalogEditorState, owner); let primary = null, result, audit;
    await page.evaluate(installCaptureCatalogWriteAudit); activeAudit = true;
    try {
      await save(`${name}-editor-before`, editorBefore); await work();
      result = await facts(`${name}-after`); const editorAfter = await page.evaluate(captureCatalogEditorState, owner); audit = await page.evaluate(() => globalThis.__captureCatalogAudit.snapshot());
      assertCaptureCatalogUnchanged(before, result, editorBefore, editorAfter, audit);
      await save(`${name}-zero-write`, { editorBefore, editorAfter, audit }); await observe(page, `${label}-${name}`, true, 'Exact physical schema/keys/typed rows, complete GET ledger, parent fields and both pointers; zero native write attempts.');
    } catch (error) { primary = error; try { await save(`${name}-failure-audit`, await page.evaluate(() => globalThis.__captureCatalogAudit.snapshot())); } catch { /* outer independent collector still runs */ } }
    finally { try { const released = await page.evaluate(() => globalThis.__captureCatalogAudit.release()); activeAudit = false; await save(`${name}-audit-restored`, released); assert.equal(released.restored, true); assert.equal(released.dropped, 0); } catch (error) { primary ??= error; } }
    if (primary) throw primary; return result;
  };
  try {
    await save('handoff-declared-intent', { originalSelected: selected, residentParent: current, amount: '17.35', allOriginalTodosSelected: false, diarySelected: false, realControlsFirst: true, technicalCommittedRouteLater: true });
    mark('review-no-edit-return'); latest = await zeroWindow('handoff-review-no-edit', async () => { await openSelected(REVIEW); await naturalReturn(REVIEW); });
    mark('original-return-to-composer'); const returned = await h.returnComposer(latest, current, 'handoff-original-L-return'); latest = returned.frozen;
    const parentBefore = await page.evaluate(captureCatalogEditorState, owner), beforeSelection = latest;
    mark('composer-select-O'); await openSelected(COMPOSER);
    const beforeEdit = await facts('handoff-O-before-edit'); assert.deepEqual(beforeEdit.snapshot, beforeSelection.snapshot); assert.deepEqual(beforeEdit.allEvents, beforeSelection.allEvents); assert.deepEqual(await page.evaluate(captureCatalogEditorState, owner), parentBefore);
    mark('explicit-O-correction'); await input(field('第1笔金额（人民币元）'), '17.35');
    for (const name of ['记录第1个待办', '记录第2个待办', '将这段文字记入日记']) {
      const selector = field(name), labelSelector = await page.$eval(selector, el => `label[for="${CSS.escape(el.id)}"]`);
      if (await page.$eval(selector, el => el.checked)) await tap(labelSelector);
      assert.equal(await page.$eval(selector, el => el.checked), false); await read(labelSelector);
    }
    await saved(); const expected = expectedContinuedO(selected, current), corrected = await facts('handoff-O-corrected');
    assert.deepEqual(checks.draft(corrected, selected.id), expected); await preserve(beforeEdit, corrected, 'handoff-only-selected-O-CAS', { writes: { [`capture-review:${selected.id}`]: expected } });
    assert.deepEqual(corrected.pointers, beforeEdit.pointers); assert.deepEqual(await page.evaluate(captureCatalogEditorState, owner), parentBefore);
    await read(field('第1笔金额（人民币元）')); assert.equal(await page.$eval(field('第1笔金额（人民币元）'), el => el.value), '17.35');
    await tap(`${CHILD} summary`, '查看原文与本机确认稿'); assert.equal(await page.$eval(`${CHILD} details[open] > p`, el => el.textContent), selected.input); await read(`${CHILD} details[open] > p`); await tap(`${CHILD} summary`, '查看原文与本机确认稿');
    await read(field('本次保存范围'), '原文 + 1 笔收支 · 0 个待办 · 不写日记 · 不记录情绪'); await capture(page, `${label}-handoff-O-final-intent`);
    const beforeCommit = await facts('handoff-O-before-commit'); assert.deepEqual(beforeCommit.snapshot, corrected.snapshot); assert.deepEqual(beforeCommit.allEvents, corrected.allEvents);
    mark('original-same-ID-Save'); const window = { before: await page.evaluate(() => Date.now()) };
    await tap(`${CHILD} footer button`, '确认保存所选记录'); await page.waitForFunction(selector => document.querySelector(`${selector} h1`)?.textContent === '这次记录已保存在本机', { timeout: 7000 }, CHILD);
    const committed = await facts('handoff-O-committed-ACK'); window.after = await page.evaluate(() => Date.now());
    const submitted = { ...expected, sessionRevision: current.sessionRevision, sessionActive: current.sessionActive }, proof = assertCaptureContinuationCommitted(beforeCommit, committed, expected, submitted, window);
    await page.waitForFunction(selector => { const statuses = [...document.querySelectorAll(`${selector} li [role=status]`)]; return statuses.length === 2 && statuses.every(el => el.textContent === '已收到云端版本确认'); }, { timeout: 7000 }, CHILD);
    await read(`${CHILD} h1`, '这次记录已保存在本机'); await read(`${CHILD} li p`, '2026-10-07 · 支出 CNY ¥17.35');
    assert.deepEqual(await page.$$eval(`${CHILD} footer button`, nodes => nodes.map(el => el.textContent.trim())), ['返回原编辑']); assert.equal(await page.$$eval(`${CHILD} a`, nodes => nodes.length), 0);
    assert.deepEqual(await page.evaluate(captureCatalogEditorState, owner), parentBefore); await save('handoff-O-independent-proof-and-ACK', { expected, submitted, window, proof });
    await capture(page, `${label}-handoff-O-saved-real-ACK`); await observe(page, `${label}-handoff-same-ID-save`, true, 'Exact original O/correction/proof/source/receipt, independently recomputed typed SHA and index/head, two exact real server events/ACKs; original L/current/raw/context/pointers retained.');
    mark('saved-return-to-resident-composer'); latest = await zeroWindow('handoff-saved-return', async () => { await naturalReturn(COMPOSER); assert.deepEqual(await page.evaluate(captureCatalogEditorState, owner), parentBefore); });
    // Separate technical routing observation, only after the real discovery and
    // user Save/return chain. Never a claim of UI entry discoverability.
    mark('technical-committed-ID-full-document'); const path = `/quick-note/result?receipt=${encodeURIComponent(selected.id)}`, oldOrigin = await page.evaluate(() => performance.timeOrigin);
    await save('handoff-technical-navigation-source', { path, source: 'driver navigation to the exact O ID already selected and committed through original controls', provesUiDiscovery: false, beforeTimeOrigin: oldOrigin });
    actions.push({ kind: 'technical-committed-capture-full-document', surface: label, path, knownCommittedId: selected.id, notUiDiscovery: true });
    await page.goto(`${h.origin}${path}`, { waitUntil: 'domcontentloaded' }); await waitPath(page, '/quick-note/result');
    await page.waitForFunction(() => document.querySelector('[data-component="capture-review"] h1')?.textContent === '这次记录已保存在本机', { timeout: 7000 });
    const newOrigin = await page.evaluate(() => performance.timeOrigin), newSessionRevision = await page.evaluate(() => localStorage.getItem('youtrace:session-revision')); assert.ok(newSessionRevision === null || typeof newSessionRevision === 'string'); assert.notEqual(newOrigin, oldOrigin); assert.equal(new URL(page.url()).searchParams.get('receipt'), selected.id);
    const reloaded = await facts('handoff-technical-reload-bootstrap'); const metadataChanges = assertCaptureHistoryReload(latest, reloaded, owner); assertCaptureContinuationProof(reloaded, expected, submitted);
    await save('handoff-technical-reload-bootstrap-proof', { oldOrigin, newOrigin, newSessionRevision, metadataChanges, noFunctionCounterClaim: true });
    latest = await zeroWindow('handoff-history-stable-read', async () => { await tap(`${REVIEW} summary`, '当时确认的原文'); const selector = `${REVIEW} details[open] > p`; assert.equal(await page.$eval(selector, el => el.textContent), selected.input); await read(selector); await tap(`${REVIEW} summary`, '当时确认的原文'); await read(`${REVIEW} h1`, '这次记录已保存在本机'); await capture(page, `${label}-handoff-technical-history`); });
    mark('explicit-new-empty-input'); await tap(`${REVIEW} footer button`, '再记一条'); await waitPath(page, '/quick-note');
    await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
    assert.equal(await page.$eval(`${COMPOSER} textarea[aria-label="速记内容"]`, el => el.value), ''); await read(`${COMPOSER} textarea[aria-label="速记内容"]`);
    const empty = await facts('handoff-new-explicit-empty'), newInputs = captureExplicitEmptyInputs(latest, empty, owner); await preserve(latest, empty, 'handoff-exact-new-root-and-composer-fork', { writes: newInputs.writes }); assertCaptureContinuationProof(empty, expected, submitted);
    await save('handoff-new-empty-input-proof', { newInputs, retainedOriginalId: selected.id, originalInputStillPresent: true }); await capture(page, `${label}-handoff-new-empty`);
    await input(`${COMPOSER} textarea[aria-label="速记内容"]`, CAPTURE_CONTINUATION_NEW_RAW); await page.waitForFunction(() => document.querySelector('[data-component="capture-composer"] [role=status]')?.textContent === '原文已保留在本机', { timeout: 7000 });
    const typed = await facts('handoff-new-distinct-raw'); await preserve(empty, typed, 'handoff-only-new-raw', { writes: { [newInputs.key]: CAPTURE_CONTINUATION_NEW_RAW } });
    await tap(`${COMPOSER} button`, '查看确认稿'); await waitPath(page, '/quick-note/result'); await page.waitForFunction(() => document.querySelector('[data-component="capture-review"] footer [role=status]')?.textContent.startsWith('确认稿已保留在本机'), { timeout: 7000 });
    const id = new URL(page.url()).searchParams.get('draft'); assert.ok(id && id !== selected.id && id !== current.id);
    const newDraft = { id, inputKey: newInputs.key, input: CAPTURE_CONTINUATION_NEW_RAW, context: newInputs.context, ownerId: owner, dataEpoch: current.dataEpoch, sessionRevision: newSessionRevision, sessionActive: true, expenses: [], todos: [], habits: [], diary: CAPTURE_CONTINUATION_NEW_RAW, diaryDate: newInputs.context.date, mood: null, moodScore: null, moodConfirmed: false };
    const final = await facts('handoff-new-uncommitted-confirmation'); assert.ok(checks.newReviewExactly(typed, final, newDraft)); await preserve(typed, final, 'handoff-only-new-distinct-review', { writes: { [`capture-review:${id}`]: newDraft, quicknote_review: newDraft } }); assertCaptureContinuationProof(final, expected, submitted);
    await read(`${REVIEW} h1`, '选择要留下的记录'); await capture(page, `${label}-handoff-new-confirmation`);
    await save('handoff-final-outcome', { committedOriginalId: selected.id, originalParentId: current.id, newUncommittedId: id, newInputKey: newInputs.key, technicalRoute: path, uiDiscovery: 'only the original catalog chain above', counters: 'parse/create invocation counts are module/component evidence only' });
    await observe(page, `${label}-handoff-technical-history-and-explicit-empty`, true, 'Known committed-ID full-document history read with exact bootstrap ledger proof, then stable readonly zero-write window; original new-note control yields unrelated empty source and one separately typed synthetic confirmation. No UI discovery or zero-call inference from routing.');
  } catch (error) {
    await collectCaptureContinuationFailure({ ...h, stage }, error);
    throw error;
  } finally {
    if (activeAudit) { try { const released = await page.evaluate(() => globalThis.__captureCatalogAudit?.release() ?? null); await save('handoff-final-audit-restored', released); } catch { /* Original failure already retained by independent collector. */ } }
  }
}
