# Phase 0 — 冻结与证据审计

审计日期：2026-09-22。业务代码基线：`4ec3012e0981dda55a37a39fcb56875decd9fe6d`。范围：当前 v2、只读 legacy、隔离本地验证、公开部署只读探测。本轮没有修复业务数据协议，没有访问/迁移真实生产数据库，没有部署或 push。

## 1. 结论与 Git 冻结状态

**基础构建/既有测试通过，但当前版本不满足数据安全发布条件。** P0 不是 UI 完善程度，而是已复现的账号串数据、未 ACK 的修改被丢弃、分页跳过数据、删除复活和旧数据迁移失败。不能继续以 CI 绿色代表可安全生产。

- 起始 `git status`：`recovery/vnext-20260827`，无已跟踪文件修改；两份用户已有根目录恢复提示/清单 Markdown 未跟踪，保留且不纳入提交。
- `git branch -vv`、`git log --oneline -10`：当前 recovery、local main、local origin/main 均指向上述基线；v2 历史仅 `4ec3012`、`9abd4d3` 两个提交。
- origin 为 `https://github.com/hxjyaohaohaode/YouTrace.git`。`git ls-remote` 本次网络失败，不能把本地 origin/main 当作实时远端确认。
- legacy 只读引用 `origin/legacy-v1-fastify`，SHA `ac64c7f21b7bc7cca12894f5dcbeb8beff129838`；`git merge-base main origin/legacy-v1-fastify` 返回 1，无共同祖先。
- GitHub API 实际读到 [基线 CI run](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/33061636314)，2026-08-27，结论 success，head 与基线一致。这是历史运行，不是本轮新 CI。
- 本轮仅添加长期上下文、审计/架构/计划、根 AGENTS 入口和可复现诊断脚本；不修改 main、legacy、生产配置或业务源码。

### 证据强度与范围

`CONFIRMED`：当前代码明确存在，关键缺陷另有实际复现；`PARTIALLY CONFIRMED`：部分成立但有范围修正/线上未验证；`OUTDATED`：旧描述已不准确；`NOT FOUND`：指定能力未找到（不是证明绝不存在）；`NEW ISSUE`：旧审计未明确列出的新增发现。每条另述是否运行复现。

枚举全部跟踪文件、依赖/配置/schema/migrations/测试，深读认证、存储、同步、数据写入、AI/设置/导出/删除关键链，检查各路由/导航/业务页面与 legacy 对应实现。不是逐按钮人工验收、渗透测试或所有代码路径的形式化证明。架构与完整功能取舍矩阵见 [ARCHITECTURE_CURRENT.md](ARCHITECTURE_CURRENT.md)。

以下 `src/`、`server/`、`scripts/` 路径相对 `youji-app/`；根配置明确写全。行号为上述基线定位，后续改动后应按函数再次核对。

## 2. 对用户提供 A–Z 审计的逐项复核

