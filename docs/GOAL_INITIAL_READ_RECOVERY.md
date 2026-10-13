# Goal 首次读取失败的有限恢复候选（2026-10-12）

## 范围与结论

基线为公开 `8545ea62fc5f2231f7e1242def8212e2967211f5`，tree `ba86c27d5a648e4b362dc4efcba41deb55a05a37`。本包仅修复 `goalStore.loadFromDB` 在首次 epoch 读取成功、后续存储持续不可读时，没有结束 loading / 暴露通用读取错误的窄状态缺陷。

没有修改 Goal 页面、品牌、Logo、业务字段、数据库 schema、业务归属、同步、旧来源恢复或自动撤销。没有新建目标、推断归属、恢复未知实体或写入任何错误处理记录。没有更改 App 初始化队列、导航、原全局重试按钮及其 reload 行为。不能称为此前普通启动／fcec 初始化队列问题的修复。

状态：本地候选；真实原生链 `BLOCKED_EXTERNAL`，未推送、未部署，未访问真实用户资料。

## 原红与最小修复

实际组件和真实服务合同在原业务源码运行：16 项中 13 通过、3 失败。

- 首次 epoch 自身失败、目标快照失败：既有实现已能显示未知统计，并通过 Goal 原“刷新核对”恢复精确记录。
- 首次 epoch 成功，随后的快照与错误发布 epoch 读均失败：停在 `loaded=false/loading=true/readError=null`。真实组件树显示“正在读取目标统计…”和“正在读取目标…”，没有“刷新核对”按钮；没有伪造空列表，也没有业务写入。
- 错误发布事务的拒绝迟到到换 owner／同 owner 重登录之后：原实现同样留下 loading；没有发现旧内容泄漏。本包同时使这两条过期尝试安全结束。

最小修复仅在原空 catch 中执行同步 actor 检查：DB 实例、owner、已验证会话、session generation、session revision、signed-out 状态均须仍匹配，并要求原 loadSequence 未过期，才设置 `loading=false/readError=READ_FAILED`。不使用默认 epoch，不发布 items、状态、旧来源列表或零统计，也不增加 DB 写。同步 actor 已变化时仅清理过期内存视图。原异常仍向调用者抛出；合法当前读取失败不会被转换为初始化成功。

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

`useAppInit.ts` 的初始必需 Promise.all 包括 Goal，离线分支的 loadAllStores 也包括 Goal；失败仍 reject。`App.tsx` 的 ReadyRoutes 仅在 ready 后开放已认证业务路由。故当前 App 的持续首次无缓存 Goal 故障会停在全局“加载遇到问题／重试”界面，通常无法到达 Goal 页面原“刷新核对”。独立组件合同不证明该页面入口在全 App 可达。

在已有 `tests/helpers/initial-session-scenario.ts` driver 增加 4 个小场景，执行实际 App、useAppInit、ReadyRoutes、RequireAuth、auth/API、DB 与八个 store。替身仅为 React 调度、router／presentation、合成 HTTP 和 IndexedDB：

- 持续 Goal epoch 事务失败，初始和恢复尝试均失败；ready=false，受保护路由锁住。实际全局原“重试”回调调用 reload 一次。
- 首次失败后恢复尝试成功，ready=true；相同原 ID／所有字段／未知 Map 字段准确恢复。
- 旧失败迟到到新 owner 之后，不开放原 owner 的受保护路由。
- 较新恢复读取先成功，旧失败随后到达，不撤销 ready 或覆盖新 Goal publication。

入口测试保全当前 Goal／旧来源／outbox／恢复收据和 B／共享源。全 App 初始化本身包含合法偏好／同步元数据操作；本包不把该完整过程表述为 0 写。driver 只验证原 reload 回调触发，未模拟真实浏览器跨文档重载。

## 本地验证与后续原生门槛

- 新组件合同：16/16。
- 全部 `tests/*goal*.test.ts`：213/213。
- 初始化模块与首次会话相邻合同：22/22（含上述 4 个入口场景）。
- 前端 app TypeScript 检查、修改文件定向 eslint、git diff --check：通过。
- 后续完整门禁：前端 1287/1287、后端 109/109、本地持久化 56/56、Render 9/9、CI 前置合同 22/22，以及两端 lint/build、品牌完整性通过。独立只读审查重跑组件与入口相邻 23/23，无阻塞；真实原生仍未执行。
- 第一次全前端运行因新树没有挂载后端依赖而有 4 个 suite 加载失败（hono／Prisma 缺失），原日志保留。进程结束后核对两端 lockfile 与 Prisma schema 相同，再只读复用既有安装；完整重跑 1287/1287。不是全新 npm ci 证据。

以后原生应走真实 App 的“全局加载失败屏 → 原重试 → 精确 Goal 恢复”，不得设置 ready／setState 来绕过初始化门禁。证据须包含原 ID、完整内容、统计、重载边界与源／队列保全。Goal 原“刷新核对”目前仅有独立组件合同，不能冒充真实首次启动链。本机原生权限此前被拒绝，本包没有重试或绕过；未来真实原生仍需获准的官方 GitHub CI。没有添加新 CI 接线。

回退只需回退本包内存错误处理与测试／文档，不涉及 schema、用户数据或存储迁移；不会改变已有写入语义。
