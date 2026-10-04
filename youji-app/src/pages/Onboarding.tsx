import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Mic, Brain, Shield } from 'lucide-react';
import { Button } from '../components/ui/Button';

const onboardingSteps = [
  {
    icon: Sparkles,
    title: '欢迎来到有迹',
    description: '记录生活、回顾变化，也可以与 AI 生活教练聊聊。',
    color: '#7C6FFF',
    bgClass: 'bg-gradient-to-br from-[#7C6FFF]/20 via-[var(--bg)] to-[#B06AFF]/10',
  },
  {
    icon: Mic,
    title: '说一句话就够了',
    description: '输入文字，或在浏览器支持时用语音转文字。规则解析会生成花销、习惯、日记和待办草稿，由你编辑确认后保存。',
    color: '#2EA06B',
    bgClass: 'bg-gradient-to-br from-[#2EA06B]/20 via-[var(--bg)] to-[#3FBF7E]/10',
  },
  {
    icon: Brain,
    title: '打开应用，看见回顾',
    description: '打开首页时，应用会按已有记录生成回顾和站内提醒。你可以调整频率、免打扰或关闭提醒；目前关闭应用后不会在后台主动推送。',
    color: '#7C6FFF',
    bgClass: 'bg-gradient-to-br from-[#7C6FFF]/20 via-[var(--bg)] to-[#45B7D1]/10',
  },
  {
    icon: Shield,
    title: '数据只属于你',
    description: '当前版本需要登录。输入草稿先保留在本机，确认保存的记录才会同步到你的账号。使用在线 AI 教练时，消息和相关数据摘要会发送到服务端及配置的模型服务。',
    color: '#D99A2B',
    bgClass: 'bg-gradient-to-br from-[#D99A2B]/20 via-[var(--bg)] to-[#E8853D]/10',
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  const handleNext = () => {
    if (step < onboardingSteps.length - 1) {
      setStep(step + 1);
    } else {
      localStorage.setItem('youji_onboarded', 'true');
      navigate('/', { replace: true });
    }
  };

  const handleSkip = () => {
    localStorage.setItem('youji_onboarded', 'true');
    navigate('/', { replace: true });
  };

  const current = onboardingSteps[step];
  const Icon = current.icon;

  return (
    <div className={`flex min-h-screen flex-col transition-colors duration-500 ${current.bgClass}`}>
      <div className="flex justify-end p-4">
        <button
          onClick={handleSkip}
          className="text-sm font-medium text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
        >
          跳过
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center text-center"
          >
            <div
              className="mb-8 flex h-28 w-28 items-center justify-center rounded-3xl shadow-[var(--shadow-glow)]"
              style={{ backgroundColor: `${current.color}15`, boxShadow: `0 0 20px ${current.color}25` }}
            >
              <Icon size={52} style={{ color: current.color }} />
            </div>

            <h1 className="mb-3 text-[26px] font-bold text-[var(--text-1)] tracking-tight">
              {current.title}
            </h1>
            <p className="max-w-xs text-base text-[var(--text-2)] leading-relaxed font-medium">
              {current.description}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-8 pb-12">
        <div className="mb-6 flex justify-center gap-2">
          {onboardingSteps.map((_, i) => (
            <motion.div
              key={i}
              animate={{
                width: i === step ? 32 : 8,
              }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              className="h-2 rounded-full"
              style={{
                background: i === step
                  ? `linear-gradient(135deg, ${current.color}, ${current.color}CC)`
                  : undefined,
                backgroundColor: i !== step ? 'var(--surface-2)' : undefined,
              }}
            />
          ))}
        </div>

        <Button onClick={handleNext} className="w-full h-12 text-[15px]">
          {step < onboardingSteps.length - 1 ? '下一步' : '开始使用'}
        </Button>
      </div>
    </div>
  );
}
