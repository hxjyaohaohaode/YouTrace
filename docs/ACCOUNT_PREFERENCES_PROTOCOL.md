# 账号偏好：版本、回执与可恢复比较

状态：隔离实现与合成回归通过，真实浏览器按最新精确SHA CI单独验收；未部署生产。

## 范围与字段

账号字段：coachStyle、coachPushEnabled、pushLimit（0–10）、quietEnabled、quietStart、quietEnd、eveningReviewEnabled、eveningReviewTime。时间为HH:mm。前端把quiet三字段组合为quietHours，pushLimit对应coachPushFrequency。外观theme、月预算、日提醒实际计数仍是设备范围，不宣称跨设备合并全局额度。

新增AccountPreferences按userId唯一，revision非负整数。AccountPreferenceReceipt按userId+mutationId唯一并绑定规范化requestHash。User里的旧四字段在同一事务镜像，供现有chat等读取，不允许旧裸PATCH绕过CAS。

迁移只新增表、复制User既有四字段，新提醒主开关与晚复盘默认关闭、免打扰开启。BEGIN IMMEDIATE/COMMIT保证复制中断整体回滚。用户随后新建账号的偏好在首次认证读取时创建相同安全默认值。历史本机明确选择作为待比较提案保存，不自动丢弃或启用提醒。

## API

GET /api/user/settings返回protocol:1、revision十进制字符串、完整settings。

PATCH /api/user/settings请求：protocol:1、mutationId、baseRevision、changes。changes必须为上述字段的非空子集。服务端认证确定账号，客户端不能指定owner。

同事务先核对旧回执：相同ID/内容返回原ACK，即使另一设备后来又改过设置也不会重写；相同ID/不同内容拒绝。没有回执时，baseRevision必须等于当前revision，再执行CAS更新、User兼容镜像、递增版本和写回执。响应只有在事务提交后包含acknowledged:true、精确mutationId和完整新snapshot。

冲突返回409 SETTINGS_VERSION_CONFLICT和当前snapshot。旧裸PATCH返回426，所有本地队列保留；数据库缺表/缺列返回503 SETTINGS_SCHEMA_UNAVAILABLE，不冒充成功。旧客户端需要刷新升级；客户端与服务端应在获准后配对部署，旧窗口中的本地规则提醒也需要关闭或刷新，不能宣称远端已经改写旧JavaScript。

## 客户端持久状态

accountPreferences:state:v1保存server snapshot、localRevision、initial、不可变active请求以及queued后续编辑。pendingSetting:accountPreferences保留未确认标记，清理保护检查该标记。

- 写本机值和排队在同一IndexedDB事务；失败不改UI成功状态
- active一旦冻结，ID、baseRevision、changes保持不变；重启/超时/丢响应重发原请求
- active期间的新编辑进入queued，只有对应前序ACK能推动其因果base；不能借较新GET绕过冲突
- GET/ACK/错误均核对持久版本、账号文档、清理世代和运行代际；迟到响应不覆盖新选择
- 只有远端未改变本次字段（或两边已经相同）时可安全重基；真正同字段冲突显式比较，两个版本归档到preferenceRecovery:*
- 比较确认绑定显示的冲突ID/localRevision，较新变化须重新比较；选择本机后仍须收到云端ACK
- Dexie订阅刷新同源其他标签页；正确性不依赖Web Locks。跨设备在启动、聚焦、在线或手动同步时拉取，不是实时推送
- stopPreferenceSync取消timer/订阅/事件并隔离未决回调；注销、退出、跨标签页锁定和本地清理接入该路径。未确认active/queued仍在原账号库

完整同步、读取失败、待确认、冲突和本机范围都有可见状态。设置页保存失败就地显示，输入/原设置保留，不发送遮挡开关的成功toast。

## 提醒最终门控

提醒仍是应用内规则能力，没有后台worker/Web Push。写入提醒的最终事务读取持久偏好，缺失/未验证/冲突不会回退到旧Zustand“开启”。免打扰、0额度、暂停、开关、晚间复盘最新时间都在投递边界重验，避免另一个标签页刚关闭后仍用陈旧内存生成。历史收件箱不会因为关闭开关被删除。

## 验证入口

- youji-app/tests/settings-recovery.test.ts：迟到GET/错误、不可变丢ACK重放、并发sender、queued继承、冲突CAS、quota、重启、清理世代、丢唤醒、stop/DB关闭等
- youji-app/tests/settings-roundtrip.test.ts：真实Hono认证+Prisma+SQLite、替身IndexedDB往返，区别于真实浏览器
- youji-app/server/tests/settings-protocol.test.ts：完整字段、所有权、并发CAS、旧协议、幂等、删除、迁移中断
- scripts/e2e-recovery.mjs：两个真实浏览器context、实际Cookie/HTTP/IndexedDB、提醒开关/时间/零预算/离线冲突比较和设备预算边界，以最新CI终态为准

不清理历史回执或降级为无版本PATCH。未来保留期、协议升级和更换数据库须另设兼容/恢复测试；不能用一次空库安装证明真实生产数据库可直接迁移。
