# 当前页聊天回复未完成：找回、编辑与明确重试基线

2026-10-07，初始应用起点为 `ddbabacedba602847d73b7273f028baf37ae8a88`，最初两份测试提交没有修改产品。原 ChatInput 发送后立即清空输入；coachStore 异常时保留原气泡，却没有可见找回入口。0c63 的输入测量阻断、15b 的缺入口及手机 Toast 遮挡、239e 的请求通知时间下界阻断均保留。现已由下述 72f 两宽指定当前页链完成限定验收，不扩大为所有聊天异常恢复或上线许可。

## 位置和连续用户边界

只续接既有 `completeObservation` 的 1280×900、360×800 两个 profile 末端。原财务每宽四问、当前依据、原记录纠错、历史阅读、显示选择故障与恢复、普通重载和最终速记链顺序完整保留；任一前置 observed-fail/blocked 会令新末项记为未到达，不重排、不删旧断言。原 8 分钟步骤、20 分钟作业、账号、录像和 trace 继续使用。

原末端停在速记 receipt 的沉浸页面，因此先用真实“回到首页”再普通导航到 Coach。此前原本就有 page.reload，未持久化的 coachStore.messages/sessionId 已清空，当前页没有气泡和当前 session；此前四问/四答仍应在完整 Chat API 来源中。本任务明确是“当前页第一问失败”，不冒称复用财务旧 session，不增加成功前置，不注入 store/session。Home 正常派生在进入 Coach 后的冻结时点之前单列；聊天故障期间不触及身份、同步或账户资格。

## 冻结问题与唯一真实故障

- A：`帮我看看这周的花销，按已记录的支出回答`
- B：`先保留这段新输入，我还想核对昨天的花销`
- A2：`帮我看看近7天的花销，只统计已记录支出`

在当前 Coach 就绪后冻结既有有序 UI 气泡、完整 ChatSession/ChatMessage API 投影及已有财务来源。先实际填写 A，正常单击 Send。Puppeteer request interception 只对同 origin、无 query 的唯一 `POST /api/chat`、原始 JSON body 与冻结的 `{message:A}` 字节完全相同者 abort 一次；其中没有 sessionId。所有其它请求 continue，不使用页面 offline、不伪造成功响应、不调用 provider/SMS，也不接入暂停的 DB、clear-generation 或 session 资格机制。记录真实 requestfailed、错误、唯一命中、无 response，等输入恢复可用和正在输入结束；超时/匹配异常是取证阻断，不能重发猜测。

实际原气泡、错误提示、空且可编辑输入都经既有严格可见几何和原截图保存。故障释放只卸载 interception，不重放请求；finally 也必须卸载。释放后真实 GET 不得出现任何新增或变化的聊天来源。随后正常输入不同待发稿 B，再寻找原失败消息旁可见的 `重新编辑这条消息`。缺少入口时保留 observed-fail、原截图/连续媒体、failure UI、真实网络和全部来源，并立即停止；不得手写 A 假装用户已找回。

服务端通常会在流答前保存 user 行，所以本任务只称“回复未完成”。本次精确的提交前 abort 可以证明没有服务器新增，但不能把这个结论推广为所有聊天异常都“未发送”。正常 EOF 无 `[DONE]` 当前可能被当作成功，是已知但未在此修复或用来造假的另一个边界。

## 后继产品可复用的可见合同

入口存在后才执行以下步骤；当前源码缺入口，不能把这些准备好的尾项称为已经验收：

1. 实际点原失败消息的“重新编辑这条消息”。B 不能静默被覆盖，也不能自动发送；显示普通选择框及 `保留当前输入` / `替换为这条消息` 两个明确选项
2. 选择“保留当前输入”取消。B 原样可读，原失败 A/error 气泡逐字保留，聊天请求仍只有第一笔；两类 API 来源及旧财务来源不变
3. 再从同一个原失败气泡打开，明确选择“替换为这条消息”。输入必须由实际产品控件恢复为完整 A；测试不会 fill A。随后用户实际编辑成 A2，未 Send 前仍零新聊天请求
4. 最后仅单次明确 Send。必须取得该次真实 200、完整 UTF-8 规则 SSE、`[DONE]`、对应 session header 和唯一新答复，沿用现 completeRuleSse 判据，不把旧气泡、部分流或财务相同金额当作这次成功

