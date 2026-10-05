# 启动与重叠恢复：原生 RED 基线准备

应用基线：`e723af607e3cad830395d24c50c31f0d76ab2be0`。本包只加测试、CI入口和验收合同；不含 `useAppInit` 修复，不改原12秒截止、Login、Splash、品牌、业务store、数据库schema或服务端。已独立审查的初始化修复候选仍另存、未混入。

**当前是待原生运行的草稿，不能记作浏览器通过。** 本地只运行已安装Node/Dexie/fake-indexeddb、纯证据oracle及静态检查；没有启动浏览器、监听器、真实网络或外部提供方。下一步由owner静态审查后将测试单独集成，再在精确SHA的GitHub CI运行、独立审核原始媒体；预期RED仍必须非零，不能转成expected pass或continue-on-error。已验收的初始身份/退出重入任务不覆盖本次重叠读竞态；旧b5b8 B待办失败原因不由此推定。

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
