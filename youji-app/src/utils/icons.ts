import {
  UtensilsCrossed, Car, Gamepad2, BookOpen, ShoppingCart, Package,
} from 'lucide-react';
import type { MoodLevel } from '../services/parser';

export type ExpenseCategoryKey = 'food' | 'transport' | 'entertainment' | 'study' | 'daily' | 'other';

export const expenseCategoryIcons: Record<ExpenseCategoryKey | string, { icon: typeof UtensilsCrossed; color: string; label: string }> = {
  food: { icon: UtensilsCrossed, color: '#ef4444', label: '餐饮' },
  transport: { icon: Car, color: '#3b82f6', label: '交通' },
  entertainment: { icon: Gamepad2, color: '#8b5cf6', label: '娱乐' },
  study: { icon: BookOpen, color: '#10b981', label: '学习' },
  daily: { icon: ShoppingCart, color: '#f59e0b', label: '日用' },
  other: { icon: Package, color: '#6b7280', label: '其他' },
};

export const EXPENSE_CATEGORY_KEYS: ExpenseCategoryKey[] = ['food', 'transport', 'entertainment', 'study', 'daily', 'other'];

const zhToCanonicalCategory: Record<string, ExpenseCategoryKey> = {
  餐饮: 'food',
  购物: 'daily',
  学习: 'study',
  交通: 'transport',
  娱乐: 'entertainment',
  其他: 'other',
};

export function normalizeExpenseCategory(category: string): ExpenseCategoryKey {
  if (Object.hasOwn(zhToCanonicalCategory, category)) {
    return zhToCanonicalCategory[category];
  }
  const knownKeys = new Set<string>(Object.keys(expenseCategoryIcons));
  return knownKeys.has(category) ? (category as ExpenseCategoryKey) : 'other';
}

export interface MoodMeta {
  label: string;
  emoji: string;
  color: string;
  score: number;
  bg: string;
}

export const moodConfig: Record<MoodLevel, MoodMeta> = {
  happy: { label: '开心', emoji: '😊', color: '#10b981', score: 8, bg: 'bg-emerald-500/10' },
  good: { label: '不错', emoji: '🙂', color: '#34d399', score: 7, bg: 'bg-emerald-400/10' },
  normal: { label: '平静', emoji: '😐', color: '#6b7280', score: 5, bg: 'bg-gray-400/10' },
  low: { label: '低落', emoji: '😞', color: '#f59e0b', score: 4, bg: 'bg-amber-500/10' },
  sad: { label: '难过', emoji: '😢', color: '#ef4444', score: 3, bg: 'bg-red-500/10' },
  angry: { label: '生气', emoji: '😠', color: '#dc2626', score: 2, bg: 'bg-red-600/10' },
  anxious: { label: '焦虑', emoji: '😰', color: '#f97316', score: 3, bg: 'bg-orange-500/10' },
};

export const MOOD_LEVELS: MoodLevel[] = ['happy', 'good', 'normal', 'low', 'sad', 'angry', 'anxious'];

export function getMoodMeta(level: string | null | undefined): MoodMeta | null {
  if (!level || !(level in moodConfig)) return null;
  return moodConfig[level as MoodLevel];
}

export const habitFrequencyLabels: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
};

export function normalizeHabitFrequency(frequency: string): 'daily' | 'weekly' {
  if (frequency === '每周' || frequency === 'weekly') return 'weekly';
  return 'daily';
}

export const diarySourceLabels: Record<string, string> = {
  quicknote_aggregated: '速记自动生成',
  ai_generated: 'AI 生成',
  manual: '手动记录',
};