A2 成功只允许新增一个实际 session，里面恰好一 user(A2)/一 assistant(完整 SSE 正文)，ID 唯一、session 归属/动作/真实时间在本次发送窗口内。原所有 session/message API 字段完整保留；当前 UI 的 A 与失败提示仍是严格原前缀，再追加 A2 和新回复。后来成功不能抹掉第一次失败事实。普通规则回答不表示真实模型理解能力。

## 来源、证据与检查范围

真实 `GET /chat/sessions` 与每个返回 session 的 `GET /chat/sessions/:id/messages` 单独保存原始响应。初始 fixture 必须仍是原财务一个 session/八条消息；所有采样 session 数严格小于20、每会话消息数严格小于200，触及 cap 即停止，不能用截断结果宣称完整。保留每个返回的完整字段，包括 ID、角色、原文、actions 与 createdAt；这是当前 API 的完整投影，不冒称取到了 API 未暴露的数据库列。业务 ledger 不含聊天，不能代替这些读取。

财务来源直接窄复用 audit-expense-summary 的 snapshot/preserve/read 闭包：完整 expenses/settings/outbox/coachInsights 四表、原始 Expense/Insights GET、完整分页全实体 ledger 和旧来源逐值保全，不另起全库读取框架。失败/释放/B/选择/取消/恢复/编辑各时点的来源、输入及请求计数分别记录。首败截图、网络和源文件留在既有 profile 原件里，terminal-network 只作结束旁证，不覆盖原 failure 文件；出错后只有只读保全和故障清理，不再次执行 Send。

新增五项纯合同只检查这一链容易被误授成功的有限反例：精确请求/单次 abort 和 release、20/200 cap 与旧行字段、取消时 B/失败气泡/零额外发送、新 session 恰两消息及时间/正文、成功后失败前缀仍在。mock transport 的通过不算浏览器原生取证；本包没有本地启动浏览器、listener、server、install 或 audit。完整既有门禁、精确 SHA 的原生执行和独立媒体复核由主任务在停止编辑后统一进行。

本次两份先后停止编辑的准备稿均完成前端 lint/build 和 799/799 测试，无跳过或取消，各自字节及日志独立保留。审查先后把实际输入读点的 value 与当次 A/B/A2/空值绑定，并将原最后一次来源/UI/请求数检查覆盖到四个气泡实际阅读之后；release 完成后的诊断错误也必须为空。最末的终点/释放增量没有新增用户动作或来源样本，已完成最终 lint、语法、五项定向合同和窄差异检查，没有重复聚合；799 仅对应前两份冻结版本，不能代替最终原生结果。应用、服务端生产/测试、依赖与工作流矩阵均未改；后台沿 ddbab 实际 62 项及双端 audit 0，本地未重复。新的真实失败、入口缺失与后继恢复仍只按精确提交原件判断。

未覆盖：部分流/EOF 结束错误、成功后来源读取失败的产品恢复、历史聊天入口、刷新或跨页保稿、账户切换/清除后重放、两设备、任意规模、真实模型/短信、全部键盘/IME/辅助技术。没有新增归档或持久恢复框架，没有修改既有 clear/session guard，也不处理暂停的权限/发布/偏好读取或旧速记稿目录。

## 0c63 首轮原件：发送前取证门槛阻断

