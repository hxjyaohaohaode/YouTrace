# 有迹 (YouTrace)

生活记录与教练应用：花销、待办、习惯、打卡、速记、日记、日程，配合明确标注的规则简报与洞察。教练默认使用规则回复；可选本人配置的模型连接，需同意外发范围并在本次页面明确选择，只发送当前文字与已披露范围的有限会话历史，不附加应用记录，可能产生 API 费用。

- 本地优先：业务数据以 Dexie (IndexedDB) 为本地单一读路径；已打开的账号可离线编辑，重新打开时仍需确认身份，详见[账号与同步边界](youji-app/README.md)
- 多端同步：登录后通过 outbox 队列 + 增量拉取在多设备间同步
- 免费优先的本机持久化运行包见 [本机运行与恢复](deploy/local/README.md)；已有电脑、受信 TLS、短信及本人模型账户仍有各自前提与费用。历史 Render 配置保留但未经本轮生产验收

## 目录结构

```
.
├── youji-app/          # 应用本体（前端 + 后端）
│   ├── src/            # React 19 + Vite + Zustand + Dexie 前端
│   ├── server/         # Hono + Prisma (SQLite) API 服务
│   └── README.md       # 详细说明：架构 / 数据同步 / 部署安全开关
├── COACH-DESIGN.md     # 历史产品愿景，不代表全部已实现
└── AI提示词.md          # 历史原型提示词，仅供追溯
```

## 快速开始与验证

使用 Node 24，从合成开发数据库开始，安装/配置/运行命令见 [应用说明](youji-app/README.md)。

当前恢复候选已引入按账号本地隔离、事务outbox、Sync v2变更序列/墓碑/冲突保全和会话撤销；生产迁移、真实服务与浏览器验收状态见 [验证报告](docs/RECOVERY_TEST_REPORT.md)。目标新增版本化账号同步与旧目标逐项确认上传，提醒偏好采用完整字段CAS/回执；旧共享库仍隔离/导出，不自动推定归属。2026-10-07阶段的历史 main、当时已验核心闭环和上线/材料阻碍见[可交付现状](docs/USER_TASK_ACCEPTANCE.md#2026-10-07-可交付现状)。逐页覆盖见[覆盖清单](docs/FEATURE_RECOVERY_COVERAGE.md)，各阶段状态以精确SHA报告为准。

软件功能与操作手册草稿、历史验收及待定项见[技术材料与版本边界](docs/COPYRIGHT_CURRENT.md)。当前生产文件的原始字节身份和审阅顺序见[源码身份](docs/copyright-preparation/source-identity.json)与[审阅清单](docs/copyright-preparation/source-excerpt-order.json)；它们不是整库HEAD哈希、登记申请或权属证明。

此前 CI 前置准备阶段的历史验证边界（2026-10-10北京时间，不代表后续组合候选）：7b9ef42f的CI最终20项成功、verify失败、diary-records在字体安装前置取消（未执行原生任务）；expense组183项原生观察已复验Timeline底边修复。随后侧栏旧阈值改为真实布局契约，本轮另将CI字体/录像前置包改为单独准备及校验后离线安装。182项生产文件未变；本地前端1066、后端73、CI准备合同22项通过，后者含APT合成状态模拟，不是Ubuntu实装。新workflow共23项作业（prepare加原22项），编制时实际Ubuntu准备及全部托管测试尚未运行，不能提前写成全绿。首开限定观察未覆盖初始化重叠，历史根因仍未知。未执行生产发布操作，有迹Render平台事件未核实。

当前账户自配 AI 与持久化组合说明见 [AI 外发与密钥边界](docs/USER_OWNED_AI_20261010.md)和[组合验证记录](deploy/local/VALIDATION.md)。模型权限、加密密钥、备份恢复、最终提交 CI 和真实界面仍按各项门禁分别核验。

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
