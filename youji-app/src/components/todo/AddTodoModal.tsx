import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useTodoStore } from '../../stores/todoStore';
import type { Priority } from '../../stores/todoStore';
import { toast } from '../../services/toastBus';
import { addDays, getToday } from '../../utils/date';

interface AddTodoModalProps {
  open: boolean;
  onClose: () => void;
}

type DueChoice = 'today' | 'tomorrow' | 'week-end' | 'none';

const dueChoices: Array<{ value: DueChoice; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'tomorrow', label: '明天' },
  { value: 'week-end', label: '本周日晚' },
  { value: 'none', label: '无日期' },
];

const priorityStyles: Record<Priority, { active: string; label: string }> = {
  high: { active: 'bg-gradient-to-r from-[var(--danger)] to-[#FF6B8A] text-white shadow-sm', label: '高' },
  medium: { active: 'bg-gradient-to-r from-[var(--warning)] to-[#F0C040] text-white shadow-sm', label: '中' },
  low: { active: 'bg-gradient-to-r from-[var(--success)] to-[#3FBF7E] text-white shadow-sm', label: '低' },
};

function resolveDueDate(choice: DueChoice): string | undefined {
  const today = getToday();
  switch (choice) {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'week-end': {
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      const daysToSunday = (7 - weekday) % 7;
      return addDays(today, daysToSunday);
    }
    case 'none':
      return undefined;
  }
}

export function AddTodoModal({ open, onClose }: AddTodoModalProps) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueChoice, setDueChoice] = useState<DueChoice>('today');
  const [saving, setSaving] = useState(false);
  const addItem = useTodoStore((s) => s.addItem);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await addItem({ text: trimmed.slice(0, 200), priority, dueDate: resolveDueDate(dueChoice) });
      setText('');
      onClose();
    } catch {
      toast.error('待办创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="新建待办" footer={
      <>
        <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={handleSave} disabled={!text.trim() || saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </>
    }>
      <div className="space-y-4">
        <Input
          label="内容 *"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          placeholder="要做什么？"
          maxLength={200}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSave();
            }
          }}
        />

        <div>
          <p className="mb-2 block text-[13px] font-semibold text-[var(--text-1)]">优先级</p>
          <div className="flex gap-2" role="group" aria-label="选择优先级">
            {(['high', 'medium', 'low'] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                aria-pressed={priority === p}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  priority === p
                    ? priorityStyles[p].active
                    : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--border)]'
                }`}
              >
                {priorityStyles[p].label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 block text-[13px] font-semibold text-[var(--text-1)]">截止日期</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="选择截止日期">
            {dueChoices.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDueChoice(d.value)}
                aria-pressed={dueChoice === d.value}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  dueChoice === d.value
                    ? 'bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-sm'
                    : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--border)]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
