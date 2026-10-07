# 当前页聊天回复未完成：找回、编辑与明确重试基线

2026-10-07，测试准备；应用起点为 `ddbabacedba602847d73b7273f028baf37ae8a88`。本包只增加取证脚本、有限纯合同和说明，不修改产品。当前代码的 ChatInput 调用 void onSend 后立即清空输入；coachStore 在异常时保留用户气泡及错误/部分回复，MessageList 没有普通用户能发现的重新编辑入口。这是源码事实。首轮 0c63 已取得下述原件，但停在发送前的输入测量判据，真正失败及找回仍未到达，不能预写产品 RED 或已经修好。

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
