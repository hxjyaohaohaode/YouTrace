import type { OutboxRecord } from '../db';
import { recordKey, isSequence } from './syncIdentity';
import type { CaptureEntityRef } from './quickNoteIntegration';
export interface CurrentCaptureRecord { available: boolean; label: string; detail: string }
/** Read-only presentation of today's entity, never a rewrite of its creation receipt. */
export function currentCaptureRecord(reference: CaptureEntityRef, value: unknown): CurrentCaptureRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { available: false, label: reference.label, detail: '当前本机未找到这条记录，可打开去向核对同步或恢复；不以同名条目代替' };
  const row = value as Record<string, unknown>, text = (key: string, fallback: string) => typeof row[key] === 'string' ? row[key] as string : fallback;
  switch (reference.entity) {
    case 'todos': return { available: true, label: text('text', '内容待核对'), detail: `${typeof row.dueDate === 'string' && row.dueDate ? `截止 ${row.dueDate}` : '无截止日期'} · ${row.done === true ? '已完成' : '未完成'}` };
    case 'expenses': return { available: true, label: text('name', '名称待核对'), detail: `${text('date', '日期待核对')} · ${row.isIncome === true ? '收入' : '支出'} ${typeof row.amount === 'number' && Number.isFinite(row.amount) ? `CNY ¥${(row.amount / 100).toFixed(2)}` : '金额待核对'}` };
    case 'diaries': return { available: true, label: `${text('date', '日期待核对')} 日记`, detail: text('content', '正文待核对').slice(0, 80) };
    case 'habitCheckins': return { available: true, label: reference.label, detail: `${text('date', '日期待核对')} · ${row.done === true ? '已完成打卡' : '当前未打卡'}` };
    case 'quickNotes': return { available: true, label: '原始速记', detail: text('rawInput', '原文待核对').slice(0, 80) };
  }
}

export interface ReceiptViewState { current: Record<string, CurrentCaptureRecord>; statuses: Record<string, string>; error: string; locked: boolean }
export function failedReceiptRead(actorCurrent: boolean): ReceiptViewState {
  return { current: {}, statuses: {}, locked: !actorCurrent, error: actorCurrent ? '暂时读不到当前记录，当前内容和同步确认未知。创建时回执仍保留，可重试读取。' : '账号状态已变化，请重新核对登录' };
}
export function currentReceiptSyncStatus(reference: CaptureEntityRef, available: boolean, outbox: OutboxRecord[], conflict: boolean, version: unknown): string {
  const key = `${reference.entity}:${reference.id}`;
  const operations = outbox.filter(operation => { try { return recordKey(operation) === key; } catch { return false; } });
  if (conflict) return '有版本冲突，需要比较';
  if (operations.some(operation => operation.status === 'blocked')) return '云端尚未接收，需要处理';
  if (operations.length) return '本机修改等待云端确认';
  if (!available) return '当前内容不可用，历史回执不代表当前状态';
  return isSequence(version) && version !== '0' ? '已收到云端版本确认' : '本机已保存，云端确认未知';
}