| 项 | 状态 | 当前结论与证据 |
| --- | --- | --- |
| A 技术栈/规模 | CONFIRMED | 两个 package.json；117 个跟踪 TS/TSX、约 16,651 行（含测试）；React19/Vite/Zustand/Dexie，Hono/Prisma/SQLite/JWT/Zod。不是小型 Demo。 |
| B CI 与测试 | PARTIALLY CONFIRMED | 根 `.github/workflows/ci.yml:10` 仅前端 build、后端 generate/build/14 tests；嵌套 workflow 不生效。没有前端独立 test script，但后端 suite 第 332/355 行也测试了前端 date/SSE 纯函数，不能说前端相关测试完全为零。 |
| C Render+SQLite | PARTIALLY CONFIRMED | `render.yaml:19,23,41` Free、构建时迁移、SQLite，无 disk；平台临时文件系统风险已用官方文档核对。实际 Dashboard/生产 DB 未核验，不能断言已发生丢失。R01。 |
| D Origin 不一致 | PARTIALLY CONFIRMED | `render.yaml:35` 是旧域名，给定实际前端带 `-ezu4`；`server/src/app.ts:42` 拒绝错误/缺失 Origin 的写请求。线上超时，Dashboard override 不明；未得到实际 403。R11。 |
| E 本地账号隔离 | CONFIRMED | `src/db/index.ts:105` 共享库；`authStore.ts:109` logout 不切库/重置全部 stores。浏览器 A→B→A 复现 B 可见 A Todo。R02。 |
| F clearAllData 漏 Goal | CONFIRMED | `src/db/index.ts:218` 清 11 表漏 goals，且 Promise.all 非事务；浏览器清除后 Goal count=1。R12。 |
| G 分页静默丢数据 | CONFIRMED | `/sync/pull` 每实体 2000；`syncEngine.ts:359` 直接升到 serverTime。实际 2001→2000；10001→2000。R06。 |
| H 删除同步/复活 | CONFIRMED | `server/src/routes/sync.ts:384` 硬删除；schema 无 tombstone/change log。创建→删除→旧设备 upsert 后记录重新出现。R07。 |
| I Outbox 丢修改 | CONFIRMED | `syncEngine.ts:159,169,187` 删除已发送项/ownership conflict/重复 4xx；logout 也清队列。403、400×2、413×2 均复现丢项。代码有 toast，故“完全无提示”需修正；持久恢复信息仍缺失。R05。 |
| J Goal 不完整 | PARTIALLY CONFIRMED | 无后端/同步/搜索/chat context；`goalStore.ts` 本地。补充：`lifeIntelligence.ts:136` 已统计 Goal，habit/todo 也会增加其进度，不能说与全部数据完全不连通。R13/R22。 |
| K Settings 不完整 | CONFIRMED | `settingsStore.ts:34,55,73,107` 仅部分字段直接 PATCH；GET 只合并 style/pushLimit，未合并 quietStart/End，enabled/晚评等无完整服务器模型；错误被 catch 掉，无 outbox。R14。 |
| L Goal 不可发现 | CONFIRMED | `/goal` route 有，DesktopSidebar/TabletSidebar/QuickActions 无 Goal。Timeline 仅有 goal_progress 类型/跳转映射，未生成 Goal 事件，不能把它算真实发现入口。R25。 |
| M 源码污染 | CONFIRMED | `src/routes/index.tsx:66` 存在字面量反引号+n；本次 build、路由 smoke 仍通过。确认污染，不推断它已造成路由崩溃。R25。 |
| N AI provider 架构 | PARTIALLY CONFIRMED | 单一 `/chat/completions`，无 registry/catalog/router。`server/src/utils/env.ts:46` 已集中环境配置，默认厂商/模型仍硬编码；“厂商名散落各业务调用”并非当前确证。R17。 |
| O AI fallback | CONFIRMED | `chat.ts:139` 无 key 有规则回答；有 key 错误分支 `:177` 给通用失败提示，不转第二模型/规则。没有上游错误分类/来源标记。R17。 |
| P AI action 临时协议 | PARTIALLY CONFIRMED | `chat.ts:214` 已有 Zod action schema 与 navigate 白名单、前端点击确认；`:242` 仍解析 fenced JSON。缺 durable permission/idempotency/execution audit/outcome；不是完全无类型校验。R18。 |
| Q Context 过窄 | CONFIRMED | `chat.ts:273 buildUserContext` 约7天消费、habits、最多10 Todo/5 Diary/10 Schedule；无统一检索/长期记忆/evidence。消费还混入收入。R19。 |
| R 非真正后台主动智能 | CONFIRMED | `Home.tsx` 打开页面触发规则与 brief；无 Job/Run/worker/lock/retry/catch-up 存储。模型名为 Push/Insight 不代表后台执行。R20。 |
| S Push fallback | CONFIRMED | 本地 `pushControl.ts` 有频控/quiet hours；无 Web Push/subscription/SW/delivery 记录。已有页面内提示，三层送达链未实现。R20/R21。 |
| T QuickNote 规则解析 | CONFIRMED | 前后端 parser 主要 regex；“AI 拆分”不等于模型解析。确认稿分项执行，无事务/幂等；已有日记可能被覆盖。R09/R19。 |
| U Voice | CONFIRMED | `QuickNote.tsx` 使用 SpeechRecognition/webkitSpeechRecognition，无服务器 STT。文本输入兜底已经存在，不应误报为连手工兜底也没有。 |
| V 图片/文件链 | CONFIRMED | 当前无 upload/file model/storage/OCR/vision→draft→实体链。旧版 upload 不在当前路由树。 |
| W PWA 退化 | CONFIRMED | 当前 public 无 manifest/service worker/register；旧树 `client/vite.config.ts` VitePWA 确认。IndexedDB 本地数据不等于可离线重新打开 app shell。R24。 |
| X legacy 功能消失 | CONFIRMED | 旧树 weather/location/notification/push/upload/search/trigger、StatsPage、agentOrchestrator 代码在。本轮未运行旧版；取舍矩阵列出价值、成本、隐私和依赖，不承诺全部恢复。 |
| Y SafetyResource | CONFIRMED | `emotionEngine.ts:89`、`chat.ts:370`、Coach 页面存在硬编码资源；无来源/核验日期。官方统一 12356 已确认；没有拨号测试，不能断言其他号码全部失效。R23。 |
| Z 文档能力差距 | CONFIRMED | `COACH-DESIGN.md:11` 承认愿景与实现差距；`youji-app/README.md:174` 对实际根 CI 的 lint/audit 描述过度；SECURITY 的迁移/撤销/合规说明不能替代测试证据。R26。 |

