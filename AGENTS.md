# YouTrace 恢复工程入口

任何 AI / Codex 会话开始工作前，必须完整读取 `docs/AI_RECOVERY_CONTEXT.md`，再读取当前 `docs/AUDIT_REPORT.md`、`docs/RECOVERY_PLAN.md` 中与任务有关的内容。

先执行并核对 `git status`、`git branch -vv`、`git log --oneline -10`。2026-10-04 用户明确将分支政策改为本地和 GitHub 只保留 `main`，授权把 Phase 0 审计成果收敛到 `main` 并删除其他分支；后续工作在 `main` 上小步提交。该次分支收敛授权不等于生产部署授权，也不等于永久授权任意重写历史；以后 force push、删除分支或破坏性重置仍需明确授权。

Render 与 GitHub 可能自动部署关联。在生产备份、恢复和发布门禁完成且获准发布前，推送需使用已核实的 `[skip render]` 提交标记或确认平台已关闭自动部署；不要把 GitHub CI 通过等同于可安全上线。

以不丢数据、不串用户、不破坏正常功能为最高优先级。先证据、后最小修改，验证失败路径和可恢复性；全面评估环境、依赖和风险，以实际效益为目标，禁止无必要重构。

历史 `legacy-v1-fastify` 只读参考；删除分支前须有经过恢复验证的离线 Git 备份，删除后从备份查看，不直接合并旧历史。保留用户现有改动和未跟踪文件。禁止输出或提交 secrets、真实数据库或隐私数据。小阶段必须有实际验证和清晰独立提交，外部未验证事项如实标记 `BLOCKED_EXTERNAL`。
