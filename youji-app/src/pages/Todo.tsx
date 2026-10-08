import '../components/schedule/planning.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Plus, CheckSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { TodoList, AddTodoModal } from '../components/todo';
import { useTodoStore, type TodoItem } from '../stores/todoStore';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/layout/PageHeader';

export default function Todo() {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TodoItem | undefined>();
  const [recoveryId, setRecoveryId] = useState<string | undefined>();
  const [dismissed, setDismissed] = useState('');
  const [routeSnapshot, setRouteSnapshot] = useState<{ key: string; item: TodoItem } | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const items = useTodoStore((state) => state.items);
  const loaded = useTodoStore((state) => state.loaded);
  const recordId = new URLSearchParams(location.search).get('record');
  const target = recordId ? items.find((item) => item.id === recordId) : undefined;
  const requestKey = `${location.key}:${recordId ?? ''}`;
  if (loaded && target && routeSnapshot?.key !== requestKey) setRouteSnapshot({ key: requestKey, item: target });
  const requestedItem = loaded && dismissed !== requestKey && routeSnapshot?.key === requestKey ? routeSnapshot.item : undefined;
  const source = (location.state as { returnTo?: { path?: string; label?: string } } | null)?.returnTo;
  const closeEditor = () => {
    setEditing(undefined); setShowModal(false); setRecoveryId(undefined); setDismissed(requestKey);
  };

  return (
    <div className="planning-page w-full">
      {source?.path && <Button variant="ghost" onClick={() => navigate(-1)}>← {source.label || '返回来源'}</Button>}
      {recordId && !loaded && <p role="status">正在查找这条记录…</p>}
      {recordId && loaded && !target && <section role="status" className="mb-4 space-y-2 rounded-xl border border-[var(--border)] p-4"><p>当前账号未找到这条记录。它可能已删除，或尚未同步到本机。</p><Button variant="soft" onClick={() => { setRecoveryId(recordId); setDismissed(requestKey); }}>查看此记录的本机编辑稿</Button></section>}
      {target && dismissed === requestKey && <Button variant="soft" onClick={() => setEditing(target)}>重新打开选中的记录</Button>}
      <PageHeader
        icon={CheckSquare}
        gradient="from-[var(--primary)] to-[var(--primary-light)]"
        title="待办"
        subtitle="把要做的事放在这里，一次完成一件"
        actions={
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { setDismissed(requestKey); setShowModal(true); }}
            className="planning-create"
            aria-label="新建待办"
          >
            <Plus size={18} aria-hidden /><span>新建待办</span>
          </motion.button>
        }
      />

      <TodoList onEdit={(item) => { setDismissed(requestKey); setEditing(item); }} />

      <AddTodoModal key={editing?.id ?? requestedItem?.id ?? recoveryId ?? 'new'} open={showModal || Boolean(editing || requestedItem || recoveryId)} item={editing ?? requestedItem} draftId={recoveryId} onClose={closeEditor} />
    </div>
  );
}
