import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retainPendingEditor, readPendingEditor, releasePendingEditor } from '../src/services/pendingEditorMemory.ts';
test('failed in-app Back retains only current document/account/session/epoch draft and never releases a newer edit', () => {
  const scope = { database: {}, owner: 'a', session: 's1', epoch: 'e1', key: 'diary:1' }, value = { content: 'Synthetic pending original' };
  const first = retainPendingEditor(scope, value); value.content = 'not the retained snapshot'; assert.equal(readPendingEditor<{ content: string }>(scope)?.content, 'Synthetic pending original');
  const second = retainPendingEditor(scope, { content: 'newer' }); releasePendingEditor(scope, first); assert.equal(readPendingEditor<{ content: string }>(scope)?.content, 'newer'); releasePendingEditor(scope, second); assert.equal(readPendingEditor(scope), null);
  for (const patch of [{ owner: 'b' }, { session: 's2' }, { epoch: 'e2' }, { database: {} }]) { retainPendingEditor(scope, value); assert.equal(readPendingEditor({ ...scope, ...patch }), null); }
});
