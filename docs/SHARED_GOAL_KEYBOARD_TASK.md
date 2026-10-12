# 旧共享目标恢复：键盘与焦点原生基线

应用基线为公开 `5a13c0b7a6d12d5615ca8fb85f55438838c0a07b`。此前 `shared-goals` 的两宽18项pointer任务及实际下载、数据保全已经通过并单独封存；不把它当作键盘验证。首轮 `31b2e2e076a05754fcc79127550471cd44046099` 只新增测试/文档，实际原生红结果如下。当前最小候选仅增加恢复面板原生焦点滚动安全区与修正测试键API；生产 Modal、恢复服务、归属/同步/自动撤销边界未改。候选尚未获得新原生通过。

## 原控件范围

独立 `shared-goals-keyboard` 任务，两个全新 Chromium profile，1280×900与360×900。真实OTP和首页/设置导航后，准备声明的合成native30共享库：12条Goal以测试分页，第12条原文40行；不是用户真实资料或通过UI创造的历史。随后恢复流程全部使用真实Tab、Shift+Tab、Enter、Space、Escape，没有测试代码调用focus、DOM click、业务服务或写API。

1. 从原设置控件用Tab到预览，Enter打开；Tab到第一页末“下一页目标”，Space分页；Shift+Tab找到原编号明确的第二页目标，Enter打开归属弹窗。
2. 长原文下，实际焦点须落在未勾选checkbox，完整控制框处于viewport/滚动裁剪内，五点命中不被固定栏覆盖且保留实际焦点样式/原截图供可见性复核。Enter不擅自勾选或提交。
3. 未勾选时Tab顺序为checkbox→暂不恢复→关闭，跳过disabled确认；Shift+Tab反向包围。Space明确勾选后，Tab顺序增加确认按钮，正反向循环都留在弹窗。
4. Esc取消并自然回到原第二页按钮；账号全表/schema/key/value和共享源逐值不变。重新打开恢复未勾选，用Space选择再Enter取消，仍零写并回焦。
5. 再次明确选择后，Enter确认只产生一个原文准确的local Goal和原文收据；所有已有资料保持。独立重算snapshot→row→intent→receipt。重新打开用Space确认同一份，不重复副本或收据。
6. 键盘读取恢复收据并打开比较弹窗，Tab/ShiftTab遍历关闭、目标页链接、保留返回；Esc自然回到比较触发者。比较不删除/复活，不自动上传。

只读取证记录每次真实键、实际activeElement、完整裁剪、命中对象、焦点样式、自然回焦及真实动画稳定信息。遮挡/丢焦/超时必须原样失败，不通过额外滚轮或注入focus让键盘缺陷消失。目标搜索最多90次真实Tab；稳定等待沿用已验有界动画观察，不关闭动效。失败也保存原始前后账号/共享源与焦点账本，不仅成功时留证。

## 本地与原生分开

本地合同实际运行native30合成IndexedDB与生产预览/确认，核12条均为支持形状及40行原文；实际Modal源码effect在DOM形状替身中检查初始焦点、Tab边界、Esc与自然返回。后者没有浏览器默认Tab行为、CSS布局或真实屏幕，因此不能授予原生通过。

只读焦点oracle拒绝错误目标、失联、disabled、不可见、部分裁剪、边缘遮挡（中心仍命中）和无focus-visible。独审另复现透明outline/零尺寸透明shadow假阳性，现只接受本产品声明的非透明计算outline；shadow单独不足。非透明CSS属性仍不等于实际背景对比，最终需独立看原截图，不声明满足WCAG或全站无障碍认证。数据oracle只允许一个新Goal与一个新收据，不豁免整张settings。首次合同负例发现其曾漏核新增losslessRows与keys长度，已收紧并保存原失败；这是新验收工具缺口，不是产品数据丢失。

精确命令：

```sh
cd youji-app
node --import tsx --test tests/shared-goal-keyboard.test.ts
npm run lint && npm run build && npm test
cd ..
python3 -m unittest discover -s youji-app/scripts/tests -p test_ci_prerequisites.py -v
```

CI矩阵新增为25，生产者/消费者、runner允许集合、原件打包与摘要入口同步核对；原24任务不替换，预算不放宽。本地原生受限，不重试、不伪造GITHUB_ACTIONS；实际两宽结果须等待批准的精确提交hosted CI，并独立阅读原始PNG/视频/账本。原生出现真实缺陷后再最小修，旧失败原件继续保留。

此范围不等于读屏、移动设备实体键盘、全局WCAG、全部zoom/reduced-motion、其它旧实体或真实用户恢复。自动撤销仍未实现；普通删除不是撤销。新任务不重复授权任何真实账户操作或部署。

## 31b 首轮原生红与最小候选

[CI 38313042329](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/38313042329)：27个job成功，仅新键盘job失败；独立durable-local成功。新链两个profile都在确认之前受阻，不能算任何取消/确认用例通过。23个原始成员按运行manifest逐个SHA/bytes核验，原archive 13,785,359字节，SHA256 `57deb1ed5cecfcf884786d94d07fa54f4057b59fcf3ce1295d3495bb50445d0a`。各profile已有账号及共享源前后逐值相等。

- 桌面：实际Puppeteer 25.8.0拒绝 `keyboard.press('Shift+Tab')`，报 `Unknown key`。这是验收脚本API缺陷；修为实际Shift down→Tab press→finally Shift up，并用已安装的真实CdpKeyboard加合成传输核键名、modifier位、释放后下一Tab不带Shift。down/press/up失败均使本例终止，释放失败不吞掉、不自动重试。
- 360：原生Tab使“下一页目标”实际聚焦，rect x160..254/y807.09375..851.09375，视口360×900；中心207/829.09375与左/下采样被DIV覆盖。004原PNG实际显示底部导航凸起“速记”覆盖按钮；此刻无动画、未打开Modal、测试无额外滚轮/focus。因此是此面板键盘焦点可见性产品缺口，与桌面API错误分开。
- 候选：只给 `shared-goal-recovery` 面板控件声明8px上下scroll-margin；mobile宽度≤768px时下方保留104px加safe-area，以避开64px固定栏及上凸28px并留焦点间距。其Modal在导航之上、独立滚动，恢复为8px。没有新增JS滚动/抢焦点、改Tab顺序、关动画、滚轮旁路或放松五点命中断言。原生滚动是否已闭合须看下一精确提交的实际图/几何，不由CSS字符串合同推断。

[CSSOM View](https://www.w3.org/TR/cssom-view/#dom-element-scrollintoview)说明scroll-margin参与滚入视区；本产品自然键盘focus滚动仍以Chromium实证为准。样式不添加滚动动画，因此不引入reduced-motion分支；其它平台、真实移动外接键盘和全站可达性仍不在此次限定结论内。
