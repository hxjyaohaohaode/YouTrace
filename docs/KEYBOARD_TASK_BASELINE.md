# 键盘编辑待办：连续用户任务红基线

应用基线 `918adacd78826c7c5b533be2b251b0b8029c7fe2`。首次基线只含原生取证模块、四项有针对性的纯合同、本文及必要的单分片接线；47fb 原生结果与后继窄候选见下。现有 Todo 任务的来源保全/确认与错误文案证据继续按各自精确 SHA 记账，不能继承为整条键盘体验通过。旧 B→Todo 初始化原因仍未关闭。

## 集成与限定范围

入口 `runKeyboardOutcomes(ctx, options = {}) -> { media }`，`scenarioSet` 为 `records` 或省略。ctx 沿用 Todo/Diary：`isolated`, `login`, `waitPath`, `capture`, `observe`, `apiFor`, `sleep`, `actions`, `artifacts`, `writeFile`, `join`, `surfaceNames`, 可选 `clock`。集成至唯一 `keyboard-records` 分片；首次基线未改应用或服务端。

媒体名 `YK-records-1280` / `YK-records-360`，各自全新隔离 profile；1280×900 使用 `13900008911` / `Synthetic YK 1280`，360×800 使用 `13900008912` / `Synthetic YK 360`。两宽有真实差别：Modal 采用居中面板与底部滑入/内部滚动，均保留原动画；360 只是桌面浏览器窄视口，不能代表手机触摸、虚拟键盘或操作系统辅助功能。

只在授权 GitHub hosted CI 运行，入口要求 `GITHUB_ACTIONS=true`。沿用现有八分钟操作取证及二十分钟 job，不延长预算、不起本地浏览器/监听器/隧道、不换端口或二进制。本包没有生产、付费模型或其他 provider 调用。

## 准备与键盘起点

显式 setup 阶段通过真实登录、普通导航、指针和键盘建立两条待办。两条同名短标题「合成：归还图书」，分别为 2026-10-07/低、2026-10-08/中，均未完成。创建使用现有 Todo 草稿 ID 与 `createdOnlyDeclared` 判据，同步后的同 ID、字段、精确版本/账本/空队列都必须成立。

浏览器沿用推进的合成 2026-10-07 Date；计时器、performance、服务端原始时间均不改。设置结束后记录实际 activeElement、视口和原图，然后标记键盘阶段。不会用 focus 或指针人为制造一个理想起点。

键盘阶段使用 Chromium 的 Tab、Shift+Tab、Enter、Space、Escape、日期分段和 select 选择键。中文通过 `sendCharacter` 的 `Input.insertText` 原生文本插入，再核真实字段与完整草稿；不称中文逐字 keydown、物理键盘或输入法实测。setup 的指针 helper 有阶段断言，之后误调用立即失败；继承的登录 helper 可在 setup 内 scrollIntoView。以下禁令仅约束明确业务键盘阶段：无 DOM click、element.focus、scrollIntoView、字段赋值、派发事件、手动滚轮、隐藏路由或指针补救。观察用的只读 WeakMap 节点身份不改 DOM/应用状态。

## 连续任务与判据

实用合同参考 [W3C APG 的 Modal Dialog 模式](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)（2026-10-06 复核）：Tab/Shift+Tab 留在对话框内并首尾循环；关闭通常回到发起者，原节点不存在或明确后续工作流才采用合理替代。因此本包区分原按钮仍存在的 Escape 取消与保存后分组移动的重挂载；这项任务判据不是全站 WCAG 认证。

