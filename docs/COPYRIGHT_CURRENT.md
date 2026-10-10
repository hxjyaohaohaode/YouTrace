# 有迹 YouTrace 技术材料草稿与源码边界

原稿编制日：2026-10-09；生产文件清单与验证边界更新：2026-10-10（北京时间）。用途：从真实冻结源码整理的工程说明和操作手册框架，可供后续定稿复用。不是已经提交的登记材料，不认定权利人、作者贡献、开发完成日期、首次发表日期或法定登记版本。旧[候选索引](COPYRIGHT_CANDIDATE.md)和[架构快照](ARCHITECTURE_CURRENT.md)保留为历史；静态审核不是运行验收。

版本读法：416文件候选与随后417文件的首次文档同步，是2026-10-09材料编制时的历史基线，不是当前HEAD文件数。本稿保留它们的原始身份及历史验收；第七章和仓内[生产文件身份](copyright-preparation/source-identity.json)、[审阅顺序](copyright-preparation/source-excerpt-order.json)已按本轮冻结生产字节重算。清单不包含自身，整库tree、同步提交及该提交CI由外部最终回执或Git读取，避免自引用，也不把旧CI直接继承给后续提交。

路径约定：正文的源码路径默认相对应用目录youji-app；仓库根README、docs、设计稿和根Logo均明确加“仓库根/”前缀。准备包中的“YouTrace-交付源码SHA256清单.txt”记录的文件路径则相对仓库根，可用于逐文件校验；该清单不是功能验收证明。

## 一、软件识别及待定字段

- 当前界面产品名：有迹 YouTrace。见 `index.html:7-10`、`src/components/ui/Brand.tsx:5-7`、`src/pages/Login.tsx:133`。内部目录/包名youji-app、youji-server及既有youji存储键是技术标识，不应列为另外两个软件名称。
- 正式申请全称、简称、版本号：待申请方确认。本稿不采用前端0.0.0、后端1.0.0或旧设计稿V3.1.1作为正式版本。
- 历史文档补充前源码内容树：`612ba824c49e4811f6bde723936af3c011e18c08`；416个文件。
- 历史基线提交：`7e45e36bcbfb07191cfed446967f99dd1cda9a05`。本稿依据该提交之后的冻结内容候选编制；该基线提交不能作为后续同步提交的身份。该416文件身份只适用于当时的历史准备包；新版同名SHA256清单标识新版源码，不可反向当作此旧候选的清单。最新同步提交须另核GitHub主线。
- 可见构建标识来自Git短修订号，导出源码无Git时为unknown。证据：`vite.config.ts:8-12,23`、`src/components/settings/DiagnosticsPanel.tsx:9-10`。正式截图时应另保留完整冻结身份清单，不能仅凭unknown或包版本认定同版。
- 权利人/开发者与贡献、开发方式、完成和发表日期、授权关系：待真实资料确认。Git身份、文件时间、代码树哈希和本审计日期均不能代替这些事实。

## 二、用途与实现概述

有迹 YouTrace 是面向成人的个人生活记录与回看Web应用。用户在验证账号后，可记录和修改收支、待办、日程、习惯打卡、日记与目标；通过速记输入形成规则整理的可编辑确认稿，明确选择后保存；通过首页、时间线、记录观察与教练对话回看资料。应用以账号隔离的浏览器本地数据库承载主要业务记录，使用未确认修改队列、版本回执和变更序列进行账号同步，并提供冲突比较、备份导出与本地资料管理。

教练对话默认使用明确标注的规则回复；账号可配置本人的模型连接，需同意外发范围并在本次教练页面明确选择。只发送当前文字与已披露范围的有限会话历史，不附加应用记录。模型不会自动变更记录；操作建议须先核对，再由你主动点击执行。简报、洞察和提醒包含规则实现，应用内提醒仅在应用打开时处理。源码实现与某一环境的实测通过分别说明，不将设计愿景当作已实现能力。

依据：`仓库根/README.md:1-7`；`README.md:3,27-37`；`src/routes/index.tsx:57-75`；`src/pages/DataInfo.tsx:8-12`。

## 三、技术及运行环境

