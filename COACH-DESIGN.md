# AI 生活教练 — 完整产品设计方案（优化版）

> 不是"帮你记录生活的工具"，而是"帮你过好生活的教练"。
>
> 核心区别：工具是用户来用，教练是 AI 主动找你。
>
> 版本：V3.1.1 | 日期：2026-04-29
>
> 基于 V3.0 全面审查修订，V3.1.1 增加 GitHub + Render 部署架构，修订内容见文末「附录 C」

> ⚠️ **实现现状声明（2026-08-23）**：本文是产品设计愿景文档。实际实现与本方案存在重大差异，
> 以 `youji-app/README.md` 为唯一现状基准。主要差异包括：
> 1. 技术栈为 Hono + Prisma + SQLite 自建 OTP/JWT-Cookie 认证（非 Supabase/Drizzle/Postgres）
> 2. 无 cron 定时引擎与 `/api/internal/daily-brief`；简报在用户打开应用时实时聚合
> 3. 速记拆分为本地正则引擎同步完成（无 LLM 异步拆分管线、无 parseStatus 轮询）
> 4. 无 Welch's t-test 统计置信度引擎；洞察基于确定性规则与用户真实数据，不编造统计结论
> 5. 推送为应用内消息（无浏览器 Notification / React Query 轮询）；冷启动策略采用"Day1 即有价值"
> 6. 数据模型以 `youji-app/server/prisma/schema.prisma` 为准（Diary 字符串主键、HabitCheckin 按日唯一等）
> 7. 当前同步契约见 [Sync v2](docs/SYNC_PROTOCOL.md)：客户端生成 ID，按事务变更序列拉取，游标为精确十进制字符串；updatedAt 不是游标。删除与打卡按当前版本/墓碑协议处理

---

## 零、修订前言：我们诚实面对的问题

V3.0 方案存在以下结构性问题，本版逐一修正：

| 问题 | 本质 | 修正方向 |
|------|------|---------|
| 产品复杂度与目标用户错配 | 用"需要执行力的产品"服务"缺乏执行力的人" | 分层设计：默认极简，深度可选 |
| 语音拆分可靠性被高估 | AI 准确率不够时，核心体验崩塌 | 设计降级链，拆分失败不是灾难 |
| 跨域关联缺乏统计严谨性 | 10 天数据得出的"相关性"不可信 | 引入置信度体系，明确最低数据门槛 |
| 冷启动策略过于理想化 | "前 3 天只观察不说话"会流失用户 | Day 1 就要有可感知的价值 |
| 教练引擎是愿景不是方案 | 没有规则来源、没有验证机制 | 给出具体的规则库和置信度计算 |
| 推送策略有内在矛盾 | "尊重边界"和"不可关闭"冲突 | 重新定义核心推送与可选推送 |
| 商业化缺乏可行性论证 | 定价和转化率没有依据 | 参考可比产品数据，给出保守估计 |
| 技术方案过度设计 | WebSocket、多引擎、全功能 | V1 用最简方案，验证后再扩展 |
| 文档结构缺乏优先级 | 23 章混在一起，不知道先做什么 | 明确 V1 边界，标注每个功能的版本归属 |

---

## 一、产品定义

### 1.1 一句话定义

**一个真正懂你的 AI 教练，它观察你的生活规律，主动发现你的问题，引导你做出改变。**

### 1.2 和工具类产品的本质区别

```
传统工具：
  用户打开 → 记一笔/写一条 → 看统计 → 关掉
  价值 = 数据记录 + 可视化
  粘性 = 低（换个工具一样用）

AI 教练：
  AI 持续观察你的行为 → 发现你自己没意识到的规律
  → 在合适的时机主动找你 → 给出具体的行动建议
  → 跟踪你是否执行 → 根据结果调整策略
  价值 = 洞察 + 行动改变 + 持续优化
  粘性 = 高（AI 越来越懂你，换掉成本极高）
```

### 1.3 AI 教练的三个层次

```
层级 1：记录层（被动）
  用户输入 → AI 存储整理
  "你今天花了 35 块"

层级 2：分析层（半主动）
  AI 分析历史数据 → 发现规律
  "你这个月奶茶花了 280，比上月多了 40%"

层级 3：教练层（主动）★ 核心差异化
  AI 发现规律 + 判断时机 + 主动干预 + 跟踪执行
  "你最近一周每天一杯奶茶，而且都是下午 3 点。
   我猜你是下午犯困？试试午睡 20 分钟，省下来的钱月底够买那本你收藏的书了。
   要不要我明天下午 2:45 提醒你午睡？"
```

**V1 的目标：做到层级 2 的 80% + 层级 3 的 20%。**
**V2 的目标：做到层级 3 的 60%。**

### 1.4 设计原则

```
1. 主动优先：AI 先开口，不要等用户来问
2. 跨域关联：不同模块的数据交叉分析，发现单模块看不到的规律
3. 行动导向：每次对话必须导向一个具体可执行的行动
4. 渐进信任：先给小洞察建立信任，再给大建议
5. 尊重边界：用户可以设定"不打扰"时段和话题禁区
6. 输入极简：用户说一句话/拍一张照，AI 做剩下的
7. 优雅降级：AI 做不到时，退化为好用的工具，而不是瘫痪的教练
8. 诚实反馈：AI 不确定时说"我不确定"，不编造洞察
```

> **新增第 7、8 条**：V3.0 假设 AI 总能正确工作，但现实是 AI 会犯错。
> "优雅降级"和"诚实反馈"是确保产品在 AI 不完美时仍然可用的底线。

---

## 二、目标用户

### 2.1 用户分层：不是所有大学生都一样

> **V3.0 修订**：原方案把"大学生"当作单一画像，但实际上大学生群体内部差异巨大。
> 我们需要识别**最可能留存的种子用户**，而不是试图服务所有大学生。

```
层级 A：高意愿高执行力（5%）
  · 已经在用多个管理工具（日历/记账/习惯App）
  · 缺的是"整合"和"洞察"
  · → 最容易留存，但不是核心用户（他们自己就能搞定）

层级 B：高意愿低执行力（25%）★ 核心用户
  · 知道该做什么，但总是做不到
  · 试过很多 App，都坚持不下来
  · 需要外部力量帮助执行
  · → 教练模式的最佳受众

层级 C：低意愿低执行力（60%）
  · 觉得自己"还行"，没有强烈改变动力
  · 可能被朋友推荐或广告吸引
  · → 大部分会在 1 周内流失，不要为他们设计

层级 D：低意愿高执行力（10%）
  · 生活已经很规律，不需要教练
  · → 不是目标用户
```

**核心用户精确画像（层级 B）**：

```
典型画像：
  · 大二/大三，成绩中等偏下
  · 每月花超预算 1-2 次
  · 想养成好习惯（早起/运动/背单词），最长坚持过 1-2 周
  · 情绪波动大，焦虑但说不清原因
  · 试过 3+ 个管理类 App，没有一个用超过 1 个月

核心痛点：
  不是"没有工具记录生活"
  而是"没有人帮我管住自己"

关键特征：
  · 对"被管"有矛盾心理——既想被管，又讨厌被管
  · 对"说教"极度敏感——任何"你应该"都会触发反感
  · 对"即时反馈"依赖——等不了 4 周才看到效果
```

> **设计含义**：这意味着产品必须在**第 1 天就提供可感知的价值**，
> 不能让用户等 2 周。同时，"教练"的语气必须极其小心——
> 不是老师，不是家长，更像是"一个比你稍微靠谱一点的朋友"。

### 2.2 用户生命周期（修订版）

> **V3.0 修订**：原方案的"第1周记录阶段"不可接受——用户等不了1周。

```
Day 1：首次价值交付（关键！）
  · 速记拆分让用户感到"AI 真的在理解我"
  · 通用洞察给出第一条有用信息（基于身份，不基于个人数据）
  · 今日待办/日程一目了然
  · 目标：用户觉得"这个 App 挺聪明"

Day 2-3：习惯雏形
  · 用户开始习惯"有事说一句"
  · AI 给出 1-2 条基于 2-3 天数据的简单观察（单维度，非跨域）
  · 目标：用户形成"打开 App → 看简报 → 随手记"的肌肉记忆

Day 4-7：首次惊喜
  · AI 给出第一个有价值的单维度洞察
  · 格式："我注意到……"而不是"你应该……"
  · 目标：用户觉得"它确实在观察我"

Day 8-14：信任萌芽
  · 第一个跨域关联（必须是高置信度的）
  · 用户开始主动和 AI 对话
  · 目标：用户觉得"这个 AI 有点东西"

Day 15-30：习惯形成
  · 每日简报成为起床后第一个看的东西
  · AI 建议开始被采纳
  · 目标：用户觉得"没有它我都不知道怎么安排了"
```

---

## 三、核心体验：每天的"教练时刻"

### 3.1 产品不是"打开看数据"，而是"AI 来找你"

```
传统 App 的使用场景：
  用户想到 → 打开 App → 看看有什么 → 关掉
  频率：想起来才用，一周 2-3 次

AI 教练的使用场景：
  场景 1：早上推送"今日教练简报"（每天 1 次，核心触达点）
  场景 2：AI 发现异常时主动推送（每周 2-4 次，非强制）
  场景 3：用户遇到问题时主动问 AI（按需）
  场景 4：用户随手记录（每天 1-3 次，核心数据来源）
```

### 3.2 每日教练简报（核心产品形态）

**每天早上 8:00 推送，这是用户打开产品的主入口：**

```
┌──────────────────────────────────────┐
│  ☀️ 早上好，小林                        │
│  今天是周三，4月27日                     │
│                                      │
│  ── 今日教练简报 ──                    │
│                                      │
│  📊 昨日复盘                            │
│  · 花了 ¥47（比平时多 35%）             │
│  · 原因：买了电影票 ¥45                 │
│  · 习惯：跑步 ✅ 背单词 ✅ 早睡 ❌       │
│                                      │
│  🔍 本周发现                            │
│  · 你这周已经 3 次超过凌晨 12 点睡觉     │
│  · 每次晚睡的第二天，你的花销都会偏高     │
│  · 我猜：晚睡 → 白天困 → 用消费提神      │
│                                      │
│  🎯 今日行动建议                        │
│  · ① 今晚 11:00 放下手机（我来提醒你）   │
│  · ② 下午买奶茶前，先喝杯水             │
│  · ③ 高数第三章还弱，建议下午复习 1.5h   │
│                                      │
│  💬 [和教练聊聊]  [查看完整分析]          │
└──────────────────────────────────────┘
```

**简报的降级方案（数据不足时）**：

> **V3.0 修订**：原方案没有考虑数据不足时简报内容是什么。
> 这是冷启动期最常见的场景，必须有明确的 fallback。

```
数据量         简报内容
─────────────────────────────────────────────
0 天（新用户）  通用洞察 + 引导记录 + 设定目标
1-3 天         单维度事实（"你这2天花了¥84"）+ 鼓励记录
4-7 天         单维度模式（"你有3天是12点后睡的"）
7-14 天        首个跨域洞察（高置信度才推）
14 天+         完整教练简报
```

### 3.3 AI 主动推送（教练干预）

不是每天固定推送，而是 **AI 发现异常时主动找你**：

```
触发条件与推送示例：

花销异常：
  连续 3 天超日均预算 50%
  → "你最近 3 天每天花了 60+，是有什么特别的开销吗？
     这个月预算还剩 ¥340，按这个速度月底会超支 ¥200。"

情绪低落：
  日记连续 2 天情绪评分 < 5
  → "你这两天看起来不太开心。不想说也没关系，
     但如果需要聊聊，我一直在。
     要不要我帮你把今天的安排简化一下，给自己减减压？"

习惯中断：
  跑步习惯连续中断 3 天（之前连续 7 天）
  → "跑步断了 3 天了。之前连续 7 天很棒！
     断了不可怕，关键是重新开始。
     今天跑 15 分钟就行，比不做强。要定个提醒吗？"

跨域关联：
  发现"每次考试前一周花销暴增"
  → "我注意到你每次考试前都会花很多钱（零食+咖啡）。
     下周有期中考，要不要提前准备点健康零食？
     我帮你列个清单？"

正向反馈：
  连续 7 天 12 点前睡觉
  → "连续 7 天早睡！🔥 你知道吗，这周你的
     日记情绪平均分比上周高了 1.2 分。
     早睡真的在起作用，继续保持！"
```

### 3.4 用户主动问 AI

用户遇到问题时，随时可以找 AI 教练：

```
用户："我最近总是犯困怎么办？"

AI 教练（不是泛泛而谈，而是基于你的数据）：
  "我看了一下你最近两周的数据：
   · 平均睡觉时间 00:47，比你设定的目标 23:00 晚了近 2 小时
   · 下午 2-4 点有 3 次消费记录（奶茶/咖啡），说明你在用咖啡因提神
   · 你的高数课在上午 9 点，但有 2 次迟到 10 分钟

   核心问题不是'犯困'，而是'晚睡导致的白天精力不足'。

   我建议分两步：
   1. 今晚试试 23:30 上床（比现在提前 1 小时，比目标晚 30 分钟，更容易做到）
   2. 下午犯困时用 10 分钟午睡代替咖啡

   要不要我 23:15 提醒你准备睡觉？"
```

---

## 四、模块设计

### 4.1 设计理念转变

```
工具方案的模块：
  日程 / 日记 / 花销 / 待办 / 习惯 / 目标 → 6 个独立功能

教练方案的模块：
  数据输入层（用户做的事）→ 教练引擎（AI 的大脑）→ 教练输出层（AI 给你的）

  数据输入层：
    · 语音速记（替代日记+快记+待办）
    · 拍照记账（替代手动记账）
    · 日程（保留，但简化）
    · 手动打卡（习惯）

  教练引擎：
    · 跨域数据分析
    · 模式识别
    · 时机判断
    · 建议生成

  教练输出层：
    · 每日教练简报
    · 主动推送
    · AI 对话
    · 行动追踪
```

### 4.2 数据输入：语音速记（核心创新）

**不是"写日记"，不是"记账"，不是"加待办"——而是"说一句话，AI 帮你分好类"。**

```
场景：用户随时随地，说一句话或打一行字

输入："今天午饭花了 15，下午高数课讲了泰勒展开，
      晚上想去跑步但下雨了没去，有点烦"

AI 自动拆分：
  💰 花销：午饭 ¥15（餐饮）
  📝 日记：高数课讲泰勒展开
  🏷️ 习惯：跑步未完成（天气原因，不计中断）
  😔 情绪：有点烦（可能和未完成跑步有关）
  📅 日程关联：高数课已完成

用户只需要说一句话，AI 做了 5 件事。

这就是"教练"和"工具"的区别：
  工具需要你分别打开 4 个模块，填 4 次表
  教练只需要你说一句话
```