**变化说明：**本地业务 HEAD 未比用户指定基线更新，所以不能把“此次纠正旧报告的范围”描述成代码已经修好。B/J/L/N/P/U/I 的部分旧表述需修正；上述核心 P0 没有一项可以标为已经解决。全项 `OUTDATED` 的严重问题未发现；目标能力的缺失按对应条目明确记载，不伪造实现状态。

## 3. 风险表（含新问题与证据）

严重度：P0=阻止发布的数据丢失/隐私边界风险；P1=重要正确性、安全或可用性风险；P2=功能闭环、体验/性能/测试缺口；P3=在稳定基础上再做的治理/增益。P0/P1 不必等后期“安全阶段”才修。

| ID | 等级/类别 | 触发与影响 | 证据/验证 | 建议处置 |
| --- | --- | --- | --- | --- |
| R01 | P0 部署/数据 | 按当前 Blueprint，重部署/重启/休眠丢 SQLite；build migration 与未来磁盘挂载时机不兼容 | render.yaml:19,23,41；官方 Free/Disk 文档；线上实态 BLOCKED_EXTERNAL | 先盘点并备份/恢复演练，再迁移受管 PG；不要先重启试验 |
| R02 | P0 隐私/数据 | A 登出 B 登录仍读 A 的业务库；内存、游标、定时器与 in-flight 请求无 session epoch | db/index.ts:105；authStore.ts:109,157；App.tsx/useAppInit；浏览器复现 B 看到 A Todo | 账号 DB factory+运行时边界；旧共享库隔离保留、显式认领 |
| R03 | P0 NEW ISSUE 升级可用性 | Dexie v2 的自增主键改为 v3 字符主键，升级直接失败，旧用户数据打不开 | db/index.ts:106,119；真实 Edge fixture 报 UpgradeError；不是已证明物理数据被删 | 跨库 copy/校验/可恢复迁移，不删除旧库来“修复” |
| R04 | P0 NEW ISSUE 迁移丢失/失败 | 非空 Habit/Expense/QuickNote 的 ALTER CURRENT_TIMESTAMP 不兼容；同日 Diary/Checkin 去重直接 DELETE | sync_foundation migration:3,6,7,9,31；非空 Habit 实测失败；2 Diary→1；旧 Checkin 无 createdAt 但 INSERT SELECT 引用它 | 先查真实迁移履历/备份；离线演练完整旧数据，不直接改已执行 migration |
| R05 | P0 数据 | outbox 只有全包 200 判成功；logout/403/重复4xx 删除未 ACK 修改 | syncEngine.ts:145,159,169,187,208；authStore.ts:112；浏览器 4 类删除实测 | 持久 mutation 状态/逐项 ACK；失败保留+导出/重试；注销暂停不丢弃 |
| R06 | P0 数据 | 时间上界被当成分页游标，超2000条变化永久跳过 | server sync:115,135,153,175；client sync:353；10001 实际仅2000 | sequence change feed + 正确提交可见性/快照协议；不可只调大 limit |
| R07 | P0 数据 | 硬删除无法通知其他设备，旧设备 upsert 重建已删记录 | server sync:384；schema 无 deletedAt；实测 resurrection | tombstone+版本冲突+retention/旧设备重建策略 |
| R08 | P0 NEW ISSUE 数据 | 缺父 HabitCheckin 被 continue，仍返回200 synced=0；客户端删除该操作 | server sync:363,428；client sync:145；进程内 API 实测 | 每个 mutation 明确 rejected/deferred/acked，不把整包 HTTP 200 当 ACK |
| R09 | P0 NEW ISSUE 内容覆盖 | sync 第二设备同日日记覆盖 A 内容但保留 A ID；B 不获 ID mapping；速记也直接替换已有日记 | server sync:319；quickNoteIntegration.ts:95；实测 A内容消失、ACK仍1 | 稳定规范 ID/显式冲突、保留版本或合并草稿；确认覆盖，保全原文 |
| R10 | P0 NEW ISSUE 离线数据 | 业务写入与入队不是事务；pull bulkPut 不区分本地待同步版本 | todoStore.ts:87,91 等 stores；syncEngine:242,365；静态路径确认，故障注入待 Phase1 | 同库事务、pending overlay/baseVersion；crash/quota/中断专项测试 |
| R11 | P0 条件部署/可用性 | 若 Dashboard 未覆盖旧 ALLOWED_ORIGINS，实际前端 auth/mutation 被拒 | render.yaml:35；app.ts:42；生产 OPTIONS 两个 origin 均超时 | 代码/Blueprint/实际 URL/Dashboard 四方一致；先 staging 验证，不误报线上403 |
| R12 | P1 隐私/生命周期 | clearAllData 漏 Goal，清除非事务；export 漏 outbox/cloud chat，无 restore | db/index.ts:187,218；Settings:176,206,219；Goal残留实测 | registry+原子清除+完整导出/恢复契约 |
| R13 | P1 数据/功能 | Goal 只本地，不跨设备、不进服务端AI/search；清理也漏 | goalStore.ts、schema、SyncEntity；本地 weekly统计存在 | 一等实体并补全 lifecycle/sync/可发现性 |
| R14 | P1 数据/隐私 | settings PATCH失败吞掉，quiet双向不一致；延迟timer可跨账号执行 | settingsStore:55,73,107；GET读写不对称 | 设置分层政策、所有者绑定、outbox、完整 merge |
| R15 | P1 NEW ISSUE 安全 | logout只删cookie；旧JWT仍有效。删账号后/me401，但/todos仍200 | middleware/auth.ts:15；session/auth/user routes；实际 cookie重放；既有测试仅查/me | session表/tokenVersion+业务路由撤销校验+设备/密钥策略 |
| R16 | P1 NEW ISSUE 队列/容量 | 全 outbox 一次发包超过实体 max500/1000 或1MB限制；finally补偿覆盖指数退避 | syncEngine:97,180,200,204,391；server sync:89；app.ts:59 | 有界批次/字节上限、Retry-After/退避、deferred parent及监控 |
| R17 | P1 AI 可靠性 | 单provider失败无secondary/rule兜底；错误以普通assistant消息完成，无结构化降级状态 | chat.ts:139,149,177,186；env.ts:46 | capability routing+错误分类+真实可测试降级，明确来源 |
| R18 | P1 AI 写安全 | typed action存在，但执行状态只在UI，缺in-flight幂等/权限审计/结果 | chat.ts:214,242；coachStore:379及后续 action handler | 先保留确认；执行ledger+permission+幂等+outcome |
| R19 | P1 AI/业务正确性 | “AI拆分”实为规则；context消费混入收入；用户文本直接混入system上下文；草稿编辑与保存解析不同 | chat.ts:273；coach.ts generateBrief；QuickNoteResult:139；quickNoteStore.addRecord | 诚实来源、授权/上下文边界、规则财务统计测试、保存确认稿 |
| R20 | P2 功能/可靠性 | 无真正job/worker/WebPush，app关闭不执行；quiet/frequency仅局部有效 | Home.tsx；pushControl.ts；schema/服务入口 | Job+Inbox+catch-up，不假装后台智能 |
| R21 | P1 NEW ISSUE 持久化 | 登录态本地产生insight/push只入Zustand，不写DB或创建API；随后mark read/dismiss可能404 | coachStore.ts:608,621,678,691；server coach routes无对应创建这些client IDs | 统一站内记录所有权/持久化；reload/offline/markread测试 |
| R22 | P1 NEW ISSUE 假进度 | Todo/Habit true分支按关键词/领域累加Goal；取消不反向扣减，再打勾可再增加 | habitStore:41-54；todoStore:19-29 | 显式关系+事件幂等+可解释/可撤销进度，不声称目标真正完成 |
| R23 | P1 安全资源 | 多处硬编码热线，无来源日期/地区管理 | emotionEngine:89；chat:370；Coach页面 | 来源核验Registry；模型只能引用白名单资源 |
| R24 | P2 离线/性能 | 无PWA shell；全表读/大store；真实移动性能未测，build有无效dynamic import警告 | public/vite.config；store loadFromDB；bundle报告 | 先隔离和正确性，再安全缓存/增量查询/性能测量 |
| R25 | P2 UX/源码 | Goal入口缺失；源码反引号+n；Timeline将时间推定为12点/任务dueDate，不是事件时间；错误边界无条件声称数据安全、刷新即可继续 | routes:66；sidebars/QuickActions；Timeline.tsx；components/ui/ErrorBoundary.tsx:35 | 两条合理入口、小修源码；ActivityEvent后再替换时间线语义；错误提示不作未经验证的数据安全保证 |
| R26 | P1 测试/供应链 | 根CI缺lint/审计/迁移已有数据/E2E；已装锁定依赖存在high；后端.env.example缺失 | 根workflow；package-lock；npm audit；README安装步骤 | 独立补门禁和依赖修复，不用audit fix大范围越级升级 |
| R27 | P2 安全/运维 | rate limit仅进程内，health不验证schema/SMS，日志/监控/备份恢复无验证闭环 | utils/rateLimit.ts；app.ts:79；render.yaml | 分布式限流/依赖就绪监测/脱敏审计/恢复演练 |
| R28 | P3 治理 | brand/assets/version分散、部分文档夸大、性能优化缺测量预算 | 两package、UI文本、README/COACH-DESIGN | 稳定后统一配置/版本与真实能力文档 |

