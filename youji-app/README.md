# 有迹 YouTrace

React 19/Vite/Zustand/Dexie 前端；Hono/Prisma/SQLite API。面向成人的个人生活记录、日程、待办、习惯、速记、日记和教练。

当前为恢复候选，生产发布仍有外部门禁。请先看 [验证报告](../docs/RECOVERY_TEST_REPORT.md)、[Sync v2协议](../docs/SYNC_PROTOCOL.md) 和 [长期恢复上下文](../docs/AI_RECOVERY_CONTEXT.md)。

## 从干净仓库运行（合成开发环境）

需要 Node 24。不要对未知真实旧库执行下列迁移。

```bash
cd youji-app
npm ci
npm --prefix server ci
cp .env.example .env
cp server/.env.example server/.env
npm --prefix server run db:generate
npm --prefix server run db:migrate
npm --prefix server run dev  # 终端1，后端3000
npm run dev                  # 终端2，前端5180
```

server环境样例仅供本地：会返回开发验证码，不发送真实短信，模型密钥为空时使用规则回复。样例JWT值绝不能用于部署；生产必须提供独立安全配置且关闭DEV_OTP_EXPOSE。前端默认同源 `/api` 代理，也可用VITE_API_BASE_URL显式配置。

## 数据和账号边界

- 验证服务端身份后才打开 `youtrace:user:<id>`，访客库独立。账号变更中止请求并重新加载文档，防止旧store/回调进入另一账号
- 无法确认身份时锁定私人记录，而不是凭旧登录布尔值打开任意账号库。已经打开的账号可以离线编辑；重新打开时仍需确认身份
- 旧共享 `youtrace` 数据库不升级、不自动归属，原样保留并可导出，当前没有自动认领旧资料的功能
- 本地业务写入与outbox原子提交。未收到完整确认不删除修改；冻结批次持久化，丢响应重试相同mutationId
- Sync v2使用事务变更序列、精确字符串游标、版本冲突及墓碑。删除传播；旧设备不能静默复活同ID。所有REST写入进入同一SQLite触发器变更链
- 冲突保留两个版本，在设置页比较后选择；采用云端时本地原稿移入恢复副本，随备份导出
- 速记按规则解析，经编辑确认后一次性应用，重试不重复写入。日记追加到当日原文
- 新目标支持版本化账号同步；旧目标需逐项预览并确认上传，进度由用户手动确认，不由相似文本自动加分。提醒偏好使用CAS/回执；草稿、外观、预算仍为设备数据，请定期导出
- 导出覆盖所有本地表、未确认修改与恢复副本；清理当前账号包含目标并阻止丢弃未同步修改

没有服务端后台通知worker、Web Push、文件/OCR或第二语音提供方。语音依赖浏览器支持，始终保留文本入口。不得把页面内提醒描述为离开应用仍会主动送达。

## 验证

```bash
npm run lint
npm run build
npm test
npm --prefix server run check
npm audit --omit=dev --audit-level=high
npm --prefix server audit --omit=dev --audit-level=high
AUDIT_BROWSER_PATH=/usr/bin/google-chrome npm run test:browser
```

前端Node测试使用fake-indexeddb；API联调使用真实Hono/Prisma/SQLite。最后一条才是真实Chromium/HTTP/IndexedDB验收。根级GitHub Actions执行检查并保存合成截图；嵌套workflow不作为有效CI依据。

## 配置与部署门禁

后端主要变量：DATABASE_URL、JWT_SECRET、ALLOWED_ORIGINS、SESSION_COOKIE_NAME、TRUST_PROXY、DEV_OTP_EXPOSE、LLM_API_KEY/BASE_URL/MODEL/TIMEOUT_MS、SMS_PROVIDER_URL/TOKEN/TIMEOUT_MS、OTP_TTL_SECONDS/MAX_ATTEMPTS、REGISTRATION_TICKET_TTL_SECONDS、REQUEST_BODY_LIMIT_BYTES。

SQLite生产需要持久存储、已验证备份/恢复、已核对的迁移履历。旧sync_foundation迁移对填充旧库存在已复现缺陷，不能直接重跑或改checksum解决。新触发器必须通过migrate deploy安装；仅db push会缺失变更链，服务端会拒绝同步。

Render持久盘在build/pre-deploy阶段不可访问。现有render.yaml保持历史配置以免误触部署，不是本轮认可的安全生产模板。生产方案及真实Cookie/SMS/模型验收需单独批准，不以GitHub推送替代上线。
