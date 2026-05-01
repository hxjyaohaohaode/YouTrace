# 有迹(Youji) - AI编程分阶段提示词

> 使用说明：按顺序将每个阶段的提示词输入给AI，每个阶段完成后运行验收标准验证，通过后再进入下一阶段。

---

## 阶段一：项目初始化与基础架构搭建

```
请创建"有迹"(Youji)项目的完整基础架构。这是一个AI驱动的日记/日程/目标管理PWA应用。

技术栈：
- 前端：React 18 + Vite + TypeScript + Tailwind CSS + Zustand + React Router v6
- 后端：Fastify 4.x + TypeScript + Prisma + PostgreSQL
- 部署：GitHub Pages(前端) + Render(后端)

要求：
1. 创建monorepo结构，根目录下有client/和server/两个文件夹
2. 前端配置：
   - Vite + React + TypeScript初始化
   - 配置Tailwind CSS
   - 配置React Router
   - 配置Zustand
   - 配置Axios(API客户端)
   - 创建基础目录结构：src/components/, src/pages/, src/stores/, src/api/, src/utils/, src/types/
3. 后端配置：
   - Fastify + TypeScript初始化
   - 配置Prisma
   - 配置CORS
   - 创建基础目录结构：src/routes/, src/middleware/, src/services/, src/utils/
4. 配置 concurrently 同时启动前后端
5. 创建 .env.example 模板文件
6. 配置 ESLint + Prettier

输出：
- 完整的项目目录结构
- 所有配置文件(package.json, tsconfig.json, vite.config.ts, tailwind.config.js等)
- 确保 npm install 可以正常运行
- 确保 npm run dev 可以同时启动前后端

验收标准：
- 运行 npm run dev 后，前端在 localhost:5173 正常显示"Hello Youji"
- 后端在 localhost:3000 正常响应 GET /health 返回 { status: "ok" }
- 前后端能正常通信
```

---

## 阶段二：用户认证与数据库实现

```
基于阶段一的项目，实现用户认证系统和数据库模型。

数据库设计(Prisma Schema)：
1. User表：id, email, password, name, avatar, createdAt, updatedAt
2. Profile表：id, userId, preferences(JSON), aiPersona, createdAt

API接口要求：
- POST /api/auth/register - 用户注册
- POST /api/auth/login - 用户登录
- POST /api/auth/refresh - 刷新Token
- GET /api/auth/me - 获取当前用户
- PUT /api/auth/profile - 更新用户资料

技术要求：
1. 密码使用bcrypt加密(12轮salt)
2. JWT认证，accessToken 7天过期
3. 使用Prisma ORM操作数据库
4. 前端创建authStore(Zustand)管理登录状态
5. 前端创建LoginPage和RegisterPage
6. 创建ProtectedRoute组件保护需要登录的页面
7. 实现axios拦截器自动附加Token

输出：
- 完整的Prisma schema文件
- 数据库迁移文件
- 后端所有路由处理函数
- 前端认证Store和页面组件
- 前端API客户端配置

验收标准：
- 可以成功注册用户
- 可以成功登录并获取Token
- 登录状态持久化(刷新页面不丢失)
- 未登录用户访问受保护页面自动跳转到登录页
- 密码在数据库中是加密存储的
```

---

## 阶段三：日记模块完整实现

