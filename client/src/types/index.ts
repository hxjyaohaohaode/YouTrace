export interface User {
  id: string;
  phone: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
  profile?: Profile;
}

export interface Profile {
  id: string;
  userId: string;
  preferences: string;
  aiPersona: string;
  nickname: string;
  personality: string;
  height: string;
  weight: string;
  hobbies: string;
  occupation: string;
  bio: string;
  birthday: string;
  gender: string;
  location: string;
  education: string;
  relationship: string;
  healthCondition: string;
  dietPreference: string;
  sleepSchedule: string;
  workSchedule: string;
  favoriteFoods: string;
  dislikedFoods: string;
  favoriteMusic: string;
  favoriteSports: string;
  lifeGoals: string;
  aiMemorySummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  userId: string;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentItem {
  id: string;
  originalName: string;
  fileType: string;
  mimeType: string;
  thumbnailPath: string | null;
  aiAnnotation: string;
  filePath?: string;
}

export interface Diary {
  id: string;
  userId: string;
  content: string;
  emotionScore: number;
  emotionTags: string[];
  aiInsight: string | null;
  mediaUrls: string[];
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments?: AttachmentItem[];
}

export interface EventItem {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  recurrenceRule: string | null;
  color: string | null;
  goalId: string | null;
  reminderMinutes: number;
  isAiCreated: boolean;
  aiSuggestion: string | null;
  isCourse: boolean;
  courseWeekStart: number | null;
  courseWeekEnd: number | null;
  courseDayOfWeek: number | null;
  courseStartSec: number | null;
  courseEndSec: number | null;
  courseTeacher: string | null;
  courseLocation: string | null;
  courseAdjust: string;
  isHoliday: boolean;
  holidayName: string | null;
  createdAt: string;
  updatedAt: string;
  goal?: { id: string; title: string } | null;
  hasConflict?: boolean;
  conflicts?: { id: string; title: string; startTime: string; endTime: string }[];
}

export interface Goal {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  deadline: string | null;
  progress: number;
  aiBreakdown: {
    summary: string;
    milestones: { step: number; title: string; duration: string }[];
    tips: string[];
  };
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
  eventCount?: number;
  completedEventCount?: number;
  autoProgress?: number;
}

export interface Habit {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  frequency: 'DAILY' | 'WEEKLY' | 'WEEKDAYS' | 'CUSTOM';
  targetDays: number;
  goalId: string | null;
  streakCurrent: number;
  streakLongest: number;
  createdAt: string;
  updatedAt: string;
  goal?: { id: string; title: string } | null;
  todayCompleted?: boolean;
  recentLogs?: { date: string; isCompleted: boolean }[];
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  availableTools?: string[];
  collaborationHints?: string[];
  scope?: { inScope: string[]; outOfScope: string[] };
  guardrails?: string[];
  escalationTriggers?: string[];
  handoffTargets?: { condition: string; targetAgent: string }[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

export type EventColor = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'teal' | 'pink' | 'yellow';

export const EVENT_COLORS: Record<EventColor, { bg: string; text: string; label: string }> = {
  blue: { bg: 'bg-blue-100', text: 'text-blue-700', label: '工作' },
  green: { bg: 'bg-green-100', text: 'text-green-700', label: '生活' },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700', label: '学习' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-700', label: '运动' },
  red: { bg: 'bg-red-100', text: 'text-red-700', label: '重要' },
  teal: { bg: 'bg-teal-100', text: 'text-teal-700', label: '社交' },
  pink: { bg: 'bg-pink-100', text: 'text-pink-700', label: '约会' },
  yellow: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '其他' },
};

export interface LocationInfo {
  province: string;
  city: string;
  district: string;
  adcode: string;
  formattedAddress: string;
  longitude: number | null;
  latitude: number | null;
  citycode: string;
}

export interface WeatherNow {
  obsTime: string;
  temp: string;
  feelsLike: string;
  icon: string;
  text: string;
  wind360: string;
  windDir: string;
  windScale: string;
  windSpeed: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud: string;
  dew: string;
}

export interface DailyForecast {
  fxDate: string;
  sunrise: string;
  sunset: string;
  moonrise: string;
  moonset: string;
  moonPhase: string;
  moonPhaseIcon: string;
  tempMax: string;
  tempMin: string;
  iconDay: string;
  textDay: string;
  iconNight: string;
  textNight: string;
  wind360Day: string;
  windDirDay: string;
  windScaleDay: string;
  windSpeedDay: string;
  wind360Night: string;
  windDirNight: string;
  windScaleNight: string;
  windSpeedNight: string;
  humidity: string;
  precip: string;
  pressure: string;
  vis: string;
  cloud: string;
  uvIndex: string;
}

export interface AirQuality {
  pubTime: string;
  aqi: string;
  level: string;
  category: string;
  primary: string;
  pm10: string;
  pm2p5: string;
  no2: string;
  so2: string;
  co: string;
  o3: string;
}

export interface WeatherAlert {
  id: string;
  senderName: string;
  issuedTime: string;
  messageType: { code: string; supersedes?: string[] };
  eventType: { name: string; code: string };
  urgency: string | null;
  severity: string;
  certainty: string | null;
  icon: string;
  color: { code: string; red: number; green: number; blue: number; alpha: number };
  effectiveTime: string;
  onsetTime: string;
  expireTime: string;
  headline: string;
  description: string;
  criteria: string | null;
  instruction: string | null;
}

export interface WeatherNowData {
  now: WeatherNow;
  updateTime: string;
  air: AirQuality | null;
  alerts: WeatherAlert[];
  location: LocationInfo;
}

export interface WeatherForecastData {
  daily: DailyForecast[];
  updateTime: string;
}

export interface WeatherSummaryData {
  summary: string;
  now: WeatherNow;
  air: AirQuality | null;
  alerts: WeatherAlert[];
  location: LocationInfo;
}

export interface Conversation {
  id: string;
  title: string;
  agentType: string;
  messageCount: number;
  lastMessage: { content: string; role: string; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}
