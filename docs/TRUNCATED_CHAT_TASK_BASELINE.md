# 当前页部分回复正常 EOF、缺少 DONE：合成客户端基线

2026-10-07。起点 `72f5acf`；本包仅增加现有 Coach 链尾部的测试与证据合同，不修改产品，不声明原生执行或通过。原 72f 当前页输入恢复已限定通过，其动作和断言原样保留。本基线不是服务器业务成功、真实 provider 验证或生产许可。

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

客户端原生合成响应只证明浏览器处理这份截断 SSE。上游另按独立 in-process 合同声明合成 upstream ReadableStream、部分增量、正常 close 无 DONE，后继验证降级、部分文本、未完成生成动作及完整下游结束/保存关系。它不调用真实 key、付费模型或 SMS；本包不修改生产、不把合成 200 写成 backend 成功，也不改变身份、未知提交重放、暂停 DB 或清除资格机制。

## 发布前检查

首份固定执行稿 `3115bd58` 完成前端 lint、build、813/813 测试，零跳过/取消；两个执行脚本语法检查通过，检查期间字节不变。随后仅把同一通知等待块移到实际恢复 C 后的最终输入读点前，并在缺入口现场保存通知状态，固定后继为 `3666d5d8`；5 秒上限、实际 elapsed、原动作/来源判据不变。该后继重新通过脚本语法、10/10 定向合同和前端 lint。两轮冻结结果分别保留，不把前一聚合计数说成后继重新执行了全部测试。

本包没有应用、服务端、依赖或 CI 工作流差异，后端沿用 `72f5acf` 的 62 项官方终态而未在本地重复运行。新增原生客户端截断链仍待精确后继提交的 Coach 工件；813/10 项检查与合成模块见证均不授页面通过，不关闭任何既有普通初始化或暂停偏好问题。