```
基于阶段二的认证系统，实现完整的日记模块。

数据库新增表：
1. Diary表：id, userId, content, emotionScore, emotionTags(String[]), aiInsight, mediaUrls(String[]), createdAt, updatedAt
2. 添加索引：@@index([userId, createdAt])

API接口要求：
- GET /api/diaries - 获取日记列表(分页)
- GET /api/diaries/:id - 获取单篇日记
- POST /api/diaries - 创建日记
- PUT /api/diaries/:id - 更新日记
- DELETE /api/diaries/:id - 删除日记
- POST /api/diaries/:id/analyze - AI分析日记情绪

前端页面要求：
1. DiaryListPage - 日记列表页
   - 时间线布局
   - 无限滚动加载
   - 显示情绪标签和AI洞察摘要
2. DiaryEditorPage - 日记编辑器
   - 富文本编辑区(使用contenteditable或轻量级编辑器)
   - AI引导问题卡片(顶部显示)
   - 实时情绪分析条(前端规则引擎：根据关键词分析)
   - 保存/取消按钮
3. DiaryDetailPage - 日记详情
   - 完整内容展示
   - AI洞察卡片
   - 编辑/删除按钮

技术要求：
1. 创建diaryStore(Zustand)管理日记状态
2. 实现前端情绪分析规则引擎(基于关键词匹配)
3. AI分析调用DeepSeek-Reasoner API(使用模拟数据即可，后续阶段接入真实AI)
4. 创建日期格式化工具函数
5. 实现日记卡片组件、日记列表组件、情绪标签组件

输出：
- 数据库迁移文件
- 后端日记路由完整CRUD
- 前端日记相关页面和组件
- 前端状态管理Store
- 情绪分析工具函数

验收标准：
- 可以创建、编辑、删除日记
- 日记列表按时间倒序排列
- 编辑器实时显示情绪分析结果
- AI分析结果正确显示在详情页
- 分页加载正常工作
```

---

## 阶段四：日程与目标模块实现

```
基于阶段三的日记模块，实现日程管理和目标管理模块。

数据库新增表：
1. Event表：id, userId, title, description, startTime, endTime, isAllDay, recurrenceRule, goalId(可选), reminderMinutes, createdAt
2. Goal表：id, userId, title, description, deadline, progress(0-100), aiBreakdown(JSON), status(ACTIVE/COMPLETED/ARCHIVED), createdAt
3. 添加索引：@@index([userId, startTime]), @@index([userId, deadline])

日程API接口：
- GET /api/events?start=&end= - 获取日程(按时间范围)
- POST /api/events - 创建日程
- PUT /api/events/:id - 更新日程
- DELETE /api/events/:id - 删除日程

目标API接口：
- GET /api/goals - 获取目标列表
- POST /api/goals - 创建目标
- PUT /api/goals/:id - 更新目标
- DELETE /api/goals/:id - 删除目标
- POST /api/goals/:id/breakdown - AI拆解目标

前端页面要求：
1. CalendarPage - 日历页
   - 月视图日历(使用react-big-calendar或自研)
   - 点击日期创建日程
   - 显示日程冲突警告
2. EventForm - 日程表单
   - 标题、时间选择、全天开关
   - 关联目标下拉选择
   - 提醒设置
3. GoalListPage - 目标列表
   - 卡片布局显示进度条
   - 状态筛选(进行中/已完成)
4. GoalForm - 目标表单
   - 标题、描述、截止日期
   - AI拆解按钮(显示加载状态)
   - 里程碑时间线展示

技术要求：
1. 创建eventStore和goalStore
2. 实现日程冲突检测算法
3. 目标进度自动计算(关联日程完成情况)
4. AI目标拆解调用DeepSeek-Reasoner(模拟数据)
5. 创建日历组件、日程卡片组件、目标卡片组件

输出：
- 数据库迁移文件
- 后端日程和目标路由
- 前端日历页、目标页及相关组件
- 冲突检测算法实现

验收标准：
- 可以在日历上创建、查看、编辑日程
- 日程冲突时显示警告
- 可以创建目标并查看进度
- AI拆解显示里程碑时间线
- 目标关联日程正常工作
```

---

## 阶段五：习惯模块与AI集成

