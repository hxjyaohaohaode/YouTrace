# Goal 首次读取失败的有限恢复候选（2026-10-12／13）

## 范围与结论

基线为公开 `8545ea62fc5f2231f7e1242def8212e2967211f5`，tree `ba86c27d5a648e4b362dc4efcba41deb55a05a37`。首阶段修复 `goalStore.loadFromDB` 在首次 epoch 读取成功、后续存储持续不可读时，没有结束 loading / 暴露通用读取错误的窄状态缺陷，已封存为 `23377dabfb87be9aac1df892000b157c6cb19711`。随后独审发现同范围的必需读取竞态，当前另补 Goal 专用的可信快照可用性验证；233 不是最终可发布候选。

没有修改 Goal 页面、品牌、Logo、业务字段、数据库 schema、业务归属、同步、旧来源恢复或自动撤销。没有新建目标、推断归属、恢复未知实体或写入任何错误处理记录。只在 useAppInit 两处必需 Goal 入口验证真实发布的快照；没有更改其他 store、初始化队列顺序／12 秒超时、导航、原全局重试按钮及其 reload 行为。不能称为此前普通启动／fcec 初始化队列问题的修复。

状态：本地候选；真实原生链 `BLOCKED_EXTERNAL`，未推送、未部署，未访问真实用户资料。

## 原红与最小修复

实际组件和真实服务合同在原业务源码运行：16 项中 13 通过、3 失败。

- 首次 epoch 自身失败、目标快照失败：既有实现已能显示未知统计，并通过 Goal 原“刷新核对”恢复精确记录。
- 首次 epoch 成功，随后的快照与错误发布 epoch 读均失败：停在 `loaded=false/loading=true/readError=null`。真实组件树显示“正在读取目标统计…”和“正在读取目标…”，没有“刷新核对”按钮；没有伪造空列表，也没有业务写入。
- 错误发布事务的拒绝迟到到换 owner／同 owner 重登录之后：原实现同样留下 loading；没有发现旧内容泄漏。本包同时使这两条过期尝试安全结束。

最小修复仅在原空 catch 中执行同步 actor 检查：DB 实例、owner、已验证会话、session generation、session revision、signed-out 状态均须仍匹配，并要求原 loadSequence 未过期，才设置 `loading=false/readError=READ_FAILED`。不使用默认 epoch，不发布 items、状态、旧来源列表或零统计，也不增加 DB 写。同步 actor 已变化时仅清理过期内存视图。普通 loadFromDB 的原异常仍向调用者抛出，既有过期读取 return 语义保持不变；下述必需入口另外判断是否已有可用的可信快照。

## 两类证据不能混为一条原生用户链

### 独立挂载 Goal 组件

`tests/goal-initial-read-component.test.ts` 执行实际 `Goal.tsx` JSX、所有嵌套 UI、Zustand store、localActor、Dexie 与服务模块。只不加载 CSS，并提供最小浏览器 host／fake-indexeddb；没有替换业务服务、Goal 读取函数或组件状态分支。准备阶段将 store 恢复为模块初始的无缓存状态，实际挂载后的 observation 自动发起读取；恢复通过实际渲染的原按钮回调触发。

16 条覆盖：

- 三种首次故障：初始 epoch、Goal 快照、epoch 成功后的持续不可读；明确未知态，没有空列表／0 进度成功态、自动建目标或旧来源恢复。
- 原“刷新核对”恢复两个同名但 ID 不同的原目标。完整字段、未知 Map／Uint8Array／undefined 字段、状态、旧来源比较数据均精确匹配；可见手动进度为 75%／100%，统计为 1/2、88%。
- 同一回调重复触发、旧成功响应迟到、新读取先发布，均保持最新 publication；测试明确区分保留回调与对 disabled 按钮的真实原生点击。
- 换 owner、重登录、退出，以及清除 epoch 后的迟到成功。
- 快照拒绝与错误发布事务拒绝两个窗口的迟到失败，分别覆盖新 owner、重登录、较新结果和清除 epoch。

准备完成后，完整记录当前 owner 的每张物理表的主键和值，包括 settings／outbox／恢复收据；另记录 B owner 与无归属共享源。所有表的 creating/updating/deleting hook 验证失败与刷新窗口 0 次写入尝试，前后完整原值相等。显式合成 clear 场景本身是预定写动作，独立于之后的 0 写窗口；真实 clearAllData 会清空当前代 goals，测试不伪称该动作保留了当前代旧表。B owner 与共享旧源继续原样保留。

每次运行输出实际加载的 Goal/store 绝对路径及 SHA-256。依赖只读复用同 package-lock 的既有安装；业务源码从本候选路径加载，未从依赖工具树加载旧源码。

### 当前 App 的真实入口控制流