| 层次 | 当前技术事实 | 源码证据 |
|---|---|---|
| 形态 | React单页Web应用，浏览器访问；不是已交付的原生iOS/Android桌面客户端 | `index.html:12-14`、`src/main.tsx:1-14` |
| 前端 | TypeScript/TSX、React 19.2.5、React Router DOM 7.18.2、Zustand 5.0.12、Dexie 4.4.2、Framer Motion 12.38.0、Lucide React 1.11.0 | `package-lock.json`的对应packages条目 |
| 构建/样式 | Vite 8.2.0、前端TypeScript 6.0.3、Tailwind CSS 4.2.4；CSS主题变量 | `vite.config.ts`、`package-lock.json`、`src/styles/` |
| 服务端 | Node.js、Hono 4.13.13、Prisma/client 6.19.3、SQLite、OTP及JWT Cookie认证 | `server/package-lock.json`、`server/src/app.ts:64-77`、`server/prisma/schema.prisma:1-7` |
| 开发端口 | 前端开发5180；预览4173；/api代理默认3000 | `vite.config.ts:14-30`、`server/.env.example:2-6` |
| 开发要求 | 应用README推荐Node24；前端包引擎声明>=22.13.0；既有验收使用Node24.19.0与22.23.3，非对所有Node版本承诺 | `README.md:9`、`package.json:45-46`；验收范围见第六章 |
| 浏览器依赖 | IndexedDB、本地存储及Cookie；语音由浏览器SpeechRecognition可用性决定 | `src/db/index.ts`、`src/services/apiClient.ts`、`src/pages/QuickNote.tsx` |
| 配置边界 | 合成开发样例可暴露开发验证码，未配模型时规则回复；不代表真实短信和模型已验收 | `README.md:23,55-59`、`server/.env.example:1-15` |

不要求为材料运行种子、创建真实账号或访问线上数据。Render蓝图保留为历史配置，不等于已确认安全可部署模板：`README.md:57-59`、`仓库根/README.md:27-38`。数据库生产备份/恢复、真实服务配置及发布授权仍独立。

## 四、实际功能与用户操作说明框架

下面是可扩展为正式操作手册的章节。每章应在正式版本确认后补同版真实截图、可复现步骤与结果，不填入演示占位截图。失败/离线/冲突提示属于用户要理解的功能边界。

### 1. 启动、登录与初次引导

进入应用，显示有迹品牌和引导。使用手机号验证码完成登录或注册；新账号设置个人资料。需要身份确认后才访问该账号私人记录。重新打开应用时需确认身份，不能把已有会话标志描述为长期无条件离线登录。

证据：`src/pages/Login.tsx:133-250`、`src/pages/Onboarding.tsx:8-11`、`src/routes/index.tsx:35-61`、`src/stores/authStore.ts:52-125`、`server/src/routes/auth.ts`。

拟配图：登录页、验证码步骤、首次引导、身份暂无法确认提示。测试只用合成账号。

### 2. 首页及功能目录

首页提供速记入口、继续处理、最近记录、记录概览，以及有数据时的周回顾和今日建议。目录可进入记录与回看、安排与坚持、观察与行动、账号与偏好功能。

证据：`src/pages/Home.tsx:155-179`、`src/lib/navigation.ts:3-20`、`src/pages/More.tsx`。

拟配图：首页空态/有记录状态、桌面导航和移动功能目录；不把空卡片截图称为已保存的业务结果。

### 3. 速记：原文、确认稿与保存回执

输入文字，或使用浏览器支持的语音输入。先保留本机原文，再查看规则整理的确认稿；核对收支金额、日期、待办、日记、习惯打卡等候选，可修改、补充或取消选择。心情须由用户选择确认。点击确认保存后，保存原速记和选定记录，显示本机结果、后续同步状态及只读写入回执。已有同日日记以追加方式处理。修改结构化记录不会重写原速记原文。

证据：`src/pages/QuickNote.tsx:209-215`、`src/pages/QuickNoteResult.tsx:100-121,151-158`、`src/services/parser.ts:23-80`、`src/services/quickNoteIntegration.ts`、`src/services/captureReceiptView.ts`。本页规则解析明确不调用模型（`src/pages/QuickNoteResult.tsx:121`）。

拟配图：原文、可编辑确认稿、未选择项、保存回执、纠错后当前记录与旧回执对照。语音仅作已验证浏览器范围说明，不声称所有设备都可用。

### 4. 花销与预算

新增和修改人民币收支记录，核对名称、金额、类别和日期；金额以分存储。明细可按已加载记录的月份/类别筛选，查看期间统计。月预算保存在本设备，区分未设置、旧值待核对、显式0和已设置金额。删除或编辑前后可核对列表与统计。