1. 从 setup 留下的真实焦点 Tab 找到今天/低优先级同名记录；先按实际标题/日期/优先级识别，ID 仅旁证。读取实际行与聚焦按钮的可见几何后，用 Enter 打开编辑器。
2. 从内容字段完整走一次正向与反向语义环：关闭、内容、优先级、截止日期、今天、明天、无日期、已完成、删除、取消保稿、保存。只到达控件，不激活删除/完成。实际 Tab 数不固定；日期内部各段保留每次观测，但连续同 DOM 日期焦点可折叠。每次观测同时绑定语义 key 和真实 WeakMap node；只同一日期 node 连续重复可折叠，闭环必须回原启动 node，正反环同语义节点须一致。每个实际访问 node 都有焦点指示核验。其他重复、缺项、乱序、提前子环或焦点逃逸均保留为 RED。
3. 用原生键盘将内容改为「合成：归还两本书」、优先级高、日期 2026-10-09。冻结全部输入和原始 base/revision，验证只写当前精确编辑稿，未提交源记录/邻居/版本/队列/旧账均不变。短标题必须实际可读，不能以 DOM value 代替被裁切文本。
4. Escape 关闭并保留完整稿件。保存确切的发起按钮节点与语义身份；连续运行至少 900 ms 的关闭前后观察窗口（各次采样保留实际时间，末次可能略早于窗口终点），覆盖386基线 Todo.closeEditor 的 250 ms 延迟行焦点及真实关闭动画。若关闭较慢，观察延续到关闭后至少 350 ms，最多 4 秒；最后 250 ms 至少四个样本都须落在原可用按钮。不是只挑第一张正确帧或固定等待后的一张好图。
5. 「回原按钮」与「回同一记录的非交互 row」分开记账。后者仍是返回 RED，但允许通过后续真实 Tab 有界找回已知按钮，继续独立保稿/重试尾项。完整返回观察窗口结束后，保存按键前节点，实际下一 Tab 必须转到不同、启用、可顺序聚焦且可见的控件，再观察 350 ms 稳定；它仅证明稳定返回后的导航，Esc→Tab 小于 250 ms 的快速操作仍未验证。重开使用 Space，核同一完整输入及原始来源，不重新输入。
6. 键盘到达真实保存。复用 `installTodoQuota`，只在这个新建合成账号的同 ID Todo put 调用前拒绝；第一次 Enter 必须一次命中、一次 abort、零 commit、原 put 未调用，意图值精确匹配完整原来源加声明三字段。三表、全稿/base/revision、所有旧 GET 账本和邻居保持。
7. 原位捕获错误、焦点、裁切、computed styles、role/aria 元数据和像素。错误要实际可读并解释存储不足、此次未保存、输入保留和重试下一步；不能手动滚动到错误后倒称自然可感知。role=alert/AX 类元数据仅是语义证据，不证明真实屏幕阅读器宣布。
8. finally 显式解除精确故障，验证方法恢复。30 秒安全到期不能当主动解除，零/多命中或意外提交停止依赖链。保留输入，Tab 找到真实当前保存后只 Enter 一次。要求同 ID 精确三字段、原其他字段和邻居保留、只消费当前稿、恰一个新业务 event、精确 ACK、空队列，无副本。
9. Save 后同样记录连续焦点。因修改日期可能使行重新分组/按钮重新挂载，接受同 ID 已更新的可用编辑按钮，不要求已卸载旧节点；非交互行/body 不算可用返回。保留这一返回结果，再用真实键盘找到可读的已更新记录，完成全部来源末次核验。恢复性后续可达不会抹掉原返回 RED。

从键盘边界才安装只读 keydown/keyup 观察，只记录 Tab/Enter/Space/Escape 的真实目标节点、isTrusted、修饰键和原 performance 时间，不收文字键或登录输入。发送意图、调用返回、页面事件实达分别记账：keydown 必须到按前确切焦点，keyup 如实保留默认动作后真实目标；缺事件、非可信、错节点、丢弃或观察错误均不通过。退出时移除监听，不阻止默认动作或派发事件。

所有控制寻找都是有界 Tab 与当前只读观察；每次激活重新核 actual activeElement、已知按钮身份、启用状态及可见几何。不会盲按未知焦点。若无法安全到达，保存首败和可获得的源事实并停止依赖操作。

## 焦点证据不是 pseudo-state

