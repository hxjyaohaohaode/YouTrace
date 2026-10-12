# 旧共享浏览器资料：记录与结构备份 v2

## 修复范围与来源

当前旧共享库名为 `youtrace`，可能含多个账号或匿名资料。此功能只读导出，**不推断归属、不上传、不导入、不修改或删除原库**。新实现基于公开 `1fc2c73444e90d05a3378a302b187cf64fcd76ab`。该基线导出仅取 `toArray()`，实际合成旧库证明：out-of-line 主键丢失、Map 变空对象、Date 变字符串，BigInt 令最终 JSON 下载失败。原红证据另存交付回执。

通过原设置页“旧版资料已隔离保留”→“查看导出说明”确认导出。文件可能包含私人原文，保存在可信位置，不上传公开仓库。仅支持浏览器尚保留该原库的设备；浏览器已清除的数据不能从空备份恢复。

## 文件契约

- 新标识 `format: youtrace-legacy-quarantine-v2`，`exportVersion: 2`。不保留旧 `tables` 数据入口，也不插入可被误当原始记录的占位对象。本产品目前没有导入入口；不得按旧格式处理新文件，不能保证第三方未知 reader 的行为。
- `ownership: unverified`；`scope: records-and-structure`；`restoreStatus: no-product-import-or-ownership-assignment`。编码解码自验只验证导出表示，不代表已经实现用户恢复或归属确认。
- `rawSnapshot` 使用明确 `youtrace-structured-clone-v2` 编码；保存原生 IDB version、每表名/keyPath/autoIncrement、每索引 name/keyPath/unique/multiEntry、每条原主键与值。Dexie 的 version 2 在原生 IndexedDB 中是 20，文件直接记录原生值，不能混用。
- 同一原生只读事务读取全部表，捕获完成后再异步读取 Blob 字节，避免不同表时点混杂和异步二进制编码导致事务自动关闭。
- 隐藏自增 nextKey 无只读 API 可取，因此 `keyGeneratorState` 明确未捕获，UI 同样提示。即使当前最大键较小，历史删掉的最大键也不能推算；这不是完整浏览器引擎克隆，未来恢复必须单独制定自增键政策。

## 类型与严格安全边界

白名单支持：null/undefined/布尔/原始字符串/有限数和 NaN、±Infinity、-0/BigInt；普通或 null-prototype 对象；稀疏数组；Map、Set、重复引用和循环；有效或无效 Date；规范 RegExp；Blob、File；固定 ArrayBuffer、DataView 及11种标准整数/浮点/BigInt TypedArray，保留同一 buffer 别名、偏移、长度和全部字节。保留所有不同原文及空白，不改主键、不选赢家。

IndexedDB 的 structured clone 还可能支持 Error、DOMException、CryptoKey、ImageData 等平台类型，浏览器支持不同。本版本诚实拒绝这些未实现类型；SharedArrayBuffer、可调整 ArrayBuffer、函数、Symbol、访问器或未知类也整批拒绝。不会把未知平台对象改为空对象。符号属性并非 IndexedDB clone 可保留的业务字段；备份只能保留实际从数据库读回的值，不能恢复存入前已被浏览器丢弃的属性/原型。

解码器只使用白名单内建类型，不按输入构造函数名执行代码。对象键用安全 own-property 定义保留 `__proto__` 等字面键，验证引用ID、重复键、越界/未对齐 view、规范 base64。两阶段图重建支持循环与前向引用；重复/悬空ID被拒绝。导出经过 JSON 序列化→严格解码→再编码逐字自验后才返回下载数据。

安全上限：100000条记录、200000图节点、1000000条目/数组容量预算、32 MiB 二进制及32 MiB UTF-16文本、嵌套深度256，最终编码 JSON 最多128 MiB UTF-16。超限/读失败/可捕获的内存异常均失败，不生成截断文件。浏览器进程被系统终止无法由页面保证提示，此时没有已完成下载结论，应保留原库并重试受控恢复。

## 验证与回退

本地使用真实生产导出代码和 fake-indexeddb 合成库，涵盖历史版本20、out-of-line key、复合key、索引、BigInt/Map/Date/Blob/二进制/循环、原库前后内容一致、单事务并发写隔离、读事务中断、隐藏生成器不重置、恶意解码数据、未知类型/超限整批拒绝。它不是原生浏览器下载验收。命令：

`cd youji-app && node --import tsx --test tests/legacy-snapshot.test.ts tests/storage-recovery.test.ts`

还需前端 lint/build/全量测试、后端既有门禁及 CI 前置原命令。严格解码器是技术自验组件；暂无界面恢复工具。不得因导出成功删除原共享库、清除浏览器数据或自动认领。回退代码不需要任何源库迁移；已生成v2文件须保留原版本解码说明，旧版本代码不具备完整导出能力。

## 原生下载验收候选

新增独立 `legacy-backup` CI任务，仅在既有获准的hosted Chromium运行。全新隔离profile经原登录/引导，再显式建立合成旧IDB20，包含原始主键/复合与二进制key、Map/Date/BigInt/Blob/4MiB共享buffer/view/循环/稀疏数组及4294967295普通属性。它是历史准备条件，不能称用户用UI创建这些旧数据。

原设置说明与确认控件触发浏览器真实下载（Browser.downloadWillBegin/Progress和落盘文件），下载JSON经严格解码，再用独立语义图/二进制SHA256与原生源库前后比较，核所有读取事务为readonly。第二阶段仅向合成旧源加入明确不支持的Error，通过原控件获得明确错误提示；核原下载事件数和实际文件列表都没增加、原共享源连该Error保持。该拒绝证据包含肯定错误状态，不能仅以下载超时推断拒绝。页面不导入/认领/修改原数据。

本地附加契约：`node --import tsx --test tests/legacy-backup-native-contract.test.ts`。独立语义oracle的key/原文/buffer/别名/schema损坏反例必须被识别；浏览器任务前的真实前置原命令校验23任务明确集合、runner和工件入口。当前尚未执行这套原生下载，不把准备脚本当作浏览器通过；先等待提醒修复链终态再发布合并候选。

原生成功和失败两阶段另分别捕获当前已核实owner的完整IDB结构/表/key/value前后快照并严格逐值相等，不豁免整个settings/业务类。正常偏好核对和网络空闲后才捕获基线；这不是停止同步或改设置。若发生后台合法变化，测试应失败并保留事实，不能因此给全表豁免。事务账本同时观测共享源与该owner库；unsupported准备写入完成后明确重置分相账本，失败控件期间同样逐事务要求readonly。
