# YouTrace「有迹」AI 恢复工程长期上下文

> 所有后续 AI / Codex 会话开始工作前先完整阅读本文件，再核对 Git 与当前审计报告。本文记录长期约束，不是功能完成声明。首次建立：2026-09-22。

## 项目与工作范围

YouTrace「有迹」是已有部署、已有数据、经历过失控重构的真实项目。目标是 Personal Life Intelligence / Personal Life OS，连接日程、任务、消费、习惯与打卡、日记、目标、速记、时间线、教练、洞察和用户偏好。不得另建 v3 / Demo 替代现有工程，不得整体覆盖仓库。

2026-09-22 已完成 **Phase 0：审计、基线验证、恢复规划及文档**，提交为 `57db49489668a3b11ca64042bf7210b3958b27e9`，业务 P0 尚未修复。2026-10-04 用户追加授权：推送 GitHub、以当前审计成果统一主线并删除其他分支，后续只保留 `main`。此授权仅改变 Git 分支管理，不代表数据修复完成或批准生产部署。后续业务修复仍按恢复计划逐个最小阶段实施。

## 2026-10-04 后续恢复候选

已在隔离合成数据上推进Sync v2、账号数据库隔离、未确认修改保全、会话撤销、可恢复确认稿和人性化纠偏。精确事实、测试替身与真实浏览器的区别、生产阻塞见 [RECOVERY_TEST_REPORT.md](RECOVERY_TEST_REPORT.md)；协议见 [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md)。原Phase0审计保留作为先红后绿基线，不把修复候选写成生产已上线。旧共享库目前只隔离/导出，不自动认领。目标与完整提醒偏好继续按P0.7推进：目标新增版本化同步、旧目标逐项确认上传；账号旧goals物理表保留为隔离来源，新goalRecords承载当前目标；提醒偏好采用独立CAS与幂等回执。具体本地/CI状态以最新测试报告和覆盖清单为准。

## Git 与部署边界