```
基于阶段四的日程和目标模块，实现习惯打卡模块和完整的AI集成。

数据库新增表：
1. Habit表：id, userId, title, description, frequency(DAILY/WEEKLY), targetDays, goalId(可选), streakCurrent, streakLongest, createdAt
2. HabitLog表：id, habitId, logDate, isCompleted, note, createdAt
3. 添加索引：@@index([habitId, logDate])

习惯API接口：
- GET /api/habits - 获取习惯列表
- POST /api/habits - 创建习惯
- PUT /api/habits/:id - 更新习惯
- DELETE /api/habits/:id - 删除习惯
- POST /api/habits/:id/toggle - 打卡/取消打卡

AI集成要求：
1. 创建aiService封装AI调用
   - 支持DeepSeek-Reasoner API
   - 支持MiMo-V2.5 API(通过OpenRouter)
   - 实现请求缓存(相同输入直接返回缓存结果)
   - 实现错误降级(AI不可用返回本地规则结果)
2. 实现日记情绪分析(真实AI调用)
3. 实现目标智能拆解(真实AI调用)
4. 实现AI引导问题生成

前端页面要求：
1. HabitListPage - 习惯列表
   - 习惯卡片显示连续天数
   - 7天打卡网格
   - 一键打卡按钮
2. HabitForm - 习惯表单
   - 标题、频率、目标天数
   - 关联目标

技术要求：
1. 创建habitStore
2. 实现连续天数自动计算算法
3. 创建AI服务层封装所有AI调用
4. 实现AI响应缓存机制
5. 创建习惯卡片组件、打卡网格组件

输出：
- 数据库迁移文件
- 后端习惯路由
- AI服务层实现
- 前端习惯页面和组件
- 连续天数计算算法

验收标准：
- 可以创建习惯并每日打卡
- 连续天数正确计算
- AI情绪分析返回真实结果
- AI目标拆解返回真实结果
- AI服务有缓存和降级机制
```

---

## 阶段六：主动智能引擎与推送

```
基于阶段五的习惯模块，实现主动智能引擎和推送通知系统。

数据库新增表：
1. Notification表：id, userId, type, title, content, actionUrl, isRead, createdAt
2. Trigger表：id, userId, type(CRON/BEHAVIOR/GOAL/EMOTION), config(JSON), isActive, lastTriggeredAt, createdAt

主动智能引擎要求：
1. 创建triggerService
   - 支持CRON触发器(定时任务)
   - 支持BEHAVIOR触发器(行为检测)
   - 支持GOAL触发器(目标进度检测)
   - 支持EMOTION触发器(情绪检测)
2. 实现晨间简报触发器(每天7:00)
   - 收集昨日日记、今日日程、本周目标
   - 调用DeepSeek-Reasoner生成简报
   - 保存为通知并推送
3. 实现晚间复盘触发器(每天21:00)
4. 实现情绪预警触发器(连续3天情绪低落)
5. 实现目标提醒触发器(截止日期前3天)

推送通知要求：
1. 实现Web Push通知
   - 使用web-push库
   - 用户订阅推送
   - 服务端发送推送
2. 实现通知中心页面
   - 显示所有通知列表
   - 标记已读/未读
   - 点击跳转对应页面

前端页面要求：
1. NotificationPage - 通知中心
   - 通知列表(按时间倒序)
   - 未读标记
   - 一键标记已读
2. 全局通知提示组件
   - 新通知Toast提示
   - 点击展开详情

技术要求：
1. 创建notificationStore
2. 使用node-cron实现定时任务
3. 创建触发器配置页面(用户可开关)
4. 实现通知推送服务

输出：
- 数据库迁移文件
- 后端触发器引擎
- Web Push配置
- 前端通知中心和组件
- 定时任务调度

验收标准：
- 定时触发器按计划执行
- 用户收到Web Push通知
- 通知中心正确显示通知
- 情绪预警正确触发
- 用户可以配置触发器开关
```

---

## 阶段七：PWA离线支持与同步