### 新问题的限定，避免夸大

- R03 已证明“无法升级打开”，没有证据证明浏览器已经删除旧数据；不得建议清除浏览器站点数据。
- R04 真实历史数据库未获得。Fixture 用初始 migration 建库，再用项目 Prisma 执行历史 SQL；已证明 SQL 本身对非空数据的问题。没有据此声称所有生产库均处于同样版本。
- R09 的 API 复现确认内容覆盖和 ID 不映射；跨设备 B 删除旧ID后留下服务端A 的后果由当前 deleteMany 语义推导，未做完整两浏览器同步 UI 演示。
- R10/R14 的断电、quota、跨账号 in-flight/timer 是代码中缺少原子性/身份绑定的风险路径，未作为已实施故障注入的通过/失败结果。
- R15 旧用户 GET 返回200不等于能读其他用户数据；过滤仍用旧 userId。问题是会话撤销不成立，并非已证明任意跨用户服务端读取。
- sync 的 P2002 fallback 按 id 更新时未重新校验 ownership，未来并发/PG 迁移需要专项验证；尚未证明当前 SQLite 下跨账号竞争可利用，不列成已复现泄露。
- 浏览器 smoke 中出现 React “未挂载组件更新状态” console warning，未产生 pageerror；来源尚未定位，列入组件测试工作，不假装已修复。

