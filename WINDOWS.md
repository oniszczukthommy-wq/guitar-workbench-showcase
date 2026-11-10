# Windows 开发与使用

目标：Windows 11 x64，Edge / Chrome。ARM64 Windows 与真实 GPU、摄像头、麦克风仍需独立验收。

## 首次安装

登录有权限的 GitHub 账号，克隆 **源码仓库**（名称不带 `-showcase`）。展示仓库只有介绍，不能运行。

```powershell
git clone https://github.com/oniszczukthommy-wq/guitar-workbench.git
cd guitar-workbench
# 先安装 Python 3.10 x64，并启用 Python Launcher（py）
powershell -NoProfile -ExecutionPolicy Bypass -File .\Windows.ps1 Setup
powershell -NoProfile -ExecutionPolicy Bypass -File .\Windows.ps1 Test
```

脚本只对这一次执行放行，不修改系统执行策略。安装命令失败会停止；既有 `.env` 不会被覆盖。

## 日常启动

双击 `Start-Windows.cmd`，或运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Windows.ps1 Start
```

在浏览器打开 http://127.0.0.1:8610/ 。终端按 Ctrl+C 停止。

Setup 安装弹奏、曲谱管理和录音所需的基础服务。摄像头和麦克风需本人在浏览器授权。可选音频识别引擎需另装对应库、模型及 Windows 版本 Vamp 插件；未安装时界面会报告不可用。不要用 evidence/python-main.lock.txt 当作 Windows 安装清单，其中包含 Mac 的 coremltools。原谱图库和个人曲库需私下迁移，不随展示仓库分发。

## 继续开发与迁移

- 在 Windows 用 VS Code 等编辑器打开源码目录，Python 解释器选择 `.venv\Scripts\python.exe`。
- 用 Git 同步源码；虚拟环境、node_modules、Mac 的二进制工具都要重新安装，不能直接复制。
- 迁移前停止旧服务，单独备份整个 `data/`、用户工程、上传素材与相关数据库附属文件。新机器恢复后保留原备份，再核对项目数量和附件。
- 密钥只在新机器本机填写；不要提交 `.env`、个人数据或模型权重。
- 后续更新执行 `git pull --ff-only`，重新 Setup 与 Test。若已有本机改动，先保存提交再更新。

## 验证边界

`.github/workflows/windows.yml` 在 Windows runner 上执行同一安装与测试入口。
自动测试不调用付费模型，不代表真实模型质量、GPU 加速或硬件输入已经验收。具体结果看仓库 Actions；首次运行失败时不得视为已支持。