提交 `0c63d2f42d0b031de3b877662f94839aea69de76`、树 `0f921ce7b444fba195e5104f7b50bbe27b2ef7fe`、[CI 37551421601](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37551421601) attempt 1 已完成。四个官方 ZIP、完整归档及 407 个成员独立逐 hash 核验，377 个受版本跟踪文件的内容首尾干净一致并绑定提交。Coach 报告为 74 observed-pass、2 observed-context、2 blocked，共 78 项；新聊天尾项两宽都在 original-input 阅读处停止，未安装故障、未 Send、未达到找回入口。

原 075/142 图片的完整 A 单行清楚可读，实际 value 等于 A，原整体 visible/painted/centerHit 均成立；唯一拒绝条件为 scrollHeight 44 大于 clientHeight 42。first-failure 与 terminal-network 都记录 fault=null、requests=[]。这是把滚动盒尺寸差直接等同正文裁切的取证问题，不是已证明的产品文字缺失、发送故障或输入找回结果。原件没有保存 computed padding/border；不能将后来按源码推导或新采样的样式值补写为本次实测。

31 份相关原 JSON 已逐 hash 独核，其中 22 份为新增 chat-recovery 命名。两宽各有一个旧 session、八条消息，逐对绑定前面四次财务真实网络正文、同 session 与完整 DONE；当前聊天页仍是空会话。冻结到首败的旧消息、完整所采四张本机表（3/17/0/5 行）、raw Expense/Insights GET 及六条全实体账均相等，账为五个 Expense 事件和一个 QuickNote 事件。业务全账来自严格分页后的聚合结果，原分页 HTTP envelope/headers 未另存，不冒称全库或全部原始 HTTP 保全；本次尾项零请求，也没有新的响应头可核。

两主 VP9 编码时长 38.250/37.083 秒，完整解码成功；两原 trace 的 578003/631640 个事件已流读到尾。原末帧仍是完整 A 和当前空会话，不能授之后的故障、B 保稿或重试。官方全矩阵 20 成功、Coach 与原暂停 preferences-read 两项失败，无取消；verify 在本次精确提交实际完成 799/62、双端 audit 0 及 25 项普通脚本检查。普通媒体未重复独审，不以这次脚本成功解释之前的初始化错误。

下一取证候选只更正 textarea 正文可读性判断：[scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight) 包含 padding，[clientHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/clientHeight) 不包含 border，二者不等不能直接证明字形裁切。新阅读保存本次实际 client/scroll 宽高、滚动位置及 computed padding、line-height、box-sizing、书写方向，在声明的水平 LTR 输入内核正文布局边界；不加固定 2px 容差，不改变产品尺寸、滚动位置或动作。精确值与原整体绘制/裁切/前景命中仍须通过，真正内容溢出或首行滚走必须拒绝。旧 0c63 首败保留，后继仍需新原件才能证明实际发送及原入口停点。

这份布局测量后继已在同一冻结执行字节完成前端 lint/build、800/800 测试，无跳过或取消；六项定向合同和独立有限边界控制也通过。44/42 与具体 padding 的组合仅是明示的合成正控，新实际样式量要由下一原件取得。产品、服务端、driver、工作流及全部用户动作/故障/期限/来源判据均未修改，后台沿 0c63 的 62 项与 audit 0，没有重复本地后台或审计。这里只授取证准备，仍未授发送、失败提示、找回或编辑重试的产品结果。

## 15b 实际首问失败与缺入口

提交 `15b377c0103c2117e4ae03563653898a91c15160`、树 `5c0558dfa0e33032f5a31dfabca87b3260a1bb29`、[CI 37552862722](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37552862722) attempt 1 的四个官方 ZIP、完整归档及 469 个成员已独立逐 hash 核验，377 个受版本跟踪文件的内容首尾干净一致。Coach 报告为 82 observed-pass、2 observed-context、2 缺入口 observed-fail，共 86 项，没有 blocked。日志状态不能覆盖下面的手机像素限制。

