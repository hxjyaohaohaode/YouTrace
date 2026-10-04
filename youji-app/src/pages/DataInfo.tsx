import { Link } from 'react-router-dom';

export default function DataInfo() {
  return <main className="mx-auto max-w-2xl space-y-6 px-5 py-10 text-[var(--text-1)]">
    <Link to="/login" className="text-sm font-semibold text-[var(--primary)]">返回登录</Link>
    <h1 className="text-2xl font-bold">有迹 · 数据处理说明</h1>
    <p className="text-sm text-[var(--text-2)]">这是当前实现的说明，帮助你决定如何使用。正式运营主体、隐私条款和服务协议仍需运营方确认，本页不代替正式协议。</p>
    <section className="space-y-2"><h2 className="font-semibold">账号与本设备</h2><p className="text-sm leading-7">手机号用于验证码登录。验证账号后，记录使用该账号独立的本地数据库。退出登录会保留本地记录和未同步修改；不会将旧版共享资料自动归给当前账号。</p></section>
    <section className="space-y-2"><h2 className="font-semibold">同步与草稿</h2><p className="text-sm leading-7">花销、待办、日程、习惯、打卡、日记、速记、新目标与提醒偏好支持账号同步。旧目标需要逐项选择上传；输入草稿、外观和预算保存在本设备，清除浏览器数据可能使它们丢失，请定期导出。同步失败的修改会保留并显示状态。</p></section>
    <section className="space-y-2"><h2 className="font-semibold">教练与语音</h2><p className="text-sm leading-7">教练对话会发送给服务端，服务端可能结合近期记录摘要调用已配置的模型提供方。未配置模型时使用明确标注的规则回复。清空本页对话不会删除服务端已保存的记录。本机规则生成的洞察和提醒只保存在当前账号的本设备；云端洞察和提醒会缓存在本机供离线查看，未收到成功确认的云端反馈不会标为已保存。浏览器语音识别是否可用及其处理方式取决于浏览器服务；你也可以始终使用文本输入。</p></section>
    <section className="space-y-2"><h2 className="font-semibold">控制与恢复</h2><p className="text-sm leading-7">设置页可调整提醒与免打扰、检查同步冲突、导出完整本地备份或清除当前账号本地数据。注销账号会删除云端所属数据和本设备当前账号缓存；其他设备离线缓存或你已导出的备份需要在相应设备自行处理。</p></section>
    <section className="space-y-2"><h2 className="font-semibold">运行诊断</h2><p className="text-sm leading-7">客户端只在本次页面内存中保留有界的操作类型、请求状态与耗时，不收集输入内容或上传第三方统计。备份可能包含私人原文、未同步修改与冲突恢复副本，请勿随意转发。</p></section>
  </main>;
}
