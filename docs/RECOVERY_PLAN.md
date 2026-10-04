# YouTrace 恢复路线与发布门禁

建立日期：2026-09-22。起点：`recovery/vnext-20260827` / `4ec3012e0981dda55a37a39fcb56875decd9fe6d`。依据 [AUDIT_REPORT.md](AUDIT_REPORT.md) 的实际失败结果，而非按功能数量推进。

分支政策更新（2026-10-04）：用户授权将当前审计成果推到 GitHub `main`、删除其他分支，之后仅保留 `main`。以下修复门禁与风险不变，历史审计仍按原基线阅读；GitHub 主线更新不等于生产部署或 P0 修复完成。

## 1. 本轮交付边界

Phase0：Git冻结核对、当前/legacy只读审计、结构与数据流图、事实复核/风险/测试报告、长期上下文、恢复计划及可复现诊断。没有更改业务实现、数据库provider或生产服务。Phase0的16项诊断失败是待修复基线，不是“预期失败所以产品合格”。

后续按本计划逐段启动，不把长期任务清单当作一次性重构授权。在唯一的 `main` 上小而清晰地提交；本次 GitHub 推送/分支删除已获授权，但生产部署、外部资源创建/费用和真实数据迁移仍要另获授权。非发布推送使用 `[skip render]` 或已核验的关闭自动部署配置。保留两份用户已有未跟踪文档。

## 2. 开始任何P0修改前的保护动作

1. 阅读 AI_RECOVERY_CONTEXT、最新报告，执行 branch/status/log；记录当前HEAD、用户修改、DB schema与迁移历史。按最新单分支政策在 `main` 上小步工作，不重新创建长期 recovery/legacy 分支。
2. 把“运行中生产 SQLite 可能还在临时盘”视为外部紧急保全问题。**不要先改Origin/Blueprint并触发部署，也不要用重启来测试持久性。**先核对Dashboard自动部署、plan、DB类型/路径与磁盘，再取得一致备份并在隔离目标验证restore。
3. 本地真实IndexedDB/SQLite同样不能删除重建。先制作带schema/version、计数/校验、来源时间的备份；含隐私的备份只在授权安全位置，不提交Git、不贴聊天。
4. 所有代码和测试先用合成fixture。历史迁移既有checksum与已执行状态须先确认，禁止随意修改已部署migration制造漂移。
5. 当前共享 `youtrace` 库归属不可信。默认隔离/只读保留，不自动归给当前登录账号；Guest→Account必须有显式确认、来源/计数预览和可撤销迁移记录。

外部保全未完成时可以在隔离本地做代码准备，但不得宣布生产获救，也不能触发发布。

## 3. Phase1 P0最小阶段与提交边界

下表每行都须独立验证/审阅diff并commit；必要时再拆成更小提交。不是一口气修改所有文件。