## 4. 可复现诊断与 baseline test report

### 环境与安全边界

本地 Windows / PowerShell，Node `24.15.0`、npm `11.12.1`。使用已安装依赖；未宣称 clean clone/全新安装已通过。新增 `scripts/phase0-data-probe.mjs` 只用系统临时目录中的合成 SQLite、随机测试JWT及 headless Edge 临时浏览器上下文；不读取生产.env、不发送真实 OTP、不调用模型、不写用户浏览器 profile、不创建生产账号。

脚本主测试直接调用真实编译后 Hono 路由和 Prisma；浏览器数据测试导入真实 Dexie/stores/sync，stub API 响应来控制 A/B/失败情境；UI smoke 用真实页面与进程内真实后端传输。**不是生产网络、短信登录、两真实设备或完整 E2E。**临时 fixture 在 finally 中按确切生成文件清理，旧版与真实数据库不动。

```powershell
# 仓库根下按目录分别执行；无需真实API key
cd youji-app
npm run typecheck
npm run lint
npm run build
cd server
npm run check
cd ..
node --check scripts/phase0-data-probe.mjs
node scripts/phase0-data-probe.mjs --browser --ui-smoke
```

浏览器默认安装路径为 Windows Edge；可通过 `AUDIT_BROWSER_PATH` 指定本机浏览器。不带 `--browser` 可运行服务端/迁移部分。需 Node >=22.13、前后端已安装依赖、后端 build。退出 1 且 `completed:true` 表示发现数据不变量违反，是 Phase0 缺陷证据，不应删除这些断言或反转预期以获得绿色。`completed:false` 是探针未完成，不能算业务通过。

