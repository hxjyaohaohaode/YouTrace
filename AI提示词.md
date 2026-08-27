# AI 代码生成提示词指南

> 如何用 AI（Cursor / Claude / Copilot）根据设计方案生成高质量代码

> ⚠️ **历史文档声明（2026-08-23）**：本文档是项目早期"用 AI 分轮生成前端 mock 原型"阶段的提示词手册。
> 项目此后已演进为前后端分离架构（React 19 + Vite + Hono + Prisma + Dexie 同步引擎），本文描述的
> 技术栈版本、导航结构、配色方案与"纯前端 mock"策略均已过时，仅作历史参考。
> 当前架构与命令请以 `youji-app/README.md` 为准；产品愿景与实现差异见 `COACH-DESIGN.md` 顶部声明。

***

## 总体策略

```
不要一步到位。分 8 轮，每轮只做一个明确的事。

每轮的结构：
  1. 角色设定（你是谁）
  2. 项目上下文（技术栈 + 目录结构）
  3. 本轮任务（具体要做什么）
  4. 设计参考（从设计文档中摘取相关章节）
  5. 质量要求（代码标准）
  6. 输出要求（文件列表 + 格式）
```

***

## 第 0 步：项目初始化 + 设计系统

```markdown
你是一个高级前端工程师，精通 React + TypeScript + Tailwind CSS。

## 项目
AI 生活教练 App（叫"有迹"），是一个响应式 Web 应用，同时适配手机端和桌面端。

## 技术栈
- React 18 + TypeScript
- Vite 6
- Tailwind CSS v4 + CSS Variables（设计令牌）
- Zustand（状态管理）
- React Router v6
- Framer Motion（动画）
- Dexie.js（IndexedDB 本地存储）
- Lucide React（图标）

## 任务
初始化项目并创建设计系统。具体包括：

1. 用 Vite 初始化 React + TypeScript 项目
2. 配置 Tailwind CSS，定义设计令牌（颜色、间距、圆角、阴影、字体）
3. 创建全局样式（reset + 基础排版）
4. 创建响应式布局壳组件：
   - 桌面端（≥1025px）：左侧固定侧边栏 240px + 右侧主内容区
   - 平板端（769-1024px）：可折叠侧边栏 + 主内容区
   - 手机端（≤768px）：底部固定 5 Tab 导航 + 主内容区
5. 创建路由配置（占位页面即可，不需要功能逻辑）

## 设计令牌

颜色（亮色）：
  --bg: #f8f9fb
  --surface: #ffffff
  --surface-2: #f1f3f5
  --border: #e5e7eb
  --text-1: #111827
  --text-2: #6b7280
  --text-3: #9ca3af
  --accent: #3b82f6
  --accent-soft: #eff6ff
  --green: #10b981
  --red: #ef4444
  --amber: #f59e0b

暗色模式：通过 [data-theme="dark"] 切换，颜色值自行推导。

间距：4px 网格（0.25rem / 0.5rem / 0.75rem / 1rem / 1.25rem / 1.5rem / 2rem / 2.5rem / 3rem）

圆角：sm 0.375rem / md 0.5rem / lg 0.75rem / xl 1rem / full 9999px

字体：系统字体栈（-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', sans-serif）

## 侧边栏结构
核心模块：🏠 首页 / 📅 日程 / 📝 日记 / 💰 花销 / ✅ 待办
更多模块：🏷️ 习惯 / 🎯 目标
底部固定：🤖 AI 教练 / ⚙️ 设置
侧边栏底部：用户头像 + 昵称

## 底部导航（手机端）
5 个 Tab：🏠 首页 / 📅 日程 / 💰 花销 / ✅ 待办 / 🤖 AI

## 要求
- 所有组件用 TypeScript，类型定义完整
- 使用 Tailwind CSS，不写自定义 CSS（设计令牌除外）
- 响应式用 useMediaQuery hook 判断断点
- 代码结构清晰，每个文件不超过 200 行
- 暗色模式支持
```

***

## 第 1 步：通用组件库

