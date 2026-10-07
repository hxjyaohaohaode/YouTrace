# 空记录首页提醒入口：原生红基线准备

2026-10-07，应用起点 `467b762`。本包仅新增测试合同与说明，产品代码未改。准备时先运行有限合同，最终固定字节的聚合检查见末节；浏览器、服务、端口、真实 provider 或 SMS 仍未执行。下述为待运行的原生任务，不能写成已复现、已修复或产品通过。

## 用户任务与源码依据

用户在空记录 Home 看见未读铃铛，应能打开同一条提醒，读全标题、正文，选择去记录或今天够了，并在普通返回首页后看见未读消退。当日不应因这次返回再投递同一条。

源码目前显示：Home mount 在完整偏好允许时调用既有 `getEveningReviewPush → deliverControlledPush → addPush`，生成本机 `evening_review`。`shouldShowEveningReview` 要求实际北京时间与所设时间相差不超过 30 分钟。Greeting 铃铛指向 `/insights`；唯一 PushList 在 BriefCard 内，空记录 Home 分支不挂载它，CoachInsights 也没有呈现这条 push 的正文/操作。这是源码发现，真实红结果仍须精确提交的媒体与来源确认。

## 两个独立的新账号任务

末端追加 `Y3-reminder-entry-1280`（去记录）与 `Y3-reminder-entry-360`（今天够了），各自新 browser profile、新普通合成注册账号；原 Coach 三个 profile、财务 fixture、聊天动作与故障原样保留。复用原 `h.isolated/login/pointer/capture/observe/apiFor`，不增加 CI 矩阵，不改原任务 8 分钟和 job 20 分钟预算。约 50 秒/新增 profile 只是估时，不构成新的准入截止。单项 source GET/ACK body 5 秒、原有 IDB 只读 5 秒、局部 UI/反馈等待 4–6 秒；无新 profile deadline 框架。

1. 原 login/onboarding 到 Home。只读观察实际 `POST /coach/generate-brief` 的响应与 finished、正常 `GET /coach/brief` 完成，以及已缓存本机和云端原简报的同 ID。首次普通 Home 会生成简报 Insight，即使八类业务记录为空；完整冻结并保全它，不把 Insight 强制清零，不访问模块内存 key，不直接调用生成函数。
2. 普通导航到 Settings。原生开关启用教练推送、晚间复盘，原 radio 选每天最多 1 条。真实当前北京时间落入已设免打扰时段时才普通关闭免打扰。读取当时真实北京 HH:mm，复用既有偏好旅程的原生时间分段 ArrowLeft/ArrowUp/ArrowDown/Tab 方式，需变更时核输入确值后点实际保存，原值已等于该分钟时不制造额外保存；声明前同时核已取得的本机/云端完整来源中两开关为 true、上限为 1、时间精确为该分钟，而不只看 DOM。不会写 DOM value、不派发伪事件、不改 Date、计数或资格。
3. 每步核完整 PATCH 请求、mutation ID、版本、完整 ACK、本机已同步状态，以及所有未声明来源。最后普通返回 Home，让应用自行生成唯一的本机提醒。设置 ACK 只是偏好证据，不能替代 push 持久记录、计数、页面未读 1。
4. 冻结实际来源后点击原铃铛。唯一目标完整标题“今天还有什么想记录的吗？”、正文“一天快结束了，回顾一下今天发生的事，用一句话记录下来吧。”及“去记录 / 今天够了”必须自然可见；复用既有 painted/clipped/foreground 几何，额外核文字横纵尺寸完整。当前卡片无 DOM ID，身份通过唯一完整本机 push 与唯一标题/正文/操作映射，再用反馈只改变该原 ID 交叉绑定。
5. 缺完整入口时保存 observed-fail、首败截图、完整来源和连续原媒体，立即停该 profile 的后继任务。不得改走旧隐藏 URL、打开其他入口、注入 push、手写正文或继续宣称操作/返回通过。另一个独立 profile 仍可运行。
6. 若真实入口可用，1280 点击该条“去记录”，仅核空且可编辑 composer 和普通本机空稿状态，不输入/不保存业务记录；用原返回控件，再普通导航 Home。360 仅点击该条“今天够了”。核原 ID 的 read/acted 或本机删除及忽略计数，核未读消退。普通 Home 回访真实 brief HTTP 完成后再次取源，保留短观察窗口，要求无新增 push、当日发送计数仍 1；只授这次同文档普通回访，不扩为 reload/后台永久保证。

## 完整来源与精确合法差额

复用 `readExistingAccount`：先查既有库 catalog，禁止读证据时建库/升级；一次 readonly 事务读全部表、物理 keys、schema、无损 `losslessRows`。复用 `decodeCaptureEvidence` 解码比较，包含 own undefined；工件中的原无损结构保留。必须具备并真正清空 todos、expenses、quickNotes、diary、habits、habitCheckins、schedules、goalRecords 八类和 outbox。缺表、截断或读取失败不能通过。