新 A 阅读实际取得 clientHeight 42、scrollHeight 44、滚动量 0、水平 LTR/border-box、line-height 24px 与 padding 10/40/10/16px，正文纵向边界 10..34 落在 42 内；value、原整体几何及完整字形原图相符。原 0c63 两个 A 准备误报在此有限端点关闭，这些样式实测只属于 15b，不回填旧原件。

桌面 080/084、手机 155/159 原图保留完整原 A 与网络错误气泡。每宽的原网络记录均只有一次无 sessionId 的精确 POST /api/chat、一次 ERR_FAILED、零 response；声明故障命中/abort 各一次、无错误且显式释放，直到末端仍只有这次请求。实际填入不同待发稿 B 后，原问题旁没有可见的重新编辑入口。选择、取消、替换回 A、编辑 A2 和第二次 Send 全部未执行；不能靠手工重输补授找回。

手机 157/159 和录像末帧中，B 的完整 value 虽已保留，错误 Toast 仍绘制在输入框上方遮住文字。其主体 pointer-events:none，所以 centerHit 并不证明未遮挡；这里不授当时 B 已可读。桌面 B 文字可读，右侧浮层绘制在发送区域上方；没有由此推断按钮命中失败。3800ms 自动消退是组件源码行为，本次没有拍到消退后的手机 B，不把一帧遮挡写成永久不可用。

77 份相关 JSON（其中 68 份 chat-recovery 命名）已逐 hash 独核；每宽 frozen/released/different-draft/missing-entry-stop 四时点保全所有旧 Chat API 字段和实际所采 financial payload。原一个 session/八条消息、四本机表 3/17/0/5 行、六个全实体事件（五 Expense、一 QuickNote）均不变。聊天 API 投影与业务 ledger 各自核对，不互相替代，也不扩大成全数据库/原分页 HTTP 包保全。这只证明本次已中止的提交前请求无新服务器聊天写入，不能泛化所有网络失败。

两段主 VP9 编码时长 39.333/37.916 秒，完整解码成功；两原 trace 的 599264/654180 个事件已流读到末端。原首问、错误与 B 保留，但手机末帧仍被 Toast 遮挡；新的成功 SSE 尚未产生。其余旧 Coach 任务只保留本次脚本结果，不借这一差额重新授全量媒体验收。

官方全矩阵为 19 成功、Coach、普通 verify 与暂停 preferences-read 三项失败，无取消。verify 实际完成 800/62 与双端 audit 0，随后第二 profile 登录后首次整页进入 `/settings` 出现“加载遇到问题／重试”，peer 读值未到；主设备设置页面仍正常。小包 10 成员独核，page3/document3 留存 auth/settings/pull 200 finished、settings 成功、sync 未留成功、12032ms 超时后恢复 store 开始。全局留存 2048/4096、丢弃 2573/19499；当前文档 35 事务开始/25 complete、73 请求开始/63 success 仅为留存计数，没有原值、Retry 或原因结论，不能套用此前旧 Goal 的失败归因。

下一普通 UI 候选只把回复未完成状态可靠绑定原消息，并在该处保留持续说明和重新编辑入口；已有 B 必须明确保留或替换，真正 Send 仍由用户决定。空回复失败用这里的持续反馈替代本条 error Toast，避免挡住输入；已有部分回复时保留原中断 warning，不能仅靠可能在屏外的原问题状态替代它。全站 Toast、原消息正文、现有请求/清空资格及持久机制不改，当前缺入口与遮挡原件均保留。

## 当前页 UI 候选检查

候选只改四个相关生产文件及一份新增测试。失败标记绑定真实 sendMessage 已捕获的 user ID，原用户/错误/部分答复正文和 actions 均保留；MessageList 在正文之外显示持续状态与编辑入口。当前输入仍在原 ChatInput 组件内，原路由 prefill/key 不变；明确选择时重核原消息 ID、正文及失败状态。保留/关闭同步使本次选择失效，旧确认或旧关闭不能覆盖 B，也不能干扰后来的新选择；当前确认只处理一次，恢复本身零发送。此处只处理当前组件的选择有效性，不新增数据库、身份、清除或持久重放检查。

