弦间：虚拟吉他弹唱原型
2026-10-24，Asia/Shanghai

运行
双击“启动吉他.command”，或在本目录运行：
.venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8610
电脑：http://localhost:8610/
手机：同一 Wi-Fi 下访问电脑的局域网 IP 加 :8610。
手机浏览器的摄像头要求可信 HTTPS；普通局域网 HTTP 可使用触屏演奏、曲库和歌曲分析。当前没有部署公网 Python 分析服务。
手机摄像头：双击“启动手机HTTPS.command”。先在手机打开 http://电脑IP:8610/api/local-certificate 下载本项目本地 CA，安装并信任后访问 https://电脑IP:8611/。
iPhone：下载描述证书后在“设置 > 通用 > VPN与设备管理”安装，再到“通用 > 关于本机 > 证书信任设置”信任 Guitar Workbench Local CA。用完可从设备管理移除。
证书和私钥仅放在 data/tls；脚本不修改 Mac 或手机的系统信任。后续正式域名 HTTPS 部署可免去本地证书安装。
摄像头只在用户点击后请求权限；视频和手势推理在浏览器内处理，不上传摄像头画面，也不申请麦克风权限。

演奏
默认 1=C、2=G、3=Am、4=F、5=Em、6=Dm，可自定义按钮。
空格或向下箭头下扫弦，向上箭头上扫弦，Esc 止音。
鼠标按住或手指滑过六根琴弦；也能逐弦点击。
摄像头镜像画面的左半区举 1–5 指选择前五个和弦；拇指与小指伸出表示 6。
右半区上下挥手扫弦，或切换为捏合后松开触发。
自动分解和弦是可选演奏模式，速度、音量、空间感、力度均可调整。
支持将麦克风歌声与虚拟吉他混音录制，在页面内试听或下载；只有用户主动下载时才保存录音文件。录音时按需申请麦克风权限。