#### 4.2.1 速记的可靠性设计（V3.0 缺失，本版新增）

> **V3.0 的致命缺陷**：原方案假设 AI 拆分总是正确的，没有设计错误处理。
> 事实上，语音拆分是整个产品的**单点故障**——拆分错误会导致数据污染，
> 数据污染会导致洞察错误，洞察错误会导致用户信任崩塌。

**拆分准确率预期（基于当前 LLM 能力的保守估计）**：

```
拆分维度      预期准确率    容错策略
───────────────────────────────────────────
花销提取      85%         金额错误可修正，遗漏可补
情绪判断      70%         允许用户不标记，不强制
习惯检测      80%         二元判断（做了/没做），相对简单
日程关联      60%         依赖日程数据匹配，经常误判
日记归类      90%         只要不是空文本就算对
```

**三层容错机制**：

```
第 1 层：拆分时——置信度标记
  AI 对每个拆分结果给出置信度（高/中/低）
  · 高置信度（>0.8）：直接采信，用户可事后修改
  · 中置信度（0.5-0.8）：标记为"待确认"，在速记确认页高亮
  · 低置信度（<0.5）：标记为"AI 不确定"，要求用户手动分类

第 2 层：确认时——极简确认流
  速记确认页设计原则：
  · 不是"逐条确认 5 个拆分结果"（太累了）
  · 而是"只确认 AI 不确定的"（通常 0-1 条）
  · 确认操作 = 一次点击（不是填写表单）
  · 用户可以"全部跳过"——系统会使用原始文本，不拆分

第 3 层：事后——随时修正
  · 任何拆分结果都可以事后修改
  · 修改操作 = 点击 → 选择正确分类（最多 2 步）
  · 用户修正数据时，AI 不会追问"为什么要改"
  · 累计修正记录用于优化拆分模型（不展示给用户）
```

**速记输入的 fallback 设计**：

```
当用户不想说话/不方便说话时：
  → 文字输入（默认支持）
  → 快捷标签（"午饭15"直接变成花销，不需要AI拆分）
  → 手动记账入口（直接打开记账表单）

当 AI 拆分服务不可用时（网络问题/服务超时）：
  → 保存原始文本，标记为"待拆分"
  → 后台重试（最多 3 次，间隔 1 分钟）
  → 重试失败后，提示用户"这条记录我暂时拆不开，
     你可以手动分类，或者等网络恢复后我再试"
  → 绝不丢失用户的原始输入
```

### 4.3 日程模块（简化版）

保留日程，但**砍掉复杂功能**：

```
保留：
  · 日/周/月视图
  · 课表导入（OCR）
  · 事件创建（简化表单）
  · 提醒

砍掉：
  · 复杂重复规则 → 只保留"每周重复"
  · POI 搜索 → 直接文本输入
  · 多标签系统 → 只保留类型（上课/自习/实习/其他）
  · 拖拽调整 → V2 再做

新增（教练特性）：
  · AI 根据你的状态调整建议："今天状态不好，建议把自习改成休息"
  · 考试前自动提醒："期末还有 21 天，高数第三章还弱"
  · 时间分析："你这周在社交媒体上花了约 12 小时"
```

### 4.4 花销模块（极简）

```
核心变化：从"记账工具"变成"消费教练"

用户输入：
  · 语音："午饭15 奶茶12" → AI 自动拆分
  · 拍照：拍午饭照片 → AI 识别名称（不估价，用户填金额）
  · 速记：在语音速记里顺带提到 → AI 自动提取
  · 手动：直接打开记账表单（fallback）

教练功能（核心差异）：
  · 消费模式识别："你每周五花销最高（社交+外卖）"
  · 情绪消费检测："心情不好的日子，你的花销平均高 40%"
  · 预算预测："按目前速度，月底会超支 ¥200"
  · 替代建议："每天一杯奶茶 ¥12 = 每月 ¥360 = 一双球鞋"
  · 收入洞察："你兼职的时薪是 ¥25，一杯奶茶 = 你工作 30 分钟"
```

### 4.5 习惯模块（教练驱动）

```
核心变化：从"打卡工具"变成"习惯教练"

传统打卡：用户手动打勾 → 看连续天数
习惯教练：

  1. 习惯建立
     用户说"我想养成跑步的习惯"
     AI："好。我们先从小目标开始——每周 2 次，每次 15 分钟。
         不要一上来就每天跑，坚持不了的。
         你觉得周几跑比较合适？"

  2. 智能检测
     · 日程有"运动"事件 → 自动打卡（L2 确认）
     · 语音速记提到"跑步了" → 自动打卡
     · 连续 3 天未打卡 → 不是惩罚，而是 AI 分析原因

  3. 中断恢复（核心教练能力）
     传统 App：断了就断了，连续天数归零，用户直接放弃
     AI 教练：
       "跑步断了 3 天了。之前连续 7 天很棒！
        我看了一下，断的 3 天都是下雨天。
        要不要加一个室内替代方案？比如室内跳绳 10 分钟？
        这样下雨天也不会断。"

  4. 阶梯式提升
     连续 2 周每周 2 次 → "要不要试试每周 3 次？"
     连续 4 周稳定 → "试试每次跑 20 分钟？"
     不是一步到位，而是 AI 根据你的节奏渐进提升
```

### 4.6 日记模块（融入语音速记）

```
核心变化：从"写日记"变成"AI 帮你回忆今天"

传统日记：用户打开 → 写 → 保存
AI 教练日记：

  方式 1：语音速记（全天随手说）
    用户随时说一句话 → AI 自动归类到日记
    晚上 AI 汇总今天所有速记 → 生成日记草稿

  方式 2：晚间回顾（AI 主动推送）
    晚上 9:00 AI 推送：
    "今天你提到了高数课和跑步，还有什么想记录的吗？"
    用户回复一句话 → AI 补全成完整日记

  方式 3：AI 全自动（最高级）
    AI 根据今天的日程+花销+速记+习惯 → 自动生成日记
    用户只需要确认/修改/补充

  情绪追踪：
    · 每次速记时 AI 自动判断情绪（置信度<0.5时标记为"不确定"）
    · 每天汇总情绪评分
    · 长期追踪情绪趋势
    · 发现情绪与行为的关联
    · 情绪数据不足时，不展示情绪趋势图（而非展示误导性数据）
```

### 4.7 AI 对话（教练核心）

```
这不是"聊天机器人"，这是"教练对话"。

对话类型：

  1. 教练主动发起（推送后用户点进来继续聊）
     AI："你最近花销有点高，要不要聊聊？"
     用户："是啊，总是忍不住买奶茶"
     AI："我注意到你买奶茶的时间集中在下午 2-3 点。
         你是因为困了想喝，还是习惯性地想喝点什么？"

  2. 用户主动提问
     用户："我最近总是焦虑"
     AI："我注意到你最近一周的日记里有 4 次提到'焦虑'。
         同时你的平均睡觉时间推迟到了 1 点，
         花销也比平时多了 30%（主要是零食）。
         这三个信号经常一起出现——
         睡眠不足会放大焦虑感。
         你愿意试试这周每天提前 30 分钟睡觉吗？"

  3. 行动跟踪
     AI："上周你说要每天 12 点前睡觉，这周做到了 4 天。
         没做到的 3 天都是周末。
         周末是不是更容易刷手机到很晚？
         要不要周末设一个 23:00 的'放下手机'提醒？"

教练对话的原则：
  · 永远基于用户的真实数据，不泛泛而谈
  · 每次对话必须导向一个具体可执行的行动
  · 不评判，不说教，只分析和建议
  · 尊重用户说"不"的权利
  · AI 不确定时说"我不确定"，不编造洞察
  · 数据不足时坦诚说"我还需要更多数据才能判断"
```

---

## 五、AI 教练引擎

### 5.1 教练框架

```
AI 教练不是"有问必答的聊天机器人"，
而是遵循一个结构化的教练框架：

观察（Observe）
  → 持续收集用户行为数据
  → 花销/日程/习惯/情绪/语音速记

发现（Discover）
  → 识别模式和异常
  → 跨域关联分析
  → "晚睡 → 次日高花销"

判断（Assess）
  → 这个发现值得告诉用户吗？（置信度 > 阈值？）
  → 时机合适吗？（不在免打扰时段？不情绪低落？）
  → 用户当前状态能接受建议吗？（最近接受度如何？）
  → 最近推过类似的吗？（去重）

干预（Intervene）
  → 选择合适的干预方式
  → 推送通知 / 每日简报 / 对话
  → 给出具体可执行的建议
  → 不确定时标注"这是我猜的，不一定对"

跟踪（Track）
  → 用户是否执行了建议（通过后续数据推断，不追问）
  → 执行后效果如何
  → 根据反馈调整策略
  → 用户修正数据时，更新模型置信度

循环：跟踪结果 → 更新观察 → 新的发现 → ...
```

### 5.2 跨域关联分析（核心能力）

这是 AI 教练和普通工具最大的区别——**不同模块的数据交叉分析**。

> **V3.0 修订**：原方案的"相关性矩阵"是概念图，不是可执行方案。
> 本版给出具体的关联规则、数据门槛、置信度计算。

#### 5.2.1 关联规则库（V1 预置规则）

> **这些规则是 V1 的起点**，基于行为科学文献和生活经验预置，
> 随着用户数据积累，由数据验证或修正。

```
规则 1：睡眠-消费关联
  条件：睡觉时间 > 00:00 的次日
  观察：次日花销 vs 基线花销
  最低数据量：7 天有效数据（至少 3 天晚睡 + 3 天正常）
  置信度计算：(晚睡日均消费 - 正常日均消费) / 正常日均消费
  置信度阈值：差异 > 20% 且 p-value < 0.1（样本少时用 Fisher 精确检验）
  输出：如果置信度达标 → "你晚睡的日子，第二天花销平均高 X%"
  降级：数据不足 → 不输出此关联，不猜测

规则 2：情绪-消费关联
  条件：情绪评分 < 5 的日子
  观察：低情绪日的花销 vs 基线花销
  最低数据量：10 天有效数据（至少 3 天低情绪）
  置信度阈值：差异 > 25% 且 p-value < 0.1
  输出："心情不太好的日子，你花的钱会多一些"
  降级：情绪数据不足 → 跳过此规则

规则 3：运动-情绪关联
  条件：运动习惯打卡完成的日子
  观察：运动日的情绪评分 vs 非运动日
  最低数据量：14 天有效数据（至少 4 次运动）
  置信度阈值：差异 > 0.5 分（10 分制）且 p-value < 0.15
  输出："运动的日子，你的心情平均好 X 分"
  降级：运动数据不足 → 跳过

规则 4：考试-压力关联
  条件：日程中有"考试"类事件的前 7 天
  观察：考前 vs 非考期的情绪、花销、睡眠
  最低数据量：至少经历过 2 次考试周期
  置信度阈值：至少 2 个维度有显著差异
  输出："每次考试前，你的 XX 都会变化"
  降级：没有考试数据 → 跳过

规则 5：社交-情绪关联
  条件：花销中有"社交"类（聚餐/娱乐）
  观察：社交日 vs 非社交日的情绪
  最低数据量：14 天，至少 3 次社交
  输出："和朋友出去的日子，你的心情通常比较好"
```

#### 5.2.2 置信度计算引擎

```typescript
interface ConfidenceResult {
  score: number;          // 0-1
  method: string;         // 使用的统计方法
  sampleSize: number;     // 有效样本数
  isSignificant: boolean; // 是否达到阈值
  caveat?: string;        // 附加说明（如"样本较少，建议继续观察"）
}

function calculateConfidence(
  treatmentGroup: number[],  // 实验组数据（如晚睡日花销）
  controlGroup: number[],    // 对照组数据（如正常日花销）
  minSampleSize: number,     // 最低样本量
  significanceLevel: number  // 显著性水平
): ConfidenceResult {
  // 1. 样本量检查
  if (treatmentGroup.length < 3 || controlGroup.length < 3) {
    return {
      score: 0,
      method: 'insufficient_data',
      sampleSize: treatmentGroup.length + controlGroup.length,
      isSignificant: false,
      caveat: '数据不足，至少需要更多天的记录才能判断'
    };
  }

  // 2. 效应量计算（Cohen's d）
  const meanDiff = mean(treatmentGroup) - mean(controlGroup);
  const pooledStd = pooledStandardDeviation(treatmentGroup, controlGroup);
  const cohensD = meanDiff / pooledStd;

  // 3. 统计检验（Welch's t-test，不假设等方差）
  const tStat = welchTTest(treatmentGroup, controlGroup);
  const pValue = tDistPValue(tStat, degreesOfFreedom);

  // 4. 置信度得分
  const isSignificant = pValue < significanceLevel;
  const sampleAdequacy = Math.min(
    (treatmentGroup.length + controlGroup.length) / (minSampleSize * 2),
    1
  );
  const effectSizeScore = Math.min(Math.abs(cohensD) / 0.8, 1); // 0.8 = 大效应
  const score = isSignificant ? (0.5 + 0.3 * effectSizeScore + 0.2 * sampleAdequacy) : 0;

  return {
    score,
    method: 'welch_t_test',
    sampleSize: treatmentGroup.length + controlGroup.length,
    isSignificant,
    caveat: sampleAdequacy < 0.7 ? '样本量较少，结论可能不够稳定' : undefined
  };
}
```

#### 5.2.3 关联分析的"不做什么"

> **这是防止 AI 胡说八道的关键**。

```
绝对不做：
  · 样本量 < 3 时不做任何关联分析
  · 不做 A→B→C 的多跳因果推断（只做 A↔B 的相关性）
  · 不在用户情绪低落时推送负面洞察（"你又超支了"）
  · 不推已经被用户否定了的关联（用户说"不准"→ 降权该规则）
  · 不推无法行动的洞察（"你周一心情最差"——然后呢？没有行动建议就不推）

必须标注：
  · "这是基于你 X 天数据的观察"（提醒用户样本量）
  · "这只是相关性，不一定是因果"（第一次推关联时）
  · "如果这个发现不准，请告诉我，我会调整"（附带反馈入口）
```

### 5.3 教练人格（不是"人设"，是"教练风格"）

```
工具方案的"人设"：换一种说话风格（温暖/毒舌/理性）
教练方案的"教练风格"：换一种教练策略

风格 A：温和引导型（默认）
  "你最近睡得比较晚，要不要试试提前 30 分钟上床？"
  策略：建议为主，不施压

风格 B：严格问责型
  "你说过这周要 12 点前睡，但已经失败 3 天了。
   什么原因？我们得解决这个问题。"
  策略：强调承诺和执行

风格 C：数据驱动型
  "根据你过去 30 天的数据，睡眠时间与次日花销
   呈负相关（r=-0.47）。改善睡眠预计可减少
   月花销约 ¥150。建议优先解决睡眠问题。"
  策略：用数据说话，不带情感

切换规则：
  · 用户可手动切换
  · AI 根据用户响应自动调整（用户连续忽略 3 次建议 → 切换为温和型）
  · 情绪低落时自动切到温和型
  · 默认风格：温和引导型（对大学生群体最安全）
```

