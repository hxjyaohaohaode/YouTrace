# 有迹

有迹是一个前后端分离的生活记录与 AI 教练应用：

- 前端：React 19 + Vite + Zustand + Dexie（本地优先 + 同步引擎）
- 后端：Hono + Prisma
- 数据库：SQLite（本地开发）或 Render 持久化磁盘上的 SQLite

## 目录

- `src`: Web 前端
- `server/src`: API 服务
- `server/prisma`: Prisma schema、迁移与本地数据库文件

## 数据架构

- 所有业务数据（花销、待办、习惯、打卡、速记、日记、日程）以 **Dexie (IndexedDB) 为本地单一读路径**。
- 未登录时，一切读写仅发生在本地。
- 登录后：
  - 启动时执行 `/api/sync/pull?since=<上次同步时间>` 增量拉取并合并入本地库；
  - 所有写操作先写本地库，同时进入 outbox 队列，由同步引擎经 `/api/sync/push` 上传；
  - 网络失败自动指数退避重试，恢复联网后自动续传；多设备冲突时服务端以最后写入为准，
    若出现所有权冲突会重置待同步队列并重新全量拉取。
- 教练域（简报 / 洞察 / 推送）在登录态下**服务端权威**；本地规则引擎仅在离线时兜底。
- 已知边界：
  - 另一台设备执行的删除不会反向传播到本机已有数据（无墓碑机制），刷新后以服务端增量为准；
  - 离线期间"修改已被其他设备删除的记录"会以新建形式复活该条（最后写入优先的固有取舍）；
  - 多账号共用同一设备时，登出仅清除待同步队列与会话，不清除业务数据——切换账号前建议先在设置页清除本地数据。

## 部署安全开关

- `TRUST_PROXY`（默认 `true`）：部署在 Render 等反向代理后保持默认，限流按
  `X-Forwarded-For` 最后一跳取真实客户端 IP；若 API **直连暴露**（无代理），
  必须显式设置 `TRUST_PROXY=false`，否则攻击者可伪造该头绕过 IP 限流。


## 本地开发

1. 安装前端依赖

```bash
npm install
```

2. 安装后端依赖

```bash
cd server
npm install
```

3. 准备环境变量

- 复制 `./.env.example` 为 `./.env`
- 复制 `./server/.env.example` 为 `./server/.env`
- 生产环境必须提供长度不少于 32 位的 `JWT_SECRET`

4. 初始化数据库

```bash
cd server
npx prisma generate
npx prisma migrate deploy
```

5. 启动后端

```bash
cd server
npm run dev
```

6. 启动前端

```bash
npm run dev
```

开发端口：前端 `5180`，后端 `3000`（`/api` 由 Vite 代理）。`vite preview`（4173）同样配置了代理。

## 质量检查

前端：

```bash
npm run lint
npm run typecheck
npm run build
```

后端：

```bash
cd server
npm run check   # lint + build + 集成测试
```

集成测试覆盖：认证全流程（OTP/票据/防重放）、请求体上限与来源校验、SSE 解析、
速记 BigInt 序列化、日记字符串主键与唯一日期、待办原子翻转、习惯 streak 与按日唯一打卡、
用户设置校验、同步 push/pull 往返与所有权强制、账号注销级联。

## 生产环境变量

前端：

- `VITE_API_BASE_URL`: 生产 API 地址，示例 `https://your-api.onrender.com/api`
- `VITE_DEV_PROXY_TARGET`: 本地开发代理目标，默认 `http://localhost:3000`

后端：

- `PORT`: 服务端口
- `DATABASE_URL`: Prisma 数据库连接串
- `JWT_SECRET`: 会话签名密钥
- `ALLOWED_ORIGINS`: 允许访问 API 的前端域名，使用逗号分隔
- `SESSION_COOKIE_NAME`: 登录 Cookie 名称
- `LLM_API_KEY`: AI 服务密钥
- `LLM_BASE_URL`: AI 服务地址
- `LLM_MODEL`: AI 模型名
- `LLM_TIMEOUT_MS`: AI 请求超时
- `SMS_PROVIDER_URL` / `SMS_PROVIDER_TOKEN`: 验证码服务地址与凭证，必须同时配置
- `SMS_TIMEOUT_MS`: 短信网关超时
- `DEV_OTP_EXPOSE`: 仅本地联调可设为 `true`；生产环境会拒绝启用，且未配置短信服务时验证码接口返回 503
- `OTP_TTL_SECONDS` / `OTP_MAX_ATTEMPTS`: 验证码有效期与最大尝试次数
- `REGISTRATION_TICKET_TTL_SECONDS`: 手机验证后一次性注册票据有效期
- `REQUEST_BODY_LIMIT_BYTES`: API 请求体上限

## API 概览

认证（公开）：

- `POST /api/auth/send-code|verify|register|logout`，`GET /api/auth/me`
- 会话为 HttpOnly Cookie；变更类请求必须携带白名单内的 `Origin` 头（CSRF 防线）

业务（需登录）：

- 日程 / 待办 / 花销 / 习惯 / 速记 / 日记：标准 REST CRUD（详见 `server/src/routes/*`）
- `PATCH /api/todos/:id/toggle`：原子布尔翻转
- `GET /api/habits`：返回今日完成态、streak 与近 7 天打卡（recentCheckins）
- 教练：`GET /api/coach/brief`、`insights(+dismiss/act)`、`pushes`、`PATCH /api/coach/pushes/:id`、`POST /api/coach/generate-brief`
- 用户：`GET|PATCH /api/user/settings`、`DELETE /api/user`（注销并级联删除全部数据）
- 同步：`GET /api/sync/pull?since=`、`POST /api/sync/push`
  - push 支持客户端生成 ID 的 upsert、`habitCheckins`（按 habitId+date 唯一）、以及 `deletions` 删除列表
- 聊天：`POST /api/chat`（SSE 流式）

## Render 部署建议

前端：

- 使用 Render Static Site
- 根目录选择 `youji-app`
- Build Command 使用 `npm ci && npm run build`
- Publish Directory 使用 `dist`
- 设置 `VITE_API_BASE_URL=https://<你的后端域名>/api`

后端：

- 使用 Render Web Service
- 根目录选择 `youji-app/server`
- Build Command 使用 `npm ci && npm run db:generate && npm run build`
- Pre-Deploy Command 使用 `npm run db:migrate`
- Start Command 使用 `npm run start`
- 为服务挂载 Persistent Disk，并将 `DATABASE_URL` 指向该磁盘，例如 `file:/var/data/youji.db`
- 将前端正式域名写入 `ALLOWED_ORIGINS`

## 生产基线加固清单

- HttpOnly Cookie 会话（SameSite=Lax/生产 None+Secure），不向前端暴露 JWT，亦不接受 Bearer 头
- OTP 使用密码学随机数并以 HMAC-SHA256 哈希持久化，验证采用常数时间比较
- 注册必须消费一次性短时票据；票据同样只存哈希
- 变更类 API 强制校验 Origin 白名单（CSRF 防线），配合频控与请求体上限
- 安全响应头（CSP/nosniff/frame-deny/HSTS 等）；API 层非法 JSON 返回 400
- 业务日历统一 Asia/Shanghai；跨月周统计使用独立查询避免边界漏算
- 过期挑战/票据在发码时机会性清理；进程内限流 Map 定期清扫并有容量上限
- SIGTERM/SIGINT 优雅停机；GitHub Actions 执行双端 lint/typecheck/build/test 与依赖审计
