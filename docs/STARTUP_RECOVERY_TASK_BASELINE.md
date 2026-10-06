# 启动与重叠恢复：原生基线与修复记录

首轮测试的应用基线为`e723af607e3cad830395d24c50c31f0d76ab2be0`，当时只加测试、CI入口和验收合同，未包含`useAppInit`修复。后续先保留525f原生红，再以fb991修复并独立验收下列四个profile；完整记录见末节。原12秒截止、Login、Splash、品牌、业务store、数据库schema和服务端不因本包改动。

**以下先保留基线准备合同，实际32e86/525f结果及后续修复候选见末节，不能把准备状态或模块通过当作新候选浏览器通过。** 本地只运行已安装Node/Dexie/fake-indexeddb、纯证据oracle及静态检查；没有启动浏览器、监听器、真实网络或外部提供方。下一步由owner静态审查后将测试单独集成，再在精确SHA的GitHub CI运行、独立审核原始媒体；预期RED仍必须非零，不能转成expected pass或continue-on-error。已验收的初始身份/退出重入任务不覆盖本次重叠读竞态；旧b5b8 B待办失败原因不由此推定。

## 四个独立原生任务

新增 `startup-recovery` matrix分片；沿用现有profile隔离、原生动作、截图、12fps webm、完整Chromium trace、checkpoint与递归分块/哈希归档。两条链各1280×900、360×800；合成手机号13900008701–13900008704，各自全新profile，确认关闭后才开始下一条。一个首败不能跳过其他分支。

共同前置：声明初始 `/login`，从实际验证码按钮的隔离后端devOTP响应正常注册、走完引导，再从可见导航创建「Synthetic 启动{宽度}」待办、明确无日期，等到完整服务端ledger中唯一同ID记录及本机同版本ACK/空整个outbox。medium、未完成、completedAt=null、所有原字段分别核对。账号偏好已有服务端快照且没有active/queued修改，避免拿未完成设置提交当读故障。保存原本机完整结构/表、完整原服务端事件及资料epoch（原本缺失也原样记录）。

随后明确声明一次全页导航 `/todo?view=all`，保留真实cookie/身份验证及账号原库。新document在Dexie开库前安装下述有限合成故障，不写任何认证、cookie、localStorage、业务store或业务数据。仅故障控制器驻留当前测试document；它不伪造应用成功、IDB请求结果或成功事件。

1. **迟到恢复失败不得撤掉成功结果**：保持初始Goal四表readonly事务；等待应用自己的真实12秒timeout、恢复attempt开始并捕获其Expense readonly事务。此后才放开初始事务，让原生完成事件自然结算真实Dexie初始加载。必须先看到完整路径、可读「待办」页头、原同ID整行及新建入口，并保留PNG/动作/序号；然后才实际abort仍悬挂的恢复Expense readonly事务。恢复error到达后立即观察，原标题/行/编辑入口不能退回错误屏。再用原生指针打开原记录，读取原输入并点击「取消（保留草稿）」、返回原行。完整原业务行、版本、整个outbox和完整ledger严格相等；草稿元数据前后单列，不声称所有settings无字节变化。
2. **两次均失败后真实重试**：初始和恢复各保持一次Expense/settings readonly事务，同样先等真实12秒timeout及恢复待决，再分别abort并要求两个真实initialization error、零success。应用本身必须出现完整可读「加载遇到问题」和「重试」。明确移除新document注入注册、释放所有当前故障，再用真实可见Retry单击触发reload。新document断言故障控制器不存在；实际GET身份仍相同、完整路径正确、原同ID行可读，并核对前后完整业务行/outbox/ledger/版本/epoch不增不丢。没有脚本直接reload替代该按钮，也没有盲目再点。

## 有限、可计数的故障边界

故障文件 `audit-startup-read-fault.mjs` 仅用于测试；应用不会导入它。所有干扰均标注 **SYNTHETIC**。

