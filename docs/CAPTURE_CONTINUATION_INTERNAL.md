# Capture 显式同 ID 交接：内部候选

基线公开版 `2abae08db7c6f49bc1cd6281bd745eb8aa96ccb2`。本文件覆盖后续内部模块/组件策略；没有新增可见“继续核对”入口，业务提交尚未接入，不能称原需求或生产发布完成。

## 已实现的内部边界

1. 目录/查看仍只读。独立的显式交接 API 只接受目录私有版本能力，重新核当前 owner、DB、session generation、严格 epoch 行和已知提交标记（receipt/source/note，以及本候选新增 proof），返回内存投影；不调用 `loadCaptureDraft`，不更新当前稿/输入或 session 指针。
2. 首次本机修正采用 typed 全行 CAS，保留 undefined 与字段缺席、负零、字符串空白和数组顺序，忽略对象键插入顺序。只有实际修正才更新同一个 `capture-review:<ID>`。未变值不会只为重绑定 session 写入。
3. 原 `CaptureReview` 的内部隔离策略从私有副本初始化，跳过普通 pending 恢复和 upgrade。首次严格只读归属核验成功后才显示内容；正常 auth 渲染/IDB epoch 变化及每次写入均有保护。没有为任意无事件的外部 JS 内存变化添加轮询，也不宣称瞬间捕获所有此类变化。
4. 本实例每项排队修改绑定不可变 payload、序号和私有 ticket。共享 pending token 仅作为冲突检测，不是锁。已拥有的 token 被删除或替换后拒绝写入，不自动抢占；旧任务成功不清除新 pending，已确认票据不可重写。
5. 未落盘副本由文档生命周期的私有强引用保留，组件卸载不丢弃。普通旧流程可能覆盖或删除共享槽，仍不能删除这份私有副本；别人的槽不被改写。仅当前准确 actor 可读取内容。此处不是磁盘耐久、自动跨登录恢复或新增用户恢复入口。
6. 未完成金额等内存编辑可暂存原文本；磁盘仍要求完整合法 schema。无限值/超安全整数不能写成合法稿，用户修正后才允许落盘。拒绝执行 getter、类实例和循环 JS 对象，不将不支持的值静默 JSON 化。
7. 隔离返回不 persist/navigate，pending/failed 时拒绝普通返回丢弃；同 ID 修正成功后只关闭实例，驻留父编辑及两指针保持原值。取消只能撤销未来能力，不能回滚已提交修正。业务 Save 和递归目录在内部隔离模式不显示；公开默认页面仍走既有流程。

## 明确未闭合

- 普通 loader 本身不是目录交接授权；不能把旧 ID URL 直接当作继续流程。
- 内部业务 apply 的完整证明和共享输入保全见下节候选；指定已提交 ID 的真实重载/用户交接仍未接入，原红例保留。
- 父编辑 pending/failed/语音/提交中阻止实际新入口、双指针全链、真正用户入口和浏览器验收仍待后续阶段。
- 原始行没有所有写入方维护的单调生命周期版本。同 ID 完全同 typed 值的删除重建 ABA 无法识别，当前 CAS 不作该承诺。
- 内存保全不保证关闭浏览器、刷新或崩溃后的恢复；尚未提供丢失共享槽后的自动恢复/重新归属 UI。
- fcec 新文档 IDB 请求队列偶发不终结的根因仍未知，此内部合同不是该问题的修复证明。

## 实际验证与替身

合成数据，实际 Dexie/fake-indexeddb 模块、实际 React 组件；router、动画、Modal/Button 宿主明确替代，不授原生焦点、布局或真实跨设备结论。组件在与服务相同 JS realm 编译执行：旧 VM realm 的 object literal 会被生产 plain-record 检查拒绝；保留该宿主不匹配的失败日志，没有放松生产原型检查。

测试覆盖 RO 无编辑关闭、同 ID 修正/父编辑保全、quota/重试、丢提交结果、旧队列晚成功与新失败、槽被覆盖/删除、组件卸载、同账号新 generation、epoch 变化、typed 精确保全、非法编辑保全与修正。冻结包保存各次真实红/绿和精确源码回执。完整范围以该包实际测试日志和独立审查为准，不能把历史完成版摘要套给本候选。

同锁依赖已在本工作区存在。本阶段未重装依赖或声称全新空机测试。现有 CI 的安装/运行次序：

```sh
cd youji-app
npm ci
(cd server && npm ci && npm run db:generate)
npm run lint
npm run build
npm test
```

测试使用隔离合成资料；这不是部署命令，也不需要填写生产凭据。

## 后续小步：输入来源与新稿首次写入门禁（仍未启用业务 Save）

