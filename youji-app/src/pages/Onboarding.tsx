import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Brand } from '../components/ui/Brand';
import '../styles/home-coach.css';

const onboardingSteps = [
  { title: '生活值得留下痕迹。', description: '不必先分类，也不必每天完成一张清单。记下一句话，再按你的需要整理成花销、待办、习惯或日记。' },
  { title: '先记录，再由你确认。', description: '文字或浏览器支持的语音输入，会生成可编辑的整理草稿。核对日期和内容后再保存，也可以只保留原文。' },
  { title: '按你的节奏，慢慢回看。', description: '打开应用时，可以查看基于已有记录的回顾与站内提醒。频率和免打扰都能调整；关闭应用后，目前不会主动推送。' },
  { title: '知道数据去了哪里。', description: '当前版本需要登录。输入草稿留在本机，确认的记录可同步到账号。教练消息会发给应用服务端，默认使用规则回复。只有配置本人的模型连接、同意外发范围并在本次教练页面明确选择后，才将当前文字与已披露范围的有限会话历史发给你选择的服务商，不附加应用记录，且可能产生 API 费用。' },
];
export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const finish = () => { localStorage.setItem('youji_onboarded', 'true'); navigate('/', { replace: true }); };
  return <div className="onboarding-page">
    <header><span className="editorial-eyebrow">认识有迹</span><Button variant="ghost" onClick={finish}>跳过</Button></header>
    <main className="onboarding-content" aria-live="polite">
      <Brand variant="full" />
      <p className="editorial-eyebrow">{String(step + 1).padStart(2, '0')} / 04</p>
      <h1>{onboardingSteps[step].title}</h1><p>{onboardingSteps[step].description}</p>
    </main>
    <footer><Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</Button><Button onClick={() => step < onboardingSteps.length - 1 ? setStep(step + 1) : finish()}>{step < onboardingSteps.length - 1 ? '下一步' : '开始使用'}</Button></footer>
  </div>;
}
