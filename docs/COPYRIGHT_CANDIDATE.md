# 有迹软件著作权候选材料索引

本文件是工程证据索引，不是法律申请书或权属结论。申请主体、作者贡献、原始Logo/素材权利及委托开发关系须由权利人确认，不能从Git提交者姓名推定。

## 当前功能证据

- 账号验证码认证、隔离本地数据、会话撤销：auth路由/中间件、authStore、db模块、账号安全测试
- 日程、花销、待办、习惯/打卡、日记、速记：对应pages/components/stores和REST路由；本地原子写与Sync v2联调
- 经编辑确认的速记草稿：quickNoteIntegration、QuickNoteResult及capture原子/幂等/回滚测试
- 多设备变更/删除、冲突保全：SYNC_PROTOCOL及sync-recovery、sync-roundtrip、sync-concurrency测试
- 教练：可配置模型对话与明确标注的规则回退、规则洞察、经用户控制的应用内提醒；没有后台推送或任意工具执行承诺
- 目标：手动进度、字段编辑/计划日期、版本化账号同步、明确旧目标选中上传与旧窗口原稿恢复；不是跨产品成果验收。新增代码验收以当前精确SHA报告为准
- 设置、导出、旧资料隔离、运行诊断：Settings、DataInfo、备份/清理/冲突恢复测试

源码范围：youji-app/src、youji-app/server/src、server/prisma及必要构建配置。实际提交版本以Git SHA和对应CI报告为准；package版本0.0.0/1.0.0及旧设计文档版本不应当作正式交付版本。

界面证据由真实Chromium CI的test-artifacts生成，全部为合成账号和记录。真实浏览器未通过前，不将脚本或模拟数据测试替代为界面验收截图。生产验收、真实外部服务及历史迁移门禁见RECOVERY_TEST_REPORT。

## 品牌与素材

原始logo.txt、纯logo.txt、favicon.svg及SplashScreen.tsx在本轮保持字节一致；登录Logo与入口动画未替换。仓库保留素材不等于已证明申请人有权利。原始来源/作者/授权文件需由权利人补齐。

## 直接运行依赖声明快照

2026-10-04读取已锁定安装包的package.json license字段；下列仅为依赖声明，不是完整第三方许可审计，也未覆盖传递依赖、字体、图片或历史代码来源。

| 包 | 实际版本 | 声明许可 |
| --- | --- | --- |
| dexie | 4.4.2 | Apache-2.0 |
| framer-motion | 12.38.0 | MIT |
| lucide-react | 1.11.0 | ISC |
| react / react-dom | 19.2.5 | MIT |
| react-router-dom | 7.18.2 | MIT |
| zustand | 5.0.12 | MIT |
| @hono/node-server | 2.0.12 | MIT |
| @prisma/client | 6.19.3 | Apache-2.0 |
| dotenv | 16.6.1 | BSD-2-Clause |
| hono | 4.13.13 | MIT |
| jsonwebtoken | 9.0.3 | MIT |
| nanoid | 5.1.16 | MIT |
| zod | 3.25.76 | MIT |

最终材料应从已验收提交重新生成真实功能说明、源码摘录、版本标识、界面截图与依赖/素材归属清单，不添加空页面、填充代码或未运行能力。
