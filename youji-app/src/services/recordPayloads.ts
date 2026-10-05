/** Runtime projection: local recovery metadata must never be spread onto wire. */
const definitions = {
  expenses: { id: 'string', name: 'string', amount: 'number', category: 'string', date: 'string', source: 'string', relatedMood: 'string?', isIncome: 'boolean', note: 'string?' },
  todos: { id: 'string', text: 'string', dueDate: 'string?', priority: 'string', done: 'boolean', completedAt: 'number?' },
} as const;
export function recordSyncPayload(entity: 'expenses' | 'todos', value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('记录格式需要核对，未传输');
  const input = value as Record<string, unknown>, output: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(definitions[entity])) {
    const leaf = input[key]; if (leaf === undefined) continue;
    if (leaf === null && kind.endsWith('?')) { output[key] = null; continue; }
    if (typeof leaf !== kind.replace('?', '') || typeof leaf === 'number' && !Number.isFinite(leaf)) throw new Error('记录字段格式需要核对，未传输');
    output[key] = leaf;
  }
  if (typeof output.id !== 'string' || !output.id) throw new Error('记录编号格式需要核对，未传输');
  return output;
}

const oldFields: Record<string, Record<string, string>> = {
  expenses: { ...definitions.expenses, createdAt: 'time', updatedAt: 'time' },
  todos: { ...definitions.todos, createdAt: 'time', updatedAt: 'time' },
  schedules: { id: 'string', title: 'string', date: 'string', startTime: 'string', endTime: 'string', type: 'string', location: 'string', repeat: 'string', remind: 'number', createdAt: 'time', updatedAt: 'time' },
  habits: { id: 'string', name: 'string', icon: 'string', frequency: 'string', sortOrder: 'number', createdAt: 'time', updatedAt: 'time' },
  diaries: { id: 'string', date: 'string', content: 'string', mood: 'string?', moodScore: 'number?', source: 'string', aiInsight: 'string?', createdAt: 'time', updatedAt: 'time' },
  habitCheckins: { id: 'string', habitId: 'string', date: 'string', done: 'boolean', source: 'string', confirmed: 'boolean', aiReason: 'string?', updatedAt: 'time' },
  goals: { id: 'string', title: 'string', description: 'string', level: 'string', domain: 'string', priority: 'string', progress: 'number', targetDate: 'string?', createdAt: 'time', updatedAt: 'time' },
};
function scalarRecord(value: unknown, fields: Record<string, string>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, leaf]) => {
    if (leaf === undefined) return true;
    const type = fields[key]; if (!type) return false;
    if (leaf === null) return type.endsWith('?');
    if (type === 'time') return typeof leaf === 'number' && Number.isFinite(leaf) || typeof leaf === 'string' && Number.isFinite(Date.parse(leaf));
    return typeof leaf === type.replace('?', '') && (typeof leaf !== 'number' || Number.isFinite(leaf));
  });
}
function parsedNote(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const parsed = value as Record<string, unknown>;
  const arrayFields: Record<string, Record<string, string>> = {
    expenses: { id: 'string', name: 'string', amount: 'number', category: 'string', confirmed: 'boolean', date: 'string?', currency: 'string', isIncome: 'boolean' },
    todos: { id: 'string', text: 'string', confirmed: 'boolean', dueDate: 'string?', dateUncertain: 'boolean', dateConfirmed: 'boolean' },
    habits: { id: 'string', habitId: 'string', name: 'string', confirmed: 'boolean', done: 'boolean', date: 'string?' },
  };
  for (const [key, leaf] of Object.entries(parsed)) {
    if (arrayFields[key]) { if (!Array.isArray(leaf) || !leaf.every(row => key === 'todos' && typeof row === 'string' || scalarRecord(row, arrayFields[key]))) return false; }
    else if (key === 'captureContext') { if (!scalarRecord(leaf, { capturedAt: 'number?', timeZone: 'string?', date: 'string?' })) return false; }
    else if (!scalarRecord({ [key]: leaf }, { diary: 'string?', mood: 'string?', moodScore: 'number?' })) return false;
  }
  return true;
}
/** Validate only. Never mutate an uncertain request or reuse its ID for new bytes. */
export function isSafeFrozenPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, leaf] of Object.entries(value)) {
    if (key === 'scheduleExceptionsVersion') { if (leaf !== 1) return false; }
    else if (key === 'protocol') { if (leaf !== 2) return false; }
    else if (key === 'mutationId') { if (typeof leaf !== 'string') return false; }
    else if (key === 'deletions') {
      if (!leaf || typeof leaf !== 'object' || Array.isArray(leaf)) return false;
      for (const [entity, rows] of Object.entries(leaf)) if (!['goalIds', 'scheduleIds', 'expenseIds', 'todoIds', 'habitIds', 'quickNoteIds', 'diaryIds', 'habitCheckinIds'].includes(entity) || !Array.isArray(rows) || !rows.every(row => scalarRecord(row, { id: 'string', baseVersion: 'string' }))) return false;
    } else if (key === 'quickNotes') {
      if (!Array.isArray(leaf) || !leaf.every(row => { if (!row || typeof row !== 'object' || Array.isArray(row)) return false; const { parsed, ...rest } = row as Record<string, unknown>; return scalarRecord(rest, { id: 'string', content: 'string', timestamp: 'number', confirmed: 'boolean', baseVersion: 'string' }) && (parsed === undefined || parsedNote(parsed)); })) return false;
    } else if (key === 'schedules') {
      if (!Array.isArray(leaf) || !leaf.every(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        const { exceptions, ...rest } = row as Record<string, unknown>;
        return scalarRecord(rest, { ...oldFields.schedules, baseVersion: 'string' }) && (exceptions === undefined || Array.isArray(exceptions) && exceptions.length <= 500 && exceptions.every(exception => scalarRecord(exception, { occurrenceDate: 'string', cancelled: 'boolean', date: 'string', startTime: 'string', endTime: 'string', title: 'string', location: 'string', type: 'string', remind: 'number' })));
      })) return false;
    } else if (!oldFields[key] || !Array.isArray(leaf) || !leaf.every(row => scalarRecord(row, { ...oldFields[key], baseVersion: 'string' }))) return false;
  }
  return true;
}