| 检查 | 本轮结果 | 范围/备注 |
| --- | --- | --- |
| frontend typecheck | PASS | `tsc -b` |
| frontend lint | PASS | 仓库现有 TS/TSX lint；mjs 另做语法检查 |
| frontend build | PASS，有 warning | 最后复跑entry约402.76kB/gzip129.53；db chunk约98.29/gzip32.30；CSS约78.92/gzip12.10；coach/goal动态导入与静态导入混用，无额外切块效果；另有CSS plugin耗时warning |
| backend lint/build/tests | PASS | `npm run check`，14/14，最后复跑约5.45秒（首次约11.5秒）；不覆盖下列严重不变量 |
| 历史 GitHub CI | PASS（历史） | main基线run；本轮未push，未触发新的recovery CI |
| 现有 `scripts/e2e-api.mjs` | BLOCKED_LOCAL | 首个 migrate deploy 在本机Windows新建SQLite文件时Schema engine error；未执行其业务断言，不记28项通过 |
| 空库 migrate deploy | PASS，有前提 | 隔离脚本预先创建空SQLite文件后执行成功；不等同无前提clean clone安装通过 |
| 非空/历史迁移 | FAIL | Habit ALTER报错；重复日期Diary从2条变1条；Checkin createdAt mismatch另有静态证据 |
| 新增诊断脚本 | 完整运行，20项检查，16项违反 | 19项数据/迁移不变量 + 1项36页面UI综合冒烟；另通过node语法检查和独立no-unused-vars lint |
| 前端独立 unit/component 套件 | NOT IMPLEMENTED | 不能用build代替；date/SSE已有少量纯函数覆盖 |
| 完整 browser E2E/键盘/a11y/性能 | NOT VERIFIED | 此次路由/宽度smoke不是全部交互或可访问性验收 |
| PostgreSQL/backup/restore/rollback | NOT VERIFIED | 当前SQLite；真实生产迁移前必须单独验证 |
| 生产smoke/CORS/Dashboard | BLOCKED_EXTERNAL | GET和OPTIONS有界超时，web工具未取到页面；原因未判定 |

