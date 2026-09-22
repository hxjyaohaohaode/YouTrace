# YouTrace 恢复工程入口

任何 AI / Codex 会话开始工作前，必须完整读取 `docs/AI_RECOVERY_CONTEXT.md`，再读取当前 `docs/AUDIT_REPORT.md`、`docs/RECOVERY_PLAN.md` 中与任务有关的内容。

先执行并核对 `git status`、`git branch -vv`、`git log --oneline -10`。恢复工作在 `recovery/vnext-20260827` 上进行；不得直接开发、重置、合并、rebase 或 push `main`，不得 force push 或生产部署，除非用户明确另行授权。

以不丢数据、不串用户、不破坏正常功能为最高优先级。先证据、后最小修改，验证失败路径和可恢复性；全面评估环境、依赖和风险，以实际效益为目标，禁止无必要重构。

`legacy-v1-fastify` 只读参考；保留用户现有改动和未跟踪文件。禁止输出或提交 secrets、真实数据库或隐私数据。小阶段必须有实际验证和清晰独立提交，外部未验证事项如实标记 `BLOCKED_EXTERNAL`。