通过原 `apiFor` 只做 GET：`sync/pull` 从 0 起的页必须明确 `hasMore=false`、正确 nextCursor 且 events 空，验证器复用既有完整 ledger page oracle。这里只接受新空账号完整空账，不用一页代替任意非空分页；遇到更多页会阻断。Push GET 必须低于 50 上限，Insight GET 低于 100，ChatSession/Message 各低于 20/200 且响应覆盖一致。新 profile 云端 push、业务全账、chat 必须为空；原简报 Insight 全字段逐值保全。所有其他本机表/字段、完整云端响应、旧 settings 键和 schema 都比较。

仅以下变化被逐条声明，并记录前后值：

- 普通偏好操作：精确一项本机字段、对应全字段 wire 变化、完整 accountPreferences 状态递进；云端 revision 只加 1、本机 localRevision 有效递增，真实同 mutation ACK 必须匹配。其余账号字段和未知字段不得改变
- 合法普通同步 lastPullAt：仅 key/value wrapper、规范 ISO、前后单调，且新时刻位于实际两次取源区间；不豁免全部 settings、sync 前缀或任意时间值
- 实际首次投递：唯一原生 push ID/创建时刻绑定普通回 Home 的时间窗口，完整固定标题、正文、两操作、origin local、read=false、acted=false；pushControlDate=当天、pushControlCount=1、todayPositiveCount=0、该精确 pushDelivery key=当天，原有值如存在必须是当天初始值
- 打开已知完整提醒：仅同一 push 的 read 可变为 true，其他字段不变；缺入口分支则要求整个源不变
- 去记录：仅该 ID read=true/acted=true，consecutiveIgnores=0；以及唯一新的原生 `capture-input:<32位ID>` value 空字符串和同 ID 的 `:context` 两条本机 settings。context 必须恰有 capturedAt/timeZone/date，时刻在实际动作窗口、Asia/Shanghai、实际当天；只读原 sessionStorage input 指针绑定该 ID。没有 actor/权限/会话实验，也不读取凭据；原 settings、稿、回执全保
- 今天够了：只删除该本机 ID，consecutiveIgnores 恰加 1；不得删除旧云端 push、增加 tombstone、清计数或建立稿
- 普通回 Home：上述结果与所有旧来源保持；仅有界 lastPullAt 可以单调前进

跨北京日期、超出 30 分钟窗口、初始普通简报未完成、完整偏好 ACK 不足、任何来源缺失、未知额外写入都保留为阻断。不会为满足测试另设资格、重置计数或解除 guard。

## 已运行与未运行

有限纯 oracle 合同包括完整来源/上限与 checkin 反例、原字段/未知 settings/有界 lastPullAt、精确投递与计数、当前北京日期窗口、read-only 打开差额、唯一空稿与原 ID 行动、精确忽略与防重投、完整偏好 ACK 与本机投递分离。它们只是验证器正反控制，不是浏览器或产品验收。

作者准备阶段只运行新文件定向合同、脚本语法和必要文件 lint/diff 检查，未执行聚合。随后发布前的固定字节检查见末节。真实红基线/修复后同动作复验、浏览器、服务、端口和真实 provider/SMS 尚未执行。此任务不覆盖后台推送、真实晚间调度、0 额度、quiet 投递、暂停 authority、clear/publication、旧库恢复或初始化原因调查。

## 停止稿后的有限取证修正

最初脚本 `5a366bda`、原 8 项合同与停止稿说明已独立保全；8 项通过未识别以下验证器缺口，不能用后来结果覆盖该事实。独立复核后，同一准备任务仅收紧取证：偏好状态和 ACK 只读适配统一读取 decoded lossless settings，拒绝普通 CDP/JSON rows 丢失 own undefined 后掩盖未知字段删除；云端偏好保留完整响应外壳，只允许声明字段与 revision 变化；每一条同 mutation 请求均通过既有 wire 验证，不能由第一条合法 ACK 掩盖畸形 retry；打开提醒后 read 仅保持或 false→true，并以实际 arrived 来源约束稍后的 before-action 来源。

另明确 push ID、composer key 必须是字符串，加入云端 Insight ID 缺失/重复与物理 key 重复的完整性检查。对应定向正反控制现为 12 项，均通过；没有添加用户动作、窗口/预算、产品修改或 CI 矩阵，也没有执行原生旅程。后继固定字节与检查结果另行交接。

## 最终固定字节检查

四类取证缺口后继之外，声明前再用已经取得的完整本机/云端来源逐项核对两开关、上限1和实际 clock.time；DOM 恰好显示该分钟不能代替其持久值。这里没有添加动作、读取或等待。最终执行稿 `340f128b`、12 项合同、原三 profile 两行接线和两新增媒体硬门均固定后，12/12 定向、829/829 前端聚合、lint/build、三个执行脚本语法及 diff 检查实际通过，零跳过/取消，检查首尾字节一致。

初稿 5a 的 8 项通过仍保留，不转授为原生结果；16c 的 12 项与最后既得源断言也分别保留。后端、应用、依赖和 CI 工作流没有差异，后端沿用 `467b762` 的 73 项官方终态而未在本地重复运行。下一步仅由精确新提交的原生工件决定是否真正产生提醒、读到正文、完成所选动作和保全来源；这些本地/纯合同检查不授提醒投递或产品通过，普通启动与暂停机制问题仍开放。
