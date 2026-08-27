# 有迹 (YouTrace)

AI 驱动的生活记录与教练应用：花销、待办、习惯、打卡、速记、日记、日程，配合 AI 教练提供简报与洞察。

- 本地优先：业务数据以 Dexie (IndexedDB) 为本地单一读路径，离线可用
- 多端同步：登录后通过 outbox 队列 + 增量拉取在多设备间同步
- 部署适配 Render（SQLite 持久盘 + 反向代理）

## 目录结构

```
.
├── youji-app/          # 应用本体（前端 + 后端）
│   ├── src/            # React 19 + Vite + Zustand + Dexie 前端
│   ├── server/         # Hono + Prisma (SQLite) API 服务
│   └── README.md       # 详细说明：架构 / 数据同步 / 部署安全开关
├── COACH-DESIGN.md     # AI 教练完整设计文档
└── AI提示词.md          # 教练域提示词设计
```

## 快速开始

```bash
cd youji-app
npm install
cd server && npm install && npx prisma generate && npx prisma migrate deploy

# 配置环境变量后启动
cp .env.example .env           # 根目录 → 前端
cp server/.env.example server/.env   # 后端（生产环境必须提供 ≥32 位 JWT_SECRET）

npm run dev      # 终端1：后端 :3000
npm run dev      # 终端2（youji-app 根）：前端 :5180，/api 由 Vite 代理
```

> 注意：两次 `npm run dev` 分别在 `youji-app/server` 与 `youji-app` 目录执行，详见 [youji-app/README.md](youji-app/README.md)。

测试：

```bash
cd youji-app && npm run build          # 前端类型检查 + 构建
cd server && npm run check             # lint + build + 14 项集成测试
```

## 部署（Render）

仓库根目录提供 [render.yaml](render.yaml) 蓝图，包含两个服务：

| 服务 | 类型 | 说明 |
|------|------|------|
| `youtrace` | Static Site | Vite 构建产物，构建时注入 `VITE_API_BASE_URL=https://youji-api.onrender.com/api` |
| `youji-api` | Web Service | Hono API，启动前执行 `prisma generate` + `migrate deploy` |

使用方式：Render 控制台 → New → Blueprint → 选择本仓库，首次 Apply 时需在面板生成 `JWT_SECRET`（≥32 位随机字符串）。

注意：免费档实例无持久磁盘，SQLite 数据随每次部署重置；需要持久化时升级实例并按 render.yaml 头部注释修改 `DATABASE_URL` 并挂载磁盘。

## 历史

`legacy-v1-fastify` 分支保留早期技术栈版本（React 18 + Fastify），当前 main 为重构后的新版。