证据：`src/pages/Expense.tsx`、`src/components/expense/AddExpenseModal.tsx:72-75`、`src/components/expense/BudgetCard.tsx:44-55`、`src/components/expense/expenseListFilter.ts`、`src/stores/expenseStore.ts:46-77`、`src/pages/Settings.tsx:334-360`。

拟配图：收支表单、筛选/清除、预算未设置及设定状态、编辑后列表。不要表述为银行账户接入、自动支付或金融专业分析。

### 5. 待办

创建待办，填写内容、优先级和日期；修改、完成、撤销完成或删除。保留取消时的编辑草稿；记录被其他位置修改时需重新核对，不应覆盖旧基线。

证据：`src/pages/Todo.tsx`、`src/components/todo/AddTodoModal.tsx`、`src/components/todo/TodoList.tsx`、`src/components/todo/todoDraft.ts`、`src/stores/todoStore.ts`。

拟配图：新增、完成/撤销、改期、取消再开草稿、并发冲突提示。截止日期不是完成事实时间。

### 6. 日程

使用日/周/月视图定位安排，新增或修改标题、日期、开始结束时间、类型和地点；支持每周重复及按实现范围调整/取消单次安排。当前日程界面标示中国标准时间UTC+8。

证据：`src/components/schedule/ScheduleContent.tsx`、`src/components/schedule/ScheduleEditor.tsx`、`src/stores/scheduleStore.ts`、`src/utils/scheduleOccurrences.ts`、`server/src/services/scheduleExceptions.ts`。

拟配图：日周月定位、编辑、单次/系列语义、取消和返回。不得写为外部日历双向同步或跨时区调度系统。

### 7. 习惯与打卡

建立习惯，选择当前频率及时间，记录真实日期上的完成事实，可补记和撤销；调整频率时先预览当前周期含义。每周一次是否达成与今天有无打卡分开显示，不用今天频率改写过去事实。

证据：`src/pages/Habit.tsx:22-25`、`src/components/habit/HabitList.tsx:142-143`、`src/components/habit/HabitFrequencyModal.tsx`、`src/stores/habitStore.ts`、`src/utils/habitPeriod.ts`。

拟配图：频率设置、今日/本周状态、历史日期补记/撤销、频率调整预览。

### 8. 日记与编辑恢复

按日期保存和回看文字，可自选心情；创建、修改、删除前确认，取消时保留本机编辑稿。同日冲突和其他位置修改需核对；已删除记录可按实际界面创建新ID副本，不称“撤销删除恢复原ID”。

证据：`src/components/diary/DiaryContent.tsx`、`src/components/diary/DiaryEditor.tsx:57,98-107`、`src/components/diary/useDiaryEditorDraft.ts`、`src/stores/diaryStore.ts`。此前限定修复：`src/components/diary/DiaryContent.tsx` 令已建立的深链编辑快照不因同账号迟到读取失败卸载；不证明首次空账号原生弹窗异常已解决。后续迟到回焦保护位于`src/components/diary/useDiaryFocusReturn.ts`，与首次空账号历史现象分开核验。

拟配图：空态、新增、编辑、取消保稿、日期冲突、删除确认和明确的新副本状态。已完成的四场景首开复测记录见第六章；均未观察到首开后的初始化重叠，原现象根因仍未知，不宣称所有时序条件均已闭环。

### 9. 目标

创建短中长期目标，编辑标题、描述、领域、优先级、计划日期，手动调整进度。新账号目标参与版本化同步；旧本机目标需逐项选择并确认上传。界面区分仅本机、待同步、已同步及需比较版本。

证据：`src/pages/Goal.tsx:20,117-140`、`src/stores/goalStore.ts`、`src/services/goalPayload.ts`、`server/prisma/schema.prisma:68-83`、`server/src/routes/sync.ts`。

拟配图：目标列表、字段/日期编辑、手动进度、旧目标上传确认与同步状态。目标不是自动行为评分，也不是群想跨产品成果验收。

### 10. 时间线与记录查找

按近7天、近30天或全部记录查看本机资料；期间可固定并显式更新到今天。按记录身份进入原记录纠错并返回；无发生时间的旧资料显示未知，日程计划/待办截止与完成事实分开解释。