---

## 六、数据联动规则

### 6.1 数据流

```
语音速记 ──→ AI 拆分 ──→ 日记内容
  │           │           │
  │           │           └──→ 情绪评分（带置信度）
  │           │
  │           ├──→ 花销记录
  │           ├──→ 待办提取
  │           └──→ 习惯检测
  │
  └──→ 教练引擎燃料

日程 ──→ 时间块分析
  └──→ 习惯关联（运动事件→运动打卡）

花销 ──→ 消费模式
  └──→ 情绪消费检测
  └──→ 预算预测

习惯 ──→ 行为模式
  └──→ 情绪关联
  └──→ 中断恢复

全部数据 ──→ 教练引擎 ──→ 洞察 + 建议 + 推送
```

### 6.2 触发规则

| 发现 | 数据源 | 触发条件 | 干预方式 | 最低数据量 |
|------|--------|---------|---------|-----------|
| 晚睡 | 习惯（睡觉时间）| 连续 3 天 > 00:00 | 每日简报 + 推送 | 7 天 |
| 超支 | 花销 | 日花销 > 日均 150% 连续 3 天 | 推送 | 7 天 |
| 情绪消费 | 花销+情绪 | 情绪低 + 花销高（置信度>0.6）| 推送 | 14 天 |
| 习惯中断 | 习惯 | 连续中断 ≥ 3 天 | 推送 | 7 天连续记录 |
| 考试压力 | 日程+情绪 | 考前 7 天 + 焦虑信号 | 每日简报 | 2 次考试周期 |
| 运动效果 | 习惯+情绪 | 运动日情绪高（置信度>0.6）| 正向反馈推送 | 14 天 |
| 跨域异常 | 多模块 | 多指标同时异常 | 推送 + 建议对话 | 14 天 |

### 6.3 干预频率控制

```
规则：
  · 每日简报：每天 1 次（固定 08:00，可自定义）——核心体验，不建议关闭
  · 异常预警推送：每天最多 2 次
  · 正向反馈推送：每天最多 1 次
  · 异常+正向合计：每天最多 3 次
  · 用户设置"免打扰"时段：所有推送静默
  · 用户连续忽略 3 次 → 推送频率减半（持续 7 天后恢复）
  · 用户连续忽略 7 次 → 暂停所有非核心推送 3 天
  · 用户明确说"别烦我" → 24h 内只保留每日简报
  · 用户关闭某类推送 → 永不恢复，除非用户手动开启

关于"每日简报不可关闭"的说明：
  每日简报是产品的核心触达方式，关闭等于退出产品体验。
  但用户可以选择"静音"（不推送通知，但 App 内仍可查看）。
  这是一个折中：尊重用户的同时保留产品价值。
```

---

## 七、技术架构

### 7.1 技术栈（V1，面向 GitHub + Render 部署）

> **V3.1 修订**：技术栈针对 GitHub + Render 部署环境做了全面适配。
> Render Free Tier 核心约束：
> · Web 服务 15 分钟无流量自动休眠（~1 分钟冷启动恢复）
> · Free Postgres 30 天过期且仅 1GB → **不可用于生产**
> · 不支持 Cron Jobs、不支持 WebSocket（休眠时连接断开）
> · 750 实例小时/月、服务发起大量外部流量可能被暂停
> 以下所有技术选型均基于这些约束做出。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        整体架构                                     │
│                                                                     │
│  ┌──────────────┐     HTTPS      ┌──────────────┐    API    ┌─────┐│
│  │  Render       │ ─────────────→ │  Render       │ ───────→ │Supa-││
│  │  Static Site  │  (免费)        │  Web Service  │  (Free)  │base ││
│  │  (前端 SPA)   │ ←───────────── │  (Hono API)   │ ←─────── │ DB  ││
│  └──────────────┘     JSON        └──────────────┘          └─────┘│
│        │                               │                           │
│        │                               │ 调用                       │
│        │                               ▼                           │
│        │                      ┌──────────────┐                     │
│        │                      │  外部 LLM API │                     │
│        │                      │  (Qwen/通义)  │                     │
│        │                      └──────────────┘                     │
│        │                                                           │
│        │  浏览器端                                                  │
│        ├── Web Speech API（语音识别，免费，浏览器原生）               │
│        ├── Notification API（推送通知）                             │
│        └── localStorage（离线暂存速记，联网后同步）                  │
│                                                                     │
│  ┌──────────────┐                                                  │
│  │ cron-job.org  │ 每天 08:00 GET /api/internal/daily-brief        │
│  │ (免费外部cron) │ → 唤醒休眠服务 + 触发教练引擎                    │
│  └──────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### 前端技术栈（V1）

```
核心框架：
  React 18 + TypeScript + Vite 6
  ——Vite 构建产物是纯静态文件，部署到 Render Static Site（免费）

样式：
  Tailwind CSS v4 + CSS Variables
  ——原子化 CSS，构建产物小，首屏加载快

状态管理：
  Zustand（全局状态，轻量无模板代码）
  React Query（服务端数据缓存 + 轮询 + 离线重试）
  ——React Query 的 refetchInterval 天然适配"轮询"策略

动画：
  Framer Motion ——仅核心交互（页面切换、卡片展开），不做过度动画

图表：
  Recharts（轻量，适合移动端）

语音输入：
  Web Speech API（浏览器端，免费，无需后端）
  ——V1 不用 Whisper/ASR，前端直接调浏览器 API
  ——识别结果为文本后，发送到后端做 AI 拆分
  ——兼容性：Chrome/Edge 支持好，Safari 部分支持
  ——不支持时 fallback 到文字输入
  ——V2 可选接入 Whisper 提升准确率

推送：
  浏览器 Notification API（需用户授权）
  ——V1 不做 APNs/FCM，用浏览器原生通知
  ——结合轮询：每 5 分钟检查新推送，有新推送时弹通知

离线暂存：
  localStorage（速记暂存，联网后批量同步）
  ——V1 不做 IndexedDB 完整离线方案
```

#### 后端技术栈（V1）

```
框架：
  Node.js 20 + Hono（超轻量 Web 框架，冷启动快）
  ——Hono 包体积小，适合 Render Free Tier 的冷启动场景

数据库：
  Supabase PostgreSQL（免费层：500MB，不过期）
  ——⚠️ 绝对不用 Render Free Postgres（30 天过期，不适合生产）
  ——Supabase 免费层无过期限制，500MB 足够 V1 用户量
  ——连接方式：Supabase 提供的 connection string 直连

ORM：
  Drizzle ORM（类型安全、轻量、无运行时开销）
  ——drizzle-kit 管理 schema migration（npm run db:push）
  ——不用 Prisma（太大，冷启动慢，不适合 Free Tier）

认证：
  Supabase Auth（免费层：50,000 月活用户）
  ——支持手机号验证码登录（符合设计要求）
  ——不用自建 JWT 认证系统

定时任务：
  外部 Cron（cron-job.org，免费）
  ——Render Free Tier 不支持 Cron Jobs
  ——cron-job.org 每天定时 GET 你的 API endpoint
  ——请求到达时 Render 自动唤醒服务（~1 分钟冷启动）
  ——详见 7.7 部署架构

推送策略：
  HTTP 轮询，不用 WebSocket
  ——前端 React Query：refetchInterval: 5 * 60 * 1000（5 分钟）
  ——适合 Render Free Tier 的休眠/唤醒模式
  ——WebSocket 在服务休眠时会断开，不可靠

文件存储：
  Supabase Storage（免费层：1GB）
  ——用于存储用户头像等小文件
  ——V1 不做大量文件上传
```

#### AI 技术栈（V1）

```
LLM 服务：
  阿里云百炼（Qwen 系列）——主力
  ——Qwen-Plus：输入 ¥0.8/百万 tokens，输出 ¥2/百万 tokens
  ——性价比极高，V1 用户量下月成本 < ¥50
  ——通过 HTTP API 调用，后端代理（不暴露 key 给前端）

  备选：DeepSeek V3（更便宜，中文能力好）
  ——输入 ¥1/百万 tokens，输出 ¥2/百万 tokens

语音识别：
  V1：Web Speech API（浏览器端，免费，零后端成本）
  V2：Whisper API（更准确，$0.006/分钟）

图片识别（V2）：
  Qwen-VL（拍照记账场景）

教练引擎：
  自建规则引擎（TypeScript，详见 5.2.1）
  + LLM 生成文案（调 Qwen API，仅生成自然语言文案，不做决策）
  ——规则引擎做决策（哪些洞察推给用户），LLM 做表达（把洞察说得好听）
  ——这样 LLM 调用次数少，成本低
```

#### 成本估算（V1，100 用户/月）

```
┌──────────────────────┬───────────────────┐
│ 项目                  │ 月成本             │
├──────────────────────┼───────────────────┤
│ Render Static Site   │ $0（免费）          │
│ Render Web Service   │ $0（Free Tier）     │
│ Supabase DB          │ $0（免费层）        │
│ Supabase Auth        │ $0（免费层）        │
│ Supabase Storage     │ $0（免费层）        │
│ Qwen API（LLM）      │ ~¥30-50（约 $5-7） │
│ cron-job.org         │ $0（免费）          │
│ 域名（可选）          │ ~¥60/年            │
├──────────────────────┼───────────────────┤
│ 合计                  │ ~$5-7/月           │
└──────────────────────┴───────────────────┘

LLM 调用拆解（100 用户/月）：
  · 每日简报生成：100×30×~1000 tokens ≈ 3M tokens
  · 速记拆分：100×10条/天×30×~500 tokens ≈ 15M tokens
  · 教练对话：100×3轮/天×30×~800 tokens ≈ 7.2M tokens
  · 总计 ≈ 25M tokens/月
  · Qwen-Plus：输入 ¥0.8/M + 输出 ¥2/M → 约 ¥30-50/月
```

### 7.2 V1 不做的事情（明确边界）

```
以下功能在 V1 明确不做，避免范围蔓延：

不做离线模式：
  · V1 需要网络才能使用
  · 速记在无网络时保存到本地，联网后同步（简单 localStorage）
  · 不做 IndexedDB 完整离线方案

不做实时推送：
  · V1 用 HTTP 轮询（每 5 分钟），不用 WebSocket
  · 每日简报在用户打开 App 时拉取，不依赖推送通知
  · 推送通知用浏览器 Notification API（需用户授权）

不做拍照记账：
  · V1 只支持语音/文字速记和手动记账
  · 拍照识别是 V2 功能

不做多端同步：
  · V1 是单设备（手机浏览器 PWA）
  · 数据在服务端，换设备登录即可，不需要复杂同步协议

不做自定义教练风格：
  · V1 固定"温和引导型"
  · 风格切换是 V2 功能

不做桌面小组件：
  · V2 功能

不做复杂图表：
  · V1 只做必要的数据展示（花销趋势、习惯连续天数）
  · 不做热力图、相关性矩阵可视化等高级图表
```

### 7.3 核心数据模型（修订版）

> **V3.0 修订**：修正了类型定义中的问题，增加了状态字段和错误处理。

```typescript
// ═══ 用户 ═══
interface User {
  id: string;
  phone: string;
  nickname: string;
  avatar: string;
  identity: string;           // 大一/大二/大三/大四/研究生
  city: string;
  coachStyle: 'gentle' | 'strict' | 'data';  // V1 固定 'gentle'
  quietHours: { start: string; end: string } | null;
  dailyBriefTime: string;     // 简报时间，默认 "08:00"
  pushEnabled: boolean;       // 是否开启推送通知
  createdAt: number;
  updatedAt: number;
}

// ═══ 语音速记（核心实体）═══
interface QuickNote {
  id: string;
  userId: string;
  content: string;            // 原始输入
  inputType: 'voice' | 'text' | 'quick';  // 输入方式
  timestamp: number;          // 输入时间
  parseStatus: 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
  parsed: ParsedResult | null; // AI 拆分结果（parseStatus=done 时有值）
  parseError?: string;        // 拆分失败原因
  confirmed: boolean;         // 用户是否已确认
  userCorrections?: ParsedResult; // 用户修正后的结果
}

interface ParsedResult {
  expenses: ParsedExpense[];
  diary: string | null;
  mood: MoodType | null;
  moodConfidence: number;     // 0-1，情绪判断的置信度
  todos: string[];
  habits: ParsedHabit[];
  schedule: ParsedSchedule | null;
  overallConfidence: number;  // 整体拆分置信度
}

type MoodType = 'happy' | 'good' | 'normal' | 'low' | 'sad' | 'angry' | 'anxious';

interface ParsedExpense {
  name: string;
  amount: number;             // 分
  category: string;
  confidence: number;         // 0-1
}

interface ParsedHabit {
  name: string;
  done: boolean;
  confidence: number;
}

interface ParsedSchedule {
  title: string;
  time?: string;
  confidence: number;
}

// ═══ 日程 ═══
interface ScheduleEvent {
  id: string;
  userId: string;
  title: string;
  date: string;               // YYYY-MM-DD
  startTime: string;          // HH:mm
  endTime: string;            // HH:mm
  type: 'class' | 'study' | 'work' | 'social' | 'exam' | 'other';
  location: string;
  repeat: 'none' | 'weekly';
  remind: number;             // 提前 N 分钟提醒
  createdAt: number;
  updatedAt: number;
}

// ═══ 花销 ═══
interface Expense {
  id: string;
  userId: string;
  amount: number;             // 分（整数，避免浮点精度问题）
  category: string;           // 餐饮/零食/交通/娱乐/学习/社交/其他
  name: string;
  date: string;               // YYYY-MM-DD
  source: 'voice' | 'photo' | 'manual' | 'ai';
  quickNoteId?: string;       // 来源速记 ID（如果是从速记拆分的）
  relatedMood?: MoodType;     // 关联情绪
  createdAt: number;
}

// ═══ 习惯 ═══
interface Habit {
  id: string;
  userId: string;
  name: string;
  icon: string;
  frequency: 'daily' | 'weekly';  // V1 只支持 daily
  targetPerWeek?: number;     // 每周目标次数（用于习惯教练）
  sortOrder: number;
  createdAt: number;
  archivedAt?: number;        // 归档时间（用户放弃或完成后）
}

interface HabitCheckIn {
  id: string;
  habitId: string;
  date: string;               // YYYY-MM-DD
  done: boolean;
  source: 'manual' | 'ai' | 'schedule';
  aiReason?: string;          // AI 检测依据
  aiConfidence?: number;      // AI 检测置信度
  confirmed: boolean;         // 用户是否确认（AI 来源时需要）
}

// ═══ 日记 ═══
interface DiaryEntry {
  id: string;
  userId: string;
  date: string;               // YYYY-MM-DD
  content: string;
  mood: MoodType | null;
  moodScore: number;          // 1-10
  moodSource: 'manual' | 'ai' | 'quicknote_aggregated';
  source: 'manual' | 'ai_generated' | 'quicknote_aggregated';
  quickNoteIds: string[];     // 来源速记
  aiInsight?: string;
  createdAt: number;
  updatedAt: number;
}

// ═══ 教练洞察 ═══
interface CoachInsight {
  id: string;
  userId: string;
  type: 'pattern' | 'anomaly' | 'correlation' | 'positive' | 'suggestion';
  title: string;
  description: string;
  dataSources: string[];      // ['expense', 'habit', 'mood']
  confidence: number;         // 0-1，洞察的置信度
  ruleId?: string;            // 产生此洞察的规则 ID
  sampleSize: number;         // 基于多少天的数据
  caveat?: string;            // 附加说明（如"样本较少"）
  actionSuggested?: string;
  actionTaken?: boolean;      // 用户是否执行了建议
  actionResult?: string;      // 执行后的效果（后续数据推断）
  dismissed: boolean;         // 用户是否忽略了此洞察
  userFeedback?: 'helpful' | 'not_helpful' | 'inaccurate';  // 用户反馈
  createdAt: number;
}

// ═══ 教练推送 ═══
interface CoachPush {
  id: string;
  userId: string;
  insightId?: string;
  type: 'daily_brief' | 'anomaly' | 'follow_up' | 'positive';
  title: string;
  body: string;
  actions: PushAction[];
  read: boolean;
  acted: boolean;
  createdAt: number;
}

interface PushAction {
  label: string;
  type: 'confirm' | 'dismiss' | 'snooze' | 'chat' | 'feedback';
  payload?: any;
}

// ═══ AI 对话 ═══
interface ChatSession {
  id: string;
  userId: string;
  triggerType: 'user_initiated' | 'push_response' | 'daily_brief';
  triggerInsightId?: string;
  createdAt: number;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'coach' | 'system';
  content: string;
  actions?: CoachAction[];
  createdAt: number;
}

interface CoachAction {
  type: string;
  description: string;
  payload: any;
  confirmed: boolean;
}
```

