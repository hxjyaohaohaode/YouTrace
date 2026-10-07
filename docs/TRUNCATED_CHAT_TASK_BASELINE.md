# 当前页截断回复：基线、修复与限定验收

2026-10-07。首个测试基线以 `72f5acf` 为起点，仅增加现有 Coach 链尾部的测试与证据合同，没有修改产品；准备时未声明原生执行或通过。原 72f 当前页输入恢复已限定通过，其动作和断言原样保留。本基线不是服务器业务成功、真实 provider 验证或生产许可；后续执行结果按下方精确提交分列。

## 最短增量

仅当前 `runChatInputRecovery` 已完成原失败、B 取消保稿、找回 A、编辑 A2、明确 Send 并逐项通过真实规则 SSE/来源/UI 断言后，才在同一页追加。原有 `terminal-network` 先保存，仍为两次 POST；新增尾段全部用 `truncated-` 名称。没有新导航、reload、成功前置、历史清除、store/session 注入或新矩阵；原任务 8 分钟、job 20 分钟不增加。

冻结既有完整 Chat API、所采 financial 来源和四个有序 UI 气泡。新问题 C 为“请继续核对已记录的花销，并说明依据”。只用真实输入与一次明确 Send；精确请求 body 包含 C 和前一真实响应已经验证的 sessionId。

Puppeteer 拦截只对同 origin、无 query/hash、精确 `POST /api/chat` 且原始 JSON 字节相同的请求 `respond` 一次，其他请求继续。响应明确声明为客户端合成：200、`text/event-stream; charset=utf-8`、一帧完整合法 JSON，其正文为“合成截断流：先核对已记录的支出，后续说明”，正常 EOF，无 `[DONE]`，无动作帧。这个 POST 没有到达 backend；200 不表示服务器接受、保存或模型完成。不得用 `requestfailed`/abort 代替正常 EOF。

退出 typing 后，保留旧四气泡并精确增加 user(C)/assistant(partial)。实际阅读 C、partial，再读取绑定 C 的持续“回复未完成”和唯一可用“重新编辑这条消息”。缺反馈或入口就保留原红并停止，不手工重输补授恢复。通过实际控件恢复 C 到空输入后读取其完整值与绘制/裁切/前景，最后重新采来源、UI 和请求计数；总数只能是原两次加本段一次。恢复零额外 POST，不再编辑或发送。72f 的 B/取消/替换支线不重复。

部分回复异常仍沿用原 warning Toast。真实控件恢复 C 后、最终输入阅读前，先保存真实通知及其与输入框的矩形重叠和截图；只有实际已绘制通知覆盖输入才触发最多 5 秒的条件等待，再保存后态及真实起止时间/elapsed。晚采样超过截止也不得授通过。`pointer-events:none` 和 centerHit 不能排除绘制遮挡。此处不固定 sleep、不点击关闭、不修改公共几何或删除反馈，也不扩大总预算；超时保留取证阻断。持续未完成状态的实际阅读返回文本还须精确等于“回复未完成”，不能借用早一时刻的文字检查。

## 必需原件与判定

- 声明保存精确冻结 request、合成响应正文/类型/状态/无 DONE、旧四气泡、原完整来源；不保存凭证或请求 headers
- 网络保存 request、response status/content-type/text、`requestfinished`、`requestfailed`、一次 respond 命中、释放时刻/错误。要求本段恰一 response/finished、零 failed、正文逐字相同、已释放且无错误；原两次请求的 terminal 原件单独保留
- 截断释放后和最终（或首个产品缺口停止处）完整读取 ChatSession/ChatMessage API 全部返回字段，延续 session<20、每 session message<200 的 cap 门槛；旧两 session/十条消息不增不改。完整所采 financial 返回值深相等；四张本机表、Expense/Insights 与完整分页聚合全实体账各自保留，不称全数据库或原始分页 HTTP 全保全
- 原生截图/状态、实际 pointer/read、连续媒体与 trace 使用原 Coach 工具；冻结和最终原件不能被合成 fixture 的预期值替代
- 纯合同反例验证请求精确匹配/一次注入、无 DONE 与正常 EOF证据、错误/重复/字节篡改/未释放均拒绝、旧气泡与 partial 不得改写。纯测试通过不授原生 UI 通过

失败分层：原链未完成则新增链未到达；拦截未命中、多命中、缺失正文或 requestfinished、出现 requestfailed、释放错误或 source 读取不完整为取证阻断。已确认正常 EOF 和精确 partial，但 C 缺未完成标识/入口为产品红；阅读被遮挡/裁切、恢复覆盖或自动重发、旧源变化另按实际原件保留，不以延长预算、人工补输或重试规避。

## 上游边界

精确 `72f5acf` 基线的独立实模块证据已执行：合成流按 7-byte 分块，客户端 `apiClient.streamChat` 和上游 `openAiStream.readChatCompletionStream` 对部分正文、空流的正常 EOF 无 DONE 都正常 resolve。完整 DONE 正控保留。真实 in-process Hono/SQLite 路由在非空 EOF 后持久化 partial 并自行发出下游 DONE；合成 partial 若含完整动作 fence，还会持久化动作候选，但候选没有执行。空 EOF 则触发原有规则 fallback。这些是实际模块/进程内路由证据，不是原生 provider 或浏览器成功。

