# 安全基线与依赖例外

## 认证边界

- 验证码使用密码学安全随机数生成，并仅持久化带服务端密钥的 HMAC-SHA256 哈希；验证采用常数时间比较。
- 验证成功后只签发短时、绑定手机号、单次消费的注册票据；`/register` 不接受无票据注册。
- 生产环境不会返回开发验证码；短信提供方缺失或调用失败时返回 503，禁止静默放行。
- 会话保存在 `HttpOnly` Cookie 中（生产 `SameSite=None; Secure`，开发 `Lax`）。
  服务端**只接受 Cookie 会话**，不存在 Bearer 头旁路；JWT 有效期固定 7 天、无刷新机制，
  `logout` 仅清除 Cookie（无状态吊销是已知取舍，见"会话生命周期"）。

## CSRF 模型

所有变更类请求（POST/PUT/PATCH/DELETE）必须携带位于 `ALLOWED_ORIGINS` 白名单内的
`Origin` 头，否则返回 403。浏览器在跨站与同站 fetch/XHR 中均会附带 Origin，
因此正常前端不受影响；不带 Origin 的非浏览器客户端只能调用 GET 类端点。
该模型配合 SameSite Cookie 构成当前 CSRF 防线；若未来启用任何服务端渲染能力，
必须重新进行专项 CSRF 审计。

## 会话生命周期

- JWT 签发含 issuer/audience 校验；用户被注销后，孤儿令牌访问 `/api/auth/me` 将收到 401 并清除 Cookie。
- 无服务端会话表意味着无法主动吊销单个已签发令牌；缩短 TTL 或引入令牌版本号是后续可选加固项。
- 进程内限流 Map 具备定期清扫与容量上限；`x-forwarded-for` 取最后一跳（最接近受信代理）作为限流键。

## 账号注销

`DELETE /api/user` 在单个事务中级联删除该用户的全部记录（日程、花销、待办、习惯及打卡、
速记、日记、教练对话/洞察/推送、认证挑战与票据）并删除用户本体，随后清除会话 Cookie，
满足个人信息保护法对账号注销的要求。

## 当前依赖审计例外

截至 2026-08-04，后端 `npm audit` 为 0。前端审计仍会报告 React Router 的
`GHSA-qwww-vcr4-c8h2`；上游当前最新稳定版尚无修复版本。

该公告要求 React Server Components / framework mode 的服务端 action 端点。本项目仅使用
`BrowserRouter` 构建静态 SPA，不启用 RSC、SSR、framework mode、loader 或 action，因此当前
构建不存在公告描述的服务端执行面。升级时必须继续满足以下约束：

1. 不启用 React Router RSC、SSR、framework mode 或服务端 action。
2. 上游发布修复版本后优先升级，并重新执行 `npm audit`、`npm run lint` 与 `npm run build`。
3. 若未来需要上述服务端能力，必须在上线前移除该例外并完成专项 CSRF 审计。

## Prisma migration gate

迁移目录包含三个顺序迁移：`initial_baseline`（全部表结构）、`auth_security`
（幂等标记迁移，保证历史数据库可完整遍历）、`sync_foundation`（统一 updatedAt 游标、
Diary 字符串主键重建、打卡按日唯一、业务索引）。CI 在干净数据库上执行
`prisma migrate deploy` 完整验证。对已有的非空 SQLite 数据库，首次切换到
`migrate deploy` 前仍需按 Prisma 的 baseline 流程登记现有迁移，不能直接把
`db push` 创建的数据库当成已迁移数据库。


## 2026-10-04 恢复候选更新

上文历史会话/依赖说明以本节及 [验证报告](../docs/RECOVERY_TEST_REPORT.md) 为准：退出已将会话不可逆摘要持久撤销，业务路由也检查账号存在与预期账号头。新同步协议拒绝旧版本并保留队列，见 [SYNC_PROTOCOL](../docs/SYNC_PROTOCOL.md)。

Hono升级至4.13.13兼容线，nanoid升级至5.1.16兼容线；Prisma6工具链定向覆盖deepmerge-ts为8.0.0，以修复递归对象合并栈耗尽。覆盖只作用于@prisma/config依赖，generate、干净migrate deploy、构建及真实SQLite集成回归需一起通过；不得把它当成已升级Prisma大版本。来源：[GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)。本轮前后端生产依赖审计均为0项公告，审计结果随时间变化，不等于产品不存在漏洞。

本地诊断仅记录内存中有界的页面/控件类型、状态码与耗时，不记录输入内容、账号、标题或查询参数，不接入第三方遥测。旧共享库原文、outbox与冲突副本仅通过用户明确操作导出，不自动上传。

原文“满足个人信息保护法”的概括不构成本轮法律合规结论。真实运营主体、隐私条款、数据留存/跨境安排和生产安全必须独立核对；本轮不作法律认证。
