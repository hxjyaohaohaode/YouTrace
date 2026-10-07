# 空记录首页提醒入口：原生结果与限定验收

2026-10-07，应用起点 `467b762`。最初 `5022cb4` 仅新增测试合同与说明，产品代码未改；`eb1fadc` 的真实入口红、最小显示改动与 `829a2ae` 限定验收见后文。准备时先运行有限合同，固定字节的聚合检查见下文。以下保留原任务合同；首轮 `5022cb4` 原生只到昵称输入，实际停点与下一准备修正见末节，不构成提醒产品结果。未运行本地浏览器/服务/端口或真实 provider/SMS。

## 用户任务与源码依据

用户在空记录 Home 看见未读铃铛，应能打开同一条提醒，读全标题、正文，选择去记录或今天够了，并在普通返回首页后看见未读消退。当日不应因这次返回再投递同一条。

`467b762/eb1fadc` 基线源码显示：Home mount 在完整偏好允许时调用既有 `getEveningReviewPush → deliverControlledPush → addPush`，生成本机 `evening_review`。`shouldShowEveningReview` 要求实际北京时间与所设时间相差不超过 30 分钟。Greeting 铃铛指向 `/insights`；唯一 PushList 在 BriefCard 内，空记录 Home 分支不挂载它，CoachInsights 也没有呈现这条 push 的正文/操作。这里保留最初源码判断，`eb1fadc` 实际原件结论见后文。

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

作者准备阶段只运行新文件定向合同、脚本语法和必要文件 lint/diff 检查，未执行聚合。随后发布前的固定字节检查见末节。准备阶段尚未执行原生；后来的 `5022cb4` 仅到昵称准备，详情见末节。本地浏览器、服务、端口和真实 provider/SMS 未执行。此任务不覆盖后台推送、真实晚间调度、0 额度、quiet 投递、暂停 authority、clear/publication、旧库恢复或初始化原因调查。

## 停止稿后的有限取证修正

最初脚本 `5a366bda`、原 8 项合同与停止稿说明已独立保全；8 项通过未识别以下验证器缺口，不能用后来结果覆盖该事实。独立复核后，同一准备任务仅收紧取证：偏好状态和 ACK 只读适配统一读取 decoded lossless settings，拒绝普通 CDP/JSON rows 丢失 own undefined 后掩盖未知字段删除；云端偏好保留完整响应外壳，只允许声明字段与 revision 变化；每一条同 mutation 请求均通过既有 wire 验证，不能由第一条合法 ACK 掩盖畸形 retry；打开提醒后 read 仅保持或 false→true，并以实际 arrived 来源约束稍后的 before-action 来源。

另明确 push ID、composer key 必须是字符串，加入云端 Insight ID 缺失/重复与物理 key 重复的完整性检查。对应定向正反控制现为 12 项，均通过；没有添加用户动作、窗口/预算、产品修改或 CI 矩阵，也没有执行原生旅程。后继固定字节与检查结果另行交接。

## 最终固定字节检查

四类取证缺口后继之外，声明前再用已经取得的完整本机/云端来源逐项核对两开关、上限1和实际 clock.time；DOM 恰好显示该分钟不能代替其持久值。这里没有添加动作、读取或等待。最终执行稿 `340f128b`、12 项合同、原三 profile 两行接线和两新增媒体硬门均固定后，12/12 定向、829/829 前端聚合、lint/build、三个执行脚本语法及 diff 检查实际通过，零跳过/取消，检查首尾字节一致。

初稿 5a 的 8 项通过仍保留，不转授为原生结果；16c 的 12 项与最后既得源断言也分别保留。后端、应用、依赖和 CI 工作流没有差异，后端沿用 `467b762` 的 73 项官方终态而未在本地重复运行。下一步仅由精确新提交的原生工件决定是否真正产生提醒、读到正文、完成所选动作和保全来源；这些本地/纯合同检查不授提醒投递或产品通过，普通启动与暂停机制问题仍开放。


## 5022 首轮原生：昵称准备被现有上限截断

提交 `5022cb481c91ab046729e1aef9d33a28c64da0c8`、tree `ffcb4498bd1ca9ff82e0935effe76b360a0d1f2c`、run `37566986250` 的两新增 profile 均在 `/login` 设置昵称时停止。声明昵称 `Synthetic Reminder 1280/360` 分别为 23/22 个 ASCII 字符，现有输入 `maxLength=20` 后实际值为 `Synthetic Reminder 1/3`；原严格 fill 比较报错，尚未点击“开始使用”。原 219/223 PNG、对应完整页面快照和两录像末帧一致。这是合成准备值超长，不是提醒正文入口的产品红，也不是初始化/投递失败。