```
基于阶段六的主动智能引擎，实现PWA离线支持和数据同步。

PWA配置要求：
1. 配置Vite PWA插件(vite-plugin-pwa)
   - 生成manifest.json
   - 配置Service Worker
   - 配置应用图标
2. 实现离线页面
   - 网络断开时显示离线提示
   - 允许继续编辑(保存到本地)
3. 配置主题色和启动画面

离线存储要求：
1. 使用IndexedDB存储所有用户数据
   - 使用idb或dexie.js库
   - 创建本地数据库：diaries, events, goals, habits, notifications
2. 实现数据同步机制
   - 在线时自动同步到服务器
   - 离线时保存到IndexedDB
   - 网络恢复时批量同步

同步队列要求：
1. 创建syncStore管理同步状态
2. 实现同步队列
   - 记录所有离线操作(CREATE/UPDATE/DELETE)
   - 网络恢复时按顺序执行
   - 处理冲突(服务器优先或本地优先)
3. 显示同步状态
   - 顶部显示同步中/已同步/待同步
   - 显示待同步项目数量

技术要求：
1. 创建indexedDB服务封装所有本地操作
2. 实现网络状态监听(online/offline事件)
3. 创建Background Sync(如果浏览器支持)
4. 实现数据版本控制(防止冲突)

输出：
- PWA配置文件(manifest, Service Worker)
- IndexedDB数据库封装
- 同步队列实现
- 离线状态UI组件
- 数据同步逻辑

验收标准：
- 应用可以安装到桌面(PWA)
- 离线时可以创建/编辑日记
- 网络恢复后自动同步数据
- 同步状态正确显示
- 数据冲突正确处理
```

---

## 阶段八：部署与CI/CD配置

```
基于阶段七的PWA离线支持，完成部署配置和CI/CD流水线。

部署配置要求：
1. 前端部署(GitHub Pages)
   - 配置GitHub Actions工作流
   - 构建并部署到gh-pages分支
   - 配置自定义域名(可选)
2. 后端部署(Render)
   - 创建render.yaml配置文件
   - 配置环境变量
   - 配置PostgreSQL数据库

CI/CD流水线：
1. GitHub Actions配置
   - 代码提交时自动运行测试
   - PR合并时自动部署前端
   - 后端自动部署到Render
2. 数据库迁移自动化
   - 部署时自动执行prisma migrate deploy
3. 环境变量管理
   - 开发/生产环境分离
   - 敏感信息使用GitHub Secrets

监控与日志：
1. 配置Render日志收集
2. 配置前端错误监控
3. 配置性能监控(LCP, FCP等)

文档要求：
1. 创建README.md
   - 项目介绍
   - 技术栈说明
   - 本地开发指南
   - 部署指南
2. 创建API文档
   - 所有接口列表
   - 请求/响应示例

技术要求：
1. 创建Dockerfile(可选，用于本地开发)
2. 配置CORS允许GitHub Pages域名
3. 配置API基础URL(根据环境变量)

输出：
- .github/workflows/ 下的CI/CD配置
- render.yaml
- Dockerfile
- README.md
- API文档

验收标准：
- 代码推送到main分支自动部署
- 前端在GitHub Pages正常访问
- 后端在Render正常响应
- 前后端可以正常通信
- 数据库迁移自动执行
```

---

## 使用说明

1. **按顺序执行**：每个阶段都依赖前一阶段的成果，必须按顺序执行
2. **验收验证**：每个阶段完成后，运行验收标准中的所有测试项，全部通过后再进入下一阶段
3. **代码备份**：每个阶段完成后，建议提交git commit，方便回滚
4. **环境准备**：阶段一开始前，确保已安装Node.js >= 20.0.0和PostgreSQL >= 14
5. **AI模型配置**：阶段五需要配置真实的AI API密钥(DeepSeek和OpenRouter)

## 项目信息

- **项目名称**：有迹(Youji)
- **项目类型**：AI驱动的日记/日程/目标管理PWA应用
- **目标平台**：Web(桌面端 + 移动端)
- **部署平台**：GitHub Pages(前端) + Render(后端)
- **主要AI模型**：DeepSeek-Reasoner + MiMo-V2.5