原始观察逐项保留：真实节点身份、activeElement、角色/名称/关联标签、focus-visible、outline/border/shadow/background/color、可见框、视口、实际滚动、祖先 overflow/transform/opacity/clip-path、中心命中与原始截图。复用现有 `initialSessionGeometry` 的绘制/裁切/遮挡判据；不会操作滚动使它通过。

每个关键编辑器控件都取得同节点未聚焦和已聚焦的 computed styles。必须发现实际变化且非透明的 outline、border 或 shadow，并核可见指示范围在裁切内；`:focus-visible` 为 true 但没有可见变化不通过，未变化的装饰阴影不通过。原图需独立审阅；这些保守的 CSS/几何候选不是色差、人类视觉感知、焦点面积、对比度或全 WCAG 认证。

原生日期控件可有内部 segment 重复；正反序列保留原每键 trace，只在合同判断中折叠同一 DOM 日期节点的连续观察。不会对所有控件固定 exact Tab 数，也不关闭动画、变更 reduced-motion 或替换 Modal 行为。

## 来源复用、测试和开放项

复用 `readTodoSource`、`installTodoQuota`、Todo 创建/编辑/保全/ACK/完整账本判据及现有 Date/geometry/pointer setup 原语；不复制五行分组、完成/撤销/Timeline 业务任务。关键前后都存 `todos/settings/outbox` 三表完整 readonly 样本、GET `/todos` 全行和 cursor 0 起完整 GET `/sync/pull` 全实体账本。只读三表样本不是全库备份，服务端原始时间不改写成本机合成时间。

新增四项纯合同检查真实误绿风险：日期 segment 与语义环的区别；pseudo-state/透明/装饰/错节点/裁切不能假装可见焦点；早期正确帧不能遮住延迟 row 抢焦点，且 Save 的同记录可用重挂载按钮与邻居必须区分；稳定后 Tab 真正转移及控制键可信实达与单纯发送意图分开。既有 Todo 合同继续负责 codec、全字段/账本/版本、草稿精确身份与 quota，不再克隆一套。

初稿的实际节点、下一 Tab 转移和控制键实达三个取证缺口已补严格判据。当前四项键盘与六项既有 Todo 专项共十项通过；前端 lint/build、733 项测试、后端 lint/build 与 57 项测试通过，均无跳过或取消。前后端 npm audit 实际均为 0 漏洞。以上为首次发布前检查，不构成原生任务 PASS 或 WCAG 结论；47fb 新原件结果如下。

未覆盖及继续暂停：偏好权限/clear-generation/发布安全审查和依赖提交后读取修复；owner/cookie/generation 注入、连接/生命周期、启动或调度实验；删除、账号切换、reload/清除、stale peer、postcommit 故障；所有页面/键盘快捷键/长文/缩放/AT/真实手机/离线/两设备/生产。旧 B→Todo 初始化问题仍开放。

## 47fb 首轮原生：两个焦点缺口与两处未到达

提交 `47fbdd28c4cdb5f2e0d2a623750fc181e9ab7222`、tree `b866ea47f595c815893b42ae742ba4df846e0f2c` 的 [CI 37452736147](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37452736147) 全21个job已终态：18成功、3失败（keyboard-records、暂停修复的preferences-read、普通verify）。verify已实际通过双端依赖审计，之后在跨tab退出后的C登录等待页面标题超时；不是本轮B首次进入Todo的断点。summary `11407216122`、分片 `11407475879` 的官方 ZIP、完整归档及 155 个成员已独立核验。两段录像完整解码，并结合关键原图、真实键事件和来源对照分类，不能将红统一解释为产品错误或脚本已走完。

桌面真实 Enter 打开原记录，正反 Tab 均按同节点完整循环。012/034 的优先级与 017/029 的“已完成”框虽然实际聚焦，原图没有可辨焦点指示；同节点未聚焦/已聚焦 CSS 都是 outline none、shadow none、边框未变。这两个读者缺口成立，其他控件的计算候选不等于全站无障碍通过。

