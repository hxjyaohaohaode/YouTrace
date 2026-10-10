# 免费优先的本机持久化运行包（候选）

此包沿用现有 React/Vite + Hono/Prisma/SQLite，不迁移 PostgreSQL，不弱化短信认证。可选 AI 配置见下文。它不部署到云、不创建账户/密钥、不安装 Docker、不自动信任证书。程序及部署配置不收取托管费用；已有电脑、电力、短信和模型服务不因此免费。

## 真实使用前提

- 已获批准安装并运行的 Docker Engine / Compose，单台机器、单个 API 实例。当前命令面向 Docker Compose；没有 Windows 原生启动验收。
- 用户已有、受控设置的生产 JWT_SECRET（至少 32 字符），以及真实 SMS_PROVIDER_URL/TOKEN。应用现有登录只支持短信验证码；没有短信供应商就不能完成正式登录。本启动器会拒绝缺失配置，不开启开发验证码或伪造登录。
- 账号自配 AI 是可选项。仅需要该功能时，另外提供已有、获准配置的 `AI_CREDENTIAL_ENCRYPTION_KEY`（独立 32 字节密钥的标准 Base64），并保留与数据库匹配的原值；本包不生成密钥。缺失时仍可使用非模型功能，但不能保存或使用账号 AI 凭据。账号自己的服务商 API 密钥仍在应用设置中配置。另有默认关闭的部署者基础聊天，只有明确配置 SERVER_AI_* 且用户在教练页选择并同意后才使用，见 ../../docs/SERVER_AI_20261010.md；不要混淆两类密钥或把任何密钥放入 VITE_*。
- `deploy/local/tls/cert.pem` 和 `key.pem` 为操作者已有/批准配置、浏览器信任且适用于 localhost 的 TLS 证书与私钥。浏览器访问 `https://localhost:8443`。不要跳过证书警告或关闭 Secure Cookie；本包不自动修改系统信任设置。TLS 在 Nginx 终止，同源代理整个 /api/。
- 机器运行时才提供服务。只绑定本机回环地址，没有公网开放、穿透或防火墙变更。不要把本机可用称为 24 小时公网在线。

## 空白新安装

从仓库根目录操作：

1. 将 `deploy/local/.env.example` 复制为同目录 `.env`，通过本机安全编辑器填入上述私有配置，不上传或提交。保留 `ALLOWED_ORIGINS=https://localhost:8443`，不要复用开发 JWT 样例。证书放在指定 tls 目录。
2. 仅第一次空白安装，在该 `.env` 中加入 `YOU_TRACE_INITIALIZE_EMPTY=true`。这只允许空卷初始化；未知旧数据库、任意额外文件、已存在但无标记的数据库都会拒绝启动，绝不替用户认领/覆盖旧数据。
3. 运行：

   ```sh
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml up --build
   ```

4. 初始化成功后从 `.env` 删除 `YOU_TRACE_INITIALIZE_EMPTY=true`。以后同一命令会使用已有持久数据。不要运行 `down -v`、删除 data 卷，或改变 Compose project name 后把新空卷误认为旧数据已恢复。
5. 浏览器打开 `https://localhost:8443`，实际验收 TLS、登录、账号隔离、写入/刷新、Cookie 与同步。真实短信/模型调用需要单独获准，并核对服务费用。已有账号和资料恢复不是新建空安装的一部分。

构建只安装依赖、生成 Prisma Client 并编译，不在 build 阶段碰数据库。运行时先验证配置、持有目录锁、对已有库创建一致性备份，再执行已有 `prisma migrate deploy`，成功后启动 API。旧库迁移失败会停机，不能通过修改旧 migration checksum 或 db push 让它表面通过。首次迁移中断后的非空未登记目录也拒绝自动接管；保全后人工核验，不盲删重试。

API 端口不发布到宿主机；仅 Nginx 的 8443 暴露于回环。API 前端地址编译为 `/api`。代理保留 Cookie、Origin 和原请求路径，不把 API 404 变成 SPA 首页；移除外来转发地址头，API `TRUST_PROXY=false`。当前因此所有通过代理的请求共享既有 IP 限流语义，适合单机个人使用；不能据此宣称已支持公网多租户容量。

## 持久化与在线备份

`data` 命名卷的 `/data/youtrace.sqlite3` 是数据库；`backups` 是独立命名卷。运行身份为 Node 镜像的 node 用户，镜像内创建目录时赋予该身份所有权；真实 Docker 卷权限仍须实际验证。后台 supervisor 始终持有 `/data/.runtime.lock`，只保护使用此启动器的进程；不要让另一个旧服务/工具写同一库。

每次已有安装启动前自动生成唯一命名的备份（不自动删旧备份，请监控磁盘）。手动在线备份命令，例如：

```sh
docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml exec api python3 /app/local/storage.py backup --data-dir /data --output /backups/manual-20261010.sqlite3
```

