# Codex 中文状态栏

在 Windows 版 Codex 输入框上方显示上下文用量、已用 Token、5 小时剩余额度，以及本机今日／本周 Token。

**非官方社区小工具，与 OpenAI 无隶属关系。当前版本：1.6.1。**

![收起状态栏，模拟数据](assets/collapsed.png)

![展开详情，模拟数据](assets/expanded.png)

以上截图使用模拟聊天和模拟用量，不包含真实账户或聊天数据。

## 功能

- 收起时显示上下文已用百分比、已用／总容量／剩余 Token、5 小时剩余额度。
- 点击展开，查看本机今日／本周 Token、5 小时／周额度和重置时间、上下文分类估算。
- 跟随当前聊天切换，适配深浅主题和窄窗口。
- 启动后静默预读最近 128 个聊天；已缓存聊天切换时立即恢复数据。
- 一轮对话期间保留上次快照，工具调用、压缩和额度轮询不会打断显示；结束或中止后更新。
- 从原桌面、DeskBox 或开始菜单入口正常启动，无需改写原快捷方式；不预启动 Codex，不增加每次接入的授权弹窗。
- 包级启动桥只在点击后短暂运行；状态栏服务与 Codex 进程一同退出，聊天数据只在变化时传输。
- 监护进程检查后台刷新心跳；后台崩溃或连续 30 秒没有完成刷新时自动重启，避免进程仍在但状态栏不再接入。
- 剩余额度按红、黄、绿显示；缺失数据和过期数据不会冒充剩余 100%。

## 安装

适用于 **Windows 10/11 x64、Windows Store 版 Codex、Node.js 22+ 和可运行的 Codex CLI**。原生启动桥使用 Windows 自带的 .NET Framework 4.x。当前已在维护者本机的 Store 版 Codex 验证；ARM64、非 Store 安装、macOS、Linux 和终端状态栏不在此模式的支持范围内。