### 7.4 教练引擎架构

```
┌─────────────────────────────────────────────┐
│                 教练引擎                      │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 数据聚合  │  │ 模式识别  │  │ 干预决策  │  │
│  │          │  │          │  │          │  │
│  │ · 日汇总  │  │ · 规则引擎│  │ · 时机判断│  │
│  │ · 周汇总  │  │ · 统计检验│  │ · 频率控制│  │
│  │ · 月汇总  │  │ · 置信度  │  │ · 方式选择│  │
│  └──────────┘  └──────────┘  └──────────┘  │
│        │              │              │       │
│        └──────────────┴──────────────┘       │
│                       │                      │
│              ┌────────────────┐              │
│              │   洞察生成器    │              │
│              │                │              │
│              │ · 文案生成     │              │
│              │ · Action 提案  │              │
│              │ · 正向反馈     │              │
│              │ · 降级处理     │              │
│              └────────────────┘              │
│                       │                      │
│              ┌────────────────┐              │
│              │   推送调度器    │              │
│              │                │              │
│              │ · 频率控制     │              │
│              │ · 免打扰检查   │              │
│              │ · 优先级排序   │              │
│              │ · 去重         │              │
│              └────────────────┘              │
└─────────────────────────────────────────────┘
```

### 7.5 教练引擎调度

```typescript
// 教练引擎核心调度（每日运行）
async function dailyCoachRun(userId: string) {
  // 1. 数据聚合
  const today = await aggregateDay(userId);
  const week = await aggregateWeek(userId);
  const month = await aggregateMonth(userId);

  // 2. 数据量检查——数据不足时的降级策略
  const dataDays = getValidDataDays(userId);
  if (dataDays < 3) {
    // 不做任何分析，只返回通用洞察
    const generalInsights = await getGeneralInsights(userId);
    await sendDailyBrief(userId, today, [], generalInsights);
    return;
  }

  // 3. 模式识别（规则引擎，每条规则自带最低数据量检查）
  const patterns = await detectPatterns(userId, week, month);
  const anomalies = await detectAnomalies(userId, today, week);

  // 4. 跨域关联分析（仅在数据充足时执行）
  let correlations: Correlation[] = [];
  if (dataDays >= 14) {
    correlations = await findCorrelations(userId, month);
  }

  // 5. 生成洞察（带置信度过滤）
  const allInsights = [...patterns, ...anomalies, ...correlations];
  const insights = allInsights
    .map(i => ({
      ...i,
      confidence: calculateConfidence(i.treatmentData, i.controlData, i.minSample, 0.1)
    }))
    .filter(i => i.confidence.isSignificant)         // 统计显著
    .filter(i => i.confidence.score > 0.5)            // 置信度阈值
    .filter(i => !recentlyPushed(i, userId))           // 最近没推过
    .filter(i => !userDismissed(i, userId))            // 用户没否定过
    .sort((a, b) => b.confidence.score - a.confidence.score)
    .slice(0, 3);                                      // 最多 3 条

  // 6. 生成每日简报
  const brief = await generateDailyBrief(today, week, insights);
  await saveDailyBrief(userId, brief);

  // 7. 存储洞察
  for (const insight of insights) {
    await saveInsight(userId, insight);
  }
}

// 异常检测（实时，速记提交后触发）
async function onQuickNoteCreated(userId: string, note: QuickNote) {
  // 1. 更新今日数据
  await updateDailyStats(userId, note);

  // 2. 检查是否触发异常预警
  const today = await aggregateDay(userId);
  const week = await aggregateWeek(userId);
  const anomalies = await detectAnomalies(userId, today, week);

  // 3. 频率检查——今天已经推过异常预警了吗？
  const todayPushes = await getTodayPushCount(userId, 'anomaly');
  if (todayPushes >= 2) return; // 今天已经推过 2 次了

  // 4. 免打扰检查
  if (isQuietHours(userId)) return;

  // 5. 推送高置信度异常
  for (const anomaly of anomalies.filter(a => a.urgent && a.confidence.score > 0.7)) {
    await sendAnomalyPush(userId, anomaly);
  }
}
```

### 7.6 API 设计（修订版）

> **V3.0 修订**：补充了错误处理、分页、速率限制。

```
认证：
  POST /api/auth/send-code        → {success}
  POST /api/auth/verify           → {token, user}
  POST /api/auth/refresh          → {token}
  错误：429 (发送太频繁), 400 (验证码错误)

速记：
  POST /api/quicknote              {content, inputType, timestamp}
    → {note: QuickNote}            // 立即返回，parseStatus=pending
    → 异步拆分，前端轮询 GET /api/quicknote/:id 获取结果
  GET  /api/quicknote/:id          → {note}（含 parseStatus 和 parsed）
  PUT  /api/quicknote/:id/confirm  {confirmed, corrections?}
  GET  /api/quicknote?date=        → {notes[]}
  速率限制：30 条/分钟

日程：
  GET    /api/schedules?date=&view=    → {events[]}
  POST   /api/schedules                → {event}
  PUT    /api/schedules/:id            → {event}
  DELETE /api/schedules/:id            → {success}
  POST   /api/schedules/import         FormData{image} → {events[]}（V2）

花销：
  GET    /api/expenses?month=          → {expenses[], stats}
  POST   /api/expenses                 → {expense}
  POST   /api/expenses/batch           {items[]} → {expenses[]}
  GET    /api/expenses/stats?month=    → {stats}

习惯：
  GET    /api/habits                   → {habits[]}
  POST   /api/habits                   → {habit}
  PATCH  /api/habits/:id/check         {done, date} → {checkIn}
  GET    /api/habits/stats?week=       → {stats}

日记：
  GET    /api/diary?month=             → {entries[]}
  GET    /api/diary/:id                → {entry}
  POST   /api/diary/generate           {date} → {entry}（AI 生成）

教练：
  GET    /api/coach/brief?date=        → {brief}（今日简报）
  GET    /api/coach/insights?limit=    → {insights[]}
  POST   /api/coach/insights/:id/dismiss → {success}
  POST   /api/coach/insights/:id/feedback {feedback: 'helpful'|'not_helpful'|'inaccurate'}
  GET    /api/coach/pushes?unread=     → {pushes[]}
  PATCH  /api/coach/pushes/:id/read    → {success}

AI 对话：
  POST   /api/chat                     {sessionId?, message}
    → {sessionId, reply}              // V1 同步返回，不做 SSE 流式
  GET    /api/chat/sessions            → {sessions[]}
  GET    /api/chat/sessions/:id/messages → {messages[]}
  速率限制：20 条/分钟（防止滥用 LLM 资源）

全局：
  · 所有需要认证的接口：Header Authorization: Bearer <token>
  · 所有列表接口支持 ?limit=&offset= 分页
  · 所有写接口返回完整对象（不是只返回 id）
  · 错误响应格式：{error: string, code: string, details?: any}
```

### 7.7 Render 部署架构（V3.1 新增）

> **这是把设计文档变成可运行产品的关键章节。**
> 所有设计决策都必须在这个部署约束下可行。

#### 7.7.1 Render 服务拓扑

```
GitHub 仓库
  │
  │  git push main
  ▼
┌─────────────────────────────────────────────────────┐
│  Render Dashboard                                    │
│                                                      │
│  Service 1: youtrace-static (Static Site)            │
│    · 构建命令：cd frontend && npm run build           │
│    · 发布目录：frontend/dist                          │
│    · 实例类型：Free                                   │
│    · 自定义域名：youtrace.app（可选）                  │
│    · 职责：托管 React SPA                             │
│                                                      │
│  Service 2: youtrace-api (Web Service)               │
│    · 构建命令：cd backend && npm run build            │
│    · 启动命令：node dist/index.js                     │
│    · 实例类型：Free                                   │
│    · 环境变量：见 7.7.3                               │
│    · 职责：所有 API + 教练引擎 + LLM 调用             │
│                                                      │
│  外部服务：                                           │
│    · Supabase：PostgreSQL + Auth + Storage            │
│    · cron-job.org：每日定时唤醒 + 触发教练引擎         │
│    · 阿里云百炼：LLM API                              │
└─────────────────────────────────────────────────────┘
```

#### 7.7.2 解决 Render Free Tier 的 7 个致命问题

```
问题 1：Free Postgres 30 天过期
  ✅ 解决：不用 Render Postgres，用 Supabase（免费 500MB，不过期）
  迁移路径：如果后续用户量大，可升级 Supabase 或迁移到 Render paid Postgres

问题 2：服务 15 分钟无流量自动休眠
  ✅ 解决：
    · 用户打开前端 → 前端请求 API → 自动唤醒（~1 分钟冷启动）
    · 冷启动期间前端展示 loading 动画 + "正在连接教练..."
    · cron-job.org 每天定时 ping → 确保教练引擎按时运行

问题 3：不支持 Cron Jobs（教练引擎无法定时运行）
  ✅ 解决：
    · 方案 A（推荐）：cron-job.org（免费，支持自定义时间）
      - 每天 07:55 GET https://youtrace-api.onrender.com/api/internal/daily-brief
      - 请求到达 → 服务唤醒 → 执行教练引擎 → 生成简报 → 存入 DB
      - 用户 08:00 打开 App → 拉取已生成的简报（秒开，无需等待 AI）
    · 方案 B：客户端触发
      - 用户打开 App 时，前端检查"今日简报是否已生成"
      - 如果未生成（cron 失败或服务休眠中），前端调用 /api/coach/brief
      - 后端实时生成（用户需等待 3-5 秒，可接受）
    · 两个方案并行，确保简报总能生成

问题 4：不支持 WebSocket
  ✅ 解决：完全用 HTTP 轮询替代
    · 简报/推送：React Query refetchInterval: 5min
    · 速记拆分状态：提交后 2s/4s/8s 递增轮询（最多 3 次）
    · 教练对话：同步请求（V1 不做流式输出）
    · V2 再考虑 SSE（Server-Sent Events，比 WebSocket 更适合 Render）

问题 5：750 实例小时/月
  ✅ 解决：
    · Free Tier 服务休眠时不消耗实例小时
    · 用户活跃时段（早 8-晚 12）≈ 16 小时/天 × 30 = 480 小时
    · 如果用户分散在不同时段，实际消耗更低
    · 极端情况：如果 750 小时不够 → 升级到 Render Starter ($7/月)
    · 监控：在 Render Dashboard 查看 Usage，接近上限时邮件提醒

问题 6：服务发起大量外部流量可能被暂停
  ✅ 解决：
    · LLM API 调用走 HTTPS（正常 API 流量，不会触发限制）
    · 限制单次 LLM 调用的 token 数（max_tokens: 1000）
    · 教练引擎批量处理（不每个用户单独调 LLM）
    · 如果被暂停 → 升级到 Render paid plan

问题 7：冷启动 ~1 分钟影响用户体验
  ✅ 解决：
    · 前端：冷启动期间展示品牌 loading 页（Logo + "正在唤醒教练..."）
    · 首次请求：设置合理超时（30s），超时后展示"服务启动中，请稍候"
    · 优化后端冷启动：
      - Hono 框架本身启动快（<1s）
      - 数据库连接池预创建（drizzle + pg driver）
      - LLM API 不预连接（按需调用）
```

#### 7.7.3 环境变量配置

```
# Supabase
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# LLM
QWEN_API_KEY=sk-...
QWEN_MODEL=qwen-plus
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Auth
JWT_SECRET=[auto-generated-32-chars]

# App
APP_URL=https://youtrace.app
API_URL=https://youtrace-api.onrender.com
NODE_ENV=production

# Internal Cron（保护 endpoint 不被外部调用）
CRON_SECRET=[auto-generated-16-chars]

# Push（V2）
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
```

#### 7.7.4 Cron-Job.org 配置

```
Job 1：每日教练简报
  URL：https://youtrace-api.onrender.com/api/internal/daily-brief
  Method：GET
  Header：Authorization: Bearer ${CRON_SECRET}
  Schedule：每天 07:55 UTC+8（提前 5 分钟，给 AI 生成留时间）
  Timeout：120 秒（LLM 生成可能需要 30-60 秒）

Job 2：健康检查（防止 Render Free Tier 长时间休眠后冷启动太慢）
  URL：https://youtrace-api.onrender.com/api/health
  Method：GET
  Schedule：每 6 小时
  作用：保持服务温热，减少用户打开时的冷启动概率
```