证据：`src/pages/Timeline.tsx`、`src/pages/timelineRange.ts`、`src/pages/timelineReturnFocus.ts`、`src/services/timelineEntries.ts`。

拟配图：期间、同名记录定位、纠错后返回、原速记及回执入口。不要写为全站全文搜索、文件搜索或无限完整云历史。

### 11. 教练、洞察与应用内提醒

用户发送问题，读取服务端流式回复；可按界面确认支持的建议操作。每账号模型连接须自行配置并显式同意外发，每次打开教练页默认不选择个人模型；未配置、未选择或调用失败时显示明确规则回复。只外发获准的当前输入及受限、来源合格的会话历史，不自动附加日记、账单或其他业务资料；部分流中断会提示不完整。洞察和记录观察提供依据及精确原记录入口。用户可调整应用内提醒、回顾时间、免打扰与频率。

证据：`src/pages/Coach.tsx`、`src/pages/CoachInsights.tsx`、`src/components/coach/CurrentRecordObservations.tsx:58-68`、`src/stores/coachStore.ts`、`src/services/coachEngine.ts`、`src/services/lifeIntelligence.ts`、`src/services/pushControl.ts`、`server/src/routes/chat.ts:155-245`、`src/pages/Settings.tsx:366-410`。

限制：写操作限现有类型/界面确认；不是任意工具代理。后端有历史会话读取接口，但前端没有普通已保存对话历史入口，不能把“服务端保存”写成“用户可完整回看和续聊历史”。来源：`server/src/routes/chat.ts:22-52`、`src/pages/Coach.tsx`与`src/stores/coachStore.ts`。清空当前页对话不等于删除服务端聊天（`src/pages/DataInfo.tsx:10`）。

拟配图：规则来源标识、截断提示、依据展开、记录纠错入口、提醒设置。真实模型能力未外部实测，不使用合成流截图声称真实模型验收。

### 12. 同步、偏好、导出与资料管理

在设置查看当前账号同步、未确认修改和冲突；比较本机与云端记录，采用云端时保留本机恢复副本。提醒偏好有独立账号同步与确认状态；外观、预算和草稿仍为设备数据。可导出当前账号完整本地表/未确认修改/恢复副本；旧共享库隔离保留并可导出，不能自动推定归属。账号注销和本机清理应分别说明其范围与不可回退的后果。

证据：`src/pages/Settings.tsx:129-171,474-531`、`src/pages/DataInfo.tsx:8-12`、`src/components/settings/SyncConflictPanel.tsx:45-49`、`src/components/settings/PreferenceSyncPanel.tsx:9,39-41`、`src/db/index.ts:230-290`、`src/services/syncEngine.ts`、`server/src/routes/user.ts`。

拟配图：本机已保存/等待云端确认、冲突比较、账号偏好、本地导出、旧共享资料警告、注销确认。备份不是已经实现完整导入/恢复的承诺，也不包含可推定的全部云端聊天。其他设备离线缓存和已导出备份不因本机操作自动消失。

## 五、明确不列为现版完成能力

1. 后台Web Push、系统通知订阅/送达、定时worker/cron和关闭应用后的可靠主动提醒。
2. 图片/文件上传、OCR/Vision、多提供方语音识别或多模型路由灾备。
3. 群想等跨产品共享账号、自动双向同步、成果验收互认。
4. 旧共享资料自动归属、任意历史数据自动无损迁移、已验证的生产备份恢复/回滚。
5. 全部浏览器/设备兼容、原生移动端、任意工具执行、完整云端聊天历史入口与续聊。
6. 已对真实短信/模型提供方、生产Cookie/Render实例及真实数据完成验收。

依据：`README.md:37,57-59`、`src/pages/DataInfo.tsx:8-12`、`src/pages/QuickNote.tsx`、`src/pages/Coach.tsx`、`server/src/app.ts:64-77`和`server/src/index.ts`。源码范围与尚未完成的运行验证分开说明；上述边界不是永久产品规划。

## 六、历史验收与本轮新增回归边界