另一个 reader-error 的实际 store 链已经确认：该合成围栏输入下，已有中断说明和规则 fallback 正文被后续 actions 分支按 fence 清理裁掉。后继最小产品修复需要同时核对已有 source 字段能否保住明确的 fallback 可见性，不能仅在 parser 抛错后假定用户已读到降级提示。本次原生尾段仍只包含一个 C 的客户端正常 EOF，不增加 D 或其他发送来代替独立合同。

客户端原生合成响应只证明浏览器处理这份截断 SSE。上游另按独立 in-process 合同声明合成 upstream ReadableStream、部分增量、正常 close 无 DONE，后继验证降级、部分文本、未完成生成动作及完整下游结束/保存关系。它不调用真实 key、付费模型或 SMS；首个测试基线未修改生产，不把合成 200 写成 backend 成功，也不改变身份、未知提交重放、暂停 DB 或清除资格机制。

## 基线发布前检查

首份固定执行稿 `3115bd58` 完成前端 lint、build、813/813 测试，零跳过/取消；两个执行脚本语法检查通过，检查期间字节不变。随后仅把同一通知等待块移到实际恢复 C 后的最终输入读点前，并在缺入口现场保存通知状态，固定后继为 `3666d5d8`；5 秒上限、实际 elapsed、原动作/来源判据不变。该后继重新通过脚本语法、10/10 定向合同和前端 lint。两轮冻结结果分别保留，不把前一聚合计数说成后继重新执行了全部测试。

这份测试基线没有应用、服务端、依赖或 CI 工作流差异，后端沿用 `72f5acf` 的 62 项官方终态而未在本地重复运行。当时新增原生客户端截断链尚待精确后继提交的 Coach 工件；813/10 项检查与合成模块见证均不授页面通过，不关闭任何既有普通初始化或暂停偏好问题。

## fdead98e 原生红基线（2026-10-07）

`fdead98e1f7233ca1dc4f6402aea6fadf06342a7` / run `37560396568` 的五份官方 ZIP、四片归档和全部 647 成员已逐 hash 核验，644 个选取工件可读；379 个受 Git 跟踪文件首尾 clean，内容摘要与精确提交一致。本段仅新增客户端 EOF 尾项的独立验收，不借本轮工件重复授予前面所有 Coach 任务。

桌面 108、手机 206 原图实际显示完整 C 与精确部分正文，typing 已结束，但 C 旁没有“回复未完成”或编辑入口。旧 A 的失败状态/入口仍属于旧问题，不能用于证明 C 可恢复。`truncated-edit-entry` 原 JSON 只有 `count:0`，没有采到 `statusCount`；缺未完成标识由原图支持，不补造这个字段。恢复 C 和随后通知覆盖等待均未到达，因此本轮没有它们的成功原件。

47 份相关 JSON（其中 40 份 truncated 命名）已逐 hash 独核。每宽旧两个 session/十条消息、声明 financial 全字段和原 Expense/Insights 投影在 released 与 missing-entry-stop 都相等；原两次请求 terminal 严格是最终三次请求的前缀。新增仅一份声明的 82-byte UTF-8 合成正文，一次匹配/respond、一次正常 requestfinished、零 requestfailed、无 DONE，显式释放且诊断 errors 为空。C、partial 和原四气泡完整保留，没有额外发送或服务端聊天新增。这只证明该次被替换响应未到 backend，不能推广为真实截断请求未提交。

两段主 VP9 编码时长 47.666/43.750 秒，完整解码成功；两原 trace 的 640367/724826 个事件流读到尾。最后实际帧仍是没有未完成标记的 C 普通气泡，与上述首败图片一致。原生读者红保留，最小产品后继必须用原动作和原判据重新取得其真实结果。

本轮普通 verify 另在第二 profile 首次 `/settings` 路由显示“加载遇到问题”，peer 偏好读值未到；前 14 项普通脚本检查通过。其 10 成员小包仅作被动分类：当前 page3/document3 留存 44 chronology/216 storage，auth/settings/pull 为 200 且 requestfinished，settings 成功、sync 只见 start，initial 在 12031ms 超时后进入恢复读取。38 个事务 start/28 complete 与 78 个 request start/68 success 仅为留存计数；全局环形账留存 2048/4096、丢弃 2577/19436，pageErrorNames 空。没有原值、Retry 或原因结论，不把本 document 编号与旧失败串为同一连接，不恢复暂停机制实验。verify 已完成的本地门禁为 813/62 项与两端 audit 0；该普通错误页仍独立开放。

该 run 的 22 项官方终态为 19 success、3 failure（新增 Coach EOF 读者红、上述普通 verify 设置页错误和仍暂停的 preferences-read），无取消或待运行。速记分片越过较慢安装后实际成功；未为其重跑或增加时限，也没有对其它成功专项重新授予完整媒体验收。

