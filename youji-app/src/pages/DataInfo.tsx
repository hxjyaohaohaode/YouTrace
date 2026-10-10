import { Link } from 'react-router-dom';

export default function DataInfo() {
  return <main className="mx-auto max-w-2xl space-y-8 px-5 py-10 text-[var(--text-1)]">
    <Link to="/login" className="text-sm font-semibold text-[var(--primary)]">返回登录</Link>
    <h1 className="text-[28px] font-semibold">有迹 · 数据处理说明</h1>
    <p className="text-sm text-[var(--text-2)]">这是当前实现的说明，帮助你决定如何使用。正式运营主体、隐私条款和服务协议仍需运营方确认，本页不代替正式协议。</p>
    <section className="space-y-2"><h2 className="text-lg font-semibold">账号与本设备</h2><p className="text-base leading-8">手机号用于验证码登录。验证账号后，记录使用该账号独立的本地数据库。退出登录会保留本地记录和未同步修改；不会将旧版共享资料自动归给当前账号。</p></section>
    <section className="space-y-2"><h2 className="text-lg font-semibold">同步与草稿</h2><p className="text-base leading-8">花销、待办、日程、习惯、打卡、日记、速记、新目标与提醒偏好支持账号同步。旧目标需要逐项选择上传；输入草稿、外观和预算保存在本设备，清除浏览器数据可能使它们丢失，请定期导出。同步失败的修改会保留并显示状态。</p></section>
    <section className="space-y-2"><h2 className="text-lg font-semibold">教练与语音</h2><p className="text-base leading-8">教练对话会发送给应用服务端，默认使用明确标注的规则回复。只有你在设置中配置本人的模型连接并同意外发范围，再在本次教练页面明确选择使用后，才会将当前文字与当前会话中已披露范围的有限历史发送给你选择的服务商，不附加日记、账单或其他应用记录。调用可能产生 API 费用，由你的服务商账户承担。模型不会自动变更记录；操作建议须先核对，再由你主动点击执行。清空本页对话不会删除服务端已保存的记录。本机规则生成的洞察和提醒只保存在当前账号的本设备；云端洞察和提醒会缓存在本机供离线查看，未收到成功确认的云端反馈不会标为已保存。浏览器语音识别是否可用及其处理方式取决于浏览器服务；你也可以始终使用文本输入。</p></section>
    <section className="space-y-2"><h2 className="text-lg font-semibold">控制与恢复</h2><p className="text-base leading-8">设置页可调整提醒与免打扰、检查同步冲突、导出完整本地备份或清除当前账号本地数据。注销账号会删除云端所属数据和本设备当前账号缓存；其他设备离线缓存或你已导出的备份需要在相应设备自行处理。</p></section>
    <section className="space-y-2"><h2 className="text-lg font-semibold">运行诊断</h2><p className="text-base leading-8">客户端只在本次页面内存中保留有界的操作类型、请求状态与耗时，不收集输入内容或上传第三方统计。备份可能包含私人原文、未同步修改与冲突恢复副本，请勿随意转发。普通本地导出不包含服务器保存的 AI 连接密钥；服务器整库备份含连接密文，恢复时还需单独保管的原加密密钥。</p></section>
  </main>;
}