最终同一冻结执行字节完成前端 lint/build 和 809/809 测试，无跳过或取消；新九项加原五项定向合同共 14 项通过。证据包含实际 store 配合合成 fetch、React 静态渲染及实际组件事件回调；组件调度、路由和 Modal 为明确替身，不冒充浏览器、原生退出动画或焦点验收。原取消后旧确认回调的有限反例先失败后关闭。初稿 807 与 partial 收窄中间稿各自保留，不转授最终字节。

原 `b1571e6f…` 取证脚本、全部业务动作/原判据/预算/driver、后端与依赖未修改，后台沿 15b 的 62 项与双端 audit 0，本地没有重跑审计。下一精确原件仍须真实完成 B 的可见阅读、取消保 B、明确恢复 A、编辑 A2、一次 Send、唯一新 session/两条消息及全部原源保全，才能关闭本次完整用户链。部分流、真实模型、跨页/重载或清除后重放不由这份候选验收。

## 239e 实际恢复已到，时间取证边界仍红

提交 `239e76c31f55839ac39fc195913e5fa29764a816`、树 `9fb8c79abe0cb9abca038d4367d315077d9af7ae`、[CI 37555421606](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37555421606) attempt 1 的四个官方 ZIP、完整归档及 603 个成员已独立逐 hash 核验，378 个受版本跟踪文件的内容首尾干净一致。报告原样为 90 observed-pass、2 observed-context、2 blocked，共 94 项，不将后面的独立复核回填成旧报告全绿。

两宽原图实际完成：持续失败状态和入口可读、B 完整可见、取消仍为 B、明确确认恢复 A、用户改为 A2、一次 Send 与新规则答复。手机原错误浮层遮挡在这次原图中已消除，旧 A 与失败气泡仍保留。末端共两次 POST，一次原始失败、一次明确成功；中间七个发送前阶段仍只有原失败请求，旧聊天和完整所采 financial payload 深等。

175 份相关原 JSON（166 份 chat-recovery 命名）已逐 hash 独核，最终恰好新增一个 session 和其中一 user/一 assistant，绑定实际 200、session header、完整 SSE/DONE 与 actions，旧来源不变。首败与 recovered 的来源/UI 也相等。原 final-source 谓词唯一不满足的两个原子条件，是新 session/user 的 createdAt 早于脚本在 Node 收到请求通知的时间；其余字段/数量/旧源条件都为真。原脚本在该断言处停止，后面的最终 UI/financial 断言没有执行，独立旁证不能改写这项执行事实。

桌面请求通知记为 01:08:36.247，新 session/user/assistant 分别为 .244/.246/.253；手机通知记为 01:10:34.695，三行分别为 .692/.693/.700，原 API 实际保留毫秒精度。原 Send 预读文件的观察时刻分别为 01:08:36.199 与 01:10:34.646，随后才有真实点击。这些材料已说明：请求通知的接收时刻不能当作数据库写入之前的动作下界。没有发现额外发送或较早旧会话混入，不加任意毫秒容差，也不取消时间检查。

两段原 VP9 编码时长 45.000/42.416 秒，完整解码成功；两份 trace 的 626523/699458 个事件已流读到末尾，原关键输入/选择/回复图和媒体均已核。官方全矩阵为 20 成功、Coach 和原暂停 preferences-read 两项失败，无取消；verify 实际完成 809/62、双端 audit 0 与 25 项普通脚本检查，普通媒体未再次独审，也不据此解释旧初始化原因。

下一最小测试后继仅在既有 Send 预读之后、唯一点击之前记录 sendActionStartedAt。原 network.requests[].startedAt 仍保留其通知接收含义，最终材料另以 requestObservedAt 明确表示该观察时点；必须满足动作下界≤通知接收≤最终来源时点，新 session 和两消息仍须在动作至末源区间内。原响应、正文、旧行、数量、API cap、SSE、真实动作与预算全部保留；不向旧原件补造新动作时间，也不修改产品或数据库。