七个项目的真实集成
1. Tone.js 15.1.22：播放、音频时钟、滤波、EQ、压缩、混响和限幅。
2. tonejs-instruments：固定 Git revision 的 37 个木吉他 MP3，约 6.97 MB，随网页本地加载。来源与 CC BY 3.0 说明在 vendor 中。
3. chords-db：固定 revision 的 guitar.json，828 个和弦定义、3283 个把位；按弦位推导实际发声音高。
4. ChordMiniApp：复用 MIT 授权的时间轴合并、时间轴有效性校验和和弦统计函数；完整原始文件和 LICENSE 已保留。没有把整个上游应用冒充成独立部署完成。
5. chord-extractor 0.1.3：真实调用 Chordino；Mac arm64 原生 Vamp 插件在 .runtime/vamp 中，编译脚本在 scripts/build_chordino.py。仅将上游 Boost 文本解析适配为标准 C++，没有改识别算法。
6. Omnizart：固定 revision 的源码与 44.24 MB 官方 chord_v1 权重；独立 TensorFlow 2.15 环境。使用 PYTHONPATH 加载，绕开上游 setup.py 的自动安装全套录音依赖行为。恢复项目本地 VAMP_PATH。
7. Basic Pitch 0.4.0：实际 ONNX 音符转录，输出音符与 MIDI；和弦是随后显式的规则估计，不能当成原模型直接识别了和弦。优先用于单乐器音频。
补充：MediaPipe Tasks Vision 0.10.22-rc.20250304 与官方 Hand Landmarker 模型，推理位于 Web Worker，模型和 WASM 均本地保存。摄像头请求 640×360、最多处理 30fps；采样用 requestVideoFrameCallback 跟随视频帧，推理未完成时跳过旧帧。扫弦轨迹使用 One Euro 自适应滤波：静止时压抖，速度升高时提高截止频率以控制拖尾；装饰骨架单独轻量平滑，不给扫弦触发额外加滤波延迟。技术依据参考 [MediaPipe Web 指南](https://developers.google.cn/edge/mediapipe/solutions/vision/hand_landmarker/web_js) 与 [OneEuroFilter](https://github.com/casiez/OneEuroFilter)，后者 GitHub 页面显示 262 Star / 20 Fork（2026-10-24 查看）；本项目只按算法自行实现滤波，不复制上游代码。MediaPipe 仓库为 37.4k Star / 6.2k Fork。目标帧率会受摄像头、浏览器和设备算力影响，尚未在用户设备上实测。

数据
曲库和分析任务保存在 data/library.sqlite3 与 data/jobs，默认不进 Git。
截至 2026-10-24，本机共 503 首，其中 497 首来自 Chord4 曲目页，162 首可对应到采集当日的“近30天热门/正在上升”榜单，49 首来自 2025/2026 华语年度热歌歌单；按标题去重后，至少 207 首有当前榜单或近两年热歌单来源。其余曲目来自卖唱歌单、经典曲单与词人作品歌单，作为常唱曲目补充。13 首来自榜单图谱的 OCR 和弦符号提取，含短和弦谱；曲目详情都保留榜单/原谱来源链接，并标记待核对。榜单随时间变化，这个数字是本地采集日期的来源快照，不代表官方实时排名。没有导入歌词或谱面图片。
曲谱导入只保存曲名、演唱者、和弦时间轴和来源，不保存歌词。和弦复杂度已压到最多 8 个大/小三和弦，并在 original_chords 保存来源和弦序列；时间轴按每个和弦四拍估算，OCR 曲目可能只识别出部分标签。所有自动曲谱仍需人工核对。导入内容留在本机个人曲库，不包含于代码提交或公网部署包。
可导入 ChordPro/JSON、手动编辑和弦和歌词、另存修正版、移调、导出 JSON/ChordPro。选曲后，弹唱谱在桌面端与摄像头、琴弦并排显示，手机端排在琴弦后；即使曲目暂无歌词，也会先显示可点击的和弦时间轴。摄像头左侧手势区的 1–6 和弦会按该曲常用时长更新，谱面点和弦也会切换同一指法。支持和弦在歌词上方、全屏看谱；专注模式保留触屏/键盘扫弦控制。ChordPro 中的 [C] 标记按原位置排版，纯歌词的和弦按时间轴均分到各行并标作草稿。自动曲库没有附歌词，可在“补充歌词”中粘贴你持有的歌词或导入 ChordPro。
ChordPro 无时间信息时，每个和弦暂按四拍估算，记录在曲谱来源中。
原始分析和 original_chords 保留；识别结果不会伪造置信度，未知值为 null。
目前歌词显示为用户导入文本，未实现自动逐字对齐。Chord4 页面说明内容供吉他爱好者学习；其曲谱页没有明确显示批量再发布许可，因此本地导入只供个人使用，不应随应用公开分发。每条曲目都保留来源页，方便回看和校对。

验证
evidence/analysis-smoke.json：三个真实引擎均完成 16 秒采样吉他 C-Am-F-G 控制样例。
tests/：弦位音高、移调、ChordPro 时间轴导入及手势触发防抖。
浏览器桌面发声链路、曲库读取和手机宽度适配已检查。摄像头权限和实际双手弹奏需要用户设备上验收；没有自动批准设备权限。

重建环境
Python 3.10；依赖锁定记录在 evidence/python-main.lock.txt 与 python-omnizart.lock.txt。
JavaScript 依赖由 package.json、pnpm-lock.yaml 锁定。
scripts/prepare_assets.py 下载固定 revision 的采样、数据库、许可证及适配后的 ChordMini 工具函数。
source-pins.json 记录上游参考与素材 revision；实际 npm/pip 安装版本以各锁定文件为准。
.runtime/vamp-plugin-sdk 和 .runtime/nnls-chroma 为项目本地编译来源，不修改系统插件目录。
上游源码与模型的许可证分别遵循各自授权，不用一个总许可证覆盖所有资源。

当前阶段
已看清原视频并按“摄像头主画面＋右侧控制栏＋底部和弦卡片”重建布局。
这是可运行的首版；音色偏好、真实手势稳定性与完整歌曲和弦准确性还需听感和人工核对。


原谱图库
========
“虫虫原谱”使用用户提供的 ccguitar-tabs-kb（固定提交 793e55ecf3a3d14c8f1ff2d1e2aff31258fa430e），索引收录 1,744 份曲谱、3,542 张 PNG 页面。应用通过本机 Git 仓库按需读取曲谱页，不将扫描图复制到前端资源中。该仓库 README 标注图片来自 ccguitar.cn 公开预览图；仓库中未发现 LICENSE 文件，因此此功能保持本机个人查看，不应将图像仓库或图像页随应用公开发布。扫描页目前只作查看，尚未转换成可编辑、可同步摄像头和弦区的结构化弹唱谱。未缓存页面需要本机 GitHub 凭证可用且网络可访问。


## Windows

Windows 开发、安装、启动与数据迁移见 [WINDOWS.md](WINDOWS.md)。