#### 7.7.5 CI/CD 流水线

```
GitHub Actions（免费 2000 分钟/月）：

触发条件：push to main

步骤：
  1. Lint + Type Check
     npm run lint && npm run typecheck

  2. 测试（V1 写关键路径的集成测试即可）
     npm test

  3. 构建前端
     cd frontend && npm run build

  4. 构建后端
     cd backend && npm run build

  5. 部署（Render 自动从 GitHub main 分支部署）
     ——Render 监听 main 分支，push 后自动触发部署
     ——不需要额外的部署步骤

分支策略：
  · main → 自动部署到 Render
  · develop → PR 触发 lint + test，不部署
  · feature/* → PR 触发 lint + test
```

### 7.8 GitHub 项目结构（V3.1 新增）

```
youtrace/
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI
├── frontend/                      # React SPA
│   ├── src/
│   │   ├── app/                   # 路由 + 布局
│   │   │   ├── App.tsx
│   │   │   ├── routes.tsx
│   │   │   └── layouts/
│   │   ├── features/              # 按功能模块组织
│   │   │   ├── auth/              # 登录/注册
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   ├── RegisterPage.tsx
│   │   │   │   └── authStore.ts
│   │   │   ├── coach/             # 教练简报 + 对话
│   │   │   │   ├── BriefPage.tsx   # 首页：每日简报
│   │   │   │   ├── ChatPage.tsx    # 教练对话
│   │   │   │   └── coachApi.ts
│   │   │   ├── quicknote/         # 语音速记
│   │   │   │   ├── QuickNoteInput.tsx  # 速记输入组件
│   │   │   │   ├── QuickNoteConfirm.tsx # 拆分确认
│   │   │   │   └── quicknoteApi.ts
│   │   │   ├── expense/           # 花销
│   │   │   │   ├── ExpensePage.tsx
│   │   │   │   ├── ExpenseList.tsx
│   │   │   │   └── expenseApi.ts
│   │   │   ├── habit/             # 习惯
│   │   │   │   ├── HabitPage.tsx
│   │   │   │   ├── HabitCard.tsx
│   │   │   │   └── habitApi.ts
│   │   │   └── settings/          # 设置
│   │   │       ├── SettingsPage.tsx
│   │   │       ├── ProfileSection.tsx
│   │   │       ├── NotificationSection.tsx
│   │   │       └── DataSection.tsx
│   │   ├── shared/                # 共享组件
│   │   │   ├── components/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Loading.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   ├── ErrorState.tsx
│   │   │   │   └── BottomNav.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.ts
│   │   │   │   ├── useVoiceInput.ts
│   │   │   │   └── usePolling.ts
│   │   │   └── utils/
│   │   │       ├── api.ts         # fetch wrapper + 错误处理
│   │   │       ├── format.ts      # 金额/日期格式化
│   │   │       └── storage.ts     # localStorage wrapper
│   │   ├── styles/
│   │   │   └── globals.css        # Tailwind + 自定义 CSS 变量
│   │   └── main.tsx
│   ├── public/
│   │   ├── manifest.json          # PWA
│   │   └── sw.js                  # Service Worker（V2）
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
├── backend/                       # Hono API Server
│   ├── src/
│   │   ├── index.ts               # 入口 + Hono app
│   │   ├── routes/                # 路由定义
│   │   │   ├── auth.ts
│   │   │   ├── quicknote.ts
│   │   │   ├── expense.ts
│   │   │   ├── habit.ts
│   │   │   ├── coach.ts
│   │   │   ├── chat.ts
│   │   │   └── internal.ts        # cron 触发的内部路由（需 CRON_SECRET）
│   │   ├── services/              # 业务逻辑
│   │   │   ├── quicknote.service.ts   # 速记拆分
│   │   │   ├── expense.service.ts
│   │   │   ├── habit.service.ts
│   │   │   ├── coach.service.ts       # 教练引擎核心
│   │   │   ├── chat.service.ts        # LLM 对话
│   │   │   └── llm.service.ts         # LLM 调用封装
│   │   ├── engine/                # 教练引擎
│   │   │   ├── rules/             # 预置规则
│   │   │   │   ├── sleep-expense.rule.ts
│   │   │   │   ├── mood-expense.rule.ts
│   │   │   │   ├── exercise-mood.rule.ts
│   │   │   │   ├── exam-stress.rule.ts
│   │   │   │   └── social-mood.rule.ts
│   │   │   ├── confidence.ts      # 置信度计算
│   │   │   ├── aggregator.ts      # 数据聚合
│   │   │   ├── scheduler.ts       # 推送调度
│   │   │   └── index.ts           # 教练引擎入口
│   │   ├── db/                    # 数据库
│   │   │   ├── schema.ts          # Drizzle schema（所有表定义）
│   │   │   ├── migrations/        # 自动生成的迁移文件
│   │   │   └── index.ts           # DB 连接实例
│   │   └── lib/                   # 工具库
│   │       ├── auth.ts            # Supabase Auth 中间件
│   │       ├── errors.ts          # 统一错误处理
│   │       ├── logger.ts          # 日志
│   │       └── rate-limit.ts      # 速率限制
│   ├── drizzle.config.ts
│   ├── tsconfig.json
│   └── package.json
├── shared/                        # 前后端共享类型
│   └── types.ts                   # 接口类型定义
├── docs/                          # 文档
│   ├── COACH-DESIGN.md            # 本设计文档
│   ├── API.md                     # API 文档
│   └── DEPLOY.md                  # 部署指南
├── .env.example                   # 环境变量模板
├── .gitignore
├── README.md
└── package.json                   # monorepo 根（npm workspaces）
```

#### 7.8.1 关键文件说明

```
backend/src/services/llm.service.ts
  ——封装所有 LLM 调用，统一处理：
    · 请求超时（30s）
    · 重试（最多 2 次，指数退避）
    · token 计数和限制
    · 错误分类（API 错误 vs 超时 vs 配额不足）
    · 降级（LLM 不可用时返回默认值）

backend/src/engine/confidence.ts
  ——置信度计算引擎（对应 5.2.2 的代码）
  ——纯函数，易于测试

backend/src/engine/rules/*.rule.ts
  ——每条规则是独立文件，导出统一接口：
    · name: string
    · minDataDays: number
    · check(data: UserAggregate): Promise<RuleResult | null>
  ——新增规则 = 新增文件，不修改其他代码

backend/src/routes/internal.ts
  ——cron-job.org 调用的内部路由
  ——校验 CRON_SECRET header
  ——触发 dailyCoachRun()
  ——返回执行结果（成功/失败/用户数）

frontend/src/features/quicknote/QuickNoteInput.tsx
  ——核心交互组件，必须处理以下状态：
    · idle：等待输入
    · recording：录音中（Web Speech API）
    · processing：发送到后端拆分中
    · done：拆分完成，展示结果
    · error：拆分失败，展示 fallback
  ——语音识别的浏览器兼容性检测 + fallback

frontend/src/shared/components/EmptyState.tsx
  ——每个模块的空状态组件
  ——props：icon, title, description, actionLabel, onAction
  ——统一的空状态设计，避免每个页面单独写

frontend/src/shared/components/ErrorState.tsx
  ——每个模块的错误状态组件
  ——props：error, onRetry, fallbackAction
  ——统一的错误处理 UI
```

> **V3.0 修订**：原方案 18 页全部标为 V1，但实际不可能 10 周做完。
> 本版明确标注 V1/V2，并补充了缺失的错误状态和空状态设计。

### V1 核心页面（10 页，8-10 周可完成）

| # | 页面 | 说明 | 优先级 |
|---|------|------|--------|
| P-01 | 启动页 + 引导页 | Logo + 3 屏介绍（合并为 1 页） | P0 |
| P-02 | 登录/注册 | 手机号 + 验证码 | P0 |
| P-03 | 新手引导 | 身份 + 预算 + 初始习惯（极简，3 步完成） | P0 |
| P-04 | 首页（教练简报）| 每日简报 + 速记入口 + 快捷操作 | P0 |
| P-05 | 语音速记 | 核心输入页面（语音/文字） | P0 |
| P-06 | 速记确认 | AI 拆分结果确认（极简确认流） | P0 |
| P-07 | 花销页 | 概览 + 明细 + 教练洞察 | P1 |
| P-08 | 习惯页 | 打卡 + 教练建议 | P1 |
| P-09 | AI 教练对话 | 教练对话 + 行动跟踪 | P1 |
| P-10 | 设置 | 账号/通知/隐私/数据管理 | P1 |

### V1 补充页面（3 页，错误/空状态）

| # | 页面 | 说明 |
|---|------|------|
| P-11 | 错误状态页 | 网络断开/服务不可用/加载失败 |
| P-12 | 空状态页 | 花销无数据/习惯无数据/日记无数据 |
| P-13 | 引导记录页 | 首次打开各模块时的引导（"说一句话试试"） |

### V2 页面（7 页，验证 V1 后再做）

| # | 页面 | 说明 | 为什么推到 V2 |
|---|------|------|--------------|
| P-14 | 日程-日视图 | 时间轴 | V1 不做日程模块，用速记+手动记录 |
| P-15 | 日程-周/月视图 | 周网格/月历 | 同上 |
| P-16 | 添加/编辑日程 | 简化表单 | 同上 |
| P-17 | 课表导入 | OCR / 文本 / 手动 | 依赖 OCR 准确率 |
| P-18 | 日记页 | AI 生成 + 时间线 | V1 用速记代替 |
| P-19 | 教练洞察列表 | 所有洞察 | V1 只在简报中展示 |
| P-20 | 数据仪表盘 | 花销/习惯/情绪趋势图 | V1 只做简单统计 |

**V1 总计：13 页**（10 核心 + 3 补充），聚焦"速记→拆分→简报→教练对话"核心链路。

### 页面状态设计（V3.0 完全缺失）

**每个页面的三种状态**：

```
状态 1：正常态（有数据）
  · 展示完整内容
  · 正常交互

状态 2：空态（无数据）
  · 不是展示空白页面
  · 展示引导用户操作的插画 + 文案
  · 示例（花销页空态）：
    "还没有记录过花销哦"
    "试试在首页说一句'午饭花了15'"
    [去记录] 按钮

状态 3：错误态（加载失败/网络断开/服务异常）
  · 不是展示"出错了"三个字
  · 展示具体错误原因 + 重试按钮 + 离线降级（如有）
  · 示例（速记拆分失败）：
    "AI 暂时拆不开这条记录"
    "你可以手动分类，或者等会儿再试"
    [手动分类] [稍后重试] 按钮
```

---

## 八、页面清单与 V1/V2 边界

> **V3.0 修订**：原方案 18 页全部标为 V1，但实际不可能 10 周做完。
> 本版明确标注 V1/V2，并补充了缺失的错误状态和空状态设计。

### V1 核心页面（10 页，8-10 周可完成）

| # | 页面 | 说明 | 优先级 |
|---|------|------|--------|
| P-01 | 启动页 + 引导页 | Logo + 3 屏介绍（合并为 1 页） | P0 |
| P-02 | 登录/注册 | 手机号 + 验证码 | P0 |
| P-03 | 新手引导 | 身份 + 预算 + 初始习惯（极简，3 步完成） | P0 |
| P-04 | 首页（教练简报）| 每日简报 + 速记入口 + 快捷操作 | P0 |
| P-05 | 语音速记 | 核心输入页面（语音/文字） | P0 |
| P-06 | 速记确认 | AI 拆分结果确认（极简确认流） | P0 |
| P-07 | 花销页 | 概览 + 明细 + 教练洞察 | P1 |
| P-08 | 习惯页 | 打卡 + 教练建议 | P1 |
| P-09 | AI 教练对话 | 教练对话 + 行动跟踪 | P1 |
| P-10 | 设置 | 账号/通知/隐私/数据管理 | P1 |

### V1 补充页面（3 页，错误/空状态）

| # | 页面 | 说明 |
|---|------|------|
| P-11 | 错误状态页 | 网络断开/服务不可用/加载失败 |
| P-12 | 空状态页 | 花销无数据/习惯无数据/日记无数据 |
| P-13 | 引导记录页 | 首次打开各模块时的引导（"说一句话试试"） |

### V2 页面（7 页，验证 V1 后再做）

| # | 页面 | 说明 | 为什么推到 V2 |
|---|------|------|--------------|
| P-14 | 日程-日视图 | 时间轴 | V1 不做日程模块，用速记+手动记录 |
| P-15 | 日程-周/月视图 | 周网格/月历 | 同上 |
| P-16 | 添加/编辑日程 | 简化表单 | 同上 |
| P-17 | 课表导入 | OCR / 文本 / 手动 | 依赖 OCR 准确率 |
| P-18 | 日记页 | AI 生成 + 时间线 | V1 用速记代替 |
| P-19 | 教练洞察列表 | 所有洞察 | V1 只在简报中展示 |
| P-20 | 数据仪表盘 | 花销/习惯/情绪趋势图 | V1 只做简单统计 |

**V1 总计：13 页**（10 核心 + 3 补充），聚焦"速记→拆分→简报→教练对话"核心链路。

### 页面状态设计（V3.0 完全缺失）

**每个页面的三种状态**：

```
状态 1：正常态（有数据）
  · 展示完整内容
  · 正常交互

状态 2：空态（无数据）
  · 不是展示空白页面
  · 展示引导用户操作的插画 + 文案
  · 示例（花销页空态）：
    "还没有记录过花销哦"
    "试试在首页说一句'午饭花了15'"
    [去记录] 按钮

状态 3：错误态（加载失败/网络断开/服务异常）
  · 不是展示"出错了"三个字
  · 展示具体错误原因 + 重试按钮 + 离线降级（如有）
  · 示例（速记拆分失败）：
    "AI 暂时拆不开这条记录"
    "你可以手动分类，或者等会儿再试"
    [手动分类] [稍后重试] 按钮
```

---

## 九、与工具方案的对比

| 维度 | 工具方案（V2） | 教练方案（V3） |
|------|-------------|-------------|
| 产品定位 | 6 合 1 生活管理工具 | AI 生活教练 |
| 用户打开原因 | "我要记一笔/看日程" | "AI 今天跟我说了什么" |
| 核心页面 | 6 个模块首页 | 教练简报（1 个） |
| AI 角色 | 辅助功能 | 核心引擎 |
| 数据输入 | 6 个入口分别输入 | 语音速记 1 个入口 |
| 粘性来源 | 数据积累 | AI 越来越懂你 |
| 竞品 | 滴答清单/随手记/Flomo... | Noom/Woebot/Fabulous（间接） |
| 页面数 | 22 | 13（V1）|
| 差异化 | 弱（功能多但不精） | **强（主动教练是独特价值）** |
| 付费意愿 | 低（工具可替代） | 高（教练不可替代） |