该时间后继同一冻结执行字节完成前端 lint/build、810/810 测试，无跳过或取消；七项定向及独立窄审通过。真实毫秒序列的纯控制另声明动作下界，早于动作或晚于末源 1ms 的任一新行仍拒，通知乱序/缺失同样拒绝。后端与依赖未改，沿 239e 的 62 项及 audit 0，本地未重复；下一原件必须实际取到新动作时点并完成保留的最终断言，旧两项 blocked 继续保留。

## 72f 指定当前页恢复链限定通过

提交 `72f5acf96b689ffd7584acd8cf88540b5e4b3bcd`、树 `4e1d49f1cfe102b1fac5445ca4eb2e5a37347d4e`、[CI 37557089779](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37557089779) attempt 1 的四个官方 ZIP、完整归档 `93b7094e076d95784e1a2e70aa1dcaede5c3949c361656e35cdf8bb8ff9acd78` 及 597 个成员已独立逐 hash 核验。378 个受版本跟踪文件的内容首尾干净一致，独立摘要 `df58d1b8b026e1862ab8ae153a7bedaf9265b9861a1a387233a024b673a48cda` 绑定该提交。96 项结果为 94 observed-pass、2 observed-context，没有 fail 或 blocked；不把 96 项全称通过。

本次桌面 082/086/089/094/095/103 与手机 175/179/182/187/188/196 等原图实际显示：原 A/失败气泡和持续入口保留，B 完整可读，取消保持 B，再次明确选择后由原控件恢复 A，用户改 A2 并仅一次 Send，出现完整新规则答复。手机输入不再被空回复 error Toast 遮挡；原四个气泡正文及最终空且可编辑输入均独核。旧失败事实没有被后来成功改写。

新动作/通知/末源时刻实际为桌面 01:29:34.198/.235/35.160、手机 01:31:06.545/.598/07.283。新 session/user/assistant 分别在动作之后 +35/+38/+42ms 与 +53/+55/+62ms，均落在真实动作窗口内；动作后紧接既有唯一 Send，绑定唯一第二 POST。原 `3e9d6f…` 来源谓词在本轮原件上独立重放为真，最后 UI、financial 保全和完整回复断言也已实际执行，不用事后推断替代原执行。

169 份相关 JSON（160 份 chat-recovery 命名）全部逐 hash 独核。七个发送前阶段保留旧一个 session/八消息及完整所采 financial payload，仍只有原失败请求；终态恰两次 POST，一次失败零 response、一次成功 200，后者绑定 session header、完整 UTF-8 SSE/DONE、正文和 actions。最终仅多一个新 session 及一 user/一 assistant；旧消息全字段相等，四本机表 3/17/0/5 行、raw Expense/Insights 投影和六个全实体事件也原样保留。聊天来源独立于业务 ledger，范围不包括 API 未返回列、原分页 HTTP 包或全数据库。

两段主 VP9 编码时长 41.333/41.000 秒，完整解码成功；两原 trace 的 646990/696062 个事件已流读到尾，关键任务图及末帧均已核。末帧保留旧失败对、新问题/答复和空输入。官方全矩阵 21 成功、仅原暂停 preferences-read 失败，无取消或待运行；verify 实际完成 810/62、双端 audit 0 与 25 项普通脚本检查，其它成功产品媒体没有重新下载授验。旧初始化错误仍不归因、不关闭。

这项只覆盖声明短合成输入的当前页首问提交前故障、用户明确保留/替换、编辑及一次成功重试。未知是否已提交后的重试、partial/EOF、跨页或持久草稿、账号/清除/重放、任意长会话、真实模型、原生取消退出帧竞态及全面无障碍/焦点仍不由此授予通过；有限组件回调/源控制继续单列。结果说明留待下一必要增量归位，不为纯说明单独运行全矩阵。