2026-10-10账户自配AI与本机持久化组合候选：生产TS/TSX/CSS范围重算为186文件、19,010物理行。平台不再提供预置模型或共享环境密钥路径；每账号可配置一条本人连接，保存不自动测试，对话每次打开须显式选择，调用可能收费。未配置/未选择时仍有明确标注的本地规则回复，不能称为真实模型调用。已有业务记录与聊天正文保留，历史来源标记用于防止未经许可外发。密钥服务端加密，不进入普通账号导出；部署仍须受控配置匹配的加密密钥。组合fresh npm ci已完成，前端最终1080项（0失败0跳过）及lint/build、后端84项及generate/lint/build通过；教练欢迎语已纠正为仅当前输入和披露的有限会话历史，不含应用记录摘要，全界面隐私提示真实组件专项17项及独立主动点击执行探针1项通过。本机持久化最终25项通过，包括加密凭据备份/重启/恢复及错密钥或缺失密钥检查，实际Docker运行仍未完成。新原生AI界面本地因明确内核限制未执行，新的精确托管CI待验。deploy/local增加单实例SQLite持久卷、启动保护、一致性备份与受限恢复；加密连接随整库恢复必须匹配原密钥。这些Python/容器/配置不属于本页TS/TSX/CSS摘要范围，需另绑定完整Git树。未实际部署、未宣称生产恢复通过、未调用真实供应商；免费优先不免除短信/模型费用，机器、受信TLS及合法配置前提仍在。详见[账户自配AI](USER_OWNED_AI_20261010.md)及[本机持久化包](../deploy/local/README.md)。

以下前三项保留2026-10-09首次材料编制时的416文件候选验收；计数与“尚未运行”均描述当时时点，不是当前HEAD的完整验证状态：

- 非浏览器检查：Node24.19.0前端999/999；Node22.23.3前端999/999、后端73/73；相关lint/build通过。这些事实不代表真实浏览器或线上服务全部通过。
- 日记限定回归：同8项测试在旧源码3通过5失败，在新源码8通过；使用React组件/路由和fake-indexeddb，不是真实浏览器画面或原生鼠标键盘验收。
- 编制本文时，416文件冻结候选的普通浏览器E2E与21个原生用户任务组尚未运行；后续同步提交的CI状态须按其精确提交另核。历史首次空账号日记弹窗在保存前消失的问题仍未解释，不能因深链编辑的限定修复宣称已解决。
- 可公开追溯的历史CI入口：[602716d8运行](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37208454062)、[2629d9e4运行](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37211614212)、[48ea8819运行](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37424048535)。这些均为旧版本，只能按各自提交和实际任务范围引用；不能替代上述历史416文件候选的999/73摘要或新版整体验收。历史附件是否仍可访问需另行核对。
- 源码中的`仓库根/.github/workflows/ci.yml:55-60,108-118`定义截图/结果上传及14天保留。配置存在不表示已经执行或已生成可用图片。最终定稿仍需取得同版真实截图并保存原件。

前次材料更新记录（2026-10-10北京时间）：历史主线`7327e22700bb5fbb9639d0aef42182472a1656d6`、tree `e6a8c605efaf50aec4c538c405d7bffbde45be3f`共424文件，其[CI 37970818142](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37970818142)首次22项作业全过，日记50项、日程126项原生观察通过，覆盖当时迟到回焦和键盘可视性问题。当时另外新增首次空账号审计前置与回归，仅修改3个测试层文件，生产实现与品牌不变；本地前端1045、后端73项通过。编制时新增首开原生场景尚未实跑，测试定义和本地通过不能替代它，也不能自动关闭历史首次空账号弹窗消失现象。含新增回归的精确提交、完整CI和实际工件仍须另行绑定。

后续精确运行：主线`0e67e392bcb89eddbc22bfad2dfbcf5d6c139143`、tree `ab9e3c8687f10b848e8120e29dbc97a85b33fae3`共428文件，[CI 37976299454](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37976299454)为21项作业成功、1项expense-records失败。日记整组66项原生观察通过，其中新增首开四场景共16项通过，但均未出现首开后的初始化重叠，原历史消失现象根因仍未知。expense-records的两项失败发生在桌面收支编辑取消/保存返回Timeline后的下一次Tab：焦点正确而记录行及其轮廓被视窗底边裁切；不能归因于新增日记测试，也不改旧失败为全绿。

前次Timeline代码候选记录（原编制时点）：仅增加键盘焦点可视性检查及一份回归，不修改品牌、布局样式、数据协议、原生断言或超时。同一真实handler替身回归在旧代码4失败/2通过、新代码6通过；前端1051、后端73项及类型、lint、构建检查通过。这些是代码候选的本地结果，新候选在精确同步提交上的原生复验仍须另取证，不能以本地回归替代托管旅程。