### 20 项诊断结果

| 不变量/场景 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- |
| 100同时间戳变化 | 100 | 100 | PASS |
| 2000同时间戳变化 | 2000 | 2000 | PASS |
| 2001同时间戳变化 | 2001 | 2000 | FAIL |
| 10001同时间戳变化 | 10001 | 2000 | FAIL，遗漏8001 |
| 删除后旧设备更新 | 不复活 | 重新有1条 | FAIL |
| 缺失父Habit的checkin | 非成功或显式逐项拒绝 | 200，applied=0 | FAIL |
| 同日双设备Diary | 保留冲突或明确拒绝 | A内容被B覆盖，仍A ID，ACK=1 | FAIL |
| logout后旧Cookie | 401 | /todos 200 | FAIL |
| delete user后旧Cookie | 所有业务路由401 | /todos200、/me401 | FAIL |
| 历史同日Diary升级 | 两份原文都保全 | 2→1 | FAIL |
| 非空Habit历史迁移 | 成功保全 | non-constant default报错 | FAIL |
| logout保留未ACK outbox | 1 | 0 | FAIL |
| A→B本地隔离 | B不见A Todo | B可见A Todo | FAIL |
| A→B→A回切 | A仍可见自己的Todo | 可见 | PASS，不证明隔离 |
| ownership 403后队列 | 保留1 | 0 | FAIL |
| 重复400后队列 | 保留1 | 0 | FAIL |
| 重复413后队列 | 保留1 | 0 | FAIL |
| clearAllData后Goal | 0 | 1 | FAIL |
| Dexie v2→v3旧Diary | 能打开并保留1条 | UpgradeError：主键变更不支持 | FAIL |
| 12路由×3宽度 | 36页、无横向溢出/错误边界/跳错路由/pageerror | 36页通过；有React console warning | PASS，仅冒烟 |

此处压力只覆盖 Todo pull 数量边界，不等于所有实体混合/并发/删除/断网压力通过。下一阶段必须扩展到所有同步实体及真实浏览器交互。

### 依赖、secret 与生成文件检查

默认 npm 镜像对 audit endpoint 返回404；使用单次 `--registry=https://registry.npmjs.org` 重查，没有更改用户全局 npm 配置，没有执行 `npm audit fix`。

| 范围 | npm audit metadata | 主要项 |
| --- | --- | --- |
| 前端全依赖 | high 1 | Vite→PostCSS→nanoid 3.3.16；GHSA-2v37-7h3g-55p8 |
| 前端 `--omit=dev` | 0 | 仅表示本次已知公告匹配为0，非绝对安全 |
| 后端全依赖及本次 `--omit=dev` | high 4、moderate 1 | nanoid 5.1.9；deepmerge-ts→@prisma/config→prisma；Hono 4.13.0 |

4 high 是 npm 受影响包节点计数，不是4个独立可利用漏洞。当前 `utils/id.ts` 固定 `nanoid(21)`，未发现非安全 generator/用户控制 size；未发现 toSSG/parseBody 使用，故不能把公告等级直接等同该站已可利用。仍不满足“无高危依赖”验收，需要受控升级与回归，不可忽略。