| 阶段 | 完成定义 | 主要文件（相对youji-app，根文件另标） | 专项验收 | 提交主题示例 |
| --- | --- | --- | --- | --- |
| P0.0 保护性回归门禁 | 把本次探针拆成可维护的frontend/API/migration回归；保留失败断言；补Node/依赖运行约束 | `scripts/phase0-data-probe.mjs`、`server/tests/production.integration.test.ts`、新`src/**/__tests__/`、两个package、根`.github/workflows/ci.yml` | 旧行为红，新行为绿；脚本不能接生产库；已有14测试保留 | `test(recovery): codify isolation and data-loss regressions` |
| P0.1 旧数据升级保全 | 支持旧Dexie自增ID数据复制到新schema，保留原库和映射；SQLite迁移先做已有数据演练/修复方案，不直接碰生产 | `src/db/index.ts`；新`src/db/migrations/`；`server/prisma/migrations/`审阅、新迁移工具/测试（按实际履历确定） | v2旧Diary/Schedule/Checkin/QuickNote、重复日记/非空表/无rawInput、升级中断/quota；重开仍可恢复 | `fix(storage): preserve legacy records during database upgrade` |
| P0.2 账号运行时隔离 | DB按用户/guest划分；userId须先验证；切换先停sync/abort、清内存/timers、再加载目标DB；多标签页协同 | `src/db/index.ts`、新`src/db/accountDatabase.ts`、`authStore.ts`、`App.tsx`、`useAppInit.ts`、`apiClient.ts`、`syncEngine.ts`、各store reset入口 | A→logout→B→logout→A、guest认领拒绝/同意、in-flight pull/flush、失效Cookie、断网登录、两tab、加载错误；B绝不见A数据 | `fix(storage): isolate account databases and session work` |
| P0.3 统一本地生命周期 | registry定义业务/设备/队列的导出、清除、删除与迁移政策；当前账号原子清除含Goal；导出明确完整性 | 新`src/db/entityRegistry.ts`、`db/index.ts`、`Settings.tsx`、全部store reset | registry覆盖所有表；clear失败回滚；export/restore count+内容校验；当前账号删除不影响其他账号 | `fix(data): unify account data lifecycle and exports` |
| P0.4 mutation不丢与可诊断 | 本地业务+outbox同事务；mutationId/owner/state/retry/error；未ACK不删；按bytes+count分包；真正退避 | `syncEngine.ts`、`db/index.ts`、所有业务store写路径、`server/src/routes/sync.ts`及协议schema | logout、401/403/400/413/429/5xx、timeout、quota、崩溃、oversize、重启重试、父子依赖；可导出和安全重试dead_letter | `fix(sync): retain unacknowledged mutations durably` |
| P0.5 最小canonical与Sync v2 | version/tombstone、ChangeEvent、MutationLedger、每项ACK；同事务覆盖所有写入口；新游标/快照协议 | `server/prisma/schema.prisma`、新增安全迁移、`server/src/routes/sync.ts`、所有REST写路由、客户端sync/DB；新`docs/SYNC_PROTOCOL.md` | 100/2000/2001/10001+所有实体、同时间戳、混合变更、并发提交、乱序/重复、丢响应、断点恢复、分页中写入 | 分拆为`feat(sync): add transactional change ledger`、`fix(sync): prevent paginated pull data loss` |
| P0.6 删除和冲突闭环 | 删除传播不复活；本地pending不被pull覆盖；Diary同日冲突保全；速记确认稿事务/幂等 | sync前后端、`diaryStore.ts`、`quickNoteStore.ts`、`QuickNoteResult.tsx`、`quickNoteIntegration.ts` | 两设备delete/offline edit、restore显式语义、重复确认、部分失败、B删除ID映射、保留两份日记原文 | `fix(sync): prevent resurrection and preserve conflicts` |
| P0.7 Goal/Settings一等数据 | Goal完整schema/API/sync/lifecycle；设置分类和双向字段政策；移除无依据进度完成声明 | schema/迁移/同步、`goalStore.ts`、`settingsStore.ts`、`routes/user.ts`、todo/habit规则、导航 | Goal跨设备增改删；quiet全字段；账户切换timer；progress幂等/撤销/解释 | 分开`feat(goals): complete durable entity lifecycle`与`fix(settings): synchronize account preferences consistently` |
| P0.8 Session安全/部署门禁 | logout/delete/密钥轮换撤销所有业务路由访问；Origin配置契约；可重复安装；依赖安全；root CI含关键回归 | `session.ts`、`middleware/auth.ts`、auth/user routes、schema、`env.ts`、新server `.env.example`/`.gitignore`、`render.yaml`、根CI/文档/package locks | 旧Cookie重放、伪Origin、Cookie属性、OTP失败关闭；fresh clone、已有数据迁移、audit、staging跨域 | 分开auth、config、CI、dependency小提交 |

P0.1/P0.2须先一起定迁移边界，但不必合成巨大提交。P0.4客户端ACK与P0.5服务端ledger有接口依赖，可先保留失败队列/限批，再在同一明确的协议版本切换中启用逐项ACK。不得让旧客户端在新后端上继续把不可靠v1响应解释为成功。

### 下一阶段第一批具体文件

下一轮先做 **P0.0+P0.1设计/回归与账号隔离最小实现**，不是同时推进AI/UI。预计首先读改：

- `youji-app/src/db/index.ts`：从静态共享实例抽出账号DB解析、旧库保护和生命周期入口；必须保持现有业务字段兼容。
- 新 `youji-app/src/db/accountDatabase.ts` 与 `youji-app/src/db/migrations/`：用户/guest命名、session epoch、旧schema复制/映射与迁移完成标记。
- `youji-app/src/stores/authStore.ts`：先验证身份再开业务库，logout暂停而非删未ACK；异步回调必须验证当前epoch。
- `youji-app/src/hooks/useAppInit.ts`、`youji-app/src/App.tsx`：串联身份→DB→store→sync启动，保留可用离线流程与明确失败状态。
- `youji-app/src/services/syncEngine.ts`、`apiClient.ts`：绑定owner/epoch、停止/取消和迟到响应丢弃（仅丢响应，不丢mutation）；切换不共用游标。
- 对应 stores 增加 reset/reload、settings timer取消；`Settings.tsx`接入统一清除/导出入口。影响面大时拆出接口兼容提交再接页面。
- 新前端测试、旧Dexie迁移fixture及现有诊断的对应用例；根CI补真实触发和执行路径。