`useAppInit.ts` 的初始必需 Promise.all 包括 Goal，离线分支的 loadAllStores 也包括 Goal；失败仍 reject。`App.tsx` 的 ReadyRoutes 仅在 ready 后开放已认证业务路由。普通单次必需 Goal 失败原已停在全局“加载遇到问题／重试”界面，通常无法到达 Goal 页面原“刷新核对”；下面的并发双失败反例说明不能把这一普通门禁结论外推到所有竞态。独立组件合同不证明该页面入口在全 App 可达。

在已有 `tests/helpers/initial-session-scenario.ts` driver 增加 4 个小场景，执行实际 App、useAppInit、ReadyRoutes、RequireAuth、auth/API、DB 与八个 store。替身仅为 React 调度、router／presentation、合成 HTTP 和 IndexedDB：

- 持续 Goal epoch 事务失败，初始和恢复尝试均失败；ready=false，受保护路由锁住。实际全局原“重试”回调调用 reload 一次。
- 首次失败后恢复尝试成功，ready=true；相同原 ID／所有字段／未知 Map 字段准确恢复。
- 旧失败迟到到新 owner 之后，不开放原 owner 的受保护路由。
- 较新恢复读取先成功，旧失败随后到达，不撤销 ready 或覆盖新 Goal publication。

入口测试保全当前 Goal／旧来源／outbox／恢复收据和 B／共享源。全 App 初始化本身包含合法偏好／同步元数据操作；本包不把该完整过程表述为 0 写。driver 只验证原 reload 回调触发，未模拟真实浏览器跨文档重载。

## 2026-10-13：必需 Goal 读取竞态的追加红／绿

独审在实际 App driver 复现：初始化的 Goal 快照拒绝迟到；`youtrace:data-updated` 较新 Goal 也失败；旧 loadFromDB 因 sequence 过期 return，Promise resolve 被误当初始化成功。233 的实际状态是 `ready=true`、protected route 已开，但 Goal 为 `loaded=false/publishedRevision=0`。故障仅 Goal.toArray，自始没有让 settings 或其他 store 失败。

四格同一合同先在 233 运行，结果 2 通过／2 失败，再在候选运行全部通过：

| 旧必需读取／较新读取 | 233 | 候选必需入口 |
| --- | --- | --- |
| 旧失败迟到／新失败 | 错开路由，无可信快照 | 拒绝，持续故障后仍锁门 |
| 旧事务成功但未发布／新失败 | 错开路由，无可信快照 | 拒绝，不把已读事务当发布 |
| 旧快照已实际发布／新失败 | 可用缓存，失败提示保留 | 可用缓存，原 ID／全文／进度精确保留 |
| 旧失败迟到／新成功已发布 | 可用较新真实快照 | 可用较新真实快照 |

新增 `loadRequiredGoals` 只用于 Goal 必需读取入口：在任何 await 前同步 capture 当前 actor，先执行原读取，之后才验证内部 publishedActor／publishedRevision。最终增加一次 settings readonly 事务核对该 publication 的真实 epoch；每个最终 await 后同步复核捕获 actor、publication actor 和实际 store.loaded／publishedRevision。没有内部真实 publication、当前 epoch 不可读／已变化、actor／generation 已变化、public loaded／revision 不匹配，都拒绝。最终等待期间同 actor／epoch 的较新实际发布可以满足可用性，跨 epoch／owner／generation 的发布不能授权旧调用。

“缓存可用”不等于“刷新成功”：useAppInit 以 callback 将 trace 包在原 loadFromDB 外，实际 reject 仍留下 goal/error，已有的 readError 仍可见；只有更外层 stores／initialization 表示必需快照已可用。没有更改全局诊断协议。普通过期 loadFromDB 的 return 保持原样；没有全局重试、循环等待或延长 12 秒。

`tests/goal-required-read.test.ts` 的 13 项真实 store 合同补验：默认真实加载、伪造 public flags 无效、loaded／revision 不匹配、失败后可信缓存、旧 epoch 拒绝、额外只读验证失败、read 等待与最终事务 promise 迟到期间 owner／同 owner generation 变化，以及同 epoch／不同 epoch publication 替换。当前 DB 按既有规则只绑定一次，换 owner 必须 reload；owner case 验旧文档失败关闭，不虚构同文档改绑成功。纯 React 调度 helper 仍只替代 store collaborator，不作为这项内部授权证据。

四格 actual App 合同在 settings／bootstrap 和非 Goal 初始读取结束后才划定失败窗口；完整当前 owner 所有物理表的主键和值（包含 settings、outbox、收据、旧源）前后相等，窗口 creating/updating/deleting 为 0。合成 B owner 与真实创建的 shared native30 来源也完整保留。准备／bootstrap 的合法元数据动作不混入“0 写”，没有整表豁免。附加 helper 的身份／epoch变化本身为明确测试准备动作，不能算成整个测试 0 写。