脚本使用 SQLite backup API，包括已提交 WAL 内容，校验 integrity_check 与 foreign_key_check，输出 0600 数据库文件和 SHA-256 回执；拒绝目标重名、侧文件、源符号链接。超时/失败输出保留诊断，不能当成功备份使用。不要只复制正在运行的主库。

备份含私人数据、认证相关状态和账号 AI 连接密文，不能放 Git、网页或公开聊天。数据库与 `.json` 回执应一起受控导出到第二存储位置；两个 Docker 卷仍可能在同一物理硬盘，不能抵御整机损坏。JWT/SMS 配置、TLS 私钥和 `AI_CREDENTIAL_ENCRYPTION_KEY` 不在数据库备份里，必须另行安全保管。恢复账号 AI 连接时，需要原数据库密文和匹配的原始加密密钥；不能丢失或重新生成替代值。错误或缺失的密钥无法解密旧连接，不会自动覆盖旧密文。不要为了恢复生成替代 JWT 后声称会话保持。

## 非覆盖恢复与回退

1. 停止 API（本机操作者确认没有其他服务写同一目录），保留原卷、配置、旧镜像和日志。先验证备份回执。
2. 使用原命名卷里的备份恢复到一个不存在的新目录，不覆盖当前数据库。例如：

   ```sh
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml stop api
   docker compose --env-file deploy/local/.env -f deploy/local/compose.yaml run --rm --no-deps api python3 /app/local/storage.py restore --source /backups/manual-20261010.sqlite3 --new-data-dir /data/restored-20261010
   ```

3. 建立本地恢复 override 文件（不要替换原 compose），将 api 的 `DATA_DIR` 改为 `/data/restored-20261010`、`DATABASE_URL` 改为 `file:/data/restored-20261010/youtrace.sqlite3`，并设置 `YOU_TRACE_INITIALIZE_EMPTY: 'false'`。以两个 `-f` 文件重新启动；数据库文件名必须保持 `youtrace.sqlite3`。启动器拒绝这两个路径不一致。
4. 在停止原 API 的情况下启动恢复副本，核对账号、记录、同步序列、删除状态和未确认更改，再决定保留哪个目录。前端 IndexedDB/outbox 不在服务器备份中，仍需使用现有导出功能保护浏览器数据，不自动认领旧共享库。
5. 回退须使用对应旧镜像/源码与升级前备份，不能让旧程序写新 schema，也不能降低 schema 数字。此恢复工具仅恢复本包创建并验证的副本；未知旧生产库的收集/归属/兼容迁移仍是单独门禁。

## 验证范围

运行全部已有检查以及本包检查：

```sh
cd youji-app
npm run lint
npm run build
npm test
npm --prefix server run check
cd ..
python3 -m unittest discover -s deploy/local/tests -v
```

本包测试包含 Linux 真正 supervisor → 运行时 Prisma 迁移 → Hono HTTP → 在线备份 → 退出/重启 → 新目录恢复。账号 AI 连接经真实 HTTP 保存，测试核对备份/重启/恢复后的密文保持一致，并在进程内 fetch 替身下执行应用的真实解密路径；原密钥成功，错误或缺失密钥失败关闭。固定公开测试密钥仅用于临时合成数据，不生成生产密钥。HTTP 合成账户与签名会话由测试直接建立，不发送短信，不代替正式登录或浏览器 Secure/SameSite 验证。TLS/Nginx/Docker 引擎、镜像拉取/构建、真实卷权限、Windows 和实际供应商未运行的部分均不能写成通过。精确当次结果见 `VALIDATION.md`。

## 隔离 Docker CI（需要单独运行，不是本地通过证明）

`.github/workflows/local-durability.yml` 支持手动 workflow_dispatch，也在 main 推送涉及应用、本包、根 `.dockerignore` 或本工作流时自动验证；它不会部署真实服务。它调用 `test-docker.sh`，以唯一测试 project/卷、合成账户与配置运行真实镜像、Nginx HTTPS、前端与 API 404 路由、UID、容器重建持久化、在线备份/新目录恢复、AI 连接密文与原加密密钥的配对和生产 Cookie 头检查。没有外部短信/模型调用；解密后调用由进程内 fetch 替身代替。证书仅在该次临时 localhost 测试生成，由 curl 的 `--cacert` 显式信任，不跳过证书验证、不改全局信任。

脚本拒绝覆盖已有 `.env` 或 tls 目录；退出时只删除自己唯一项目的测试卷和自己创建的临时配置。手动本机执行需明确设置 `YOU_TRACE_SYNTHETIC_DOCKER_TEST=1`，且本机 8443 未被其他程序占用。没有自动安装 Docker。只有相应精确提交的 CI 运行回执成功后，才能把这些 Docker 验证标为通过；本次未推送或触发远端。
