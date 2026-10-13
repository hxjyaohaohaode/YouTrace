# Capture 显式同 ID 交接：内部候选

基线公开版 `2abae08db7c6f49bc1cd6281bd745eb8aa96ccb2`。本文件记录分阶段模块/组件候选。当前末节已接入本地显式继续入口、同ID业务保存和返回原编辑，C/D 源码独审与本地1590项已过；末尾原生脚本正在准备，尚未执行，未公开或部署。此前各节“入口未接入”是相应历史阶段边界，不是末节的当前实现状态。

## 第一、二阶段已实现的内部边界（历史）

1. 目录/查看仍只读。独立的显式交接 API 只接受目录私有版本能力，重新核当前 owner、DB、session generation、严格 epoch 行和已知提交标记（receipt/source/note，以及本候选新增 proof），返回内存投影；不调用 `loadCaptureDraft`，不更新当前稿/输入或 session 指针。
2. 首次本机修正采用 typed 全行 CAS，保留 undefined 与字段缺席、负零、字符串空白和数组顺序，忽略对象键插入顺序。只有实际修正才更新同一个 `capture-review:<ID>`。未变值不会只为重绑定 session 写入。
3. 原 `CaptureReview` 的内部隔离策略从私有副本初始化，跳过普通 pending 恢复和 upgrade。首次严格只读归属核验成功后才显示内容；正常 auth 渲染/IDB epoch 变化及每次写入均有保护。没有为任意无事件的外部 JS 内存变化添加轮询，也不宣称瞬间捕获所有此类变化。
4. 本实例每项排队修改绑定不可变 payload、序号和私有 ticket。共享 pending token 仅作为冲突检测，不是锁。已拥有的 token 被删除或替换后拒绝写入，不自动抢占；旧任务成功不清除新 pending，已确认票据不可重写。
5. 未落盘副本由文档生命周期的私有强引用保留，组件卸载不丢弃。普通旧流程可能覆盖或删除共享槽，仍不能删除这份私有副本；别人的槽不被改写。仅当前准确 actor 可读取内容。此处不是磁盘耐久、自动跨登录恢复或新增用户恢复入口。
6. 未完成金额等内存编辑可暂存原文本；磁盘仍要求完整合法 schema。无限值/超安全整数不能写成合法稿，用户修正后才允许落盘。拒绝执行 getter、类实例和循环 JS 对象，不将不支持的值静默 JSON 化。
7. 隔离返回不 persist/navigate，pending/failed 时拒绝普通返回丢弃；同 ID 修正成功后只关闭实例，驻留父编辑及两指针保持原值。取消只能撤销未来能力，不能回滚已提交修正。业务 Save 和递归目录在内部隔离模式不显示；公开默认页面仍走既有流程。

## 第一、二阶段当时未闭合（后续实现见各节）

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

## 显式同 ID 用户交接候选（本地实现，原生未验）

详情保留独立“继续核对此稿”按钮；目录浏览/选择/展开没有写权限。只有该动作才读取私有原版本能力；一次只读准备后再次核选中代次、当前身份、父编辑同步保存状态和编辑revision。父页 pending/failed/语音及同一个已驻留确认ID均拒绝，不为资格而 save/flush/stop-speech。取消或关闭使迟到准备失效。

准备被同 ID、未落盘或失败父编辑拒绝时，已经停止的详情订阅不再保留旧正文；清空详情并要求明确重新读取目录、重新选择。独审原反例与修后实际父组件回归保留，拒绝与重新只读核验均不新增写或改指针。

父页面隐藏但保持组件驻留；原 CaptureReview 以隔离策略核对 O。新输入、当前 D、current 行和双 session 指针不转移。父 ready 状态由真实串行队列同步更新，不仅依赖 React 渲染的 disabled。进入子页后父旧事件也不再改其编辑。隔离页使用独立标题焦点，关闭后在父真正可见且身份有效时回目录入口；这些是产品焦点机制，尚不是原生焦点结果。