随后 Home/选择键已将 priority 置 high，新增的 Enter 打开浏览器原生 select 列表。应用 document 的只读账只有可信 keydown 到原 select、无 keyup，且丢弃/观察错误均为零；040 原图仍显示展开的原生列表。原 Chrome trace 同时在 ListPicker 新 frame 记录 keyup 调度，不能称浏览器未发 keyup，也不能把该无具体 key/target 的 trace 项代入应用 receipt 授绿。Escape 关闭保稿、重新打开、Quota 和保存尾项均未到达。两条已提交 Todo 与旧账未变，当前草稿只有标题/高优先级变动，日期仍 10-07。

手机停在准备阶段的全部功能页，Todo 入口 y746–828，视口高800且底栏占736–800；入口未滚入可点击区域。原049图与中心命中旁证不支持“弹窗一直移动”的产品归因。该 profile 尚无 Todo/账本，也未安装键盘观察器；不能授手机键盘、保存或返回结果。

当前后继最小候选只给优先级与已完成框添加和既有 Button 一致的键盘焦点 outline，不改表单事件、Modal、草稿、保存或250ms返回行为。取证侧在显式 setup 内沿既有 Todo 的有界真实滚轮准备入口，再保留原完整绘制/裁切/命中/稳定和唯一单击；键盘边界之后继续禁止滚轮/滚动补救。关闭状态的 select 用 Home/ArrowDown 选择后真实 Tab 离开，仍要求可信 down/up 与完整字段/草稿值，不再额外 Enter 打开原生列表；所有按钮的 Enter/Space 和 Escape 判据不放宽。

候选仍须新精确 SHA 的两宽完整原件。原生焦点返回风险目前只来自源码线索，不能将未到达的 Escape 或错误恢复尾项写成已复现或已修。

此两控件样式与取证窄候选的前端 lint/build、733 项测试通过，无跳过或取消。依赖锁文件未变；本轮47fb官方前后端audit均为0，未把旧审计阻碍说成产品修复。新像素与完整键盘任务仍待后继原件。

普通小包 `11407976113` 另经独立被动分类：failure-1在根路径实际为“目标库存在未确认资料，未自动覆盖”的本地资料升级保护页，failure-2才是另一页Synthetic C首页。page1/doc89的auth-me为200且finished，留存元数据未捕获该document的useAppInit阶段事件；两笔readonly事务、29次请求均success/complete，随后只观察到close-requested。chronology/storage分别丢弃10154/48628；没有原业务库值或实际Retry结果，不能据此归因，也不把close请求当物理连接终态。此新普通红保留，未沿暂停的权限/代次/发布机制继续复现或修复。

## 386 两宽：焦点表示已修，连续编辑仍有三类中断

提交 `386cde59c2a2254d08e70df712751b55c8af2a8b`、tree `15bbb9506b5469f3ac799a7191ae638cfb9a67c8` 的 [CI 37454254774](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37454254774) 全21个job终态为18成功、3失败（keyboard-records、暂停修复的preferences-read、普通verify）。summary `11408981596`、分片 `11408671922` / `11408761804` 的官方 ZIP、完整归档和382成员独立核验；351个受Git跟踪文件内容首尾一致并绑定提交。两录像完整解码，桌面59.25秒、手机54.333秒，并核关键原图与真实事件/来源。

本轮两宽优先级与已完成框已能看到清晰紫色焦点轮廓，关闭47fb两个表示缺口。手机实际滚到菜单入口后进入任务，原生select选择后以真实Tab离开；两宽均已走到保存及重新找到记录的机械尾链，没有把后来的可达洗成全程焦点顺畅。

三类连续性红各在两宽实际出现：

- Escape在18/22ms先回原BUTTON node2，约295/297ms后被同ID非交互DIV row16接管，直到末次876/890ms采样仍在行上
- Quota拒绝时弹窗仍打开、原11控件节点仍在，完整中文解释和三字段可读，但焦点是BODY；后续26/32次真实Tab穿过背景导航和列表才回Save，焦点已离开对话框
- Save后先落BODY，约330/326ms后停同ID非交互行，不能把“同记录”当“回到可继续操作的编辑按钮”