1. 安装 [Node.js](https://nodejs.org/) 和 [Codex CLI](https://learn.chatgpt.com/docs/cli)，确认在 PowerShell 中能运行 `node --version`、`codex --version`，并已登录 Codex。
2. 在 [Releases](https://github.com/Canvai1337/codex-context-panel-zh/releases) 下载 `codex-context-panel-zh-v1.6.1-windows.zip`，解压到任意文件夹。
3. 在解压后的文件夹打开 PowerShell，运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

4. 继续使用原有 Codex／ChatGPT 图标打开软件。若安装前已从普通入口打开且没有接入端口，保存工作后正常退出一次再打开即可；安装器不会强制结束聊天。

安装器通过 Windows 包级调试接口注册启动桥，不再接管原快捷方式。由 1.5.x 升级时，会将此前接管的链接按备份恢复为原始文件。登录和应用部署事件触发的维护任务只修复注册配置，不启动 Codex，不预读聊天。

安装目录：`%LOCALAPPDATA%\Programs\CodexContextPanel\1.6.1`。不需要管理员权限。安装和运行无需 `npm install`；源码安装会用 Windows 自带的 C# 编译器构建启动桥，发布 ZIP 已包含编译文件。隔离安装检查可使用 `-SkipIntegration`，该选项不注册系统配置，也不操作快捷方式。

## 数据说明与隐私

- **当前上下文 Token**：来自本机 Codex 日志最近一次请求的用量与模型窗口容量，并非整个聊天累计消耗，也不等于距离自动压缩的精确余量。
- **上下文分类**：按可观察文本的 UTF-8 字节权重估算，不能精确归因图像、加密推理或未记录的服务端内容。
- **5 小时／周额度**：通过已有 Codex CLI 的只读 `app-server` 连接获取账户共享额度。协议参考 [OpenAI App Server 文档](https://learn.chatgpt.com/docs/app-server)。
- **今日／本周 Token**：汇总本机 `sessions` 和 `archived_sessions` 的已记录请求，不是跨设备账单。当前采用 `America/Los_Angeles` 时区，周一开始一周；额度重置区间与自然周不同。
- 面板会读取本机聊天日志以计算上下文分类，不导出聊天正文，也不创建提示词副本；登录文件仅检查元数据，不解析凭据内容。不向第三方服务上传聊天或用量。
- 接入方式是在 Codex 渲染器中通过本机 CDP 临时加入状态栏。启动桥在初始线程执行前重建命令行参数块，补充仅监听本机的接入参数；不修改 WindowsApps 或 `app.asar`。本方案依赖 Windows x64 的进程参数布局、包级调试接口和 Codex 内部页面结构，不是官方插件接口，应用或系统更新仍可能需要适配。

详细口径、刷新频率和维护说明见 [使用说明](使用说明.md)。

## 卸载

在 PowerShell 中运行，然后正常重启 Codex：

```powershell
& "$env:LOCALAPPDATA\Programs\CodexContextPanel\1.6.1\Uninstall.ps1"
```

如需一并删除面板诊断文件，在命令末尾加 `-RemoveSettings`。卸载只停止本面板及其只读 app-server，不停止 Codex 应用或其他聊天。

请先运行卸载器再删除安装文件夹，以撤销 Windows 对启动桥的注册。需要修复入口配置时，可运行安装目录中的 `NativeStartup.ps1 -Action Repair`；撤销原生接入可用 `NativeStartup.ps1 -Action Disable`。

若安装目录被意外删除，独立恢复脚本仍保留在 `%LOCALAPPDATA%\CodexContextPanel\Recover-NativeStartup.ps1`。包级调试模式会改变 Windows 的应用挂起、自动终止及激活超时策略，具体机制见 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ipackagedebugsettings-enabledebugging)；本工具不承诺系统或 Codex 更新后的无条件兼容。

## 常见问题

**原入口打开后没有面板**：首次安装时已打开的普通 Codex 需正常退出一次；此后使用原图标即可。应用更新后可运行 `NativeStartup.ps1 -Action Repair`。

**额度显示“—”或“待刷新”**：检查 Codex CLI 登录和网络状态，等待下一次额度查询。面板不会自行猜测额度。

**面板没有出现**：确认正在查看本机聊天。1.6.1 会自动恢复崩溃或失去心跳的后台；可等待约 30～40 秒。若仍未出现，检查 `%LOCALAPPDATA%\CodexContextPanel` 的 `startup-error.log`、`daemon-error.log`、`service-error.log`、`service-status.json` 与 `status.json`。反馈问题时请先删除日志中的个人路径、聊天内容和账户信息。

## 开发与验证

需要 Node.js 22+ 和 Google Chrome（现有浏览器测试使用 Playwright 的 `chrome` channel）。

```powershell
npm ci
npm test
npm run preview
```

预览输出到仓库内的 `outputs/中文上下文面板-交互预览.html`，双击即可查看。测试覆盖日志增量读取、重复用量去重、额度状态、深浅主题、窄窗口及本机 CDP 桥接。桥接测试使用临时模拟日志与独立测试浏览器，不连接实际 Codex 聊天。

## 文件怎么放

| 文件 | 用途 |
| --- | --- |
| `widget.js` | 状态栏界面 |
| `data.mjs`、`usage.mjs`、`account.mjs` | 上下文、本机 Token 和账户额度 |
| `cdp.mjs`、`daemon.mjs` | 本机连接与后台刷新 |
| `runtime.mjs`、`service.mjs` | 端口发现、单实例监护、故障重启和有界诊断日志 |
| `Install.ps1`、`Start.ps1`、`Launch.vbs`、`Uninstall.ps1` | Windows 安装、启动、卸载 |
| `NativeStartup.ps1`、`.code/native/StartupBridge.cs` | 包级启动配置和原生启动桥 |
| `Shortcuts.ps1` | 旧版快捷方式的备份恢复兼容代码 |
| `tests/`、`fixture.mjs`、`build-preview.mjs` | 自动检查与模拟预览 |
| `assets/` | README 使用的模拟截图 |

源码和说明放在仓库，用户下载的安装 ZIP 放在 Releases。运行配置、日志、聊天记录、`node_modules/` 和预览输出由 `.gitignore` 排除。

## 许可证与来源

本项目采用 [MIT License](LICENSE)。参考项目和第三方说明见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。