---

## 十、开发路线图（修订版，面向 GitHub + Render 部署）

> **V3.1 修订**：路线图针对 GitHub + Render 部署做了调整。
> 增加了每个阶段的部署验证步骤，确保"写完就能跑"。

### V1 阶段（12 周，核心链路验证）

```
Phase 1（第 1-2 周）基础设施 ✅ 先让项目跑起来
  · monorepo 初始化（npm workspaces：frontend/ + backend/ + shared/）
  · Supabase 项目创建（获取 connection string + anon key）
  · Render 服务创建（Static Site + Web Service）
  · GitHub Actions CI 配置（lint + typecheck + build）
  · 环境变量配置（Render Dashboard + .env.example）
  · Hono "Hello World" 部署到 Render（验证部署流程通）
  · Drizzle schema 设计（Users + QuickNotes 表）
  · npm run db:push（创建数据库表）
  · Supabase Auth 集成（手机号验证码登录）
  · 登录/注册页面（前端）
  → 目标：用户可以注册、登录、看到空白首页

Phase 2（第 3-5 周）速记 + 教练简报 ✅ 核心产品链路
  · 语音速记输入组件（Web Speech API + 文字 fallback）
  · 速记拆分 API（POST /api/quicknote → LLM 拆分 → 存储）
  · 速记确认页面（极简确认流）
  · 三层容错机制（置信度标记 + 待确认 + 跳过）
  · 花销模块（手动记账 + 速记拆分入库）
  · 习惯模块（手动打卡 + 速记检测）
  · cron-job.org 配置（每日 07:55 触发 /api/internal/daily-brief）
  · 教练引擎 V1（数据聚合 + 通用洞察库 + 简单单维度分析）
  · 每日简报 API（GET /api/coach/brief）
  · 首页简报展示
  · 空状态 + 错误状态设计
  → 目标：用户可以说一句话 → AI 拆分 → 第二天看到简报

Phase 3（第 6-8 周）教练引擎 + 对话 ✅ AI 教练核心能力
  · 教练引擎规则库（5 条预置规则，每条独立文件）
  · 置信度计算引擎（Welch's t-test）
  · 跨域关联分析（14 天数据后启用）
  · AI 教练对话 API（POST /api/chat → LLM 同步回复）
  · 教练对话页面
  · 行动建议 + 简单跟踪（用户确认 → 标记 actionTaken）
  · 新手引导流程（3 步完成：身份 + 预算 + 初始习惯）
  · 教练语气词典（LLM system prompt）
  → 目标：AI 能基于用户数据给出有价值的对话

Phase 4（第 9-10 周）体验打磨 ✅ 产品可用性
  · Loading 状态设计（冷启动 ~1 分钟的等待体验）
  · 浏览器 Notification API 集成
  · 推送轮询逻辑（React Query refetchInterval）
  · 冷启动通用洞察库（50+ 条）
  · 性能优化（首屏加载 < 2s、API 响应 < 500ms）
  · PWA manifest（添加到桌面）
  · 移动端适配检查（iOS Safari / Android Chrome）
  → 目标：产品体验流畅，冷启动不卡顿

Phase 5（第 11-12 周）内测 ✅ 验证核心假设
  · 招募 20-30 人内测（校园社群）
  · 收集反馈（每周问卷 + 用户访谈）
  · Bug 修复 + 体验迭代
  · 监控：Render Dashboard 观察实例小时消耗
  · 监控：Supabase Dashboard 观察 DB 使用量
  · 监控：LLM API 调用量和成本
  · 验证 5 个核心假设（见第二十章）
  · 基于反馈调整 V2 规划
  → 目标：验证产品假设，决定是否继续
```

### V2 阶段（8 周，扩展功能）

```
Phase 6（第 13-15 周）日程 + 日记
  · 日程模块（日/周/月视图）
  · 课表导入（OCR → V2 用 Qwen-VL）
  · 日记模块（AI 生成 + 时间线）
  · 花销拍照识别

Phase 7（第 16-18 周）体验升级
  · 教练风格切换（温和/严格/数据驱动）
  · 高级图表 + 数据仪表盘
  · 离线支持（IndexedDB）
  · SSE 流式对话（替代同步请求）
  · Render 升级评估（是否需要 paid plan）

Phase 8（第 19-20 周）商业化
  · 付费版功能（Stripe/微信支付集成）
  · 多设备同步
  · 增长机制（分享卡片、邀请奖励）
  · 性能监控（Sentry / LogRocket）
```

### Render 升级路径（当 Free Tier 不够时）

```
阶段 1：Free Tier（V1 开发 + 内测，0-30 用户）
  · Render Static Site（免费）
  · Render Web Service Free（免费，750 小时/月）
  · Supabase Free（免费，500MB DB）
  · 月成本：$5-7（仅 LLM API）

阶段 2：Starter Plan（内测后，30-200 用户）
  · Render Web Service Starter（$7/月，不休眠）
  · Supabase Free（仍然免费）
  · 月成本：$12-14
  · 收益：无冷启动、更稳定、可选 WebSocket

阶段 3：Standard Plan（正式上线，200-1000 用户）
  · Render Web Service Standard（$25/月）
  · Supabase Pro（$25/月，8GB DB）
  · 月成本：$50-57
  · 收益：自动扩展、持久化磁盘、更好性能

阶段 4：自建（1000+ 用户）
  · 迁移到 VPS（阿里云 ECS / 腾讯云 CVM）
  · 自建 PostgreSQL + Redis
  · 月成本：$20-50（按配置）
  · 收益：完全控制、成本可控
```

---

## 十一、风险与应对（修订版）

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| AI 拆分准确率不足 | 高 | 核心体验崩塌 | 三层容错 + 降级为手动 + 持续优化 |
| 前 2 周用户觉得没用就流失 | 高 | 留存率不达标 | Day 1 就有价值 + 通用洞察 + 速记体验 |
| 推送太多用户关闭通知 | 中 | 失去核心触达 | 严格频率控制 + 用户可调 + 每日简报不依赖推送 |
| LLM 成本高于预期 | 中 | 运营亏损 | 规则引擎为主 + 控制对话轮数 + 免费版限额 |
| 跨域关联不准导致信任崩塌 | 中 | 用户不信任 AI | 置信度阈值 + 样本量门槛 + 用户反馈机制 |
| 大学生不愿为教练付费 | 高 | 商业化失败 | 先验证免费版留存，再考虑付费；学生价 ¥9.9 |
| 隐私担忧 | 低 | 用户不敢用 | 本地优先 + 数据透明 + 可导出可删除 |
| 校园网环境导致服务不稳定 | 中 | 体验差 | HTTP 重试 + 离线降级 + 服务端冗余 |
| **Render Free Tier 冷启动 1 分钟** | **高** | **用户首次打开体验差** | **品牌 loading 页 + cron 保活 + Phase 2 升级 Starter** |
| **Render Free Tier 750 小时不够** | **中** | **月中服务被暂停** | **监控 Usage Dashboard + 升级 Starter ($7/月)** |
| **Supabase 免费层 500MB 不够** | **低** | **数据写入失败** | **监控 DB 大小 + 定期清理旧数据 + 升级 Pro** |
| **LLM API 不可用（百炼故障）** | **低** | **速记拆分/简报生成失败** | **降级为手动分类 + 简报用缓存 + DeepSeek 备选** |
| **Web Speech API 兼容性差** | **中** | **语音速记不可用** | **自动检测 + fallback 到文字输入 + V2 接 Whisper** |
| **cron-job.org 服务中断** | **低** | **每日简报不生成** | **客户端 fallback：App 打开时实时生成简报** |

---

## 十二、一句话总结

**不是"帮你记录生活的 6 个工具"，而是"一个真正懂你的 AI 教练，它观察你的生活规律，主动发现你的问题，引导你做出改变"。**

工具让用户"记录"，教练让用户"改变"。改变才是用户真正愿意付费的东西。

---

## 十三、冷启动策略（产品成败的关键）

AI 教练产品最大的杀手不是技术不行，而是**前两周用户觉得"这 AI 啥也不懂"就卸载了**。

### 13.1 冷启动分阶段策略

```
Day 1：首次价值交付（最关键的一天）
  AI 能做的事：
    · 通用型建议（基于身份，不基于个人数据）
    · "你是大学生，这个月月初容易花超，前 10 天注意控制"
    · "周日晚上是大学生最焦虑的时间，今晚早点睡"
    · 设定初始目标（根据用户选择的预算/习惯）
    · 速记拆分的"惊艳时刻"——让用户看到 AI 真的在理解

  产品策略：
    · 新手引导完成后，立即展示 1 条通用洞察（不需要个人数据）
    · 引导用户做第一次速记，展示拆分效果
    · 第一次速记的拆分效果必须好——这是用户决定是否继续的关键
    · 如果拆分不确定，宁可不拆，展示原始文本

Day 2-3：建立记录习惯
  AI 能做的事：
    · 单维度事实：昨天花了多少、习惯完成情况
    · 鼓励性反馈："你已经连续 2 天记录了，很好"

  产品策略：
    · 每次打开 App 展示最新简报
    · 简报内容以"事实+鼓励"为主，不给建议
    · 速记入口放在最显眼的位置

Day 4-7：首个洞察
  AI 能做的事：
    · 单维度模式："你这 4 天平均每天花了 ¥42"
    · 简单规律："你有 3 天都是 12 点后睡的"

  产品策略：
    · 第 5 天给出第一个"微型洞察"
    · 格式必须是"我观察到……"而不是"你应该……"
    · 不给建议，只给事实
    · 附带"这个发现对你有用吗？"的反馈按钮

Day 8-14：信任萌芽
  AI 能做的事：
    · 第一个跨域关联（仅在置信度足够时推）
    · 第一个习惯建议

  产品策略：
    · 这是用户决定是否留下的关键时刻
    · 第一个跨域洞察必须是高置信度的（宁可不给，不能给错）
    · 给出后立即跟进："这个发现对你有用吗？" → 收集反馈
    · 如果用户反馈"不准"，立即道歉 + 降权该规则

Day 15-30：习惯形成
  AI 能做的事：
    · 更大胆的跨域分析
    · 开始主动推送（但每天最多 1 次）
    · 行动建议 + 跟踪

  产品策略：
    · 每周给出一个"本周总结"
    · 展示 AI 建议被用户采纳后效果的数据
    · "上周你听了我的建议早睡了 4 天，这周情绪分高了 0.8"
```

### 13.2 通用洞察库（冷启动内容储备）

预置 50+ 条不依赖个人数据的通用洞察，按身份/场景分类：

```
大学生通用洞察（无需个人数据）：
  · 周一综合症："周一上午是大学生效率最低的时段，别安排重要任务"
  · 月末效应："月底最后 5 天，大学生平均花销比月初高 20%"
  · 考试季："考试前一周，80% 的大学生睡眠不足，你现在怎么样？"
  · 社交与情绪："每周至少一次和朋友出去，对情绪的帮助比早睡还大"
  · 运动频率："每周运动 2-3 次的人，焦虑水平比不运动的人低 40%"

季节/节日洞察：
  · 开学季："新学期开始了，现在是设定目标的好时机"
  · 期末季："期末倒计时 3 周，现在开始复习刚好来得及"
  · 假期："假期最容易打乱作息，要不要设一个弹性目标？"

数据触发的通用洞察：
  · 首次超支："第一次超预算了。别慌，大多数人都会在月初前 10 天花超"
  · 首次连续打卡："连续 3 天了！研究显示第 4 天是最容易放弃的，撑过去"
  · 首次写长日记："写了 200+ 字！写得越多的人，对自己了解越深"
```

---

## 十四、推送通知策略（教练产品的生命线）

推送是教练产品最关键的触达方式。推多了烦人，推少了没用。

### 14.1 推送类型与频率

```
类型 1：每日教练简报（核心）
  时间：每天 08:00（可自定义）
  频率：每天 1 次
  内容：昨日复盘 + 今日建议
  可关闭：可静音（不推送通知，App 内仍可查看）
  说明：这是产品的核心触达方式，静音≠关闭

类型 2：异常预警（触发式）
  触发：花销异常/习惯中断/情绪低落
  频率：每天最多 2 次
  可关闭：是
  前置条件：置信度 > 0.7

类型 3：正向反馈（触发式）
  触发：达成里程碑/连续打卡/预算控制好
  频率：每天最多 1 次
  可关闭：是

类型 4：行动提醒（用户设定）
  触发：用户确认的行动（"提醒我 11 点睡觉"）
  频率：按用户设定
  可关闭：按条关闭

类型 5：晚间回顾（固定）
  时间：每天 21:00（可自定义）
  频率：每天 1 次
  内容："今天还有什么想记录的吗？"
  可关闭：是

硬性限制：
  · 类型 2+3 每天合计 ≤ 3 次
  · 用户连续忽略 3 次 → 频率减半（持续 7 天后恢复）
  · 用户连续忽略 7 次 → 暂停类型 2+3 推送 3 天
  · 用户明确说"别烦我" → 24h 内只保留简报
  · 用户关闭某类推送 → 永不自动恢复
```

### 14.2 推送文案规范

```
好的推送：
  ✅ "你这周已经 3 天 12 点后睡了。今晚试试 23:30？"
     → 简短 + 有数据 + 有具体建议

  ✅ "连续 5 天跑步了 🔥 明天休息一天也没关系"
     → 正向 + 降低压力

  ✅ "今天花了 ¥67，比平时多了 1 倍。是有什么特别的开销吗？"
     → 好奇而非指责

坏的推送：
  ❌ "你今天又超支了！"
     → 指责语气

  ❌ "根据数据显示，你的消费习惯需要改善..."
     → 机器人口吻

  ❌ "快来打开 App 看看你的数据！"
     → 无价值引导

  ❌ "你已经很久没有写日记了"
     → 制造焦虑

原则：
  · 用"你"而不是"用户"
  · 用数据说话，不用判断
  · 每条推送必须有一个可执行的行动
  · 语气像朋友，不像系统
  · 不确定时说"我猜"而不是"我发现"
```

---

## 十五、信任曲线与渐进式建议

### 15.1 信任四阶段