官方五 ZIP、完整归档和全部 699 成员的 hash/字节数均已核；384 个 Git 跟踪文件与干净首尾摘要一致。报告 100 项为 96 observed-pass、2 observed-context、2 setup blocked，原三个 profile 的本轮脚本结果不转授新的完整媒体验收。新两 profile 的 12 份相关 JSON 显示 stage=login，设置请求/响应、Home brief 与 generate-brief 四类数组均空，尚未产生本任务的新来源快照；因此不能授空业务表、偏好 ACK、提醒记录/计数、铃铛、正文、去记录/忽略或返回保全。业务过滤流量为空也不等于所有认证服务端活动为零。

两新增 VP9 录像实际编码时长为 4.916/5.000 秒，完整解码退出 0；两原 trace 71,036/68,480 事件读到尾，停在同一昵称状态。官方 22 项全部终态为 20 success、Coach 与已暂停 preferences-read 两项 failure，无取消。verify 原日志为前端 829/829、后端 73/73、两端 audit 0 漏洞及 25 项普通 Chromium 检查 PASS；本轮没有重新下载/独审通用媒体，不据这些脚本结果关闭旧启动原因或暂停项。

后继只将该行合成昵称缩为 `Synthetic Rem 1280/360`（18/17 字符），保持原严格 fill、产品 20 字上限、所有动作/等待/来源断言/任务预算不变。真实提醒步骤仍待下一精确提交的原件，不以短名源码正确授原生通过。

该两文件后继已执行 12/12 既有定向合同、脚本语法、该脚本 ESLint、diff 检查与原文逐字差额/18和17长度核验，均通过。应用、后端、依赖及其聚合门禁沿本次 `5022cb4` 官方结果，未为两个准备昵称重复无关聚合；下一原生仍待运行。


## eb1f 原生：已投递的未读提醒无法从铃铛读到

提交 `eb1fadc99fc5e0b077e82581c7c582a73ae8efd3`、tree `471f93dd34ace40de280e296699f43c64134e008`、run `37568769699` 中，两宽短昵称已正常通过。两新 profile 实际完成普通设置；每端 wire 留有四次 PATCH 与四份响应、两次 Home brief 和一次原生 generate-brief。实际北京时间均为 2026-10-07 11:58，普通 Home mount 后各生成一条本机 evening_review，云端 push 仍空。这里只证明按所设窗口在打开应用时生成，不能称真实晚间或后台通知。

原 235/257 图显示空记录首页与未读 1。点击原铃铛后的 237/259 图确为 `/insights`，只有当前记录空态和历史观察，找不到该提醒的完整标题、正文与“去记录 / 今天够了”；两份 bell-arrival 均记录 titleCount=0、differences=[]。这是本轮实际产品入口缺口，原提醒记录仍保留；所选动作与普通返回未执行，不用初始设置 ACK 或脚本旧前缀替代尾项。`5022cb4` 的超长昵称准备失败仍单独保留。

六个官方 ZIP 与完整归档全部 840 成员均逐 hash/字节数核验，384 个 Git 跟踪文件内容与干净首尾一致。报告 102 项为 98 observed-pass、2 observed-context、2 本次入口 observed-fail。新两 profile 的 118 份相关 JSON 中，106 份为来源/动作旁证，另 12 份为前置登录引导；独立核过 16 份完整来源、每端四次同归属 PATCH/完整 ACK 和 revision 0→4。实际投递仅增四个控制 key 和一条本机 push；铃铛点击至原失败来源之间，完整本机/云端值保持，目标 read/acted 仍为 false。已有原简报与无损 own-undefined 均保留，不把本机投递写成云端推送。

两新增 VP9 完整解码退出 0、无解码 stderr，编码时长 15.666/14.500 秒；两原 trace 246,203/246,887 事件读到尾，实际末帧仍在无提醒正文的原洞察页。这些时长为录像编码界限，不是用户任务总墙钟耗时；原三个 profile 没有重复授完整媒体。

官方 22 项终态为 19 success、Coach/普通 verify/已暂停 preferences-read 三项 failure，无取消或运行中任务。所有前置安装及录制预检成功；Coach 红来自上述实际用户停点。verify 的前端 829/829、后端 73/73、两端 audit 0 漏洞已完成，普通浏览器在 14 项 PASS 后于第二 profile 首次 Settings 进入加载错误页；实际 peer 读值尚未到。被动当前 page3/doc3 留存 44 条 chronology、218 条 storage；auth/settings/pull 均 200 且 finished，settings 成功、sync 未留成功终态，12032ms 初始化超时后恢复开始。留存中有 38/29 笔事务开始/完成及 78/69 次请求开始/成功；全局保留 2048/4096、丢弃 2584/19620，仅按这些保留事件分类，不据缺失事件推断原因，不操作 Retry 或暂停机制。