- fetch：真实GET `/auth/me`仍走原生fetch，要求HTTP200；当前document同源 `/api/` 非auth业务请求暂时在真实fetch调用边界抛出明确合成TypeError，以走应用现有offline bootstrap。精确记录每次路径/方法/序号；正常预算最多64次，第65次为明确失败的tripwire并立即释放，实际网络未发送该次请求。任何POST/PATCH等业务写入尝试令本场合同失败。它不是云端掉线的自然发生证据
- IndexedDB：只拦截已预先读取名称的该账号库、原生 `IDBDatabase.transaction` 返回的真实readonly事务；其他库和readwrite原样放行。迟到链只保持初始 `goalRecords/goals/outbox/settings` 与恢复 `expenses/settings`；全失败链保持初始/恢复各一个 `expenses/settings`。严格各一次，额外匹配即失败
- 在原生readonly事务中加入真实 `count()` 保持请求，延后**事务完成**；不替换业务Promise、getAll/get结果、事件或应用函数。放开时仅停止继续加入count，原生complete正常发生；失败时调用同一真实readonly事务的abort，原生/Dexie正常拒绝。附加读取同事务内的 `localDataEpoch`，记录原有/缺失和值；两次与原ACK快照严格相同
- 每个事务最多30,000,000次真实保持请求，当前document另有45秒硬截止。计数达到上限前不再添加下一请求并abort；硬截止显式释放全部故障，两种都是取证失败，不是产品通过。该上限是有限测试安全闸，不改变应用12秒定时器
- 放开顺序可验证：initial-start → initial-held → 原12秒timeout → recovery-start → recovery-held → initial-release/abort → initial-success/error；迟到链还要求真实可读画面见证在recovery-abort之前，随后才有recovery-error。实际事务terminal也必须存在。身份/owner匹配与会话代次未变；任何后续generation/revision变化令合同失败，不把新资料或新身份产生的有意义错误静默吞掉

45秒取证故障、105秒每场总截止、18秒路径/阶段观察、5秒每次GET/IDB快照、2.5秒稳定目标截止都只限制测试。原应用 `INIT_TIMEOUT_MS = 12_000`保持原字节；时序oracle要求两条应用事件间至少11,990ms且至多18,000ms，10ms只容纳独立采样精度，不缩短定时器。没有修改动画、浏览器时钟或应用调度。

## 首败、证据与保全

使用既有几何工具确认完整视口/裁剪祖先、文字宽度、绘制/透明度、点击中心命中；原生悬停后连续稳定帧后单击。没有DOM click、滚动写入、内部业务方法调用或认证注入。

每场目录 `startup-recovery/YS-{branch}-{width}`保留原ACK、初始被保持、重叠事务、完整故障chronology、画面见证、场景结果及安全初始化collector。失败首先保存未释放故障/原始诊断和首次画面，再允许只读保全与故障cleanup；此后不再进行业务动作。cleanup后GET-only ledger和existing-IDB readonly源快照另标明采样时点，不把它说成故障前瞬时状态。整个profile关闭保留原视频/trace；媒体非零只是存在，不替代独立逐帧审查。

GET证据只用当前页已有同源cookie自动发起的 `/auth/me`与完整分页`/sync/pull`；不手工读取或重放凭证，不调用业务写API。IDB沿用枚举已存在库、无版本参数open、upgradeneeded立即abort、只读所有表和保留undefined/负零的原快照函数。原本机业务对象与原服务端事件各自精确跨时比较，不删去源字段以获得通过。

## Node边界验证和未验证范围

真实模块测试只在fake-indexeddb里建立明确合成fixture并加载真实Dexie、八个业务store、settings/bootstrap。它在Node里用合成传输/身份前置，绝不作为原生OTP/DOM证据。初始35ms试验分别确认真实事务完成/拒绝，随后加做完整12秒持续验证。

第一次12秒试验暴露保持请求预算太低；同实现的诊断复跑记录fake-indexeddb在约3.72秒已跑满2,000,000次，触发明确预算abort，未达到12秒。原失败日志及当时故障实现保留，不能说首次即通过。有限上限改为30,000,000、45秒硬截止仍保留后，两分支12秒测试都达到预期：迟到链初始5,700,196次后complete、恢复5次后abort；全失败初始5,627,021次、恢复2次分别abort；当次两分支各7次明确合成业务GET拒绝，约12.04秒结束。每次精确数字以本次原日志为准，不假定浏览器会有相同吞吐。