本轮定向验证：13 helper + 11 actual App／相邻模块通过；全 Goal 与初始化／首次会话相邻共 334/334（其中 8 项为保留但暂停的 native 脚本负向合同，只是 fake-indexeddb／脚本检查，不能记原生执行）。修改文件 eslint、app TypeScript、git diff --check 通过。最终生产源码／测试绝对路径与 SHA 另有回执。233 下文完整门禁是历史阶段结果，不自动覆盖本轮新增代码；本轮完整门禁与最终独审待父任务冻结后接续。

## 本地验证与后续原生门槛

- 新组件合同：16/16。
- 全部 `tests/*goal*.test.ts`：213/213。
- 初始化模块与首次会话相邻合同：22/22（含上述 4 个入口场景）。
- 前端 app TypeScript 检查、修改文件定向 eslint、git diff --check：通过。
- 233 阶段完整门禁（不覆盖上述追加竞态修复）：前端 1287/1287、后端 109/109、本地持久化 56/56、Render 9/9、CI 前置合同 22/22，以及两端 lint/build、品牌完整性通过。独立只读审查重跑组件与入口相邻 23/23，无阻塞；真实原生仍未执行。
- 第一次全前端运行因新树没有挂载后端依赖而有 4 个 suite 加载失败（hono／Prisma 缺失），原日志保留。进程结束后核对两端 lockfile 与 Prisma schema 相同，再只读复用既有安装；完整重跑 1287/1287。不是全新 npm ci 证据。

以后原生应走真实 App 的“全局加载失败屏 → 原重试 → 精确 Goal 恢复”，不得设置 ready／setState 来绕过初始化门禁。证据须包含原 ID、完整内容、统计、重载边界与源／队列保全。Goal 原“刷新核对”目前仅有独立组件合同，不能冒充真实首次启动链。本机原生权限此前被拒绝，本包没有重试或绕过；未来真实原生仍需获准的官方 GitHub CI。没有添加新 CI 接线。

回退只需回退本包内存错误处理、Goal 必需快照 guard 与测试／文档，不涉及 schema、用户数据或存储迁移；不会改变已有写入语义。

### c3cb 全门禁引出的相邻 startup 合同修订

纯净 c3cb 全 FE 发现旧 `late-recovery` fixture 仍将未发布的旧 Goal 事务 complete 当 initial success。原红与实际 App 双臂取证已封存；追加三臂区分：未发布旧 Goal＋恢复 Expense 失败锁门、恢复 Expense 成功后的完整恢复开放、真实已发布可信旧快照的完整成功后晚失败不撤回。实际 actor／generation／epoch 和完整原 Goal 同步断言。生产 Goal guard 没有为旧测试增加等待或放宽可信快照要求。