真正 Save 不先 persist 未修改行，仅调用私有 apply；业务在途同步禁止 close/back/重复操作和所有改值入口（包含金额的显示字符串）。实际反例发现金额字符串曾先于写守卫更新，已把守卫前移。纯字段错误可修正；注册后的operation冻结改值，只允许同操作重试。已知complete但读回失败只重试严格历史读取。隔离保存结果只有返回原编辑，不提供跳到新输入/首页/其他实体的链接。

返回前严格重验父 actor/epoch；失败显示锁定页而非展示/聚焦旧字段。同号新generation可能先使上层 QuickNoteResult 重新读取旧可编辑父稿，实际合同已揭示该旁路；现在已打开的可编辑稿遇身份变化先锁定，用户明确“重试读取”才重新读取，不自动把原父生命周期升级为新授权。新协议只读历史仍可以按当前合法会话重新加载。

子页请求绑定 grant/动作代次/挂载状态，迟到 success/error 不覆盖新实例。组件卸载本身仍保留原模块的 pending 私有副本；实际父交接卸载会撤销该父持有的未来能力，不把撤销称磁盘恢复。未知提交只暂停后续操作，不假装回滚已完成业务。

目前真实模块/实际 React 父页合同包括：原ID修正和共享key不同日期保全、零编辑取消、pending/failed父页拒绝、准备中取消/改文拒绝、同ID双编辑拒绝、隐藏父换代/epoch拒绝、业务在途重复动作、完成后丢结果/读回失败、金额错误可修正、原语音/返回邻接。Modal/动画/路由宿主、fake IndexedDB仍明确替身；真正两宽点击、焦点、长文与服务器ACK须后续原生。


## 同 ID 原生准备（尚未执行）

复用现有 capture-return 两宽/25矩阵及原8分钟预算，原 O/R/D、只读目录、语音替身和40行原文合同全部保留。普通 fork 新增的第三行来源按动作前实际 session 指针、typed 原行存在性、父 context/来源、owner/epoch逐项独立核验，只有精确新增 input/context/origin允许写，不放开整个 settings。

在原 L 后追加：确认页通过真实目录选择 O、Continue、零编辑返回；原 Return 到原文页后再次真实目录选择 O，明确改金额17.35、取消两待办和日记，同 ID 保存一笔收支和原始速记，查看真实 ACK，再返回驻留 L。每次父 fields/URL/双指针、原文/current、所有非目标实体保全。零编辑和返回单独原生写尝试账为0；有意修改与业务提交不冒充只读。

Node 内建 SHA-256 根据独立typed协议重算最终 CAS 行→proof/source/receipt/index/head，而非调用产品自身 verifier。proof.expected 对应最后成功修正后的 O；目录初选版本另保存，submitted仅有已声明会话投影。真实 GET ledger/准确原ID ACK 与空 outbox独立核对。负例覆盖合法同步改body/source/receipt但保留旧摘要、删head、错owner和索引截断。摘要仍只是损坏一致性检测。

真实界面发现/保存/返回链之后，另单列技术性访问本轮已知已提交 O 的实际 receipt 深链接并产生新文档。该动作不证明用户可从界面发现该路由。重载bootstrap与稳定只读窗口分开：只按完整原GET分页、同owner全部事件、既有ACK和精确非回退tip授权cursor差异，其他数据不豁免。稳定后原控件展开历史原文才核全表和写尝试0；无原生调用计数时只声明未生成新稿/业务写，parse/create调用0仍限实际组件合同。随后原“再记一条”必须生成独立空root及composer fork，保留已消费原文、context和proof，真实输入新合成原文后仅生成新未提交确认稿。

每次失败独立尝试原错、editor/session、IDB、GET账、写观察账和截图；任一收集错误不跳过其它部分或覆盖原错。成功必须证据完整且观察器还原。原生未运行前，本节只有准备合同，不授实际点击/布局/焦点、reload或用户完整流程通过。

原生两个登录标识现在由 Node 内建随机源在运行时生成，仍只供既有本地 CI console 短信适配器使用，不把固定个人样貌手机号写入新源码。历史档案继续保留原运行身份，不改标签。本候选未加入密钥或私人申请材料。