```markdown
延续上面的项目。现在创建通用 UI 组件库。

## 任务
创建以下组件（放在 src/components/ui/ 下）：

1. Button：primary / ghost / danger / icon 四种变体，sm/md 两种尺寸
2. Input：文本输入，支持 label、placeholder、错误状态
3. Modal：居中模态框（桌面端）/ 底部滑出半屏（移动端），支持标题+内容+底部按钮
4. Toast：右上角弹出，success/warning/error/info 四种类型，3s 自动消失
5. Toggle：开关切换组件
6. Chip：标签选择组件，支持 active 状态
7. ProgressBar：进度条，支持绿/黄/红三色
8. Checkbox：复选框，支持 checked 状态和动画
9. SearchBar：搜索输入框，带搜索图标
10. Skeleton：骨架屏加载组件，带 shimmer 动画

## 要求
- 每个组件一个文件
- 所有 props 用 TypeScript interface 定义
- 支持 className 扩展
- 动画用 Framer Motion
- 每个组件导出类型定义
- 组件内不包含业务逻辑
```

***

## 第 2 步：首页（教练简报）

````markdown
延续上面的项目。现在实现首页。

## 产品背景
这是一个 AI 生活教练 App，首页不是传统的数据看板，而是"每日教练简报"——
AI 根据用户数据生成的个性化洞察和建议。

## 首页结构

### 顶部问候
  "早上好，小林" + 日期 + 天气标签

### AI 教练简报卡片（核心）
  渐变背景（蓝→紫），白色文字
  内容分三块：
    📊 昨日复盘（花销/习惯/情绪）
    🔍 本周发现（跨域关联洞察）
    🎯 今日行动建议（1-3 条具体建议）
  底部按钮："和教练聊聊" / "查看完整分析"

### 快速操作区
  两个大按钮：
    🎙️ "说一句"（语音速记入口）
    📷 "拍一下"（拍照记账入口）

### 今日概览卡片（可折叠）
  📅 今日日程（最多 3 条，超出显示"还有 X 条"）
  ✅ 今日待办（最多 3 条，点击圆圈可直接完成）
  💰 今日花销（金额 + 预算进度条）
  🏷️ 今日习惯（打卡状态，点击可打卡）

### 底部
  "查看全部" 链接到各模块

## 交互
- 下拉刷新
- 卡片可折叠（记住折叠状态）
- 待办点击圆圈 → 乐观更新（立即显示完成，失败回滚）
- 习惯点击圆圈 → 直接打卡
- AI 简报卡片每日 08:00 自动生成（当前用 mock 数据）

## 数据（用 mock）
```typescript
// 放在 src/mocks/ 下
const mockBrief = {
  greeting: '早上好',
  date: '4月27日 周日',
  weather: '☀️ 26° 多云',
  yesterdayReview: {
    spent: 47,
    spentDiff: '+35%',
    habits: { done: 2, total: 3 },
  },
  weeklyInsight: '你这周有 3 天超过 12 点睡觉，每次晚睡的第二天花销都偏高。',
  todayActions: [
    '今晚 23:00 放下手机',
    '下午买奶茶前先喝杯水',
    '高数第三章建议复习 1.5h',
  ],
};

const mockSchedule = [
  { id: '1', time: '09:00', title: '高等数学', location: '教学楼301', tag: '上课', tagColor: '#3b82f6' },
  { id: '2', time: '14:00', title: '实习', location: '中关村软件园', tag: '工作', tagColor: '#f59e0b', warning: '下午有雨' },
  { id: '3', time: '19:00', title: '图书馆自习', location: '三楼', tag: '学习', tagColor: '#10b981' },
];

const mockTodos = [
  { id: '1', text: '回复导师邮件', due: '3天前', priority: 'high', done: false },
  { id: '2', text: '交高数作业', due: '明天截止', priority: 'high', done: false },
  { id: '3', text: '买洗衣液', due: '今天', priority: 'low', done: false },
];

const mockExpenses = { today: 35, monthSpent: 1860, monthBudget: 2500 };

const mockHabits = [
  { id: '1', icon: '🏃', name: '跑步30min', done: true, streak: 7 },
  { id: '2', icon: '📖', name: '背单词50个', done: true, streak: 12 },
  { id: '3', icon: '😴', name: '11点前睡觉', done: false, streak: 3 },
];
````

## 要求

- 骨架屏加载（数据加载前显示灰色占位块）
- 卡片用 Card 组件包裹
- 响应式：手机端单列，桌面端 AI 简报占满宽度，概览卡片两列
- 动画：卡片淡入（stagger），完成待办有划线+下沉动画
- 使用 Zustand store 管理首页状态

````

---

## 第 3 步：日程模块

```markdown
## 要求

