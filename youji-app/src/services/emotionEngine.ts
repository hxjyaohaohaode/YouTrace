import { useQuickNoteStore } from '../stores/quickNoteStore';
import { useDiaryStore } from '../stores/diaryStore';
import { formatBusinessDate } from '../utils/date';

export type EmotionState = 'normal' | 'low' | 'persistent_low' | 'crisis';

export interface EmotionAssessment {
  state: EmotionState;
  lowDays: number;
  hasCrisisKeywords: boolean;
  shouldReduceAdvice: boolean;
  shouldOnlyCompanion: boolean;
  shouldShowHotline: boolean;
}

const crisisKeywords = [
  '不想活', '活着没意思', '想死', '自杀', '跳楼', '割腕',
  '活不下去', '不想存在', '消失', '结束生命', '了结',
];

export function detectCrisisKeywords(text: string): boolean {
  return crisisKeywords.some((kw) => text.includes(kw));
}

const SEVEN_DAYS_MS = 7 * 86_400_000;

function isWithinWindow(timestamp: number): boolean {
  return Number.isFinite(timestamp) && Date.now() - timestamp < SEVEN_DAYS_MS && Date.now() - timestamp >= -SEVEN_DAYS_MS;
}

export function assessEmotionState(): EmotionAssessment {
  const diaryStore = useDiaryStore.getState();
  const quickNoteStore = useQuickNoteStore.getState();

  const recentDiaries = diaryStore.items.filter(
    (d) => isWithinWindow(d.createdAt) || isWithinWindow(d.updatedAt)
  );

  const recentNotes = quickNoteStore.records.filter((r) => isWithinWindow(r.createdAt));

  const lowMoodDiaryDays = new Set<string>();
  for (const d of recentDiaries) {
    if ((d.mood === 'low' || d.mood === 'sad' || d.mood === 'anxious') && d.moodScore < 5) {
      lowMoodDiaryDays.add(d.date);
    }
  }

  for (const r of recentNotes) {
    if (r.mood === 'low' || r.mood === 'sad' || r.mood === 'angry') {
      if (Number.isFinite(r.createdAt)) {
        lowMoodDiaryDays.add(formatBusinessDate(new Date(r.createdAt)));
      }
    }
  }

  const lowDays = lowMoodDiaryDays.size;

  const allRecentText = recentNotes
    .map((r) => r.rawInput)
    .concat(recentDiaries.map((d) => d.content))
    .join(' ');

  const hasCrisisKeywords = detectCrisisKeywords(allRecentText);

  let state: EmotionState = 'normal';
  if (hasCrisisKeywords) {
    state = 'crisis';
  } else if (lowDays >= 3) {
    state = 'persistent_low';
  } else if (lowDays >= 1) {
    state = 'low';
  }

  return {
    state,
    lowDays,
    hasCrisisKeywords,
    shouldReduceAdvice: state === 'low' || state === 'persistent_low',
    shouldOnlyCompanion: state === 'crisis',
    shouldShowHotline: state === 'crisis' || state === 'persistent_low',
  };
}

export function getCrisisResponse(): string {
  return `我很担心你。

如果你现在很难受，有专业的人可以帮到你。

全国24小时心理援助热线：400-161-9995
北京心理危机研究与干预中心：010-82951332
生命热线：400-821-1215

你不需要很"严重"才能打这个电话。
有时候就是需要一个专业的人听你说说话。

我一直在，如果你想聊，随时找我。`;
}

export function getCompanionResponse(): string {
  const responses = [
    '那就什么都不做。有时候就是会这样，没关系。今天没有什么必须做的事。如果想聊，我在。如果不想说话，也没关系。',
    '听起来你今天过得很辛苦。不想说也没关系，但如果你需要聊聊，我一直在。',
    '今天可以对自己温柔一点。不用逼自己做什么，休息也是一种力量。',
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}