`capture-input-origin:<inputKey>` 是本机、不授权的复制来源记录。每次 fork 在同一 settings 事务读取父 key 对应原文、context、来源和消费行，再原子新增子 input/context/来源三行；源行保持不变。原文与日期不会从两个时点混合。副作用增加一行来源元数据，不能称默认 fork 的物理写入字节完全不变。

只有实际 input/context/来源/消费索引/消费校验头五行都不存在时，才能为本次确实没有复制旧文字的新输入记录空 root。旧 session 指针可作为悬空指针证据记录，不作为继承父节点，也不据此猜测缺席一定因 clear。现存 undefined/null/空字符串、半行、旧无来源的输入都不是这种缺席；原值保留并标未知。

新确认稿 create 有只读预检，真正首次 `capture-review:<新ID>` put 还在同一 RW 事务重新检查来源链、当前 actor/epoch 和最新消费标记，防止 create→save 之间发生变化。已经存在的明确 D 原 ID 继续走既有版本路径，不因 O 共用输入就冒认成 O。来源最多核 32 个节点，环/超界/缺损/跨 owner 或 epoch 均保文拒绝，不截短或补写“安全”标签。

`capture-input-consumption:<inputKey>` 在此小步只是一项保守停止条件：链上任一点只要该行存在，包含 undefined/坏值/未知格式，均不授权新建，也不据其选择回执。复制记录已见过消费行时，即使原行之后消失，也持续保守拒绝，不能把明确已有的未知消费证据洗成安全。第三阶段单独检查点尚无生产索引写方，彼时注入 marker 仅是合成不可信数据。本节之后的内部业务服务才新增真实索引写方；指定历史 ID 的真实页面重载仍待接入。

现有明确 ID 的普通回执重放，在实际 QuickNote store 删除原实体后仍返回历史结果、全表不变；后续新协议必须保留此语义，不能要求可变原实体永远存在或因其删除重新 apply。新的无 reviewId 原文页遇未知来源时保持原文并失败，不按同文本找某条回执。用户消歧/真正继续入口及全部原生仍未验收，本候选不可作为完整恢复交付。

## 内部原子业务提交候选（未开放用户 Save）

新增能力专用 applyCaptureContinuation(grant)，公开可修改的 grant.draft 不作保存依据；真实私有能力在 RW 前登记固定 operation、expected 原行与当前 session 的 submitted 投影。独立 committing 状态禁止提交期间 stage/CAS/第二次提交，不改变原 autosave busy 可排队语义。纯字段校验在首次 operation 登记与任何 RW 前执行；这类明确未开始业务提交的错误仍允许同 grant 修正。已登记的提交尝试不悄悄改 operation 或重取原行；若需重新编辑，要经过以后明确取消/重新核对的用户流程，当前尚未接入。事务内的习惯唯一匹配、重复日记或追加过长等业务拒绝已经建立 operation，仍按精确重试/另行明确授权处理；不宣称所有失败都能在同 grant 任意修改。

同一份原业务 mapper 服务普通 apply 和隔离分支。隔离分支在全表事务核 typed CAS、owner/严格epoch/取消和全部提交标记，原子落实体/outbox/source/receipt/版本化 proof/index/head；只删选定 capture-review，保留实际 input/context、父 current 及双 session 指针。source 等于 submitted，proof 另留 expected；零编辑不先写 session 绑定。

不可变 proof 只绑定自己的操作、完整历史 result 及实际保留输入两行，不绑定未来可追加的整个 index。双行 index+head 同事务更新；head 含准确 owner/epoch/inputKey、数量及整个规范 index 的 SHA-256。读取先核双行一致，再有界反查每项 proof/source/receipt。合法 D 追加后 O 仍能回放；单边缺失、截断、重复项、坏摘要均拒绝，不自动补 head。最多32项、规范内容尺寸/节点/深度有界，单次证明处理总哈希预算4MiB/5秒；哈希用 Dexie.waitFor 持活，不夹网络。

SHA-256 是本地一致性/损坏检测，不是认证：整套 index/head 一致改写或同时删除，当前没有独立可信全历史来识别。不得宣传永久全局 exactly-once 或不可篡改。fork/首次 put 把 index 或 head 任一存在当作消费证据，已经见过的标记即使消失仍拒绝；新空 root 须五行全缺。

同 grant 精确重试还核私有 expected/submitted/operation。实际 IDB complete 事件保留本 document 已提交事实，不把函数体结束或 abort 当提交；已知完成的回放采用一致 readonly 全表快照、0新增写，不再次刷新/发送。正常删除或修改可变业务实体不使历史 receipt 失效，也不复活它。提交后取消/换号只停止旧结果发布，不能假装回滚已提交数据。首次提交后 store刷新/网络故障保留持久回执，只记诊断。