公告：[nanoid3](https://github.com/advisories/GHSA-2v37-7h3g-55p8)、[nanoid5 非安全size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv)、[nanoid5 overflow](https://github.com/advisories/GHSA-xwg4-73v4-xw9w)、[deepmerge-ts](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)、[Hono query](https://github.com/advisories/GHSA-crvj-82cr-hjcx)。准确版本与可达性需升级时再次核验。

Secrets：当前跟踪文件中未发现真实 `.env`、DB、pem/key 文件；扫描本地全部可达41个commit相关的472个文本blob，规则仅输出文件/行/类型，不输出候选值。5处候选为CI/测试用JWT常量、legacy `.env.example` 注释示例连接串、weatherService动态PEM包装；未确认真实泄漏。没有专用 gitleaks/trufflehog，也没有扫描远端不可达历史/生产环境，不能给“Git绝无secret”认证。构建dist、Prisma生成文件、临时DB不纳入提交；两份用户未跟踪文档保留。

## 5. 外部状态与明确阻塞

| 项目 | 状态 | 已做 | 外部还需提供/执行 |
| --- | --- | --- | --- |
| Render真实服务plan/disk/database/迁移版本 | BLOCKED_EXTERNAL | 读Blueprint和官方文档；未登录Dashboard | 查看实际service/plan、DATABASE_URL类型/路径、disk、迁移历史；不把密钥值贴聊天 |
| 生产备份和可恢复性 | BLOCKED_EXTERNAL | 识别临时盘风险，未触发restart/deploy | 在仍可访问的运行环境导出一致备份，校验并在隔离目标restore；获授权后执行 |
| 实际Origin/Cookie/SMS | BLOCKED_EXTERNAL | 后端health、前端GET及两个Origin OPTIONS均超时 | Dashboard核对允许域名；staging浏览器验证Cookie、OTP提供方；不先发送生产短信 |
| 生产数据有无丢失/污染 | BLOCKED_EXTERNAL | 未访问真实表/账号 | 只读汇总计数、迁移履历、备份比对；未经授权不输出用户明细 |
| 新recovery CI | NOT RUN | 本地checks、历史main run已读 | 后续授权push recovery/开PR并扩大CI触发；不涉及merge main |
| PostgreSQL/对象存储/worker/API key | Planned / BLOCKED_EXTERNAL | 只定义依赖与验收 | 选持久服务/预算、访问权限、staging配置；不能凭代码宣布已部署 |

官方平台事实：[Render Free](https://render.com/docs/free)、[Render Disks](https://render.com/docs/disks)。健康检查超时可能受当前网络、服务冷启动或服务状态影响；本轮证据不足以区分，故不写“生产宕机”。Blueprint注释提到取消disk注释，但文件没有实际disk段，需要明确配置而非照注释操作。

安全资源：[国家卫健委统一12356通知](https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml)、[2025-12-26发布会确认全国开通](https://www.nhc.gov.cn/xcs/c100122/202512/9731f93a7e0d451284a0da462527cbd2.shtml)。核验日期2026-09-22；这仅核对官方资源信息，未验证所有地区实时接通。后续应放入来源可追溯Registry。

## 6. 推荐修复顺序与发布判定

1. 先做外部生产数据保全/部署冻结确认，不能为了修配置触发丢临时盘数据的重新部署。
2. 在隔离fixture上先建立旧库可恢复升级方案；账号数据隔离与会话切换屏障同时设计，禁止自动把共享库认领给当前登录人。
3. 业务+outbox原子写、注销不删未ACK、逐项ACK/持久失败诊断/有界批次/真实退避。
4. 最小canonical基础+ChangeEvent/MutationLedger/version，落地完整Sync v2分页与删除语义；要覆盖REST旁路，不仅sync路由。
5. 冲突与Diary原文保全、速记事务/幂等、pending local edits保护。
6. 生命周期registry/Goal/Settings与session撤销；Origin/部署/供应链门禁并行准备代码，但生产变更依旧需外部授权与备份。
7. 本地、集成、浏览器、压力、已有数据迁移、备份恢复/回滚、staging全部有证据后，再申请生产切换。

文件清单、最小提交边界、双层兜底、测试及rollback详见 [RECOVERY_PLAN.md](RECOVERY_PLAN.md)。本次 Phase0 完成不代表 Phase1 已修复，不满足最终38项DoD；不建议当前基线直接重部署或合入任何未验证修复到main。