回归包括完整12秒真实模块场景、事务范围/放行、返回原响应对象、fetch第65次tripwire/恢复、45秒截止、错误chronology/身份代次/源变化/缺失先成功画面的反例、CI-only guard。Node正向通过不能证明Chromium IDB调度、实际DOM/全页导航、动画、录像或原生Retry成功；这些必须下一精确SHA CI实际执行。若浏览器时序不满足合同，保留首失败并报告具体边界，不能改内部Promise或放宽用户结果断言取绿。

本合同不覆盖生产数据/真实SMS模型、任意数据量/硬盘配额、真正手机系统、读屏/缩放、任意账号/epoch切换或全部初始化竞态。

## 集成门禁（原生运行前）

测试基线合入e723应用树后，本地前端575项、后端55项及双端lint、类型/构建通过。应用、服务端和schema未改；`useAppInit`仍为原实现，后续v4候选未合入。新增8项包含实际DOM原ID见证的正反oracle及两次真实模块的12秒持续机制试验，仍不等于应用定时器/原生界面通过。新精确SHA的实际浏览器结果与独立读者结论将另列，不覆盖原失败。

## 32e86首轮原生结果与昵称夹具修正

[`32e86b5`](https://github.com/hxjyaohaohaode/YouTrace/commit/32e86b57cf916fdfd5d2d227b4e9dbff77fd33e7) / [CI37355698513](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37355698513)原十项成功，startup-recovery分片失败。官方ZIP、三分片、完整归档与93份原件已独立核验。两条late-recovery都停在原生注册昵称：23字符合成值超过原登录框20字符上限，实际只输入`Synthetic late-recov`，精确输入断言正确拒绝。它们没有点击注册、安装故障或进入重叠读取，不能把该setup失败当产品启动竞态红证。

两条both-fail已独立限定验收：关键原图显示可读错误与重试，实际点击后返回原待办；手机录像片段一致。真实初始deadline分别为12000.5/12000.6ms，初始与恢复的expenses/settings只读事务都实际abort，未有整体success；明确释放故障后仅一次原生Retry，新文档验证同账号、完整原路径。全Todo（含原dueDate字段缺失的精确表示）、整个outbox、schema、版本回执及完整ledger与原ACK逐值相同，分别仅有自身seq1/2，没有新业务写入。这不授予尚未到达的迟到恢复链或v4修复通过。

窄修只给四个profile声明各自不超过20字符的合成昵称，并在实际昵称框渲染后读取其maxLength校验夹具；正常键入和完整值断言保留。应用、原限制、故障预算、12秒定时器、后续用户步骤及结果断言均未改。575项前端复验通过；两条晚到失败链仍须下一精确SHA真正执行。


## 525f两宽实际就绪回退

[`525f927`](https://github.com/hxjyaohaohaode/YouTrace/commit/525f92780f767d208c1ce49229eda336515e3684) / [CI37357154930](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37357154930)十项成功，startup-recovery分片仍失败。独立核验139份原件：两条late-recovery这次已经实际注册、建立原待办并获ACK，经过真实12000.6/12000.5ms截止启动恢复；初始事务原生complete、initial success后，真实同ID唯一行与编辑归属的可见见证为seq29，随后才发recovery abort seq30并收到error33。

关键相邻原图007→008、028→029清楚显示原待办先可读，约872/683ms后退回“加载遇到问题／重试”，标题、原行、编辑及新建入口全部消失。首败cleanup后明确另取的只读旁证仍保持完整Todo/outbox/schema/回执/全ledger与原ACK相同，因此证据是可用画面被撤回，不是原记录丢失；实际打开/取消编辑尾项未执行。两条both-fail仍完成真实Retry返回与完整原源保全，各自事件seq2/4，late原事件seq1/3。这是所声明不变来源条件下的实际就绪回退；原红保留，不能外推旧b5b8故障也有相同原因。

## 有界就绪修复候选

唯一业务源码修改为useAppInit：结果绑定当前启用生命周期、账号、数据库对象和会话代次/修订；旧生命周期或已取消的完成不能解锁后来页面。同一生命周期已有完整成功时，重叠失败仍记原诊断，但不再撤销成功就绪；两次都失败仍进入原错误与重试路径。身份读取失去或恢复存储访问时，失败通知能唤起React显示错误或发起有效新尝试，不能因严格旧结果守卫把12秒截止也静默丢掉。成功发布仍要求当前已验证账号。

原12秒期限、一次恢复、必需store顺序、现有Retry控件、Login/Splash与品牌字节保持不变。actor、数据库、同步引擎及store写入代码没有改动；资料清除epoch仍由原store/事务门禁处理，不声称本包覆盖任意新数据更新、清除或全部初始化竞态。

该六文件核心/回归候选与独立技术审的冻结字节逐项一致。独立检查覆盖重叠成功/失败、取消/会话变化及存储访问变化，使用真实模块与fake-indexeddb、确定性React/router调度替身；不代替真正React DOM或浏览器结果。合入当前测试树后，前端633项、后端55项及双端lint、类型/构建通过；下一精确SHA原生修复验收仍待执行。原生四profile脚本、故障边界、期限、同ID见证和结果断言未放宽。


## fb991四profile限定验收

[`fb991ce`](https://github.com/hxjyaohaohaode/YouTrace/commit/fb991ce14e189204fea25a095a986544dcd9aba9)的首个[CI37358956850](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37358956850)中，startup-recovery已成功，独立核验137份成员、官方ZIP/分片/完整归档与312份源码起止固定值。关键PNG、录像片段和归档内原始trace的顺序一致，两宽各两条指定用户链通过：

- 真实12秒期限后，initial完整成功再遇到晚recovery error，原标题、同ID原行和可用入口保留；确实用原生指针打开原待办，读到原标题/中优先/无日期/未完成，再取消回原行
- 两次读取均失败时仍有清楚错误与可用Retry，明确解除故障后实际单击重试，进入新的原路径document、真实auth200及同owner原待办
- 完整Todo含字段存在性和lossless表示、整个outbox、schema、版本回执与完整服务端ledger均与原ACK相同；四个场景各只有原始seq1–4中的自身一次业务事件，故障document之后没有新业务POST。打开/取消的草稿元数据单独核对，本轮前后均空，不据此外推新输入草稿恢复

这关闭525f指定的不变来源重叠竞态用户链，原红工件保留。存储访问变化、其他身份/资料代次边界的技术测试仍与原生场景区分，旧b5b8原因、任意规模和全无障碍不在此结论内。

同SHA出现两个官方push型CI记录：首run十项成功、旧目标来源分片一项失败；后一个[CI37359003937](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37359003937)十一项成功。本次独立startup验收只引用首run原件。首run的Y6L-retained-360在验证后等待阶段超时；后续原图/trace证实早已进入可读onboarding，测试等待未承认，准确证据及窄观察修正见[旧来源记录](LEGACY_GOAL_TASK_BASELINE.md#fb991首run的新设备登录观察阻断)。该profile后续旧目标任务未执行，不能用后run绿色覆盖该失败，或称所有本轮用户任务都已独立通过。


## 普通整页进入的等待：另行收集连接与页面生命周期

267888的[普通浏览器原件](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37392561776)在真实注册后首次进入Todo出现加载错误；认证与两个同步GET均已结束，但全表readwrite事务的首个settings读取没有终态。其254条事件与765条存储元数据无丢弃，具体计数与未证明事项见[偏好取证记录](PREFERENCE_TASK_BASELINE.md#267888完整边界证实中间导出快照)。这与上述525f“完整成功后被晚失败撤销”的已验场景不同，当前没有证明锁源或相同根因。

下一份仅测试采集器的候选补充：已观察账号连接的数值编号、首次被观察、原close成功调用、实际close事件、已观察事务总数/尚无终态数/complete与abort数；再观察原页面的pagehide/pageshow、persisted布尔、freeze/resume、可见性与wasDiscarded。保持现有存储专用4096条环形账与丢弃计数，仍不记录数据库名、账号、key、值或响应内容。初始化、初次会话及启动恢复三个既有入口复用同一采集器，原动作和时限不变。连接/页面事件的mode为none、transaction/request为0，表示非事务事件；不能把这些保留值算成一笔等待事务。documentElapsedMs记录原文档performance时间，另有timeOrigin和接收时的外层时间，避免把连接或事务自己的elapsedMs误作整篇文档时钟。

这些字段有明确限度：connection-seen是首次看见已有对象，不是证明刚建立连接；页面事件汇总本document已观察过的连接，其中可能早已请求关闭，不能把条目数当仍打开的连接数；只有观测到complete/abort才减少“尚无终态”计数，error不是终态，也不能把未终态直接称持锁。close调用只是请求关闭，close事件另记实际异常关闭；正常显式close并不触发该事件，规范要求等待当前事务结束。[IndexedDB规范](https://w3c.github.io/IndexedDB/#close-a-database-connection)说明这些不同阶段，因此本候选不会把close调用当作已结束全部事务。

页面事件只读取浏览器原值，不自行触发freeze/resume或调整缓存；不增加unload/beforeunload处理器。persisted可以说明相应页面事件的缓存状态，但缺事件仍可能是卸载交付被截断；必须按timeOrigin区分原文档，不能把接收时document序号或跨文档重复的数值DB编号当成同一物理连接。[Chrome生命周期文档](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)是字段语义依据，并不是本项目已发生缓存阻塞的证据。

为保持观察边界，不向IDBDatabase新增versionchange、abort或error监听；[IndexedDB接口规范](https://w3c.github.io/IndexedDB/#database-interface)明确这些监听会影响连接垃圾回收条件，单用WeakMap不足以排除这种影响。候选只新增不属于该保留条件的close监听，连接汇总只保留标量；原应用已有的事件处理照常执行。原方法先调用一次、返回原对象/结果，观察错误隔离，未增加业务读写、数据库关闭操作或等待。

纯投影与fake-IDB合同验证了原返回/异常、原处理器、主动close时未结束事务仍能正常完成、属性只读取一次及未添加上述保留型监听。它们不是新的原生因果证明。当前普通等待仍开放；权限与清除代次的暂停审查、偏好提交后读失败也没有被这份观察候选解决。

## 07bc普通B登录后首次Todo进入：仍开放的原生错误

`07bc198487a883fc9e508520a2eaef6d2bd1dd74` 的 [CI 37431507130](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37431507130) 中，通用脚本完成此前记录操作、响应式与reduced-motion检查后，实际退出A并正常登录B。B根页已记录初始化成功及就绪；随后第一次整页进入 `/todo` 在原期限内等不到标题。脚本停于 `e2e-recovery.mjs` 的该次route调用，之后B隔离断言、返回A与跨标签页退出/注销尾项未执行。没有自动重试或延长期限。

[本次小包](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37431507130/artifacts/11396879374) ZIP SHA256为 `c0bdf9357b7222d19bb7a595bf83e906f0ccea8ab5175323999b3dafa6de7f6b`，已独立核官方hash及原图：failure-0是单独的800×600空白页；failure-1才是1280×900、路径 `/todo` 的“加载遇到问题 / 重试”。不能把两张图当同一页面先后状态，也不能把错误页称为标题选择器误报。

本次留存的普通被动元数据支持以下有限定位：page1/document79根页initial initialization日志的elapsedMs为150时成功，实际route开始后产生document80。新document的auth-me、settings及sync-pull均200且requestfinished，settings阶段成功、sync阶段未记录success，initial initialization于12035ms超时，再开始8个store的恢复读取。38笔已观察事务中29笔complete、0笔abort；最早无终态的database2/transaction30在原documentElapsedMs148创建，为全14表readwrite，只有首个settings.get请求开始，没有success或终态。随后transaction31–38的恢复首读也没有观察到结果。

旧document79仍有9笔已观察而无终态的transaction76–84。其close-requested回执只记录了旧database1的3笔已complete事务；没有旧database2的close或pagehide回执，不足以断言它未关闭、仍持锁或被缓存。两个document的数值编号不能连接成同一物理DB身份；该次全局chronology丢弃9076条、storage丢弃45185条，事件缺席不能当作不存在。没有普通B业务库的完整来源旁证，也没有本次错误页Retry后结果，不能据此声称资料丢失、串号或已恢复。

本包只对原件进行读取和分类，未进一步实施权限/清除代次/发布时序复现或修复。它与267888存在相似的首读未完成形态，但尚未证明同一锁源或根因；e947的升级保护页、525f的晚失败撤回界面也继续按各自证据区分。同期通过的两条花销指定链见 [EXPENSE_TASK_PACKAGE.md](EXPENSE_TASK_PACKAGE.md)，不转授本项或整体产品上线通过。
