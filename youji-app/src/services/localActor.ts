import { db, LOCAL_DATA_EPOCH_KEY, type YoujiDatabase } from '../db';
import { getVerifiedSessionOwner, getSessionGeneration, SESSION_REVISION_KEY, SIGNED_OUT_KEY } from './apiClient';

/** Capture before awaiting. A DB name or persisted flag never proves an actor. */
export interface LocalActor {
  database: YoujiDatabase;
  owner: string | null;
  session: string | null;
  sessionGeneration: number;
  epoch: unknown;
}
export function captureLocalActor(): Omit<LocalActor, 'epoch'> {
  const actor = { database: db, owner: getVerifiedSessionOwner(), session: localStorage.getItem(SESSION_REVISION_KEY), sessionGeneration: getSessionGeneration() };
  assertLocalActorNow(actor);
  return actor;
}
export function assertLocalActorNow(actor: Omit<LocalActor, 'epoch'>): void {
  if (actor.database !== db || actor.owner !== db.ownerId || actor.owner !== getVerifiedSessionOwner() || actor.sessionGeneration !== getSessionGeneration() || actor.session !== localStorage.getItem(SESSION_REVISION_KEY) || localStorage.getItem(SIGNED_OUT_KEY) === 'true') {
    throw new Error('账号或本机资料已变化，未写入旧修改。输入仍保留，请重新核对');
  }
}
export async function readLocalActor(): Promise<LocalActor> {
  const actor = captureLocalActor();
  const epoch = (await actor.database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value;
  assertLocalActorNow(actor);
  return { ...actor, epoch };
}
export async function assertLocalActor(actor: LocalActor): Promise<void> {
  assertLocalActorNow(actor);
  const epoch = (await actor.database.settings.get(LOCAL_DATA_EPOCH_KEY))?.value;
  // Recheck synchronous authority AFTER the final awaited storage boundary.
  assertLocalActorNow(actor);
  if (epoch !== actor.epoch) throw new Error('本机资料已变化（已清除），未恢复旧修改。输入仍保留，请重新核对');
}
