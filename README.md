# 有迹 (YouTrace)

AI驱动的日记/日程/目标/习惯管理PWA应用

## 技术栈

### 前端
- React 18 + TypeScript
- Vite 5 (构建工具)
- Tailwind CSS (样式)
- Zustand (状态管理)
- React Router v6 (路由)
- Dexie.js (IndexedDB离线存储)
- vite-plugin-pwa (PWA支持)

### 后端
- Fastify 4 (Web框架)
- Prisma (ORM)
- SQLite (开发) / PostgreSQL (生产)
- JWT (认证)
- node-cron (定时任务)
- web-push (推送通知)

### AI集成
- DeepSeek-Reasoner API
- MiMo-V2.5 (通过OpenRouter)
- 本地规则降级

### 部署
- 前端: GitHub Pages
- 后端: Render
- CI/CD: GitHub Actions

## 功能模块

| 模块 | 功能 |
|------|------|
| 日记 | 创建/编辑/删除日记, 实时情绪分析, AI洞察 |
| 日程 | 日历视图, 日程CRUD, 冲突检测 |
| 目标 | 目标管理, AI智能拆解, 进度追踪 |
| 习惯 | 习惯打卡, 连续天数计算, 7天网格 |
| 通知 | 通知中心, Web Push, 触发器配置 |
| AI | 情绪分析, 目标拆解, 引导问题, 缓存+降级 |
| 离线 | IndexedDB存储, 同步队列, 网络状态监听 |
| PWA | 可安装, Service Worker, 离线访问 |

## 本地开发

### 前置要求
- Node.js 20+
- npm 9+

### 安装

```bash
# 安装后端依赖
cd server
npm install
npx prisma generate
npx prisma db push

# 安装前端依赖
cd ../client
npm install
```

### 配置

```bash
# 后端环境变量
cp server/.env.example server/.env
# 编辑 server/.env 填入配置

# 前端环境变量
cp client/.env.example client/.env
```

### 启动

```bash
# 启动后端 (终端1)
cd server
npm run dev

# 启动前端 (终端2)
cd client
npm run dev
```

访问 http://localhost:5173

### Docker

```bash
docker build -t youji-api .
docker run -p 3000:3000 \
  -e DATABASE_URL="file:./dev.db" \
  -e JWT_SECRET="your-secret" \
  youji-api
```

## 部署

### 前端 (GitHub Pages)

1. 在GitHub仓库设置中启用Pages, Source选择GitHub Actions
2. 在仓库Settings > Secrets中添加:
   - `VITE_API_BASE_URL`: 后端API地址 (如 `https://youji-api.onrender.com/api`)

3. 推送到main分支自动部署

### 后端 (Render)

1. 连接GitHub仓库到Render
2. Render自动检测`render.yaml`配置
3. 配置环境变量:
   - `JWT_SECRET`: JWT密钥
   - `CORS_ORIGIN`: 前端地址 (如 `https://yourname.github.io`)
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: Web Push密钥
   - `DEEPSEEK_API_KEY` (可选): AI功能

4. 生成VAPID密钥:
```bash
npx web-push generate-vapid-keys
```

### 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `DATABASE_URL` | 数据库连接字符串 | 是 |
| `JWT_SECRET` | JWT签名密钥 | 是 |
| `CORS_ORIGIN` | 允许的前端域名(逗号分隔) | 是 |
| `VAPID_PUBLIC_KEY` | Web Push公钥 | 是 |
| `VAPID_PRIVATE_KEY` | Web Push私钥 | 是 |
| `DEEPSEEK_API_KEY` | DeepSeek AI密钥 | 否 |
| `OPENROUTER_API_KEY` | OpenRouter AI密钥 | 否 |

## 项目结构

```
├── .github/workflows/     # CI/CD配置
│   ├── ci.yml             # 代码检查
│   └── deploy-frontend.yml # 前端部署
├── client/                # 前端
│   ├── src/
│   │   ├── api/           # API调用
│   │   ├── components/    # UI组件
│   │   ├── pages/         # 页面
│   │   ├── services/      # 服务层
│   │   ├── stores/        # Zustand状态
│   │   └── utils/         # 工具函数
│   └── vite.config.ts     # Vite+PWA配置
├── server/                # 后端
│   ├── prisma/            # 数据库Schema
│   └── src/
│       ├── middleware/     # 中间件
│       ├── routes/        # API路由
│       ├── services/      # 业务逻辑
│       └── utils/         # 工具
├── render.yaml            # Render部署配置
├── Dockerfile             # Docker配置
└── API.md                 # API文档
```

## License

MIT