```
阶段 1：怀疑期（Day 1-7）
  用户心态："这个 App 真的有用吗？"
  AI 策略：多做对的事，少说话
  关键动作：速记拆分要惊艳，通用洞察要准
  失败信号：用户 3 天不打开 → 失去这个用户
  设计重点：让"记录"这个动作本身就有趣（AI 拆分的惊喜感）

阶段 2：好奇期（Day 8-21）
  用户心态："哦？它怎么知道的？"
  AI 策略：给高置信度的洞察，制造"它真的懂我"的惊喜
  关键动作：第一个跨域关联必须准
  成功信号：用户点开推送并和 AI 对话

阶段 3：依赖期（Day 22-60）
  用户心态："没有它我都不知道怎么安排了"
  AI 策略：开始给行动建议，跟踪执行
  关键动作：展示"建议 → 执行 → 效果"的闭环
  成功信号：用户主动问 AI "我该怎么办"

阶段 4：伙伴期（Day 60+）
  用户心态："它就像一个了解我的朋友"
  AI 策略：深度教练，长期规划
  关键动作：月度回顾、习惯升级
  成功信号：用户向朋友推荐
```

### 15.2 建议难度递进

```
第 1 周：不给建议
  AI 只说事实："你这周花了 ¥280"

第 2-3 周：小建议（低门槛）
  "要不要试试每天 12 点前睡？"
  特点：容易执行，失败代价低

第 4-6 周：中建议（需努力）
  "你每周五花销最高，试试周五带饭而不是点外卖？"
  特点：需要改变习惯，有一定难度

第 7 周+：大建议（需坚持）
  "你的数据显示晚睡是很多问题的根源。
   我建议你做一个 30 天早睡挑战，我来每天提醒你。"
  特点：长期项目，需要持续跟踪

原则：永远不要在用户还没信任你的时候给大建议
```

---

## 十六、成功指标（KPI）

### 16.1 核心指标

```
北极星指标：用户行为改变率
  定义：AI 给出建议后，用户在 7 天内执行的比例
  目标：V1 达到 20%（保守），V2 达到 35%
  意义：教练的价值 = 用户真的改变了行为

一级指标（产品健康）：
  · 7 日留存率：目标 > 30%（生活管理类 App 行业平均约 15-20%）
  · 30 日留存率：目标 > 15%（行业平均约 8-10%）
  · 每日打开率：目标 > 50%（简报驱动）
  · 推送打开率：目标 > 25%（行业平均约 10-15%）

二级指标（教练质量）：
  · 洞察准确率：用户标记"有用"的比例 > 60%
  · 建议采纳率：AI 建议被执行的比例 > 20%
  · 速记拆分满意度：用户不修改的比例 > 70%
  · 正向反馈率：收到正向反馈后的 24h 行为改善 > 40%

三级指标（用户满意度）：
  · NPS（净推荐值）：> 30
  · 教练评分：用户对 AI 教练的平均评分 > 3.5/5
  · 申诉率：用户标记"不准确"的比例 < 10%
```

### 16.2 反指标（需要监控的负面信号）

```
· 推送忽略率 > 60% → 推送太多或内容不好
· 用户关闭通知比例 > 30% → 推送策略失败
· 7 日留存 < 15% → 冷启动有问题
· 速记拆分修正率 > 40% → AI 拆分质量需要提升
· AI 建议采纳率 < 10% → AI 不够懂用户
· 日均使用时长 < 30s → 产品没有价值感
```

---

## 十七、竞品分析（修订版）

> **V3.0 修订**：原方案说"几乎没有直接竞品"然后列了 4 个，自相矛盾。
> 本版诚实面对竞争格局。

### 17.1 直接竞品（AI 行为教练类产品）

```
1. Noom（AI 健康教练）
   定位：减肥/健康行为改变
   优点：教练模式 + 行为改变科学 + 数据追踪 + 真人教练混合
   缺点：只做健康，月费 $60（约 ¥430），大学生用不起
   数据：2023 年收入约 $4 亿，付费用户约 500 万
   学习点：教练框架 + 行动跟踪 + 渐进式建议
   我们的优势：覆盖更多生活维度（不仅仅是健康），价格低 90%

2. Woebot（AI 心理健康教练）
   定位：心理健康支持
   优点：对话式教练，有临床验证，CBT 框架
   缺点：只做心理健康，不做生活管理
   数据：下载量约 150 万，主要用于临床场景
   学习点：渐进式信任建立 + 情绪响应策略
   我们的优势：不只是心理健康，是全方位生活教练

3. Fabulous（习惯教练）
   定位：习惯养成 + 日常流程优化
   优点：漂亮的 UI + 科学依据 + 阶梯式习惯建立
   缺点：没有 AI，是预设流程，无法个性化
   数据：约 1000 万下载，App Store 健康类 Top 50
   学习点：阶梯式习惯建立 + 美学设计
   我们的优势：AI 个性化 + 跨域分析
```

### 17.2 间接竞品（工具类 + AI 助手类）

```
工具类：
  滴答清单/Things：待办+日程，但没有教练
  随手记/Mint：记账，但没有消费建议
  Flomo：轻量笔记，但没有 AI 分析
  Day One：日记，但没有情绪洞察
  小日常/Loop：习惯打卡，但没有习惯教练

AI 助手类：
  豆包/Kimi/ChatGPT：通用 AI，但不了解你的生活数据
  Notion AI：文档 AI，但不关心你的行为

工具类竞品的共同弱点：
  · 用户需要主动使用
  · 数据不互通
  · 没有跨域分析
  · 没有主动干预
  · 替代成本低
```

### 17.3 我们的差异化定位

```
我们不是在做"更好的工具"，我们是在做"不同品类的产品"。

定位矩阵：
              主动推送 ←→ 被动使用
              │
  单一维度    │    多维度
    Noom     │    有迹 ★
    Woebot   │
    Fabulous │
    滴答清单  │
    随手记    │
              │

我们的位置：主动 + 多维度
这是目前市场上空白的位置。
```

### 17.4 诚实的护城河分析

```
短期优势（0-6 个月）：
  · 语音速记的拆分体验（产品体验差异化）
  · 跨域关联分析（产品设计壁垒，非技术壁垒）
  · 教练框架设计（产品设计壁垒）
  · 大学生市场定位（细分市场聚焦）

中期壁垒（6-18 个月）：
  · 用户数据积累（AI 越来越懂你——前提是留存率够高）
  · 教练效果验证（"用了之后真的变好了"的口碑）
  · 习惯形成（"每天早上看简报"的肌肉记忆）

长期壁垒（18 个月+）：
  · 数据网络效应（更多用户 → 更好的通用模型——这个需要验证）
  · 品牌信任（"生活教练 = 有迹"——这个需要时间）

诚实的弱点：
  · 通用 LLM 可以随时复制"教练对话"能力
  · 大厂（字节、腾讯）如果做类似产品，有流量优势
  · 数据积累壁垒需要用户留存，但留存率是未知数
```

---

## 十八、情感智能框架

AI 教练不同于工具——它需要处理用户的情绪。

### 18.1 情绪识别

```
数据源：
  · 语音速记中的情绪词（"烦""开心""焦虑"）
  · 日记的情绪评分
  · 花销模式异常（情绪消费）
  · 作息异常（晚睡/暴食）
  · 输入频率下降（可能情绪低落不想说话）
  · 直接表达："我心情不好"

情绪状态机：
  正常 → 低落 → 持续低落 → 危机

  正常：常规教练策略
  低落（1-2 天）：温和模式，减少建议，增加陪伴
  持续低落（3-7 天）：简化日程，鼓励社交/运动
  危机（>7 天 + 危机关键词）：建议寻求专业帮助

重要限制：
  · 情绪识别的准确率约 70%，不要把 AI 的情绪判断当作事实
  · 情绪标签仅供教练引擎参考，不直接展示给用户（避免标签化）
  · 用户可以手动修正情绪标签
```

### 18.2 情绪响应策略

```
用户情绪正常时：
  AI 可以给挑战性建议，可以追问，可以较严格

用户情绪低落时：
  · 减少建议数量（最多 1 条）
  · 语气变温柔
  · 不追问原因（等用户自己说）
  · 给出"减压"建议："今天把待办减到 2 件就行"
  · 陪伴式回复："不想说也没关系，我一直在"

用户情绪崩溃时：
  · 不给任何建议
  · 不分析数据
  · 只做陪伴："听起来你今天过得很辛苦"
  · 如果检测到危机关键词（"不想活""活着没意思"等）：
    → "我很担心你。专业的人能更好地帮到你。"
    → 提供心理援助热线：全国 24 小时 400-161-9995
    → 不尝试自己处理心理危机
  · 危机关键词匹配规则：
    · 必须匹配：直接提及自杀/自残的词语
    · 不匹配：口语化的"累死了""想死"（日常表达）
    · 灰色地带：连续多条低落 + 社交退缩 + 作息紊乱 → 建议但不强制推荐热线

用户情绪恢复时：
  · 不要马上说"你终于好了"
  · 自然过渡回常规教练
  · 可以轻描淡写地回顾："上周你不太开心，现在看起来好多了"
```

### 18.3 教练语气词典

```
禁止使用的表达：
  ❌ "你又……"（指责）
  ❌ "你应该……"（说教）
  ❌ "你为什么……"（质问）
  ❌ "根据数据显示……"（冷冰冰）
  ❌ "你需要改善……"（否定）
  ❌ "别人都能做到……"（比较）

推荐使用的表达：
  ✅ "我注意到……"（观察）
  ✅ "要不要试试……"（建议）
  ✅ "你最近……"（关心）
  ✅ "我猜你可能……"（共情）
  ✅ "这周比上周好多了"（正向）
  ✅ "没关系，明天再来"（宽容）
  ✅ "这只是我的猜测，不一定对"（诚实）
```

---

## 十九、商业化策略

### 19.1 免费版 vs 付费版

```
免费版（核心体验完整）：
  · 语音速记（每天 10 条）
  · 习惯打卡（3 个习惯）
  · 每日教练简报
  · AI 对话（每天 5 轮）
  · 基础跨域分析（2 维度）

付费版 ¥9.9/月（学生价）/ ¥19.9/月（标准价）：
  · 无限语音速记
  · 无限习惯
  · 无限 AI 对话
  · 高级跨域分析（多维度）
  · 教练风格定制
  · 周度/月度教练报告
  · 数据导出

定价逻辑（基于可比产品）：
  · Noom 月费 $60（约 ¥430），我们 ¥19.9 = Noom 的 5%
  · 国内大学生月均可支配约 ¥2000-3000，¥9.9 占比 < 0.5%
  · 免费版已经能用，付费版是"更深的教练"而非"解锁功能"
  · 转化率预期：3-8%（参考 Noom 的约 5%）

定价风险：
  · 大学生可能不愿为"看不见的 AI 教练"付费
  · 应对：先验证免费版留存率，留存率 > 25% 后再推付费
```

### 19.2 增长策略（修订版）

```
Phase 1：种子用户（0-500 人）—— 验证产品
  · 渠道：校园社群（微信群/QQ群）、小红书校园号
  · 方式：免费使用 + 深度访谈（每人 30 分钟）
  · 目标：验证核心假设（速记体验、教练价值、留存率）
  · 不追求用户数，追求反馈质量

Phase 2：口碑传播（500-5000 人）—— 验证增长
  · 分享机制：每周分享"我的本周教练总结"卡片（脱敏数据）
  · 邀请机制：邀请好友注册，双方各得 7 天付费版体验
  · 内容营销：小红书/公众号分享"AI 发现的我的生活规律"
  · 前提：7 日留存 > 30% 才考虑增长，否则先修产品

Phase 3：付费转化（5000+ 人）—— 验证商业
  · 免费版体验 14 天后弹出付费引导
  · 展示"教练帮你省了多少钱/多睡了多少小时"
  · 限时优惠：首月 ¥4.9
  · 目标：付费转化率 > 5%
```

---

## 二十、验证计划（写代码之前必须做）

### 20.1 核心假设

```
假设 1：大学生愿意让 AI 分析自己的生活数据
  验证方式：访谈 20 人
  问题："如果一个 AI 能看到你的花销/日程/日记，主动给你建议，你觉得？"
  通过标准：>50% 表示"可以试试"（降低原方案的 60%）

假设 2：语音速记能替代多模块分别输入
  验证方式：给 10 人演示语音速记拆分效果
  问题："你愿意用这个代替现在分别记账/写日记吗？"
  通过标准：>40% 表示愿意（降低原方案的 50%——因为实际效果可能不如演示）

假设 3：AI 的跨域洞察能带来惊喜感
  验证方式：给 10 人看模拟的跨域洞察
  问题："这个发现对你有用吗？"
  通过标准：>60% 表示有用（降低原方案的 70%——因为模拟数据比真实数据好看）

假设 4：用户能接受 AI 主动推送建议
  验证方式：访谈 10 人
  问题："如果 AI 每天给你 1-3 条建议推送，你觉得？"
  通过标准：>40% 表示"可以接受"（降低原方案的 50%）

假设 5：用户愿意为深度教练付费
  验证方式：给 20 人看免费版 vs 付费版功能对比
  问题："你愿意为付费版每月花 ¥9.9 吗？"
  通过标准：>10% 表示愿意（降低原方案的 15%——大学生付费意愿更低）
```

### 20.2 最小验证方案（不写代码）

```
方法：Wizard of Oz（绿野仙踪法）+ 问卷追踪

步骤：
  1. 招募 10 个大学生测试用户（通过校园社群）
  2. 建一个微信群，你在群里扮演"AI 教练"
  3. 每天早上 8:00 在群里发"今日教练简报"（你手动写的）
  4. 用户随时在群里说一句话（模拟语音速记），你手动拆分回复
  5. 你根据用户的数据，手动给跨域洞察和建议
  6. 坚持 2 周，观察：
     · 用户是否每天看简报？（统计消息阅读率）
     · 用户是否主动找你聊？（统计主动消息数）
     · 用户是否执行了你的建议？（统计建议采纳率）
     · 用户是否觉得"被理解"？（问卷评分）
  7. 每周做一次问卷（5 题，2 分钟完成）

成本：0 元，2 周时间
产出：10 个真实用户的深度反馈 + 定量数据
价值：比写 3 个月代码更有价值
```

### 20.3 验证后决策树

```
如果假设 1 不通过（用户不愿让 AI 分析数据）：
  → 放弃教练模式，转向工具模式
  → 核心价值变为"语音速记自动分类"

如果假设 2 不通过（语音速记体验不行）：
  → 降低 AI 拆分的权重，增加手动输入的比重
  → 核心价值变为"教练简报"而非"语音速记"

如果假设 3 不通过（跨域洞察没惊喜感）：
  → 砍掉跨域分析，聚焦单维度教练
  → 核心价值变为"习惯教练"或"消费教练"

如果假设 4 不通过（用户不接受推送）：
  → 降低推送权重，产品变为"用户主动打开看"
  → 失去"教练"的核心差异，需要重新定位

如果假设 5 不通过（用户不愿付费）：
  → 先做用户量，再考虑商业模式
  → 或转向 B 端（学校心理咨询中心合作）
```

---

## 二十一、完整对话脚本示例

