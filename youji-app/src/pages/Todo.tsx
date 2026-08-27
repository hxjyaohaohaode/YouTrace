import { useState } from 'react';
import { Plus, CheckSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { TodoList, AddTodoModal } from '../components/todo';
import { PageHeader } from '../components/layout/PageHeader';

export default function Todo() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="w-full">
      <PageHeader
        icon={CheckSquare}
        gradient="from-[var(--primary)] to-[var(--primary-light)]"
        title="待办"
        subtitle="管理你的任务清单"
        actions={
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowModal(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-light)] text-white shadow-[var(--shadow-glow)]"
            aria-label="新建待办"
          >
            <Plus size={20} aria-hidden />
          </motion.button>
        }
      />

      <TodoList />

      <AddTodoModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  );
}