每宽13份三表/全账来源独立逐值核对：原输入、精确draft revision/base、Escape关闭/重新打开/Quota原稿保全成立；故障一次命中、一次abort、零commit且主动解除。实际重试只改同ID声明三字段、消费该稿并新增一个upsert，版本1→3及4→6，邻居与全部旧账保留。没有原HTTP ACK body或全库备份，不授快速Esc→Tab、真实读屏、任意手机OS或所有弹窗。

后继普通UI候选取消Todo关闭后的无条件250ms行焦点回调。Modal关闭时尊重已经移到面板外的有效焦点；否则优先原触发者，仅在其卸载/不可用时使用调用方提供的替代控件。Todo只提供同ID当前编辑按钮作为替代，不延迟抢回用户随后已选中的控件。保存/保稿失败的实际错误节点可聚焦并滚入当前编辑区，使后续Tab从对话框内继续；业务写入、草稿base/版本与调用参数未改。

新增两项合成DOM合同覆盖原触发者、用户后续焦点、重挂载同记录按钮及无效替代，不作为原生结果。13项相关专项、前端lint/类型/构建及735项全套测试、后端lint/构建及57项测试通过；新精确SHA的相同动作、焦点轨迹与全源尾项仍须原生独审。250ms快速按键和读屏声明继续未覆盖。

386普通小包 `11409040927` 另经独立被动分类：23项已完成报告后，在跨tab退出后的C登录等待标题超时；首错误页仍为根路径本地资料升级保护提示，另一页为Synthetic C首页。该次doc89留存auth-me200 finished、两笔readonly及29请求success/complete、close-requested，未捕获本document初始化阶段事件；chronology/storage丢弃10155/48538，不能沿用47fb计数。没有原业务库值、Retry或根因结论，普通启动开放项与暂停机制继续保留。

## eea 指定键盘连续任务独立验收

提交 `eea0f7e4c5b75a867e3eca769e68744865240655`、tree `a94f79eebe927781ecbbf77d249367c0ab37d365` 的 [CI 37456366870](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37456366870) 全21个job为19成功、2失败；键盘分片实际完成，普通verify和暂停修复的preferences-read仍失败。summary `11409789042`、原分片 `11409269700` / `11409494529` 的官方ZIP、完整归档和382成员全部独立核验，353个受Git跟踪文件内容首尾一致并绑定提交。

两宽实际11个控件的正向聚焦原图逐项独审，原优先级/勾选框紫色焦点轮廓保留。Escape在13/15ms回到原编辑BUTTON node2并持续稳定，没有原来的迟到行焦点；保存改期后先短暂BODY，再于64/66ms回到同ID新编辑按钮，原图紫框位于可操作入口。失败时完整中文说明和三字段仍可读，实际错误区域获焦；其后每宽13次Tab都留在modal内，未再穿过背景导航。

独立重新核26份完整三表/全账样本、156次控制键发送与312个可信原事件：改稿、Escape关闭、重开与精确提交前拒绝的draft revision/base、原行和旧账保全；一次abort、零commit、主动解除后，原保存控件唯一重试只修改同ID三字段、消费本稿、保留邻居。两原trace各3次sync POST200且finished，包含两笔创建和一次修改；本地版本/队列和完整服务端账相互印证。两原录像完整解码为51.833/44.5秒，并核关键任务帧与终态。

47fb和386原红及未到达边界保留。此精确SHA关闭指定任务里的焦点表示、迟到返回和错误后焦点外逃；不扩大为快速Esc→Tab、真实IME、读屏、移动OS、所有弹窗或全站无障碍验收，也没有原HTTP ACK body或全库恢复证明。新普通第二设备设置加载错误另见[启动恢复记录](STARTUP_RECOVERY_TASK_BASELINE.md#eea第二设备首次设置进入仍为开放项)，不能用本键盘绿抵消它或暂停的偏好读取问题。
