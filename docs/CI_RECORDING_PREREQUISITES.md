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

这段预检不访问应用、不创建记录，也不替代实际浏览器／中文画面／可播放媒体验收。一次新的正常全矩阵验证仍按精确SHA核实际APT包集合、安装／预检耗时、原任务终态及媒体；如官方取包仍慢，保留日志和未完成结果，不反复重跑、加时限或削弱原断言。该首稿集成时仅完成源码准备与静态检查；118的实际测量结果见下。

主要依据：[9月27日runner清单](https://github.com/actions/runner-images/blob/ubuntu24/20260927.320/images/ubuntu/Ubuntu2404-Readme.md)、[10月4日runner清单](https://github.com/actions/runner-images/blob/ubuntu24/20261004.327/images/ubuntu/Ubuntu2404-Readme.md)、[Ubuntu FFmpeg](https://packages.ubuntu.com/noble/ffmpeg)、[libavcodec60](https://packages.ubuntu.com/noble/libavcodec60)、[libavfilter9](https://packages.ubuntu.com/noble/libavfilter9)、[pocketsphinx库](https://packages.ubuntu.com/en/noble/libs/libpocketsphinx3)、[APT选项](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)。原日志中的包版本／下载与本仓锁定录制源相互核对，未把当前本地环境当作CI镜像。

## 118的一次实测结果

精确提交 `118a8a418ddf41e105316474029633940c49130d`、tree `b83e7e4fd2c5c2eac5e6704171a3a6405d4e8761`，CI `37518023736` attempt 1 已全终态：21成功、既有暂停的preferences-read失败，无取消。21项录制预检都成功；原任务矩阵和时限保持，没有另行重跑。

同October镜像20261004.327的旧Goal与本次Expense安装逐包对照，实际100→88个Debian包请求，恰好去掉前述12个推荐分支包，没有新增，其余88包描述／版本相同且逐项完成Setting up，移除大小为原APT圆整记录31,228,706B。保留libvpx、codec2、flite和pocketsphinx等硬依赖。September镜像的新initial-session另避免了旧Budget所见的4项Mesa升级，只作为这两次解析的事实，不承诺所有镜像必然一致。所有包仍来自原Ubuntu源，未增加缓存。

代表initial-session／Expense各取124MB，用21秒／9秒；Goal仍花12分45秒取同样124MB，完整安装步骤779秒，然后预检和业务成功。其它20项安装步骤为17–34秒。包集合减少有直接证据，网络／runner条件没有受控，不能把快慢差全部归给一个选项，也不保证未来下载速度。21项预检的官方秒级步骤耗时均不超过6秒；两份代表连续日志约1.1／2.46秒，不把API的0秒粒度理解成未运行。

原预检日志核到 `/usr/bin` 工具、FFmpeg6.1.1、准确Noto Sans CJK SC／zh-cn／文件与包归属；各所读预检形成单一64×48 VP9流、34个有效解码帧并完整输出解码成功。同时保留编码stderr的 `Invalid PNG signature 0xD494844520000`：进程退出0后仍产生上述有效输出，满足事前固定的至少一帧／完整输出解码门槛；不称36个输入帧全部保留或输入处理无错误。这条诊断未归因，未因见到它而修改flags或补跑。

代表Expense双宽原包的五ZIP、分片、归档`1d84268093d78b20fdb6527fec75c113dc37f210b176e3a9b492756eaae5788a`及578成员已独立核验；365个受版本跟踪文件首尾干净且摘要一致。原报告144 observed-pass＋4 observed-context、infrastructure为空。1280／360实际中文PNG可读，两段VP9录像72.25／77.666秒完整解码，实际尾帧已查看；两trace764064／843959事件完整流读。Expense安装证据是原image行与连续安装／预检摘录，没有声称读过其完整业务日志；initial-session完整日志另保留。Chrome分别随真实September／October镜像为154.0.8037.57／154.0.8037.97，和各自报告相符。

本次独审只授依赖差额、中文与录制／工件能力保留，未重复授全部产品流程。新Expense手机next是同日10.02收入，先前3.21元行遮挡的关闭仍引用545真实原件。暂停偏好读错与旧普通启动原因不因基础设施结果关闭；生产发布仍未获通过。
