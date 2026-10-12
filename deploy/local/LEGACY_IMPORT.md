# 精确旧版本离线导入

这是未登记的离线候选生成工具，不是上线/自动升级命令。源文件与源收据只读，输出目录必须全新；不覆盖、不删记录、不选赢家、不修改已发布迁移。

## 支持与运行

只支持精确完成履历：`20260731190000_initial_baseline`，或其加 `20260731190001_auth_security`。来源表/索引/外键 SQL、Prisma 履历字段/状态/checksum 必须吻合。无履历、失败/回滚/部分迁移、额外 HabitLog 或其他漂移均拒绝。目标10个迁移的 SHA 固定；改变目标迁移需重新审核工具。

前置为 Python3、Node、按锁文件安装的后端依赖及 Prisma 引擎。输入来自已授权备份流程的封存 SQLite 文件和同名 SHA-256 `.json` 收据，无 WAL/SHM/journal。不能手写假收据通过检查。

在仓库根执行，路径均为绝对路径且不经过符号链接，输出父目录必须存在：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 deploy/local/legacy_import.py \
  --source /absolute/private/verified-prestart.sqlite3 \
  --new-output-dir /absolute/private/new-import-candidate
```

退出0：无歧义数据离线校验通过，仍未登记。退出2：待决清单生成，整批阻断，无目标data目录。退出1：校验/I/O失败，保留全部已生成文件，不能在同一目录强制重试。

## 产物与转换

- `source.sqlite3/.json` 是原字节副本/原收据；`source-export.json` 为全部实际表的类型化原始导出。整数用十进制字符串，实数用十六进制，BLOB/非法UTF-8 TEXT分别标型并用Base64，保留原空白/换行/Unicode/NUL/JSON文本。
- `plan.json` 记录来源SHA、计数、每条已识别记录的原ID/归属/父引用/目标ID/处置和冲突。未知schema不猜所有者，只保全原库及可导出的原表。
- 原User.id/phone、字符串ID和外键保留。Diary整数ID确定性转换为`legacy-diary-<原十进制ID>`，映射受来源SHA限定，不支持多库合并。打卡另列SQL行ID与`habitId|date`同步ID，不混用。
- 同用户同日日记、同习惯同日打卡整组阻断，内容相同、时间更晚或成员字段损坏也不选赢家。孤儿与跨账号Push→Insight软引用阻断。
- baseline打卡没有createdAt，全部列为待决，不填今天/午夜/父时间。Todo.completedAt保持NULL。Expense/Habit/QuickNote.updatedAt复制已验证的原createdAt，仅作为结构初始值，不声称知道历史最后编辑时间。
- AccountPreferences复制原coachStyle/pushLimit/quietStart/quietEnd，revision=0，教练推送与晚评关闭。坏偏好不改默认值过关。OTP/注册票据只归档，目标认证表为空，不重放旧授权。
- 非法日期/时区、非毫秒精度、超范围数字/布尔/枚举、非空动作或未知JSON引用、重复JSON键等进入待决。不会重写任意名为id的字段或把原文清成空对象。
- 无冲突时先由真实Prisma在全新库执行原样迁移，再在单一事务中导入并保持正式同步触发器启用。逐字段、计数、归属、事件数、schema/checksum、integrity/FK核验后产生独立`imported.sqlite3/.json`备份与`candidate.json`。目标SyncChange是新序列，墓碑/回执为空，不能编造旧删除/确认历史。

## 永不自动激活

工具始终不创建`.youtrace-local.json`，包括全部校验成功。生产supervisor会拒绝该目录；candidate.json明确未登记、未部署。异常尽力生成failure.json，磁盘故障时它也可能写不出；failure优先于candidate回执。不要复制marker、设初始化开关或直接启动Node来绕过。

输出目录0700、文件由0077 umask保护。产物含私人数据和认证历史，不能提交Git、放Web根目录或公开上传。工具只向控制台输出固定状态，不输出原文、手机号、哈希或环境值。

## 切换与回滚

正式激活前另行批准：解决所有待决项并保留全部原始版本；维护窗口封存旧服务/旧库；逐设备导出账号库、outbox、冻结批次、游标与恢复草稿；明确新旧ID/序列切换，不自动认领/清空/重放。通过获准安全流程安排新会话签名密钥/撤销策略，旧cookie必须失效再登录。工具不生成或读取密钥，空OTP表本身不撤销JWT。

本工具不改源库，尚未切换时继续保留原配置/原库即可，不把候选反向覆盖回去。保留失败目录，修复后换全新路径。现有storage.py restore会登记marker，不得在切换门禁完成前用于激活导入候选。若未来新服务已接收写入，不可直接切回旧备份丢掉新数据，需封存两端并制定差异恢复。

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/local/tests -p test_legacy_import.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/local/tests -v
```

测试只用合成数据，真实运行Prisma/SQLite/HTTP/进程重启与备份恢复。磁盘/中断故障为明确注入；认证为合成cookie，SMS/AI外呼被拦截。它们不替代浏览器、容器/云卷权限、正式短信或生产切换验收。
