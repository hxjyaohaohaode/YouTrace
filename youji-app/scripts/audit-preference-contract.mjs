import { isDeepStrictEqual } from 'node:util';

export const PREFERENCE_STATE_KEY = 'accountPreferences:state:v1';
export const PREFERENCE_PENDING_KEY = 'pendingSetting:accountPreferences';
export const WIRE_KEYS = ['coachStyle', 'coachPushEnabled', 'pushLimit', 'quietEnabled', 'quietStart', 'quietEnd', 'eveningReviewEnabled', 'eveningReviewTime'];
export const preferenceRows = snapshot => snapshot.tables.find(row => row.name === 'settings').rows;
export const preferenceState = snapshot => preferenceRows(snapshot).find(row => row.key === PREFERENCE_STATE_KEY)?.value;
export const preferenceRelevantRows = snapshot => preferenceRows(snapshot).filter(row => row.key === PREFERENCE_STATE_KEY || row.key.startsWith('pendingSetting:') || row.key.startsWith('preferenceRecovery:') || ['coachStyle', 'coachPushEnabled', 'coachPushFrequency', 'quietHours', 'eveningReviewEnabled', 'eveningReviewTime'].includes(row.key));
export function desiredPreferences(state) { return { ...state.initial, ...state.server?.settings, ...state.active?.changes, ...state.queued?.changes }; }
export function wirePreferences(local) {
  return { coachStyle: local.coachStyle, coachPushEnabled: local.coachPushEnabled, pushLimit: local.coachPushFrequency, quietEnabled: local.quietHours.enabled, quietStart: local.quietHours.start, quietEnd: local.quietHours.end, eveningReviewEnabled: local.eveningReviewEnabled, eveningReviewTime: local.eveningReviewTime };
}
export function validSnapshot(remote) {
  const row = remote?.settings;
  return remote?.protocol === 1 && typeof remote.revision === 'string' && /^(0|[1-9]\d{0,9})$/.test(remote.revision) && BigInt(remote.revision) <= 2147483647n && row &&
    WIRE_KEYS.every(key => Object.hasOwn(row, key)) && ['gentle', 'strict', 'data'].includes(row.coachStyle) &&
    ['coachPushEnabled', 'quietEnabled', 'eveningReviewEnabled'].every(key => typeof row[key] === 'boolean') && Number.isInteger(row.pushLimit) && row.pushLimit >= 0 && row.pushLimit <= 10 &&
    ['quietStart', 'quietEnd', 'eveningReviewTime'].every(key => typeof row[key] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(row[key]));
}
export function acknowledgedPreferences(local, remote) {
  try {
    const state = preferenceState(local), rows = preferenceRows(local), desired = desiredPreferences(state);
    return Boolean(validSnapshot(remote) && state.version === 1 && state.server?.protocol === 1 && !state.active && !state.queued && !state.readError && !rows.some(row => row.key.startsWith('pendingSetting:')) &&
      state.server.revision === remote.revision && isDeepStrictEqual(wirePreferences(state.server.settings), remote.settings) && isDeepStrictEqual(wirePreferences(desired), remote.settings) &&
      Object.entries(desired).every(([key, value]) => rows.filter(row => row.key === key).length === 1 && isDeepStrictEqual(rows.find(row => row.key === key).value, value)));
  } catch { return false; }
}
export function storedSourceExcept(before, after, mutableKeys = []) {
  if (before.databaseName !== after.databaseName || before.version !== after.version || !isDeepStrictEqual(before.schema, after.schema) || !isDeepStrictEqual(before.tables.map(row => row.name), after.tables.map(row => row.name))) return false;
  return before.tables.every(table => {
    const current = after.tables.find(row => row.name === table.name);
    if (table.name !== 'settings') return isDeepStrictEqual(table, current);
    const retained = row => !['lastPullAt', ...mutableKeys].includes(row.key);
    const lossless = value => value.losslessRows ? value.rows.flatMap((row, index) => retained(row) ? [[row.key, value.losslessRows.entries.find(entry => entry[0] === String(index))?.[1]]] : []) : null;
    return isDeepStrictEqual(table.rows.filter(retained), current.rows.filter(retained)) && isDeepStrictEqual(lossless(table), lossless(current));
  });
}
export function unchangedPreferences(before, after) {
  return before.owner === after.owner && storedSourceExcept(before.local, after.local) && isDeepStrictEqual(before.remote, after.remote);
}
export function retainedPreferenceIntent(before, after, key, value, requests = [], responses = []) {
  const old = preferenceState(before.local), current = preferenceState(after.local), intended = { ...desiredPreferences(old), [key]: value };
  return before.owner === after.owner && old.version === current.version && current.version === 1 && old.epoch === current.epoch && isDeepStrictEqual(old.initial, current.initial) &&
    Number.isInteger(current.localRevision) && current.localRevision > old.localRevision && isDeepStrictEqual(desiredPreferences(current), intended) &&
    storedSourceExcept(before.local, after.local, [PREFERENCE_STATE_KEY, PREFERENCE_PENDING_KEY, key]) && (() => {
      const pending = [current.active, current.queued].filter(Boolean);
      if (pending.length === 1) return pending[0].baseRevision === before.remote.revision && !pending[0].parentId && isDeepStrictEqual(pending[0].base, desiredPreferences(old)) && isDeepStrictEqual(pending[0].changes, { [key]: value });
      if (pending.length !== 0 || !acknowledgedPreferences(after.local, after.remote)) return false;
      const ownRequests = requests.filter(row => row.body.baseRevision === before.remote.revision && isDeepStrictEqual(row.body.changes, wirePreferenceChanges({ [key]: value })));
      return exactPreferenceAck(ownRequests, responses, before.owner, after.remote);
    })();
}
export function savedPreferenceMutation(before, after, key, value, wireKey, requests, responses) {
  if (!retainedPreferenceIntent(before, after, key, value, requests, responses) || !acknowledgedPreferences(after.local, after.remote)) return false;
  const expected = { ...before.remote.settings, [wireKey]: value };
  return isDeepStrictEqual(after.remote.settings, expected) && BigInt(after.remote.revision) === BigInt(before.remote.revision) + 1n && requests.length > 0 &&
    new Set(requests.map(row => row.body.mutationId)).size === 1 && requests.every(row => row.account === before.owner && validPreferenceWire(row.body) && row.body.baseRevision === before.remote.revision && isDeepStrictEqual(row.body.changes, { [wireKey]: value }));
}
export function validPreferenceWire(request) {
  return request?.protocol === 1 && Object.keys(request).every(key => ['protocol', 'mutationId', 'baseRevision', 'changes'].includes(key)) && typeof request.mutationId === 'string' && request.mutationId.length > 0 && typeof request.baseRevision === 'string' && /^(0|[1-9]\d*)$/.test(request.baseRevision) &&
    request.changes && Object.keys(request.changes).length > 0 && Object.keys(request.changes).every(key => WIRE_KEYS.includes(key)) &&
    Object.entries(request.changes).every(([key, value]) => key === 'coachStyle' ? ['gentle', 'strict', 'data'].includes(value) : key === 'pushLimit' ? Number.isInteger(value) && value >= 0 && value <= 10 : key.endsWith('Enabled') ? typeof value === 'boolean' : typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

export function validPreferenceAck(request, response) {
  return validPreferenceWire(request) && validSnapshot(response) && response.acknowledged === true && response.mutationId === request.mutationId && BigInt(response.revision) === BigInt(request.baseRevision) + 1n && Object.entries(request.changes).every(([key, value]) => isDeepStrictEqual(response.settings[key], value));
}

export function comparisonRows(values) {
  const style = { gentle: '温柔型', strict: '严格型', data: '数据型' }[values.coachStyle];
  return [
    `教练风格：${style}`,
    `教练提醒：${values.coachPushEnabled ? '开启' : '关闭'} · 每设备每日最多 ${values.coachPushFrequency} 条`,
    `免打扰：${values.quietHours.enabled ? '开启' : '关闭'} · ${values.quietHours.start} 至 ${values.quietHours.end}`,
    `晚间复盘：${values.eveningReviewEnabled ? '开启' : '关闭'} · ${values.eveningReviewTime}`,
  ];
}
export const comparisonTextMatches = (observed, expected) => typeof observed === 'string' && observed.replace(/\s+/g, '') === expected.replace(/\s+/g, '');
export function resolutionPreservesSource(before, after, choice) {
  const old = preferenceState(before.local), current = preferenceState(after.local), oldRows = preferenceRows(before.local), newRows = preferenceRows(after.local);
  const added = newRows.filter(row => row.key.startsWith('preferenceRecovery:') && !oldRows.some(prior => prior.key === row.key));
  if (added.length !== 1 || added[0].value.choice !== choice || !isDeepStrictEqual(added[0].value.state, old)) return false;
  const accountKeys = Object.keys(desiredPreferences(old));
  return before.owner === after.owner && current.version === old.version && current.version === 1 && current.epoch === old.epoch && isDeepStrictEqual(current.initial, old.initial) && current.localRevision > old.localRevision &&
    acknowledgedPreferences(after.local, after.remote) && storedSourceExcept(before.local, after.local, [PREFERENCE_STATE_KEY, PREFERENCE_PENDING_KEY, ...accountKeys, added[0].key]);
}

export function exactPreferenceAck(requests, responses, owner, snapshot) {
  return requests.some(request => request.account === owner && responses.some(response => response.status === 200 && isDeepStrictEqual(response.request, request.body) && validPreferenceAck(request.body, response.body) && (!snapshot || response.body.revision === snapshot.revision && isDeepStrictEqual(response.body.settings, snapshot.settings))));
}
export function wirePreferenceChanges(changes) {
  const result = {};
  for (const key of ['coachStyle', 'coachPushEnabled', 'eveningReviewEnabled', 'eveningReviewTime']) if (Object.hasOwn(changes, key)) result[key] = changes[key];
  if (Object.hasOwn(changes, 'coachPushFrequency')) result.pushLimit = changes.coachPushFrequency;
  if (changes.quietHours) { result.quietEnabled = changes.quietHours.enabled; result.quietStart = changes.quietHours.start; result.quietEnd = changes.quietHours.end; }
  return result;
}
export function frozenPreferenceRequestMatches(active, request) {
  return validPreferenceWire(request) && isDeepStrictEqual(request, { protocol: 1, mutationId: active.id, baseRevision: active.baseRevision, changes: wirePreferenceChanges(active.changes) });
}
