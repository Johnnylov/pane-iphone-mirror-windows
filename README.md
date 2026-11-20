# Pane 中文版

通过 USB 或 Wi-Fi 在 Windows 上显示 iPhone 的实时画面，用鼠标点按、长按、拖动和滑动，用电脑键盘输入。Pane 免费开源，视频和输入指令在手机与电脑之间传输。

**[下载 Windows 中文便携版（Pane.exe）](https://github.com/Johnnylov/pane-iphone-mirror-windows/releases/latest/download/Pane.exe)** · [查看发行说明](https://github.com/Johnnylov/pane-iphone-mirror-windows/releases/latest)

本仓库基于 [Pane 上游项目](https://github.com/teyboxv1/pane-iphone-mirror-windows) 1.0.2，将主界面、设备状态、操作提示和使用指南译为简体中文。上游演示见[操作动图](docs/pane.gif)。

## 首次有线投屏

1. 准备 64 位 Windows 10 或 11、Chrome 或 Microsoft Edge，以及一根支持数据传输的 USB 线。安装 Microsoft Store 中的 [Apple 设备](https://apps.microsoft.com/detail/9np83lwlpz9k) 或 iTunes，以便 Windows 识别 iPhone。
2. **实时画面需要 iOS 或 iPadOS 27 及以上版本**。在手机的「设置 → 隐私与安全性 → 开发者模式」中开启该选项。按提示重启，解锁并确认。
3. 用数据线连接手机和电脑，解锁手机，点按「信任」。打开中文版 `Pane.exe`，选择「数据线」，点击「开始投屏」。首次连接可能需要下载并挂载开发者映像，请保持手机解锁。

便携版已包含 Python，手机端无需安装 App 或越狱。可执行文件未经代码签名，Windows SmartScreen 可能提示未知发布者。可以在发行页校验 SHA-256，也可以按下方步骤自行构建。

## Wi-Fi 投屏

保持数据线连接，点击「设置 Wi-Fi」完成首次配对。然后拔下数据线，让手机保持解锁，确保电脑和手机连接到同一专用网络，再选择「Wi-Fi」并点击「开始投屏」。VPN 或路由器的无线客户端隔离可能会影响设备发现。

## 操作

| 电脑上的操作 | iPhone 上的效果 |
| --- | --- |
| 单击、按住、拖动 | 点按、长按、滑动 |
| 在手机画面上向下 / 向上滚动鼠标滚轮 | 向下 / 向上浏览内容，相当于手指向上 / 向下滑动。触控板双指纵向滚动也可使用 |
| 右键，或从画面底边上滑 | 返回主屏幕 |
| 从底边上滑，稍停再松开 | 打开 App 切换器 |
| 键盘输入 | 输入到手机当前选中的文本框。可用「键盘输入到 iPhone」开关暂停转发 |
| Ctrl+C / V / X / A / Z | 复制、粘贴、剪切、全选、撤销 |
| 点击手机边框按键 | 锁屏、调节音量、静音 |

界面还提供通知中心、控制中心、Siri、缩放、旋转、紧凑窗口和全屏操控。按 Esc 可退出全屏。

## 黑屏时怎么处理

- **先确认系统版本。** 根据上游说明，iOS 26 及更早版本可能连接成功，甚至能接收输入，但不会传回实时画面。
- 若系统符合要求，请保持手机解锁，确认已信任电脑并开启开发者模式。如果相机、语音备忘录或其他使用麦克风的 App 在前台，请先退出，再点击「重启投屏」。
- 若 Windows 无法识别手机，请检查 Apple USB 驱动及数据线。若仅 Wi-Fi 发现失败，可先切回「数据线」。

## 从源码运行或打包

在装有 Git 和 Python 的 Windows 电脑上运行以下命令。本中文版使用 Python 3.12 构建。

```powershell
git clone https://github.com/Johnnylov/pane-iphone-mirror-windows.git
cd pane-iphone-mirror-windows
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m handset.server
```

在 Chrome 或 Edge 中打开 <http://127.0.0.1:8765>。从源码打包时，在同一环境内执行以下命令，产物位于 `dist\Pane.exe`。

```powershell
python -m pip install pyinstaller pillow
.\packaging\build.ps1
```

Pane 通过 [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) 建立设备通道，在浏览器中解码 HEVC 视频，并以 HID 事件回传触控与按键。本地服务监听 `127.0.0.1`。可选的 AirPlay 音频接收器需单独提供 Shairport4w，详见[组件说明](handset/bin/NOTICE.txt)。

## 反馈与许可

上游功能问题可查阅 [Pane 的 Issues](https://github.com/teyboxv1/pane-iphone-mirror-windows/issues)。原项目版权归 Pane 贡献者所有，代码按 [GNU GPL v3.0](LICENSE) 发布。iPhone、iPad、iOS 和 iPadOS 为 Apple Inc. 的商标，本项目与 Apple 无隶属或背书关系。