前次侧栏测试更新的编制记录（2026-10-09 19:42 UTC）：`7b9ef42f05fd66626533e575afc0eb69153af950`的[CI 37980241786](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37980241786)中，expense组183项原生观察通过，原两项Timeline边缘Tab失败已实际复验；普通verify因旧260px侧栏阈值与真实232px布局契约冲突失败。本轮仅修改3个测试层文件，检查实际workspace/aside边界及paint/stability；182个生产文件逐字节不变，品牌及超时不变。本地前端1066、后端73项及类型、lint、构建通过，契约专项旧10失败/5通过、新15通过。编制时旧运行完整终态仍待核，新精确提交的修订契约尚未托管实跑，不能据此声称全CI通过。首次空账号历史根因与未观察到的初始化重叠条件仍保留原范围。

当前CI准备候选（2026-10-10北京时间）：上述7b9运行最终20项成功、verify失败、diary-records因字体安装前置未完成而取消，后者未执行probe或原生任务。本轮新增单独的官方APT准备作业，工件经摘要及运行身份等校验后离线安装；原22项测试、原生probe及20分钟作业/8分钟原生预算保留，总计预期23项作业。生产182文件、品牌及摘录不变。前端1066、后端73及相关lint/build通过，另有22项Python CI准备合同测试（含真实APT对合成状态的模拟）；它们不计入前端1066项，也不证明Ubuntu已实际下载或安装。编制时完整Ubuntu准备、工件传输、离线安装及新精确提交全部23项托管作业尚未执行，须另核；范围见[CI前置准备](CI_PREREQUISITES.md)。

逐文件身份可用准备包中的“YouTrace-交付源码SHA256清单.txt”核对。正式截图应另记录冻结版本、实际执行提交/会话、原始文件SHA-256、页面和步骤、视窗尺寸、合成账号及限定范围；不得把旧图或模拟结果改标成新版实际操作，也不使用私人真实数据。

## 七、源码材料范围与排序

本轮严格正文候选：186个生产TS/TSX/CSS文件，共19,010物理行（含注释/空行；不等于正式排版有效行）。顺序：启动/认证 → 账号数据库和本地事务 → 同步协议 → 速记确认与回执 → 六类日常记录模块 → 首页/时间线/教练 → 服务端认证/业务/同步 → 公共组件与样式。上述为建议编排顺序；逐文件路径、字节、行数与哈希见仓内[source-excerpt-order.json](copyright-preparation/source-excerpt-order.json)，完整生产集合身份见[source-identity.json](copyright-preparation/source-identity.json)。上述186项摘要集合为`546dd6f3559c768bfbe57e99ec7d37407dfadd7c63f7df36eb36f2ed6583a331`；适用后续版本前须重新逐文件核对，不能代替作者来源确认。

本轮冻结候选按实际目录排除112测试文件、48审计工具（后者含CI Python helper及其合同测试文件）、两个依赖锁文件、node_modules/生成客户端/dist、九份素材、合成seed、声明文件及来源未逐项确认的migration SQL。schema、必要入口与配置可作为结构说明附录；选取不代表对所有项目文件的作者身份作出认定。不为凑篇幅插入第三方代码、生成文件或空白填充。

## 八、依赖与素材来源补充

14个直接运行依赖的当前版本与许可声明可在`package-lock.json`和`server/package-lock.json`核对。两个锁文件共458个非根条目（包括开发/可选依赖），其中71项未标dev；跨锁未去重。锁文件声明不代替许可全文、NOTICE审查或资产授权。

原始`仓库根/logo.txt`与`仓库根/纯logo.txt`分别哈希为`1392864aca6c6b66dae4207081e61eaadeb254650fa2d6a5b16ee4889427390d`、`7250f7734b95d02da53ffc3485bf1038d88c0a9ddb40dd4a52cde5fda3bce522`；`public/brand/youtrace-wordmark.svg`、`public/brand/youtrace-mark.svg`、`public/favicon.svg`均为对应原件精确副本。不得为材料替换原始标志。品牌保存只证明字节一致，不证明原作者授权；真实权利资料待补。

`src/assets/react.svg`、`src/assets/vite.svg`、`src/assets/hero.png`、`public/icons.svg`另列第三方/待溯源素材。树中未发现字体二进制，仅有系统字体栈及SVG文字引用；应保留原设计来源并核对实际分发范围。
