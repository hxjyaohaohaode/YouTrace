import { readLocalActor, assertLocalActor } from './localActor';

export type PreferenceTimeKey = 'eveningReviewTime' | 'quietStart' | 'quietEnd';

/** Read an actual current local value, never infer that a particular save succeeded. */
export async function readPreferenceTime(key: PreferenceTimeKey) {
  const actor = await readLocalActor(), database = actor.database;
  const result = await database.transaction('r', database.settings, async () => {
    await assertLocalActor(actor);
    const row = await database.settings.get(key === 'eveningReviewTime' ? key : 'quietHours');
    const value = key === 'eveningReviewTime' ? row?.value : (row?.value as { start?: unknown; end?: unknown } | undefined)?.[key === 'quietStart' ? 'start' : 'end'];
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('当前本机时间尚未读到，输入仍保留，请稍后重新核对');
    await assertLocalActor(actor);
    return value;
  });
  await assertLocalActor(actor);
  return result;
}
