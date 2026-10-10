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

server环境样例仅供本地：会返回开发验证码，不发送真实短信。平台默认不预置模型或共享供应商密钥；保留账号自配连接，部署者也可通过 SERVER_AI_ENABLED、SERVER_AI_API_KEY、SERVER_AI_BASE_URL、SERVER_AI_MODEL 四个变量另行显式配置可选基础 AI，用户仍须明确选择并同意外发范围，详见 [可选站点基础 AI](../docs/SERVER_AI_20261010.md)。本次页面未选择任何模型时使用明确标注的规则回复。样例JWT值绝不能用于部署；生产必须提供独立安全配置且关闭DEV_OTP_EXPOSE。前端默认同源 `/api` 代理，也可用VITE_API_BASE_URL显式配置。

## 数据和账号边界

- 验证服务端身份后才打开 `youtrace:user:<id>`，访客库独立。账号变更中止请求并重新加载文档，防止旧store/回调进入另一账号
- 无法确认身份时锁定私人记录，而不是凭旧登录布尔值打开任意账号库。已经打开的账号可以离线编辑；重新打开时仍需确认身份
- 旧共享 `youtrace` 数据库不升级、不自动归属，原样保留并可导出，当前没有自动认领旧资料的功能
- 本地业务写入与outbox原子提交。未收到完整确认不删除修改；冻结批次持久化，丢响应重试相同mutationId
- Sync v2使用事务变更序列、精确字符串游标、版本冲突及墓碑。删除传播；旧设备不能静默复活同ID。所有REST写入进入同一SQLite触发器变更链
- 冲突保留两个版本，在设置页比较后选择；采用云端时本地原稿移入恢复副本，随备份导出
- 速记按规则解析，经编辑确认后一次性应用，重试不重复写入。日记追加到当日原文
- 新目标支持版本化账号同步；旧目标需逐项预览并确认上传，进度由用户手动确认，不由相似文本自动加分。提醒偏好使用CAS/回执；草稿、外观、预算仍为设备数据，请定期导出
- 导出覆盖所有本地表、未确认修改与恢复副本；不包含服务器保存的 AI 连接密钥。服务器整库备份含加密连接，恢复须配对单独保管的原 AI_CREDENTIAL_ENCRYPTION_KEY，不能重新生成替代。清理当前账号包含目标并阻止丢弃未同步修改
- 模型连接由各账号在设置中自行添加并明确同意外发范围，每次进入教练页默认不选择模型。只发送当前文字与当前会话中已披露范围的有限历史，不附加日记、账单或其他应用记录；本地规则回复和旧来源不明的历史不会外发。调用可能产生 API 费用，由本人服务商账户承担。模型不会自动变更记录；操作建议须先核对，再由你主动点击执行

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

后端主要变量：DATABASE_URL、JWT_SECRET、ALLOWED_ORIGINS、SESSION_COOKIE_NAME、TRUST_PROXY、DEV_OTP_EXPOSE、AI_CREDENTIAL_ENCRYPTION_KEY（可选，仅用于加密本人连接，不是共享模型密钥）、SMS_PROVIDER_URL/TOKEN/TIMEOUT_MS、OTP_TTL_SECONDS/MAX_ATTEMPTS、REGISTRATION_TICKET_TTL_SECONDS、REQUEST_BODY_LIMIT_BYTES。

SQLite生产需要持久存储、已验证备份/恢复、已核对的迁移履历。旧sync_foundation迁移对填充旧库存在已复现缺陷，不能直接重跑或改checksum解决。新触发器必须通过migrate deploy安装；仅db push会缺失变更链，服务端会拒绝同步。

Render 持久盘在 build/pre-deploy 阶段不可访问。[根级 render.yaml](../render.yaml) 现为付费 API 与持久盘的准备候选，尚未完成生产验收或实际重新部署。构建阶段不访问数据库或持久盘；运行时先检查实际持久盘挂载及安装状态，对已有安装完成一致备份后再执行迁移并启动。服务创建、成本、已有数据恢复及生产 JWT、真实短信和 Cookie 验收仍须分别确认，详见 [Render 重新部署准备](../docs/RENDER_READINESS_20261010.md)。GitHub 推送和 CI 通过不代表获准上线。
