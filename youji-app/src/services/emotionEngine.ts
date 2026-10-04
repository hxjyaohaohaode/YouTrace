import { useQuickNoteStore } from '../stores/quickNoteStore';
import { useDiaryStore } from '../stores/diaryStore';
import { addDays, formatBusinessDate, getToday } from '../utils/date';
import { getSafetySupportResponse, hasCurrentSelfHarmCue } from '../../server/src/services/safetyResources';

export type EmotionState = 'normal' | 'low' | 'persistent_low' | 'crisis';

export interface EmotionAssessment {
  state: EmotionState;
  lowDays: number;
  hasCrisisKeywords: boolean;
  shouldReduceAdvice: boolean;
  shouldOnlyCompanion: boolean;
  shouldShowHotline: boolean;
}

// Kept as a compatibility export; this only evaluates the current message.
export const detectCrisisKeywords = hasCurrentSelfHarmCue;

const SEVEN_DAYS_MS = 7 * 86_400_000;

function isWithinWindow(timestamp: number): boolean {
  return Number.isFinite(timestamp) && Date.now() - timestamp < SEVEN_DAYS_MS && Date.now() - timestamp >= 0;
}

export function assessEmotionState(currentMessage = ''): EmotionAssessment {
  const diaryStore = useDiaryStore.getState();
  const quickNoteStore = useQuickNoteStore.getState();

  const recentDiaries = diaryStore.items.filter(
    (d) => d.date >= addDays(getToday(), -6) && d.date <= getToday()
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

  // Historical notes are context, never evidence of current imminent danger.
  // In particular, editing an old diary must not lock unrelated chat messages.
  const hasCrisisKeywords = detectCrisisKeywords(currentMessage);

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

export const getCrisisResponse = getSafetySupportResponse;

export function getCompanionResponse(): string {
  const responses = [
    '现在可以先缓一缓。如果有不能耽误的事，我们可以一起看看哪些需要保留、哪些可以延后；你也可以先说说感受。',
    '听起来你今天过得很辛苦。不想说也没关系，但如果你需要聊聊，可以在这里慢慢说。',
    '今天可以对自己温柔一点。不用逼自己做什么，休息也是一种力量。',
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}
