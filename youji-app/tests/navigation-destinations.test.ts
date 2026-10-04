import assert from 'node:assert/strict';
import test from 'node:test';
import { destinations, destinationFor, isMoreDestination, navigationGroups, navigationReturnTarget, parseDirectoryPosition, directoryEntry, directoryOrigin, staticPageEntry, isStaticPageEntry } from '../src/lib/navigation';
import { ROUTE_IDS, clearDiagnostics, diagnosticSnapshot, recordDiagnostic } from '../src/services/diagnostics';

test('feature directory exposes each actual business destination once and includes first-use tasks and data controls', () => {
  assert.equal(new Set(destinations.map(item => item.path)).size, destinations.length);
  assert.deepEqual(new Set(destinations.map(item => item.path)), new Set(['/quick-note', '/expense', '/diary', '/timeline', '/schedule', '/todo', '/habit', '/goal', '/coach', '/insights', '/settings']));
  for (const item of destinations) { assert.ok(navigationGroups.includes(item.group)); assert.ok(item.description.length > 3); assert.ok(ROUTE_IDS[item.path]); }
  assert.equal(isMoreDestination('/todo'), true); assert.equal(isMoreDestination('/habit'), true); assert.equal(isMoreDestination('/coach'), true);
  assert.equal(isMoreDestination('/more'), true); assert.equal(isMoreDestination('/'), false); assert.equal(isMoreDestination('/expense'), false);
});
test('directory return retains an exact local context without accepting an external or invented destination', () => {
  assert.deepEqual(navigationReturnTarget('/expense?record=synthetic-row'), { path: '/expense?record=synthetic-row', label: '花销' });
  assert.deepEqual(navigationReturnTarget('/timeline?range=all&limit=120'), { path: '/timeline?range=all&limit=120', label: '时间线' });
  assert.deepEqual(navigationReturnTarget('/'), { path: '/', label: '首页' });
  for (const value of ['https://example.invalid/', '//example.invalid/', '/made-up', '/more', null, 5, { path: '/todo' }]) assert.equal(navigationReturnTarget(value), null);
  assert.equal(destinationFor('/todo?record=synthetic'), undefined);
});
test('directory observations retain only a fixed route area', () => {
  clearDiagnostics(); recordDiagnostic('button', ROUTE_IDS['/more']);
  assert.deepEqual(Object.keys(diagnosticSnapshot()[0]).sort(), ['area', 'at', 'kind']);
  assert.equal(diagnosticSnapshot()[0].area, 'navigation'); clearDiagnostics();
});

test('optional menu position accepts only finite scroll and static routes, never record content', () => {
  assert.deepEqual(parseDirectoryPosition('{"top":723,"path":"/habit","privateMemo":"synthetic"}'), { top: 723, path: '/habit' });
  for (const raw of [null, '{', '[]', '{"top":-1,"path":"/habit"}', '{"top":100001,"path":"/habit"}', '{"top":1,"path":"/todo?record=secret"}', '{"top":1,"path":"//example.invalid"}']) assert.equal(parseDirectoryPosition(raw), null);
});

test('only an app-entered directory state for the current account can use native history Back', () => {
  const state = directoryEntry('/todo?record=synthetic-row', 'synthetic-owner-a');
  assert.deepEqual(directoryOrigin(state, 'synthetic-owner-a'), { path: '/todo?record=synthetic-row', label: '待办' });
  assert.equal(directoryOrigin(state, 'synthetic-owner-b'), null);
  assert.equal(directoryOrigin({ from: '/todo?record=old-id', ownerId: 'synthetic-owner-a' }, 'synthetic-owner-a'), null);
  assert.equal(directoryOrigin(state, ''), null); assert.equal(directoryEntry('/more', 'synthetic-owner-a'), undefined);
  assert.equal(directoryEntry('/todo', undefined), undefined);
});

test('only same-account explicit static PUSH may place the destination heading', () => {
  const state = staticPageEntry('/settings', 'synthetic-owner-a');
  assert.equal(isStaticPageEntry(state, 'synthetic-owner-a', '/settings', 'PUSH'), true);
  for (const type of ['POP', 'REPLACE']) assert.equal(isStaticPageEntry(state, 'synthetic-owner-a', '/settings', type), false);
  assert.equal(isStaticPageEntry(state, 'synthetic-owner-b', '/settings', 'PUSH'), false);
  assert.equal(isStaticPageEntry(state, 'synthetic-owner-a', '/coach', 'PUSH'), false);
  assert.equal(isStaticPageEntry({}, 'synthetic-owner-a', '/settings', 'PUSH'), false);
  for (const path of ['/more', '/quick-note', '/quick-note/result', '/expense?record=synthetic', '//example.invalid']) assert.equal(staticPageEntry(path, 'synthetic-owner-a'), undefined);
});