- 三种视图通过顶部 Tab 切换，切换有过渡动画
- 日视图的时间轴高度固定 60px/hour
- 事件块用 absolute 定位（基于时间计算 top 和 height）
- 使用 useSchedule hook 管理数据
- 响应式：桌面端时间轴占 70% 宽度，右侧 30% 显示选中事件详情

````

---

## 第 4 步：语音速记（核心创新）

```markdown
延续上面的项目。现在实现语音速记功能。

## 产品背景
语音速记是这个 App 最核心的创新点——用户说一句话，AI 自动拆分成花销、日记、习惯、情绪等。
这是区别于所有工具类 App 的关键能力。

## 任务

### 速记输入页
- 首页的大按钮"🎙️ 说一句"点击后进入
- 输入方式：
  1. 文本输入（大文本框，自动增高）
  2. 语音输入（长按录音，松开转文字）- V1 先做文本，语音用占位
- 底部："提交"按钮

### AI 拆分结果页（提交后显示）
- 显示 AI 拆分结果，每条可确认/修改/删除
- 拆分类型：
  💰 花销：名称 + 金额 + 分类
  📝 日记内容
  😊 情绪评分
  🏷️ 习惯：名称 + 是否完成
- 每条右侧有确认 checkbox
- 用户可修改任何字段
- 底部："确认保存"按钮

### AI 拆分逻辑（V1 用规则引擎模拟，不调真实 AI）
```typescript
// src/services/parser.ts
function parseQuickNote(input: string): ParsedResult {
  // 规则引擎模拟 AI 拆分
  const expenses: ParsedExpense[] = [];
  const habits: ParsedHabit[] = [];
  let diary: string | null = null;
  let mood: string | null = null;

  // 花销：匹配 "XX数字" 或 "XX元"
  const expensePatterns = [
    /(\S+?)(\d+(?:\.\d+)?)\s*元?/g,
  ];
  // ... 实现拆分逻辑

  // 习惯：匹配已知习惯名
  const knownHabits = ['跑步', '背单词', '早睡', '读书'];
  // ... 实现检测逻辑

  // 情绪：匹配情绪关键词
  const moodKeywords = {
    happy: ['开心', '高兴', '爽', '棒'],
    sad: ['难过', '烦', '累', '丧'],
    // ...
  };

  return { expenses, diary, mood, habits };
}
````

### 数据模型

```typescript
interface ParsedExpense {
  name: string;
  amount: number;
  category: string;
  confirmed: boolean;
}

interface ParsedHabit {
  name: string;
  done: boolean;
  confirmed: boolean;
}

interface ParsedResult {
  expenses: ParsedExpense[];
  diary: string | null;
  mood: 'happy' | 'good' | 'normal' | 'low' | 'sad' | null;
  moodScore: number; // 1-10
  habits: ParsedHabit[];
}
```

## 示例

输入："今天午饭花了15，下午高数课讲了泰勒展开，晚上下雨没去跑步，有点烦"

拆分结果：
💰 午饭 ¥15（餐饮）
📝 高数课讲了泰勒展开
🏷️ 跑步：未完成
😔 情绪：低落（4/10）

## 要求

- 拆分结果用卡片展示，每种类型用不同颜色标识
- 每条可独立确认/修改/删除
- 确认后写入 Zustand store
- 页面转场动画：输入页→结果页用上滑过渡
- 规则引擎要能处理常见的口语化表达

````

---

## 第 5 步：花销模块

```markdown
延续上面的项目。现在实现花销模块。

## 任务

### 花销概览页
- 月预算卡片：已花金额 + 预算总额 + 进度条（绿<60%/黄60-80%/红>80%）
- 统计行：今日 / 本周 / 本月 三个数字
- 最近 5 条记录 + "查看全部"

### 快速记账（模态框）
- 金额输入（大字体居中）
- 分类选择（图标网格）：🍜餐饮 🚗交通 🎮娱乐 📚学习 🛒日用 💰收入 📦其他
- 备注输入
- 保存

### 花销明细页
- 按日期分组的完整记录列表
- 每条：分类图标 + 名称 + 金额
- 左滑删除

### 数据
```typescript
const mockExpensesFull = [
  { id: '1', name: '午饭', amount: 15, category: 'food', icon: '🍜', date: '今天' },
  { id: '2', name: '奶茶', amount: 12, category: 'food', icon: '🧋', date: '今天' },
  { id: '3', name: '打车', amount: 8, category: 'transport', icon: '🚗', date: '今天' },
  { id: '4', name: '晚饭', amount: 22, category: 'food', icon: '🍜', date: '昨天' },
  { id: '5', name: '电影票', amount: 45, category: 'entertainment', icon: '🎬', date: '昨天' },
  { id: '6', name: '兼职收入', amount: 200, category: 'income', icon: '💰', date: '4月25日', isIncome: true },
];
````