既有 startup-recovery 四个双宽 profile 的现行验收准备因此重订为 recovery-success／both-fail，并通过原控件增加一个真实 Goal 与原 Todo；完整边界见 [STARTUP_RECOVERY_TASK_BASELINE.md](STARTUP_RECOVERY_TASK_BASELINE.md#2026-10-13-必需-goal-快照后的合同重订本地候选原生待验)。该组与独立 Goal 首读 25%／50% 两次 Retry 草稿是不同验收，均未本机执行原生，不能互相转授。旧缓存晚失败保持场景目前明确为受控 actual App 模块证据。

## 首读原生验收准备：沿用 goals 双宽，尚未执行

以 `1dc5fe5ff143dcf89f93df67dca7d3082ea847cd` 为本轮准备基线；不修改 c3cb 生产 guard 或已封存的 startup 合同。新增 `audit-goal-initial-read.mjs` 只接既有 `goals` 的 1280／360 两个 profile，在原控件创建并确认同步的两个同名目标达到 25%／50% 后运行，后续原 quota／编辑／删除继续使用同一 pair。没有新增矩阵、账号种子、依赖、能力查询、服务或部署。

未来官方 GitHub CI 必须同时满足以下合同，当前本地检查不替代原生通过：

1. 直接访问 `/goal` 产生新文档，Goal 内存从模块初始状态读取。故障只命中已验证合成 owner 的现有账号 DB、readonly 模式、无视顺序但精确等于 `goalRecords/goals/outbox/settings` 的四表集合，以及其中真实 `goalRecords.getAll` 请求；先发原请求，再让该真实事务自然 abort。不阻断 settings-only、其他 owner、全表证据事务或任何写事务，不使用 keepalive、伪造成功事件、store/ready 注入或替换业务 promise。
2. 首文档与第一次原“重试”后的新文档均须真实命中该故障；initial 和 recovery 的完整必需尝试都记录 error，且至少有真实 goal/error。普通过期 Goal 读取可能 resolve，不能把它当作初始化成功。两次均显示全局“加载遇到问题／重试”，业务 workspace/card 不开放，没有原目标内容、空列表成功态或 0 进度统计。只在原控件真实点击，第一次 Retry 必须保留故障。
3. 明确移除后续新文档脚本并恢复当前文档拦截方法，核对原方法身份和无过期／预算异常后，才允许第二次原 Retry。三份文档的有限、正数 timeOrigin 必须各异；新文档不再安装故障。恰好两次 Retry，不加第三次。第二次后须恢复原两个 ID、完整原始本机行以及可见标题、说明、类型、领域、优先级、计划日期、25%／50% 手动进度和 `0/2 完成 · 平均进度 38%`。
4. 准备完成的当前账号每张物理表、主键、原完整值、旧 goals 表、outbox、settings、所有收据，与服务器完整 GET-only 事件 ledger 均冻结比较。跨文档普通 bootstrap 仅允许原 `settings.lastPullAt` 同一 key 的合法时间值前进，逐项保存前后差值；不豁免整张 settings，也不重写原值。全局失败稳定窗口的两次全表／ledger 快照必须完全相等，object-store put/add/delete/clear 和 cursor update/delete 的当前 owner 写入尝试增量必须为 0，包括同值写入和最终 abort 的写请求。准备／bootstrap 操作单独记录，不宣称整个启动 0 写。
5. 实际目录中存在的其他 owner／共享来源也完整比较；本组不另造它们的 fixture。目录没有旧来源时，不能把缺少 fixture 记作“旧来源 0 写已验”。任一首读断言失败直接终止该 profile 后续业务链，先保存 first-failure 故障事实、全账号／全 ledger、截图与初始化时序，再解除；原 quota／编辑／删除不能修复或掩盖这一结果。

故障每文档最多记录 16 个命中，45 秒安全上限只会判失败并恢复拦截，不授权成功；观察写入和诊断也有上限。未更改 App 原 12 秒初始化预算、既有 runner／CI 总时限或重试次数。既有 runner 本来就录制常规 trace，本组没有新增 tracing/capability 接线。

首轮本地新增合同 15/15：纯负向 oracle、真实 fake-indexeddb 精确事务边界、实际 Goal store／required loader 两次失败后原方法恢复、写请求观察，以及模拟浏览器 driver 的编排与五种失败中止反例。编排 mock 不是真浏览器；实际模块的两次 abort 也不等于两次浏览器 reload。原生获准后仍需实际页面、原控件与记录授证。四表 abort 只检验 App 必需门禁和真实 reload 恢复，不证明窄 catch 的第二次 epoch 失败或受控重叠读取矩阵在原生发生；普通单次门禁本来已有效，也不能据此声称 fcec 初始化队列问题已修复。

首轮冻结前定向运行全部 Goal、初始化、首次会话与 startup 相邻合同，366/366 通过；三个修改脚本 `node --check`、两个新测试文件定向 eslint、`git diff --check` 通过。c3cb 的 Goal store／useAppInit 及原 Goal 页面内容 hash 未变。完整 FE/BE/build 与原生验收仍分别由干净候选门禁和以后获准的 CI 接续，本节没有将本地脚本合同记作浏览器成功。

### 独审追加：保全操作失败不得遮蔽原异常

独立反例发现首个 `FIRST-FAILURE.json` 写失败会跳过后续原故障／截图／全表证据直接 cleanup；`fault()`／账号快照在 save 参数中的拒绝也会截断，而最终 chronology 写失败可能覆盖原业务错误。旧六文件、独审三个原红和扩展合同的 21 绿／6 红已另行封存。

本轮仅纠正验收 runner 的异常收尾：每项保全整体独立 try，包括 await 参数求值；全表取证失败仍单独尝试可用的 GET ledger。所有这些尝试都先于 cleanup。移除后续文档脚本失败仍尝试恢复当前方法，cleanup／最终 chronology 失败不能覆盖原业务异常；若此前没有错误，最终保全失败仍拒绝，不能授予成功。可保存的 chronology 记录各保全失败步骤；这是尽力保全，不保证磁盘或浏览器不可用时生成全部文件。没有更改 Goal 数据断言、四表故障范围、两个 Retry 或任何生产文件。

新增逐文件写失败、截图、故障／账号读取、ledger 兜底、自身 cleanup 与最终 chronology 失败反例；合同现 29/29，独审原三个探针原样复跑 3/3，全部 Goal／初始化／首次会话／startup 相邻回归 380/380，定向 eslint／脚本语法／diff 检查通过。此前首轮完整门禁不自动覆盖本修订，须按新冻结内容重新接续。