## 产品后继准备与检查（发布时待原生复验）

生产差异仅限 `apiClient.streamChat`、`openAiStream.readChatCompletionStream` 和 `coachStore.sendMessage`。两个聊天专用读取器都在最后解码/事件分发后检查 DONE，正常 EOF 缺标记改为拒绝；客户端没有 body 也不能成功。通用 SSE 分帧器不变，完整 DONE、七字节切分的 UTF-8、CRLF 和最后一帧没有空行仍保持原完成行为，原始 reader 异常保持原异常路径。

客户端缺 DONE 会沿既有 catch 保留已显示部分正文，标记对应问题“回复未完成”并保留主动编辑入口和原 partial warning；没有自动重发。此前已经到达客户端的动作继续按原读取失败语义保留，本次没有引入候选动作缓存/撤回，也没有执行它们。上游缺 DONE 则进入现有 route catch，保留原部分文字、明确中断说明和带来源的规则回复；该层只有规则候选可进入后续动作分支，规则恢复的下游 DONE 不表示 provider 原答复完整。

为防止原动作围栏清理再次吞掉中断说明，客户端只把已存在 content 帧中精确字符串 `source:rule_fallback` 传给原回调；store 用本次 send 的局部标记保留该完整 raw 正文。未知或非字符串 source 不享有这个分支；下一次正常 provider 完成仍走原围栏清理。没有新增 wire 字段、改聊天 route、通用 SSE、会话资格/清除或业务执行路径。

新增前端 4 项、后端 11 项（含路由子案例）定向回归实际通过。真实 store→API→in-process Hono/隔离 SQLite 的 closed/unclosed fence＋EOF/reader-error 都保留 raw partial、中断句和规则正文，保存/历史投影对应规则动作；紧接下一次正常 provider 恢复原清理。合成 fetch 没有外部请求，各业务实体计数保持零；这属于实际模块/路由证据，尚不授浏览器中上游模型或所有围栏布局通过。

五份执行文件固定后，前后端 lint/build 与 817/73 项聚合测试均完成，零跳过/取消，检查首尾字节一致。原 native helper `3666d5d8`、明确一次 Send/精确 respond、来源保全、Toast 5 秒门槛和全部原判据未修改；发布时尚需等待新精确提交两宽真正看到未完成反馈、原控件恢复 C 和最终来源结果。原 fdead 红、普通初始化开放项及暂停范围不由本地检查关闭。

## 467b762 指定链限定验收（2026-10-07）

精确提交 `467b762cf7ede9f6030fde82824958a409169d07` / tree `fbeaea09cc2e8ace0b309f26e4c404af8df527d0` / run `37562006672` 已取得新原件。五份官方 ZIP、全部 675 成员逐 hash 核验，672 个选取工件可读；381 个受 Git 跟踪文件首尾 clean，摘要与精确提交一致。脚本 98 项为 96 observed-pass、2 observed-context，无失败或 blocked；通过结论另由下面实际来源、像素与媒体支持。

桌面 108、手机 211 实际显示 C 自己的“回复未完成”和可用编辑入口，C 与 partial 正文保留。实际单击该入口把 C 放回空输入，没有第二次 fill 或 Send。桌面 110/手机 213 保留 warning 仍遮输入的真实前态；两份 `mustWait:true` 记录分别等待 2560/3075ms 后 `cards:[]`，均在原 5000ms 上限内，随后 112/215 的完整 C 无遮挡可读。没有 dismiss 或删除警告；这些是本次观测时长，不用默认 3800ms 反推，也不声称恢复瞬间全无遮挡。

65 份相关 JSON（58 份 truncated 命名）逐官方 hash/bytes 核验。released 与 restored-final 的旧两个 session/十条消息、声明 financial 全字段及原 Expense/Insights 投影深相等；六个实际气泡不变。动作只有最初输入 C、一次明确 Send、一次 C 的编辑入口；原两请求 terminal 是新总三请求的严格前缀，恢复没有自动发送。新请求仍是唯一声明的正常 EOF 合成 respond，来源范围继续限于 API 返回字段、所采四表和完整聚合账；不推广到未知提交结果、未返回列或全数据库。

两主 VP9 编码时长 49.500/47.416 秒，完整解码成功，关键原帧及最后实际帧均复核；两原 trace 的 676541/746706 个事件流读到尾。原 fdead 客户端缺反馈/入口红在这条同动作、两宽链上关闭，原件保留。上游缺 DONE、规则降级和围栏说明保全仍按前述真实模块/隔离路由证据授限，不冒充真实 provider 调用或任意围栏布局的浏览器验收。

本 run 的 22 项官方终态为 21 success、仅仍暂停的 preferences-read failure，无取消/待运行。verify 实际完成 817/73 项、两端 audit 0 和 25 项普通脚本检查；本轮未重复下载通用媒体授验，新的普通绿不解释 fdead/旧 Settings、Todo、Goal 或升级保护页的原因。持续的暂停机制与生产部署门禁仍开放。本轮结果说明随下一必要增量归位，无需为纯说明重触全矩阵。
