# Render 重新部署准备与真实阻塞（2026-10-10）

## 结论

前端静态站可免费托管；当前全功能 API 使用 Prisma SQLite 和 SQLite 专用同步触发器，不能在 Render 免费临时文件系统上可靠保存真实资料。不能只换 PostgreSQL URL 或 provider。免费 Render PostgreSQL 30天到期，不能当长期免费持久方案。代码包不是一键永久免费上线承诺。

原 `render.yaml` 免费 SQLite API 已移除。根模板现在是明确的付费 API (`0.5c-512mb`，以本次官方 Blueprint 规范为准) + 1GB付费磁盘候选，且关闭服务自动部署；只有用户明确认可当前报价、持久化、恢复与登录前提后才能创建。`deploy/render/free-static.yaml` 仅创建免费静态前端，需填已有且授权的可靠 API 的实际 URL；没有 API 时只发布静态文件不等于业务可用。

本轮没有创建/部署/重启/改动任何 Render 服务、凭据或真实数据库，也没有打开 Blueprint Auto Sync。服务 `autoDeployTrigger: off` 不是 Blueprint Auto Sync 的替代；现有 Blueprint 必须仍保持 No，手动同步也可能重新创建已删除服务。

## 生产 API 的最小真实前提

- 实际获准的付费持久盘必须以 `/var/data` 单独可写挂载。启动器读取挂载表，匹配实际挂载；只有目录或相同环境字符串不算。免费/临时文件系统、只读盘或路径不匹配会拒绝启动，无绕过开关。
- 单实例：数据库 `file:/var/data/youtrace/youtrace.sqlite3`；数据目录 `/var/data/youtrace`，启动前备份 `/var/data/backups`。备份与主库同盘只是第一层保护，必须另保受控异地副本；已有 `deploy/local` 的一致备份、回执、非覆盖恢复、未知目录拒绝和目录锁复用。
- 新空安装需操作者确认后临时设置 `YOU_TRACE_INITIALIZE_EMPTY=true`，成功后移除。未知/非空目录不会自动认领或覆盖。已有数据只能经验证的迁移/恢复流程；不能将新空库称旧数据恢复。
- JWT_SECRET 至少32字符且非开发样例；真实短信 URL 和 TOKEN 成对且使用 HTTPS。现有生产登录是短信验证码→验证→注册票据，没有短信服务就无法完成正式登录/注册；禁止假短信/开放开发验证码。短信并不因 Render 免费而免费。现有适配约定是向 URL 发送 Bearer TOKEN 和 JSON `{phone, code, purpose:"login", expiresInSeconds}`，供应商或用户已有网关必须真实支持此约定；不能把任意短信平台原生URL/密钥直接填入就声称已接通。
- ALLOWED_ORIGINS 填真实前端 HTTPS origin；静态站 VITE_API_BASE_URL 填真实 API 的 `/api` 地址。旧删除服务地址不硬编码复用。实际跨站Cookie/SameSite/Secure与CORS须在授权后真实浏览器验收。
- Docker构建只安装依赖、生成客户端和编译，运行时先持久盘/安装门禁与备份，再迁移并启动。Render挂载权限若不允许 node 身份写入则安全失败，不自动提升系统权限。
- AI完全可选：BYOK需独立加密密钥；站点基础聊天按 `SERVER_AI_20261010.md` 显式配置。无AI仍可正常CRUD；无短信则不能首次正式登录，二者不是同一个前提。

## 低成本选择

1. 现有本机Docker持久卷方案：无云托管费，电脑/电力/短信/模型仍可能有成本，只在机器运行时可用，当前非24小时公网服务。
2. 免费Render静态前端 + 用户已有可靠API：无需新增Render API费用，但现有API的运行费用和数据安全须另核。
3. 付费Render单实例+持久盘：当前SQLite代码的较小改动路径，实际服务+磁盘报价需用户确认；本包不提交费用或创建资源。
4. 另行批准外部持久数据库方案：需要迁移SQLite schema/trigger/事务/同步协议、已有数据导入、恢复回滚与并发回归。当前未实现，不把 Neon/Supabase/Render 的免费额度当现代码可直接接入。

## 验收及未运行项目

本地运行 `python3 -m unittest discover -s deploy/render/tests -v` 验证挂载门禁；`deploy/local/tests` 保持真实临时库备份/重启/恢复回归；前后端 lint/build/test 另见本次回执。测试使用合成数据，不是生产假数据。

BLOCKED_EXTERNAL：Render官方Blueprint在线校验、真实Docker构建/云盘挂载权限、费用与服务创建批准、真实短信/模型调用、生产数据来源和恢复、真实跨域登录与浏览器端到端。没有因过去CI通过而把本候选写成通过。已知浏览器执行拒绝不通过换路径/参数绕过。

平台依据：
- https://render.com/docs/free
- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec
- https://render.com/docs/infrastructure-as-code