服务端历史migration修复只先在fixture上设计验证；在不知道生产migration履历前不自动改旧SQL。以上是下一阶段文件计划，当前Phase0没有修改这些业务文件。

## 4. Sync v2必须先写清的不变量

1. 所有请求由服务器绑定userId，不能信任payload用户字段；ID冲突/P2002重试也要重复ownership约束。
2. `mutationId`在用户范围唯一；重复请求返回同一结果，不重复写业务/事件；写业务、写变更、记ACK同事务。请求超时不代表失败，重试必须安全。
3. 不直接假定BIGSERIAL分配顺序等于事务提交可见顺序。评估每用户事务计数器/锁或具有稳定可见高水位的变更流，证明晚提交的低seq不会被跳过。
4. `nextCursor`指最后已返回/已原子合入的change，空页/hasMore/用户隔离/无权限cursor行为明确；初始snapshot与后续增量需要一致边界。客户端页数据和cursor必须一个事务提交。BIGINT序号通过字符串等无精度损失的形式传输，不能落入JavaScript不安全整数。
5. 每条 mutation 有 pending/sending/retryable/dead_letter/acked 等显式状态与诊断；sending超时可恢复。永久拒绝也不静默丢弃用户原稿，UI可修正/导出/显式放弃。
6. delete是版本化事件；tombstone在保留期内压过过时编辑。过期设备必须全量重建或显式冲突恢复；GC不得允许未确认旧设备无声复活记录。
7. 所有REST、sync、AI确认执行、未来job写入走同一数据边界；否则REST变化仍可能绕开change log。
8. Diary按user/date唯一如何映射多端临时ID必须写进协议；不能ACK一次静默内容替换。QuickNote需要captureId与实体关联，重试不重复新增。
9. Goal和Settings不再靠旁路遗漏。短期不支持的实体必须显式拒绝/保留队列，不能忽略后200成功。
10. 定义旧客户端兼容窗口、最低协议版本、升级提示与数据导出。禁止以回退损坏v1为“兜底”；不兼容时安全只读/暂停同步并保留修改。

## 5. 每条关键链路的至少两层兜底（全部是待实现/待验证目标）

| 链路 | 主路径 | 第一层故障兜底 | 第二层故障兜底 | 验证方式 |
| --- | --- | --- | --- | --- |
| 生产数据 | 持久PG+事务 | 自动备份/PITR（按最终服务能力） | 独立校验的逻辑导出+隔离restore | 故障恢复演练、hash/count/关系比对 |
| 旧库迁移 | 复制校验后切换 | 完整保留源库、映射与检查点 | 隔离只读导出/人工确认归属工具 | 断电、quota、重复迁移、无主数据 |
| 本地写入 | 业务+outbox原子事务 | 失败回滚并保留输入草稿 | 明确失败UI+可导出未提交草稿 | 注入事务中断和存储满 |
| 同步 | ledger/版本化事件/ACK | 持久重试、idempotency、退避 | dead_letter诊断/原稿导出/显式修复 | 4xx/5xx/超时/重启/重复请求 |
| 账号切换 | user DB+epoch+终止请求 | 身份不确定时锁定业务视图/停止同步 | 用户可导出隔离旧库，不能误认领 | A/B/A、两tab、迟到响应 |
| AI生成 | Primary Provider | Secondary Provider | 明示的规则结果或手工完成 | 各类错误/无key/invalid schema |
| AI写操作 | 授权+确认+幂等执行 | 失败不ACK并可安全重试 | 保存proposal草稿+人工操作/审计 | 双击、重放、部分失败、权限变化 |
| 主动job | 持久worker/lease/retry | durable failed/dead-letter与运维补偿 | app-open catch-up、幂等避免双执行 | worker宕机、错过计划、重复lease |
| 通知 | Web Push | 站内Inbox持久记录 | App-open catch-up（受quiet/frequency限制） | 订阅失效、拒绝权限、关闭app |
| 语音 | Primary STT | Secondary STT | 浏览器识别（可用时）再文本输入 | 权限拒绝、无网络、超时、不支持 |
| 图像/文件 | upload+vision/OCR+草稿 | secondary provider/保留待处理附件 | 手工录入/关联证据；未经确认不写业务 | 上传失败、隐私拒绝、低置信度 |

不能把本表作为已经上线的能力介绍。每层只有真实实现并验证后才从 Planned 改为 Implemented/Partial。