### 21.1 Day 1：首次价值交付

```
【用户完成注册后】

教练："你好！我是你的生活教练 👋
      我会通过你平时随手记录的内容来了解你，
      然后帮你看清你自己看不到的规律。

      先说好——我不会天天催你做什么，
      你该干嘛干嘛，记录的事交给我。

      对了，你是大学生吧？我有条小建议：
      这个月前 10 天容易花超，悠着点 😄

      有什么想说的，随时跟我说。
      不想打字？说一句话就行。"

（注意：第一条建议是通用洞察，不基于个人数据，但已经提供了价值）
```

### 21.2 Day 3：建立记录习惯

```
用户说了 3 条速记，AI 已经有一些数据了：

教练："这 3 天你提到了 2 次高数课，1 次图书馆自习。
      看起来学习是你最近的重点。

      对了，你之前说想养成跑步的习惯——
      这 3 天还没提到过跑步，不着急，
      什么时候想开始了跟我说一声就行。"

（注意：只陈述事实，不给建议，不施压）
```

### 21.3 Day 10：首个跨域洞察

```
教练："我发现了一个有意思的事——

      你这 10 天里有 4 天是 12 点后睡的。
      那 4 天的第二天，你的平均花销是 ¥52，
      而 12 点前睡的日子，平均花销只有 ¥31。

      差了将近 70%。（基于 10 天数据，继续观察会更准）

      我不确定是不是因果关系，但你可以留意一下：
      晚睡的日子，第二天是不是更容易买买买？

      （不用急着改什么，先观察就好）

      这个发现对你有用吗？ [有用] [不准] [说不清]"

用户："真的吗？我都没注意到..."

教练："大多数人注意不到这种关联，因为单看每一天差别不大。
      但 10 天的数据凑在一起，模式就出来了。

      下次你晚睡了，第二天留意一下自己的消费，
      看看是不是这样。"
```

### 21.4 Day 25：行动建议

```
教练："过去 3 周的数据证实了我之前的发现：
      晚睡的第二天，你的花销确实平均高 65%。

      而且我还发现——晚睡的日子里，你买的东西
      70% 是零食和奶茶。

      我猜你可能是睡不够→白天困→用零食提神。
      （这只是我的猜测，不一定对）

      要不要试一个小实验：
      这周试着 5 天 12:30 前睡，
      我们看看花销会不会降下来。

      我可以 12:15 提醒你准备睡觉。你觉得呢？"

用户："好，试试吧"

教练："好，那就从今晚开始。
      12:15 我会提醒你。
      不用太严格，12:30 之前上床就行。
      如果某天实在做不到，也没关系，
      我们看整体趋势。"
```

### 21.5 Day 65：月度复盘

```
教练："你的第一个完整月结束了，我想跟你聊聊这个月的变化。

      📊 这个月的数据：
      · 平均睡觉时间：00:23 → 23:47（提前了 36 分钟）
      · 月花销：¥2,180 → ¥1,850（省了 ¥330）
      · 跑步：0 次 → 8 次
      · 情绪均分：6.1 → 7.2

      🔍 最大的变化：
      早睡带来了连锁反应——
      白天不那么困了 → 零食消费降了 → 省了钱 → 焦虑也少了

      🎯 下个月建议：
      你现在早睡基本稳定了，可以加一个新挑战。
      跑步已经开始了 8 次，要不要试试固定到每周 3 次？

      你觉得这个月最大的收获是什么？"
```

### 21.6 情绪危机处理

```
【用户情绪低落时】

用户："今天什么都不想做"

教练："那就什么都不做。
      有时候就是会这样，没关系。

      今天没有什么必须做的事。
      如果想聊，我在。
      如果不想说话，也没关系。"

（不给建议，不分析原因，只陪伴）

【如果持续低落 3 天以上】

教练："你这周看起来不太开心。

      我不是要分析你，就是想说——
      如果需要找人聊聊，除了我之外，
      学校的心理咨询中心也是个选择。

      全国 24 小时心理援助热线：
      400-161-9995

      你不需要很'严重'才能打这个电话。
      有时候就是需要一个专业的人听你说说话。"

（不诊断，不评判，只提供资源）
```

---

## 二十二、多端体验

### 22.1 手机端（V1 主设备，唯一设备）

```
核心场景：
  · 早上看教练简报（推送通知 → 打开 App）
  · 随时语音速记（首页大按钮）
  · 和教练对话
  · 习惯打卡
  · 查看花销

交互特点：
  · 速记是第一入口（首页大按钮，始终可见）
  · 教练简报是第二入口（推送驱动）
  · 其他模块通过底部 Tab 到达
  · PWA 安装到桌面（不需要应用商店审核）
```

### 22.2 电脑端（V2 辅助设备）

```
核心场景：
  · 查看教练分析报告（大屏看图表更舒服）
  · 写长日记（语音速记转文字后，在电脑上编辑补充）

交互特点：
  · 教练简报在右侧常驻
  · 左侧是数据面板（花销/习惯）
  · 不需要所有功能都在电脑端可用

V2 再做，V1 不考虑响应式适配。
```

### 22.3 桌面小组件（V2）

```
小组件内容：
  · 今日教练简报摘要（一句话）
  · 今日习惯打卡状态
  · 今日花销 / 预算剩余
  · 快速速记入口

V2 功能，V1 不做。
```

---

## 二十三、数据最小化

### 23.1 教练需要的最少数据

```
核心数据（必须有）：
  · 每日行为记录（速记/花销/习惯打卡）
  · 情绪信号（速记中的情绪词 / 手动评分）
  · 时间信息（什么时候做了什么）

辅助数据（有了更好）：
  · 日程安排（知道你每天做什么）
  · 地理位置（知道你在哪里，但不强制）——V2

不需要的数据：
  · 联系人（不需要知道你和谁在一起）
  · 相册（不需要看你的照片）
  · 通话记录 / 短信
  · 社交媒体
  · 精确位置（不需要 GPS 坐标）

原则：只收集教练分析必需的数据，能从用户口述推断的就不收集原始数据
```

### 23.2 数据透明

```
用户可以随时查看：
  · AI 收集了哪些数据
  · AI 用这些数据做了什么分析
  · AI 的每个洞察基于哪些数据点
  · 删除任何一条数据

设置页 → "我的数据"：
  → 查看所有原始数据
  → 查看 AI 分析日志（哪些规则产生了哪些洞察）
  → 删除特定数据
  → 导出全部数据（JSON 格式）
  → 清除 AI 分析缓存
  → 注销账号（删除所有数据）
```

---

## 附录 A：设计系统规范（V3.0 缺失，本版新增）

### A.1 颜色系统

```
品牌色：
  主色：#E8941E（暖橙——活力、温暖、积极）
  辅色：#C9553E（赤陶——深度、信任、稳重）
  渐变：linear-gradient(135deg, #E8941E, #C9553E)

中性色：
  背景：#FFFCF7（暖白——不刺眼，适合长时间使用）
  文本主色：#1A1520（深紫黑——比纯黑更柔和）
  文本次色：#6B6475（灰色——辅助信息）
  分割线：#E8E4ED

功能色：
  成功：#2ECC71（绿色——习惯完成、预算达标）
  警告：#F39C12（黄色——接近预算上限）
  错误：#E74C3C（红色——超支、习惯中断）
  信息：#3498DB（蓝色——数据、分析）

情绪色（用于情绪标签）：
  开心：#FFD93D
  平静：#6BCB77
  低落：#4D96FF
  焦虑：#FF6B6B
  愤怒：#C84B31
```

### A.2 字体系统

```
中文：
  标题：PingFang SC Semibold / Noto Sans SC Semibold
  正文：PingFang SC Regular / Noto Sans SC Regular
  ——不使用自定义字体加载（影响首屏速度）

英文+数字：
  标题：Inter Semibold
  正文：Inter Regular
  数字：Inter Medium（金额、日期等需要等宽对齐）

字号：
  H1：28px（教练简报标题）
  H2：22px（模块标题）
  H3：18px（卡片标题）
  Body：16px（正文）
  Caption：14px（辅助信息）
  Small：12px（标签、时间戳）
```

### A.3 间距系统

```
基础单位：4px

常用间距：
  xs：4px（紧凑元素间距）
  sm：8px（列表项间距）
  md：16px（卡片内边距、模块间距）
  lg：24px（页面边距、大模块间距）
  xl：32px（页面顶部间距）
  xxl：48px（章节间距）
```

### A.4 圆角系统

```
按钮/输入框：8px
卡片：12px
头像：50%（圆形）
底部弹窗：顶部 16px
```

---

## 附录 B：与前版方案的变更对照

| 维度 | 工具方案 V2 | 教练方案 V3.0 | 本版 V3.1 |
|------|-----------|-------------|----------|
| 冷启动 | "第 1 周记录" | 分 4 阶段 | Day 1 有价值 + 分阶段 + 通用洞察库 |
| 推送策略 | "通知设置" | 5 种推送类型 | 频率控制 + 文案规范 + 降级策略 + 可静音 |
| 信任建立 | 未提及 | 4 阶段 | 建议难度递进 + 置信度体系 |
| 成功指标 | 未提及 | 北极星+三级 | 保守目标 + 反指标 + 行业基准 |
| 竞品分析 | 未提及 | "几乎没有竞品" | 3 直接 + 6 间接 + 诚实护城河 + 定位矩阵 |
| 情感智能 | "安全护栏" | 简要提及 | 完整框架 + 危机处理 + 语气词典 |
| 商业化 | "¥9.9/月" | 未详细 | 可比产品定价 + 保守转化 + 验证后推付费 |
| 验证计划 | 未提及 | 5 个假设 | 降低阈值 + 决策树 + Wizard of Oz |
| 对话脚本 | 无 | 部分示例 | 6 个完整场景脚本 |
| 多端体验 | "响应式断点" | 未提及 | V1 只做手机 + V2 扩展 |
| 数据最小化 | 未提及 | 未提及 | 必须/辅助/不需要 + 透明机制 |
| 技术架构 | 全功能 | 全功能 | V1 最简 + V2 扩展 + 明确不做清单 |
| 数据模型 | 基础 | 基础 | 增加状态字段+置信度+错误处理 |
| API 设计 | 基础 | 基础 | 增加错误处理+分页+速率限制 |
| 页面清单 | 22 页 V1 | 18 页 V1 | 13 页 V1 + 7 页 V2 + 空态/错误态 |
| 设计系统 | 未提及 | 未提及 | 颜色+字体+间距+圆角 |
| 速记可靠性 | 未提及 | 未提及 | 三层容错+降级链+准确率预期 |

---

## 附录 C：修订变更清单（V3.0 → V3.1）

```
  ── 产品设计修订 ──

 1. 新增「第零章：修订前言」—— 诚实列出 V3.0 的 9 个结构性问题
 2. 修订「第二章：目标用户」—— 增加用户分层（A/B/C/D），精确画像
 3. 修订「第三章」—— 增加简报降级方案（数据不足时展示什么）
 4. 新增「4.2.1 速记可靠性设计」—— 三层容错 + 降级链 + 准确率预期
 5. 新增「4.6 情绪追踪限制」—— 情绪数据不足时不展示误导性图表
 6. 新增「4.7 诚实反馈原则」—— AI 不确定时说"我不确定"
 7. 新增「5.2.1 关联规则库」—— 5 条预置规则 + 最低数据量 + 置信度计算
 8. 新增「5.2.2 置信度计算引擎」—— Welch's t-test + Cohen's d + 完整代码
 9. 新增「5.2.3 关联分析的不做什么」—— 防止 AI 胡说八道
10. 修订「第八章」—— 13 页 V1 + 7 页 V2 + 新增空态/错误态设计
11. 修订「第十一章」—— 增加概率列 + Render 特有风险
12. 修订「第十三章冷启动」—— Day 1 就有价值（不是"前3天只观察"）
13. 修订「第十四章推送」—— 每日简报可静音（不是"不可关闭"）
14. 修订「第十六章 KPI」—— 保守目标 + 增加行业基准
15. 修订「第十七章竞品」—— 诚实面对竞争 + 定位矩阵 + 弱点分析
16. 修订「第十八章情感智能」—— 危机关键词匹配合规 + 70%准确率限制
17. 修订「第十九章商业化」—— 可比产品定价 + 保守转化率 + 验证后推付费
18. 修订「第二十章验证」—— 降低通过阈值 + 增加决策树
19. 修订「第二十二章多端」—— V1 只做手机 + V2 扩展
20. 新增「附录 A：设计系统规范」—— 颜色+字体+间距+圆角

  ── 技术架构修订（面向 GitHub + Render 部署）──

21. 重写「7.1 技术栈」—— 全面适配 Render Free Tier 约束
    · 数据库：Supabase PostgreSQL（替代 Render Free Postgres，不过期）
    · 认证：Supabase Auth（替代自建 JWT）
    · 语音：Web Speech API（替代 Whisper，零后端成本）
    · LLM：阿里云百炼 Qwen-Plus（替代 Qwen2.5/GPT-4o 双模型）
    · 推送：HTTP 轮询（替代 WebSocket，适配休眠模式）
    · 定时：cron-job.org（替代内置 Cron Jobs，Render 不支持）
    · ORM：Drizzle（替代裸 SQL，类型安全 + migration 管理）
    · 新增完整成本估算：100 用户/月 ≈ $5-7

22. 新增「7.7 Render 部署架构」—— 完整部署方案
    · 7.7.1 服务拓扑（Static Site + Web Service + Supabase + cron-job.org）
    · 7.7.2 解决 Render Free Tier 的 7 个致命问题（逐个给出方案）
    · 7.7.3 环境变量配置（完整 .env 模板）
    · 7.7.4 cron-job.org 配置（每日简报 + 健康检查）
    · 7.7.5 CI/CD 流水线（GitHub Actions）

23. 新增「7.8 GitHub 项目结构」—— 完整目录树
    · monorepo 结构（frontend/ + backend/ + shared/）
    · 按功能模块组织代码（features/coach/、features/quicknote/ 等）
    · 教练引擎独立目录（engine/rules/*.rule.ts）
    · 关键文件说明（llm.service.ts、confidence.ts、QuickNoteInput.tsx 等）

24. 重写「第十章开发路线图」—— 面向 Render 部署的分阶段计划
    · 每个 Phase 增加部署验证步骤
    · 新增「Render 升级路径」（Free → Starter → Standard → 自建）
    · 部署成本随阶段递进（$5-7 → $12-14 → $50-57 → $20-50）

25. 修订「第十一章风险」—— 增加 6 个 Render 特有风险
    · 冷启动 1 分钟、750 小时不够、Supabase 500MB 限制
    · LLM API 故障、Web Speech 兼容性、cron-job.org 中断
``