## 要求

- 金额存储用分（整数），显示时除以 100
- 预算进度条有过渡动画
- 添加后立即更新概览数据（乐观更新）
- 响应式：桌面端左侧概览，右侧明细

````

---

## 第 6 步：待办 + 习惯模块

```markdown
延续上面的项目。现在实现待办和习惯两个模块。

## 待办模块

### 待办列表页
- 按状态分组：🔴逾期 / 🟡今天 / 🔵本周 / ⚪更晚 / ✅已完成
- 每条：优先级色点（红/黄/绿）+ 圆圈 + 内容 + 截止日期
- 点击圆圈 → 乐观更新（勾+划线+下沉动画）
- 5s 内 toast + [撤销] 按钮
- 新建待办：模态框，内容必填，其他可选

### 数据
```typescript
const mockTodosFull = [
  { id: '1', text: '回复导师邮件', due: '3天前', dueDate: '2026-04-24', priority: 'high', done: false, overdue: true },
  { id: '2', text: '交高数作业', due: '明天截止', dueDate: '2026-04-28', priority: 'high', done: false },
  { id: '3', text: '买洗衣液', due: '今天', dueDate: '2026-04-27', priority: 'low', done: false },
  { id: '4', text: '整理实习材料', due: '本周', dueDate: '2026-04-30', priority: 'medium', done: false },
  { id: '5', text: '背单词', due: '今天', dueDate: '2026-04-27', priority: 'low', done: true },
];
````

## 习惯模块

### 习惯打卡页

- 今日习惯列表：图标 + 名称 + 连续天数 + 打卡按钮
- 点击打卡 → 弹跳动画 + 🔥
- 顶部：今日完成率百分比
- 底部：本周日历（✅/⬜）

### 数据

```typescript
const mockHabitsFull = [
  { id: '1', icon: '🏃', name: '跑步30min', streak: 7, done: true, frequency: 'daily' },
  { id: '2', icon: '📖', name: '背单词50个', streak: 12, done: true, frequency: 'daily' },
  { id: '3', icon: '😴', name: '11点前睡觉', streak: 3, done: false, frequency: 'daily' },
  { id: '4', icon: '💧', name: '喝8杯水', streak: 0, done: false, frequency: 'daily' },
];
```

## 要求

- 两个模块各自独立的 Zustand store
- 待办完成动画：圆圈变勾(scale 0.8→1) + 文字划线 + 延迟后下沉
- 习惯打卡动画：弹跳(scale 1→1.2→1) + emoji 飘出
- 空状态：待办全完成→"今天都做完了 🎉"

````

---

## 第 7 步：AI 教练对话

```markdown
延续上面的项目。现在实现 AI 教练对话模块。

## 产品背景
这不是普通的聊天机器人，是"教练对话"——AI 基于用户的数据给出个性化建议。
对话中可能包含"可执行的行动建议"，需要用户确认后执行。

## 任务

### 对话页
- 消息列表：用户消息（右侧紫色气泡）/ AI 消息（左侧白色气泡）
- 输入框：自适应高度（1-4行），Enter 发送，Shift+Enter 换行
- 🎤 语音按钮 + 📷 图片按钮（V1 占位）
- AI 回复模拟流式输出（逐字显示，50ms 间隔）

### AI Action 卡片
当 AI 回复中包含可执行操作时，渲染为卡片：
````

🤖 AI 建议以下操作：
☑ 创建待办：高数错题整理
☑ 提醒：今晚 23:00 睡觉
☐ 修改目标：攒钱进度暂缓（高影响，默认不勾）
\[确认勾选项] \[忽略全部]

````
- L2 操作默认勾选
- L3 操作默认不勾选
- 确认后显示执行状态

### 教练对话模拟（V1 不调真实 AI，用预设回复）
```typescript
const coachResponses: Record<string, string> = {
  '犯困': '我看了一下你最近两周的数据：\n\n· 平均睡觉时间 00:47，比你设定的目标 23:00 晚了近 2 小时\n· 下午 2-4 点有 3 次消费记录（奶茶/咖啡）\n\n核心问题不是"犯困"，而是"晚睡导致的白天精力不足"。\n\n我建议：\n1. 今晚试试 23:30 上床\n2. 下午犯困时用 10 分钟午睡代替咖啡\n\n要我 23:15 提醒你准备睡觉吗？',
  '花钱': '你这个月已经花了 ¥1860，预算还剩 ¥640。\n\n我注意到你每周五花销最高（平均 ¥85），主要是社交+外卖。\n\n一个建议：周五带饭，能省约 ¥40/周 = ¥160/月。\n\n你觉得可行吗？',
  'default': '你好！有什么想聊的？\n\n你可以问我：\n· "最近花销怎么样？"\n· "我最近总是犯困怎么办？"\n· "帮我安排明天的计划"',
};
````