## 6. 后续阶段（保持用户给定顺序与依赖）

| 阶段 | 范围 | 启动/完成门槛 |
| --- | --- | --- |
| Phase2 Canonical Data | entity lifecycle/version/关系；ActivityEvent最小可追溯事件 | P0基础不变量通过；不一次加完所有建议模型 |
| Phase3 Sync v2专项 | 在P0必要协议基础上全实体/多设备/压力/迁移兼容 | 100、2000、2001、10001+混合变化及失败注入全部通过 |
| Phase4 Infrastructure | PG、对象存储、worker、monitoring、backup/restore | 获平台权限与预算，迁移/restore/rollback证据齐备；不只改provider |
| Phase5 Feature Recovery | 按Parity Matrix恢复高价值搜索/PWA/通知等 | P0无回归，旧实现只读参考，不merge legacy |
| Phase6 AI Platform | provider/model/capability/tool registry，来源、permission、audit、fallback | 有可控provider故障测试；规则与模型身份诚实区分 |
| Phase7 Proactive | trigger/insight/proposal/job/notification/outcome | worker真实运行、catch-up与幂等/quiet/frequency完成 |
| Phase8 Multimodal | text/voice/image/file草稿确认/事务写入 | storage ACL/删除/retention先落地，低置信度不自动写 |
| Phase9 Personalization | 可解释排序、pin/hide/reorder/never/reset、memory/preference | 稳定核心导航、可撤销学习、明确授权和删除 |
| Phase10 UX/Brand/Performance | 统一资产与真实version；360px+、键盘、a11y、加载/错误、性能 | 在数据正确性上优化，不换皮掩盖风险 |
| Phase11 Security/Privacy | 分布式限流、secret生命周期、完整导出/删除/retention审计 | 补强已在P0前置的安全边界，不能延后解决串号 |
| Phase12 Release | staging→canary→production | 38项DoD逐项证据，外部BLOCKED清零，用户批准切换 |

后续按真实阶段添加 DATA_MODEL、SYNC_PROTOCOL、AI_ARCHITECTURE、AI_PROVIDER_MATRIX、PROACTIVE_ENGINE、DEPLOYMENT、RUNBOOK、PRIVACY_SECURITY、TEST_REPORT、CHANGELOG 等；不创建没有事实的空文档当进度。

## 7. 测试计划与CI策略

每个小阶段先 `git diff --check`/人工diff，再frontend typecheck/lint/build、backend lint/build/tests、专项回归、secret与generated检查。可用现有14 tests当基础，但不能以其通过覆盖新增失败结果。

| 测试层 | 必测场景 | 验收证据 |
| --- | --- | --- |
| 数据/迁移unit | 旧Dexie版本、所有表registry覆盖、非空SQLite与重复日期/ID保全 | 行数/内容hash/关系映射/中断后重开；不只空库 |
| 账号边界 | A/B/A、guest显式迁移、多tab、session过期、离线、in-flight请求和timer | UI/DB/outbox/cursor/settings/chat无串号、旧库原文保全 |
| mutation | create/update/delete、quota、重启、401/403/400/413/429/500、timeout、重复mutation | 未ACK永远可恢复；ledger结果稳定；无重复执行 |
| pull | 100/2000/2001/10001+每实体与混合、相同时间、并发提交、空页、页面中断 | 精确ID集合/内容/游标校验，不能仅检查总数 |
| 多设备冲突 | A删除B离线改、同时更新、Diary同日、父子乱序、retention过期 | 不复活、不静默覆盖，有明确冲突/全量重建策略 |
| API安全 | 每路由ownership、ID竞争、注销/delete/改密钥后Cookie、Origin/CSRF、OTP滥用 | 旧凭据无法访问业务路由，保留现有headers/cookie/zod策略 |
| Capture/AI | 编辑稿保存、重复确认、部分失败；provider各错误；tool确认/权限/审计 | 同一操作最多一次，失败真实可见，context授权与evidence可追溯 |
| UI E2E | 真浏览器登录隔离测试环境、核心CRUD、账号切换、离线重连、实际请求 | 不依赖手工注入auth状态；每个可见按钮分类验收 |
| UX/性能 | 360/390/768/1280+、键盘焦点/弹窗、基础axe、长列表/冷启动/慢网 | 不溢出、不丢焦点、有错误恢复；设置可量化且现实的性能预算 |
| 基础设施 | PG迁移、备份restore、重启重部署、rollback、新clone一键安装 | staging用合成/获批脱敏数据，验证数据与运行版本一致 |