- 仓库：<https://github.com/hxjyaohaohaode/YouTrace>。
- Phase 0 审计时的正式基线：`main`，`4ec3012e0981dda55a37a39fcb56875decd9fe6d`。这是历史基线，不是实时 HEAD；GitHub main 与运行中的生产版本必须分别核验。
- 最新分支政策（2026-10-04）：本地及 GitHub 只保留 `main`，原 `recovery/vnext-20260827` 的审计成果纳入主线。开始时执行 `git status`、`git branch -vv`、`git log --oneline -10` 并确认所在分支；异常时先保全用户改动。
- 在 `main` 上创建独立、清晰的小提交。本次授权允许分支收敛及必要的受保护强推/删除；后续 force push、破坏性重置或其他分支删除需再次明确授权。发布生产始终另需授权，不把 GitHub 推送默认为生产发布。
- 历史 `legacy-v1-fastify`（`ac64c7f21b7bc7cca12894f5dcbeb8beff129838`）只作功能、设计与实现思路参考。用户本次允许删除其远端分支，但先保留并恢复验证完整离线 Git bundle；此后从离线备份用 `git show`、`git diff`、`git log`、`git ls-tree` 等只读方式查看，不直接 merge，不假定与 v2 历史连续。
- 后端：<https://youji-api.onrender.com>；前端：<https://youtrace-ezu4.onrender.com>。GitHub 与 Render 自动部署有关联。仓库配置、Dashboard、运行中服务必须分别核对。
- 未获生产发布授权的推送使用 Render 官方支持的 `[skip render]` 标记，或先核验平台已关闭自动部署；标记不关闭 GitHub CI，也不能代替生产数据备份。仅一次标记不会永久关闭后续自动部署。[官方部署说明](https://render.com/docs/deploys#skipping-an-auto-deploy)，核验日期 2026-10-04。
- 保留用户已有的未提交/未跟踪文件，禁止夹带无关文件进入提交。

2026-09-22 的 AUDIT_REPORT、ARCHITECTURE_CURRENT 中分支和部署状态是当时快照，不能覆盖上述后续用户授权。分支收敛前的 Git bundle 包含旧 main、recovery 和 legacy 历史，不包含生产数据库备份；不要混淆代码可恢复与用户数据可恢复。

## 决策顺序与不可破坏的原则

1. 不丢数据，不串账号，不破坏已正常工作的能力。
2. 数据正确性、架构与安全先于功能、AI、视觉；禁止只为代码外观做重构。
3. 不做假功能、假智能、假成功；错误必须可见，可诊断，不吞掉用户数据异常。
4. 修改必须实际运行、测试和验证；编译通过不等于功能完成，文档存在不等于功能实现。
5. 每条关键链路原则上至少两层真实兜底，并测试失败路径。
6. 用户采用 vibe coding：AI 负责阅读、修改、运行和验证，不让用户逐文件手工改代码。
7. 不删除测试来获得通过，不大量使用 `any`、`@ts-ignore` 或 lint disable 掩盖问题。
8. 禁止提交 `.env`、API key、真实数据库、用户隐私数据；发现疑似 secret 只报告变量名与文件位置，不输出值。
9. 不从旧共享本地库自动推断数据归属。迁移必须有备份、明确归属/授权、校验和恢复路径。
10. 生产数据库变更必须先备份、验证 schema、迁移与数据校验、验证 restore 和 rollback；禁止仅修改 Prisma provider 就切生产。

## 数据与同步方向（目标，未声明实现）

- 评估每用户独立 Dexie：`youtrace:user:<userId>`，另设 `youtrace:guest`；账号切换必须隔离 DB、内存 store、异步请求、定时器、outbox、游标及多标签页状态。
- 建立 Entity / Lifecycle Registry，统一导出、清除、注销、迁移与同步覆盖；Goal 必须成为一等领域实体。
- 主要实体统一 `userId`、`createdAt`、`updatedAt`、`version`；可删除实体有 `deletedAt`。打卡等通过父实体隔离的模型需明确归属不变量。
- Sync v2 评估单调 `ChangeEvent.seq`，`nextCursor` 只能指向实际消费的最后一条变化；需要一致快照/提交可见性设计，不能把“序号递增”当作完整正确性证明。
- 业务写入与 outbox 必须同事务。mutation 具备 ID、幂等、明确 ACK、重试和持久失败诊断；未确认成功不得删除。
- 删除需 tombstone/change log、保留期及过期设备重同步策略；禁止旧设备复活已删除记录。
- 区分 AccountSetting、DeviceSetting、ExperimentSetting，逐项定义同步政策。
- 逐步引入 ActivityEvent、MutationLedger、EntityRelation、InsightEvidence、ActionProposal/Execution/Outcome、Device、Memory、FileAsset、Job/JobRun 等；只按真实需要增加，禁止为架构名词造空壳。
- PostgreSQL / managed database 是生产方向，SQLite 保留开发和测试用途。旧版 PostgreSQL schema 不是 v2 可直接使用的迁移。

## AI、主动智能与输入方向（目标，未声明实现）

- 业务依赖 capability；统一 Provider Registry、Model Catalog、Capability Router，覆盖 chat、reasoning、structured output、vision、STT、embedding、rerank。
- Primary → Secondary → 明确标注的 deterministic / manual fallback；区分超时、限流、认证、响应/schema 错误和服务不可用。
- 写操作遵循 Tool Registry → typed schema → permission → 用户确认 → 幂等执行 → audit → outcome。不能依赖 fenced text 作为最终协议。
- 上下文按授权、相关性、隐私、大小和成本选择；不把所有个人数据直接拼进 prompt。
- 主动链路目标：ActivityEvent → Trigger → Insight → Proposal → Job/Worker → Notification → User Action → Outcome → User Model。
- Job 需要 lock、retry、timeout、dead letter、catch-up、幂等；server worker 主路径，app-open catch-up 兜底。
- Push：Web Push → In-App Inbox → App Open Catch-up，支持 quiet hours、频控、优先级、dismiss、snooze、关闭类型。
- Capture：Text / Voice / Image / File → Extraction → Structured Draft → 用户确认 → Transactional Apply。低置信度不得自动写重要业务数据。
- Voice：Primary STT → Secondary STT → 浏览器识别 → 文本；图片：Vision/OCR → Secondary → 手工。附件必须涵盖存储、元数据、授权、关联与删除生命周期。
- 安全资源采用带国家/地区、类型、来源和 `verifiedAt` 的 Registry；模型不得自编热线号码。

## 产品、UX 与真实能力表达

- 核心导航稳定；Home 可按时间、紧迫性、行为和目标排序，但用户能 Pin / Hide / Reorder / Never Suggest / Reset，变化可解释、可撤销。
- 每个重要功能至少两个合理发现入口。IA 参考：Home / Schedule / Capture / Tasks / AI；Life Data；Intelligence；System。按现有实现逐步演进。
- 统一 BrandConfig / AssetRegistry：有迹、YouTrace、Logo、favicon/PWA、教练名、主题、图片、语音 UI、Support、Legal、真实版本来源。
- 保留 lazy routes 和 code splitting；优化响应、后台同步、离线、加载/错误/空态。乐观 UI 仅用于可回滚操作。
- 不把规则解析说成真实模型推理，不把页面内提示说成后台推送。
- 功能状态固定用 `Implemented`、`Partial`、`Experimental`、`Planned`、`Deprecated`，必要时注明“代码存在但未运行验证”。

## 阶段与交付规则

阶段顺序：0 Freeze & Audit → 1 Production Rescue/P0 → 2 Canonical Data → 3 Sync v2 → 4 Infrastructure → 5 Feature Recovery → 6 AI Platform → 7 Proactive Intelligence → 8 Multimodal → 9 Personalization → 10 UX/Brand/Performance → 11 Security/Privacy → 12 Staging/Canary/Production。

Phase 1 的严重同步风险与 Phase 2/3 的最小数据基础存在依赖，允许提取必要基础先行，但不趁机扩大重构。具体见 [RECOVERY_PLAN.md](RECOVERY_PLAN.md)。

每个最小完整阶段：diff → typecheck → lint → build → tests → 必要专项测试 → secrets/generated files 检查 → 摘要 → 独立 commit。缺失的测试不能记 PASS。CI 未运行不能写 green。

外部平台、真实数据库、API key、DNS、OAuth、生产账号导致的未完成项标 `BLOCKED_EXTERNAL`：先完成代码准备、列清外部动作与验收命令，不能假装完成，也不能据此自行发布。

## 最终验收目标（目前须逐项验证）

1. clean clone 一键安装；2. 前端 build；3. 后端 build；4. lint；5. 后端测试；6. 前端测试；7. 浏览器 E2E。
8. PostgreSQL 迁移验证；9. 生产重启/重部署不丢数据；10. 多设备增改删；11. >2000 变化；12. >10000 变化；13. A/B/A 隔离；14. 离线重连不丢修改；15. outbox 不静默删除；16. 删除不复活；17. 重复 mutation 幂等。
18. AI primary 失败有真实 fallback；19. 写操作有 permission+confirmation；20. Tool Call 可审计；21. 后台 Job 可执行；22. push 兜底；23. voice 兜底；24. image 兜底；25. 重要 Insight 有 evidence。
26. 360px+ 响应式；27. 基础键盘；28. 基础 accessibility；29. 无高危依赖；30. Git 无 secret；31. 生产无测试数据；32. 可见按钮真实工作。
33. 账号导出；34. 注销；35. backup；36. restore；37. rollback；38. production smoke 均可验证。

## 文档索引

- [AUDIT_REPORT.md](AUDIT_REPORT.md)：本次事实复核、证据、风险与已知局限。
- [ARCHITECTURE_CURRENT.md](ARCHITECTURE_CURRENT.md)：当前架构、领域/数据/同步/AI/部署图与功能对照。
- [RECOVERY_PLAN.md](RECOVERY_PLAN.md)：依赖、修复顺序、下一阶段文件、验证和回滚。
- [ACCOUNT_PREFERENCES_PROTOCOL.md](ACCOUNT_PREFERENCES_PROTOCOL.md)：完整账号偏好CAS、回执、冲突与设备边界。
- [FEATURE_RECOVERY_COVERAGE.md](FEATURE_RECOVERY_COVERAGE.md)：未满足但可隔离推进的必要功能、逐页/组件验收边界与下一包。
- 后续按阶段建立 ARCHITECTURE_TARGET、FEATURE_MATRIX、DATA_MODEL、DATA_FLOW、SYNC_PROTOCOL、AI_ARCHITECTURE、AI_PROVIDER_MATRIX、PROACTIVE_ENGINE、DEPLOYMENT、RUNBOOK、PRIVACY_SECURITY、TEST_REPORT、CHANGELOG，避免空文件假装落地。

## 每次会话交接

先读本文件 → 看最新报告/计划 → 核对 branch/status/HEAD → 区分已提交、用户修改和外部状态 → 明确本轮范围 → 完成验证后记录准确结果。旧审计结论需标 `CONFIRMED / PARTIALLY CONFIRMED / OUTDATED / NOT FOUND / NEW ISSUE`，代码证据与线上证据分开。

## 2026-10-04 原始用户任务首包（候选，待真实界面复验）

完整全仓审读和独立新UI红基线后，当前优先“原文→可改候选→明确选择→持久回执→精确纠错→返回”整链。实现、兼容与未验证边界见 [CAPTURE_CORRECTION_PACKAGE.md](CAPTURE_CORRECTION_PACKAGE.md)。新Todo.completedAt为nullable事实时间，不推断旧完成日期；预算未设置/旧值待核对/显式设置分开。旧共享恢复包没有混入此次候选。新UI工件和独立产品审查未完成前，不能把单元或类型通过写成产品可上线。

## 2026-10-05 记录观察任务候选

首个记录/纠错包与导航后续已在4d37独立限定验收；随后e020d01d真实Y3基线揭示依据/续行/忽略和历史理解断点。当前按[OBSERVATION_TASK_PACKAGE.md](OBSERVATION_TASK_PACKAGE.md)推进“看懂依据→精确纠错→回看当前结果”，保留历史原文及设备选择范围。核心逆向通过不能替代新UI验收，最终状态以具体SHA与当前真实工件为准。
