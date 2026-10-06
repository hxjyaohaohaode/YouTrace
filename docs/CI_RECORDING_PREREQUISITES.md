# CI录制依赖：保留能力，减少无关推荐包

## 已观察到的问题

原录制步骤在每个独立runner执行官方Ubuntu源的 `apt-get update`，随后安装 `fonts-noto-cjk ffmpeg`。2ad Goal使用ubuntu24/20261004.327镜像，取155MB用了19分钟；5bb Diary和545 Budget使用ubuntu24/20260927.320，APT计划166MB。Diary取包期间被取消；Budget取完用了17分14秒。Get条目含Mirrorlist，不能把101／105项叫作已完成的Debian包数。

原20分钟job总限未改。2ad Goal只到开始录制；5bb Diary业务未执行；545 Budget则在官方取消前约0.1秒已生成完整70项无红报告。这三种状态分别保留，不能把安装耗时或job取消一概算成业务失败，也没有证据认定取消发起原因。此前原日志和工件不由新一次成功替代。

## 实际需要及最小修改

两份精确runner说明列有现用Chrome，原APT日志把FFmpeg和Noto CJK列为新装；没有已可用的另一套录制工具／字体的正面证据，不省略它们。Fontconfig已有，同镜像普通verify只加Noto CJK后实际Chrome流程已成功，不另装浏览器。锁定Puppeteer 25.8.0从PNG image2pipe编码VP9/WebM、12fps、CRF35，明确 `-an`，并使用crop/pad。

只在user_outcomes安装命令增加 `--no-install-recommends`，保留两个直接包及全部Depends。`libavcodec60`的libvpx和codec2、`libavfilter9`的flite及pocketsphinx库均是硬依赖，继续由APT解析安装。英语语音模型 `pocketsphinx-en-us` 是推荐数据，不用于本录制管道；它在原日志占27.4MB。语音模型和显卡驱动／光盘／窗口装饰等推荐分支中的12个包，原取包大小合计约31.23MB，来自APT圆整记录；实际新解析与耗时仍须读新runner日志，不能保证Mesa升级全部消失或未来网速。

官方源、Chrome来源、字体包、已有verify步骤、原任务矩阵、20分钟job／8分钟业务预算、录制参数、原图／trace／视频、打包和上传均保留。不新增缓存，也不更改镜像来处理明确网络拒绝。

## 小型能力预检与一次验证

安装后执行 [`recording-prereq-probe.sh`](../youji-app/scripts/recording-prereq-probe.sh)，外层45秒、另2秒强制结束宽限计入原job总限。它记录少数固定工具的实际路径／包版本，并只核现有Chrome路径和版本；fontconfig必须返回准确Noto Sans CJK SC、zh-cn、可读文件及该已装包归属，拒绝仅exit0却实际fallback。固定合成PNG重复36帧，经锁定录制参数与pipe输入／输出、crop/pad形成64×48 VP9/WebM；必须只有一个video流、至少一个有效解码帧，再完整解码。阶段失败及原stderr留在CI日志；退出时尽力清理自己创建的RUNNER_TEMP目录，SIGKILL时不保证清理完成，不增加任何缓存。

这段预检不访问应用、不创建记录，也不替代实际浏览器／中文画面／可播放媒体验收。一次新的正常全矩阵验证仍按精确SHA核实际APT包集合、安装／预检耗时、原任务终态及媒体；如官方取包仍慢，保留日志和未完成结果，不反复重跑、加时限或削弱原断言。当前候选仅完成源码准备与静态检查，尚无新runner测量结果。

主要依据：[9月27日runner清单](https://github.com/actions/runner-images/blob/ubuntu24/20260927.320/images/ubuntu/Ubuntu2404-Readme.md)、[10月4日runner清单](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/Ubuntu2404-Readme.md)、[Ubuntu FFmpeg](https://packages.ubuntu.com/noble/ffmpeg)、[libavcodec60](https://packages.ubuntu.com/noble/libavcodec60)、[libavfilter9](https://packages.ubuntu.com/noble/libavfilter9)、[pocketsphinx库](https://packages.ubuntu.com/en/noble/libs/libpocketsphinx3)、[APT选项](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)。原日志中的包版本／下载与本仓锁定录制源相互核对，未把当前本地环境当作CI镜像。