CI改动在根`.github/workflows/`生效，合并嵌套workflow中的有用检查而不是假定它已运行；增加recovery push/PR触发与迁移/前端测试/浏览器/审计。重型10000+压力可独立job，关键数据不变量必须阻止发布。先受控升级依赖并证明可达风险/兼容性，禁止删除测试或大量eslint-disable来变绿。

Phase0浏览器smoke绕过OTP并使用进程内传输，后续必须补真实HTTP Cookie/CORS/SSE链测试。生产smoke只在备份/批准之后执行，不能往正式账户灌合成数据。

## 8. 自动可完成与外部配置清单

### 可在当前仓库自动完成（后续获启动指令后）

账号隔离、旧schema复制工具/fixture、生命周期registry、业务+outbox事务、ACK/ledger/changefeed/tombstone/冲突、Goal/Settings、session撤销、Origin配置契约、测试/CI、PG迁移与校验/restore脚本、运行手册。真实运行验证由AI完成，不交给用户逐文件改代码。

### BLOCKED_EXTERNAL（不能伪装完成）

| 外部动作 | 需要的权限/决策 | 完成后如何验证 |
| --- | --- | --- |
| 核对Render自动部署/实际plan/env/disk | Render只读权限；暂停自动部署如需更改须用户授权 | 服务设置快照（不含secret值）和代码配置差异表 |
| 抢救当前生产SQLite | 运行环境访问、获批备份存放位置、必要写入冻结窗口 | 一致备份校验、隔离restore、核心表数量/关系/摘要 |
| 持久PG/staging | 服务选择/费用、连接权限、region/retention | staging migration、连接/权限、备份还原和重启试验 |
| Origin、真实Cookie、SMS | 实际域名/面板配置、专用测试账号与SMS配置 | 允许来源成功、未知来源拒绝、真实会话跨域端到端 |
| Object Storage/Web Push/worker | 预算、存储ACL、VAPID/worker配置 | 私有文件生命周期、订阅失效兜底、关app仍执行任务 |
| AI providers/STT/vision | API keys、数据出境/隐私政策与预算决策 | 独立staging合成输入、provider故障注入、不输出key |
| main远端CI与生产发布 | 本次 GitHub 推送已授权；后续按单main政策验证CI，生产另行批准 | CI链接+staging报告+release/rollback签核；非发布推送跳过Render自动部署 |

不要求用户粘贴API key/数据库内容到聊天。DNS/OAuth若未来需要再列具体步骤，不作为本次Phase0已做事项。

## 9. 回滚/恢复策略

### 当前Phase0

只有新增文档/诊断脚本和AGENTS；没有业务/DB变更。若需撤销，在获授权后用 `git revert <该阶段commit>` 生成可追踪反向提交；不破坏性reset main、不删两份用户原有文档、不触碰真实数据。分支删除可从已验证的离线bundle恢复对应提交；尚未执行生产数据回滚演练，不能记成“生产rollback PASS”。

### 后续本地隔离与schema迁移

先保留原库只读快照/原始ID→新ID映射，再复制到目标账号库，逐表校验并设置完成标记，最后切读写。中断时继续检查点或回到源库只读导出，不清空来源；目标库被错误写入时保留其新增修改以便合并，不能以回滚代码为由删掉新数据。切换前后测试窗口/数据库版本兼容性。

### Sync/服务端schema

采用expand→兼容读写/协议门禁→验证→后续contract，新增字段/表先非破坏迁移。服务端/客户端分别记录最低协议版本和游标版本；旧客户端不兼容时暂停同步、保留outbox并提示升级。不能退回会丢页/复活/删outbox的v1当作安全恢复。

数据库已开始接受新写入后，`git revert`不等于恢复数据。优先修复前进；若必须回滚，先暂停写入，保全切换后delta，使用已验证反向转换/重放或完整restore方案，再核对所有者、计数、金额、关系、mutation/seq/tombstone。无法无损转换时保持只读并请求决策，而非“恢复旧备份”丢掉新修改。

### PostgreSQL生产切换

获授权维护窗口内：一致备份→恢复演练→目标schema→保序迁移/ID与日期金额校验→双环境只读核对→明确写入切点→staging/受控canary→生产smoke。源快照加密保留至约定retention；回切要覆盖切点之后的新数据。测试redeploy/restart不丢数据只在已有可靠备份和恢复能力后进行。

每次交付给出真实commit、实际命令/退出码/测试数量、未通过项、外部阻塞、回滚适用边界；禁止“代码写完/文档写完”即宣布整个恢复工程完成。