## 要求

- 消息列表自动滚动到底部
- AI 回复用 setTimeout 模拟流式（每个字符 50ms）
- Action 卡片用独立组件渲染
- 对话历史保存在 Zustand store
- 新对话显示快捷问题 chips："今天有什么安排？""这个月花了多少？"

````

---

## 第 8 步：设置 + 数据层

```markdown
延续上面的项目。现在实现设置页和本地数据持久化。

## 设置页

### 设置项
【AI 教练】
  教练风格：温和引导 / 严格问责 / 数据驱动（三选一）
  主动推送：开关
  推送频率：每天 1-3 次

【通知】
  每日简报：开关 + 时间选择
  异常预警：开关
  习惯提醒：开关

【外观】
  主题：浅色 / 深色 / 跟随系统

【隐私与数据】
  导出所有数据（JSON）
  清除所有数据（二次确认）

## 本地数据持久化

### 用 Dexie.js 封装 IndexedDB
```typescript
// src/db/schema.ts
import Dexie from 'dexie';

const db = new Dexie('youtrace');
db.version(1).stores({
  schedules: '++id, date, tag',
  expenses: '++id, date, category',
  todos: '++id, done, dueDate, priority',
  habits: '++id',
  habitCheckins: '++id, habitId, date',
  quickNotes: '++id, timestamp',
  diary: '++id, date',
  settings: 'key',
});
````

### 数据同步策略

- 所有写操作先写 IndexedDB
- Zustand store 从 IndexedDB 加载
- 数据变更时自动保存到 IndexedDB
- 导出功能：从 IndexedDB 读取全部数据，生成 JSON 文件

## 要求

- 设置变更立即生效（主题切换即时响应）
- 数据导出包含所有模块的数据
- 清除数据需要二次确认弹窗
- 首次打开时从 IndexedDB 加载数据到 Zustand

````

---

## 通用提示词模板

当你在 Cursor/Claude 中继续开发时，用这个模板：

```markdown
## 角色
你是高级前端工程师，正在开发"有迹"AI 生活教练 App。

## 项目上下文
- 技术栈：React 18 + TypeScript + Tailwind + Zustand + Framer Motion + Dexie.js
- 设计文档：[粘贴 COACH-DESIGN.md 中相关章节]
- 现有代码：[描述当前已有的组件和结构]

## 任务
[具体要做什么]

## 参考
[从设计文档中摘取相关的交互描述、数据模型、API 设计]

## 质量要求
- TypeScript 类型完整，不用 any
- 组件拆分合理，单文件不超过 200 行
- 响应式适配（手机/平板/桌面）
- 动画流畅（Framer Motion）
- 无障碍（aria-label、键盘导航）
- 错误处理（加载状态、空状态、错误状态）

## 输出
- 列出所有需要创建/修改的文件
- 每个文件给出完整代码
- 说明文件之间的依赖关系
````

***

## 注意事项

1. **每轮只做一个模块**，不要贪多
2. **每轮都带 mock 数据**，不要依赖后端
3. **每轮都要跑通**，确认没问题再下一步
4. **把设计文档拆开喂**，不要一次丢 55KB
5. **代码风格保持一致**，每轮开始前提醒 AI 遵循已有的代码规范
6. **遇到问题立即修正**，不要累积到后面