## 最小显示改动：复用既有提醒列表

只改 `BriefCard.tsx` 与 `CoachInsights.tsx`：导出原 PushList，在原铃铛到达的 `/insights` 当前记录观察前呈现“待处理提醒”；仍仅列 `!read && !acted` 的原记录。标题和正文改为完整换行显示，Home 原调用也复用同一卡片。既有去记录/忽略、读与反馈处理器、持久写入、去重/额度、路由、资格检查及历史观察原样保留；没有在进入页面时自动标记已读，没有另建通知中心或订阅。

固定执行字节 `f7d5e92f/291302a5` 已完成 46/46 既有提醒/反馈/简报定向合同与前端 829/829 聚合、lint/build 检查，零跳过/取消，执行字节首尾一致；后端未改，沿 `eb1fadc` 官方 73 项终态而未本地重跑。原 `5e900c29` 原生动作和严格来源判据未改。上述源码检查当时不授新原生尾项；后续 `829a2ae` 实际结果见下节。


## 829a：两个指定提醒任务限定验收通过

提交 `829a2ae9bcb7bf956bec01458fe1627e0e0d88c1`、tree `ef2f004889a7b93a7d479f899e969ed18c44a455`、run `37571932462` 保持原 `5e900c29` 旅程与判据。两新增 profile 在普通设置、真实本机投递后，经原 Home 未读铃铛进入洞察页，实际读到同一条提醒的完整标题、正文与两个可操作按钮。238/269 原图与相应几何/文字绑定一致，360px 正文换行后完整位于底栏之上。原 `5022cb4` 准备阻断和 `eb1fadc` 入口红保留，本轮原件单独支持关闭指定入口缺口。

- 1280：真实点击该条“去记录”，242 原图显示空且可编辑的速记输入框；已持久的唯一新空 input/context 和实际 sessionStorage 导航指针绑定一致。只该原 push 的 read/acted 与 ignore=0 作合法变化，未保存业务记录。原 Back 和正常 Home 返回后，245 原图铃铛不再显示未读。
- 360：真实点击“今天够了”，只删除同一原本机 push，ignore 变为 1，没有建立 composer。274 原图返回 Home 未读清除。
- 两端返回来源均与各自操作后完整相等，当日计数仍 1、未重复投递；末来源分别在第三次真实 Home brief 完成后 1011/750ms 采集。这只授本次同文档普通返回的有限观察，不外推 reload、后台或长期调度。设置声明的实际北京时间分别为 12:37/12:38，仍只证明所配窗口，不能称真实晚间投递。

六个官方 ZIP、完整归档全部 900 成员逐 hash/字节数核验；384 个 Git 跟踪文件与精确提交、干净首尾一致。102 项结果为 100 observed-pass、2 observed-context，无本轮任务红或 blocked。独立消费 150 份任务 JSON 及总报告，含 12 份前置登录引导的主审 JSON 口径为 162；22 份完整来源覆盖 308 次表读取，原无损字段、空业务账、已生成简报和全部未声明本机/云端字段保全。原三 profile 仅保留其本轮脚本结果，不重复授完整媒体。

两新 VP9 录像编码 19.416/16.416 秒，完整解码通过；两原 trace 289,610/275,989 事件读到尾，关键完整正文/空 composer/返回图和录像末帧均已独立阅读。这些视频时长不等于用户任务总耗时，不授多个提醒、所有 push 类型、推送权限/订阅、后台或真实晚间调度、真实 provider/SMS，以及任意旧库/身份机制。

本轮 22 项 CI 全终态为 20 success、普通 verify 与已暂停 preferences-read 两项 failure，无取消。前后端 829/73 项、两端 audit 0 漏洞实际完成；普通浏览器在 21 项 PASS、B 不可见之后，A 恢复断言前的 `/todo` 出现“加载遇到问题”，failure0 为 blank。它与 `eb1fadc` 的第二 profile `/settings` 停点分开保留：本次 page1/doc85 留存 44 条 chronology、218 条 storage，38/29 笔事务开始/完成、78/69 次请求开始/成功，initial 在 12036ms 超时；全局保留 2048/4096、丢弃 9553/46752。仅做原件被动分类，未点 Retry、未实验迁移/资格/锁原因，也不据本次提醒通过授整体上线。
