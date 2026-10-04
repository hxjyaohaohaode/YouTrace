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

## 快速开始与验证

使用 Node 24，从合成开发数据库开始，安装/配置/运行命令见 [应用说明](youji-app/README.md)。

当前恢复候选已引入按账号本地隔离、事务outbox、Sync v2变更序列/墓碑/冲突保全和会话撤销；生产迁移、真实服务与浏览器验收状态见 [验证报告](docs/RECOVERY_TEST_REPORT.md)。目标仍为本设备功能，旧共享库只隔离/导出，不自动推定归属。

## 历史部署配置（未经本轮生产验收）

不要直接Apply或重部署现有真实服务；先完成备份/restore和单独发布审批。仓库根目录保留 [render.yaml](render.yaml) 蓝图，包含两个服务：

| 服务 | 类型 | 说明 |
|------|------|------|
| `youtrace` | Static Site | Vite 构建产物，构建时注入 `VITE_API_BASE_URL=https://youji-api.onrender.com/api` |
| `youji-api` | Web Service | Hono API，启动前执行 `prisma generate` + `migrate deploy` |

使用方式：Render 控制台 → New → Blueprint → 选择本仓库，首次 Apply 时需在面板生成 `JWT_SECRET`（≥32 位随机字符串）。

注意：免费档实例无持久磁盘，SQLite 数据随每次部署重置；需要持久化时升级实例并按 render.yaml 头部注释修改 `DATABASE_URL` 并挂载磁盘。

## 历史

当前分支政策仅保留main。早期legacy历史只从经过验证的离线备份只读参考，不重新建分支或直接合并。
