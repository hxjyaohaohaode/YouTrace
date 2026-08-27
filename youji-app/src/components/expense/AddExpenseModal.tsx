import { useState } from 'react';
import { motion } from 'framer-motion';
import { UtensilsCrossed, Car, Gamepad2, BookOpen, ShoppingCart, Package, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useExpenseStore } from '../../stores/expenseStore';
import { expenseCategoryIcons, EXPENSE_CATEGORY_KEYS } from '../../utils/icons';
import { toast } from '../../services/toastBus';
import { getToday } from '../../utils/date';

const categoryComponents: Record<string, typeof UtensilsCrossed> = {
  food: UtensilsCrossed,
  transport: Car,
  entertainment: Gamepad2,
  study: BookOpen,
  daily: ShoppingCart,
  other: Package,
};

const MAX_AMOUNT_FEN = 100_000_000_00;

interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddExpenseModal({ open, onClose }: AddExpenseModalProps) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('food');
  const [name, setName] = useState('');
  const [isIncome, setIsIncome] = useState(false);
  const addItem = useExpenseStore((s) => s.addItem);

  const parsedYuan = parseFloat(amount);
  const fenValue = Number.isFinite(parsedYuan) ? Math.round(parsedYuan * 100) : 0;
  const amountValid = fenValue > 0 && fenValue <= MAX_AMOUNT_FEN;

  const handleSave = async () => {
    if (!amountValid) {
      toast.error(isIncome ? '请输入有效的收入金额' : '请输入有效的金额（大于0）');
      return;
    }

    const label = expenseCategoryIcons[category]?.label ?? '其他';

    try {
      await addItem({
        name: (name.trim() || label).slice(0, 100),
        amount: fenValue,
        category,
        date: getToday(),
        isIncome,
      });
      setAmount('');
      setName('');
      setCategory('food');
      setIsIncome(false);
      onClose();
    } catch {
      toast.error('保存失败，请重试');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="记一笔" footer={
      <>
        <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!amountValid}>保存</Button>
      </>
    }>
      <div className="space-y-5">
        <div className="py-4 text-center">
          <motion.p
            key={amount}
            initial={{ scale: 0.95, opacity: 0.5 }}
            animate={{ scale: 1, opacity: 1 }}
            className="font-mono text-5xl font-extrabold tracking-tight text-[var(--text-1)]"
          >
            ¥{amount || '0'}
          </motion.p>
          <label htmlFor="expense-amount" className="sr-only">金额</label>
          <input
            id="expense-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-invalid={Boolean(amount) && !amountValid}
            className={`mt-3 w-full bg-transparent text-center text-xl outline-none placeholder:text-[var(--text-3)] ${amount && !amountValid ? 'text-[var(--danger)]' : 'text-[var(--text-1)]'}`}
            autoFocus
          />
          {Boolean(amount) && !amountValid && (
            <p role="alert" className="mt-1 text-xs text-[var(--danger)]">金额需大于 0 且不超过一亿</p>
          )}
        </div>

        <div className="flex rounded-full bg-[var(--surface-2)] p-1" role="radiogroup" aria-label="收支类型">
          <button
            type="button"
            onClick={() => setIsIncome(false)}
            aria-checked={!isIncome}
            role="radio"
            className={`flex-1 rounded-full py-2.5 text-sm font-semibold transition-all duration-200 ${
              !isIncome ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-3)]'
            }`}
          >
            支出
          </button>
          <button
            type="button"
            onClick={() => setIsIncome(true)}
            aria-checked={isIncome}
            role="radio"
            className={`flex-1 rounded-full py-2.5 text-sm font-semibold transition-all duration-200 ${
              isIncome ? 'bg-[var(--surface)] text-[var(--success)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-3)]'
            }`}
          >
            收入
          </button>
        </div>

        {!isIncome && (
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">分类</p>
            <div className="grid grid-cols-6 gap-2 sm:gap-3" role="radiogroup" aria-label="支出分类">
              {EXPENSE_CATEGORY_KEYS.map((key) => {
                const cat = expenseCategoryIcons[key];
                const Icon = categoryComponents[key] ?? Package;
                const isSelected = category === key;
                return (
                  <motion.button
                    key={key}
                    whileTap={{ scale: 0.95 }}
                    type="button"
                    onClick={() => setCategory(key)}
                    aria-checked={isSelected}
                    role="radio"
                    aria-label={cat.label}
                    className={`relative flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border p-2 transition-all duration-200 sm:p-3 ${
                      isSelected
                        ? 'border-2 border-[var(--primary)]/30 bg-gradient-to-br from-[var(--primary-soft)] to-[var(--primary-muted)]'
                        : 'border-transparent bg-[var(--surface-2)] hover:bg-[var(--border)]'
                    }`}
                  >
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-xl sm:h-10 sm:w-10"
                      style={{ background: `linear-gradient(135deg, ${cat.color}20, ${cat.color}08)` }}
                    >
                      <Icon size={17} style={{ color: isSelected ? cat.color : `${cat.color}80` }} aria-hidden />
                    </div>
                    <span className={`text-[11px] font-semibold ${isSelected ? 'text-[var(--primary)]' : 'text-[var(--text-2)]'}`}>
                      {cat.label}
                    </span>
                    {isSelected && (
                      <motion.span
                        layoutId="categoryCheck"
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] shadow-[var(--shadow-xs)]"
                      >
                        <Check size={10} className="text-white" aria-hidden />
                      </motion.span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="expense-name" className="mb-1 block text-xs font-medium text-[var(--text-3)]">备注</label>
          <input
            id="expense-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 100))}
            maxLength={100}
            placeholder="备注（可选）"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-1)] outline-none transition-all focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/8 placeholder:text-[var(--text-3)]"
          />
        </div>
      </div>
    </Modal>
  );
}