此阶段只有真实模块/组件及合成IDB证据；用户 Save、指定ID重载反查、父页面完整handoff及新的原生验收仍未闭合。普通输入遇未知来源仍保文拒绝，不以同文本选回执。

## 指定 ID 历史回执的严格服务候选（真实页面链仍待验）

新 receipt 有三个明确字段 continuationProtocol、continuationOperationId、continuationProofDigest，与 source/proof/index/head 同一事务持久化。分类按任一字段的 own-property 存在性或 proof 行存在性，undefined/坏值/未知协议仍走严格分支，不能退回普通成功。普通旧 receipt 无这些标记时保留既有兼容读取。

严格读取在一致 settings readonly 事务核同 owner/epoch 的全部证明和索引自己的项，返回 detached typed 历史值；初次 await 前捕获当前 actor，事务末及交付后仍核同 DB/session/generation/epoch。同 owner 同 epoch 的新登录可读历史，旧 submitted.session 不是本次登录授权。可变 note 删除不复活，历史回执不代表当前业务实体仍存在或已同步。

普通 loadCaptureDraft 检出有效新协议后，在任何 put 前返回 null，交由原指定 ID 流程读取历史回执，不能从保留的 current 回填已删 review；坏证明抛错。普通 save/apply 检出新协议先严格核验，再拒绝普通写路径并提示查看该 ID，不凭宽松 fingerprint 借成功或 fork。专用同 grant 精确幂等回放不变。

前三/四阶段均未公开用户 Save，中间 phase4 私有检查点未带这三个 receipt 字段；该检查点仍按自身完整源码恢复。本候选不把无字段的中间新 proof 默认为最终新协议通过。普通公开旧协议兼容与最终新协议严检是明确分支。

实际模块已覆盖合法追加后读旧 O、note 删除后的历史、坏/缺 source/receipt/proof/index/head、标记存在但坏值、普通写误用、当前 D loader 不复活以及读中/交付后 owner、同号 generation、epoch 变化。真实页面 reload/parse-create 计数、明确新建空输入及最终用户 handoff 仍另验，不因服务绿而授 UI/native 完成。

## 实际页面历史重入与明确新空原文候选（交接 Save 仍未开放）

实际 QuickNoteResult 的已加载结果按请求 ID、数据库、当前 owner/session/generation 在 render 阶段绑定；切到另一个 ID 时不再把旧回执临时显示为新请求结果。首次读取和 SavedCapture 的当前记录订阅均绑定严格 epoch，过期订阅交付不能覆盖当前状态。坏证明显式读取失败，不进入可编辑页；真实页面同 ID 历史读取不 parse/create/save/apply，也不调用 draft loader。组件合同不是浏览器 reload 授证。

新协议回执的原“再记一条”按钮现在显式创建独立空原文：同事务确认随机新 key 的五行均不存在，仅新增该 key 的空 input、当前新记录 context 与空 root 来源三行。旧原文、共享 context、消费索引、proof、原稿和 current 不被改写；不靠 URL 布尔或文本相同认领。普通旧协议按钮保持原路径。

新空输入服务不改 session 指针。页面在交付时再核原 actor/epoch、请求仍活跃且内存版本未变化，才选新 input 指针并进入普通原文页；active-review 指针不在此步改写。取消/换号/新内存编辑发生在事务 complete 后，可能保留三行孤立空元数据，但不得抢走当前输入或导航。它不是空元数据的全局 exactly-once 协议。

原文的文档内存保留提取为小型共享 accessor，语义仍是本 document 的 owner 限定副本；每次排队保存持自己的 token，只有当前 token 才能清除相应已落盘副本，旧队列完成不删除新保文。当前 owner 还有保留的输入（即使空文本但 context 有意义）时，新空动作明确停止，不清除、混入或悄悄丢弃。异 owner 副本不显示；不宣称磁盘耐久或新增跨登录恢复。

新的目录“继续核对”用户交接、隔离实际业务 Save 与父编辑返回链尚未启用，本节不代表整个恢复需求完成。旧红及 fixture 准备错误均原样留在检查点：首次路由负例曾在 O 提交后新建 D，被正确来源门禁提前阻止，后改为先准备两稿再提交重现真正旧内容错配；相邻晚到例曾合法追加同日日记并把其中旧原文误判为串内容，已用明确不写日记的独立原文 fixture 去除该混淆，没有放松业务断言。

本次实际页面合同首次全套/独审组合各有一次初次 mount 的 200 次 setImmediate 预算耗尽，尚未执行身份变化。原日志保留；相同源码单页及组合复跑通过后，仅把新增页面合同的宿主就绪等待改为5秒真实时钟、有页面状态诊断的有限等待，无固定 sleep、不改生产初始化或原生超时。
