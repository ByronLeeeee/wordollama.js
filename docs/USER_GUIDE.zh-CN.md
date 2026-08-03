# WordOllama.JS 用户指南

WordOllama.JS 首发支持 Windows x64 和 Apple Silicon Mac。Ollama 是可选外部依赖；
使用在线模型时不需要安装 Ollama。安装后 Desktop Bridge 随当前用户登录启动，Word
中的任务窗格不需要另开终端或 Vite。

## 3 分钟开始使用

1. 安装完成后完全退出 Word，再重新打开。
2. 在 Word 的 `WordOllama.JS` 功能区打开任意功能；第一次进入设置时会自动出现“首次使用向导”。
3. 向导会自动检查 Desktop Bridge 和安全配对。选择您已经使用的模型服务，填写 API Key
   （本机 Ollama 不需要），点击“读取模型”，选择一个模型并完成设置。
4. 在 Word 中选中一段文字并点击“翻译”验证，或打开 Agent 选择一个示例任务。

如果某一步失败，打开“设置 > 诊断修复”，点击“检查并修复”。它会重新建立安全配对、
检查当前模型和更新配置；仍无法解决时，点击“复制诊断报告”发给维护者。诊断报告不会包含
API Key。下面的证书、哈希和平台说明主要供发布者或需要手动核验离线安装包的用户参考。

## Windows 安装

1. 从正式下载页取得同一版本的安装器、SHA-256 和 WordOllama.JS 代码签名证书。
2. 核对文件哈希和证书指纹。自签名版本没有 SmartScreen 公共信誉；在确认来源后，
   由当前用户显式将仅含代码签名用途、不可签发其他证书的产品证书导入“受信任的
   发布者”。若 Windows 仍将其视为不受信任链，再将同一终端证书导入当前用户的
   “受信任的根证书颁发机构”。不要安装到本地计算机存储，也不要信任指纹不符的证书。
3. 运行 `WordOllama-Installer-<version>-win-x64.exe`。安装器只写入当前用户目录、
   当前用户 Office manifest 和登录启动项，不注册 COM 加载项。
4. 安装器会显示 localhost HTTPS 证书的用途、SHA-256 指纹和有效期。确认后才会把
   该证书加入当前用户信任库；拒绝则不会持久化证书或启动 Bridge。
5. 完全退出所有 Word 窗口并重新打开，在 `WordOllama.JS` 功能区打开设置，新增并
   激活至少一个模型。产品不会自动创建 Ollama 或 llama3.2 模型。

旧 COM/VSTO 版与 JS 版使用不同仓库、manifest 和设置目录，可以同时安装。

普通版本升级会复用尚有至少 30 天有效期、用途正确且凭据完整的 localhost 证书，
只替换 Bridge、前端和 manifest，不会重复修改证书信任。仅当证书缺失、损坏、临近
过期，或执行明确的安全维护轮换时，安装器才会再次显示证书确认；卸载会删除本产品
拥有的 localhost 证书和对应凭据。

## Apple Silicon Mac 安装

首期本地自签名包无法取得 Apple Developer ID 公共身份，因此不能完成 Apple 公证、
stapling，也不能承诺 Gatekeeper 无警告。发布证据会明确标记
`explicitUserTrustRequired: true`，不会把本地签名冒充为 Apple 已公证。

1. 核对 PKG 的 SHA-256、签名身份和随包公布的指纹。
2. 将发布者提供的应用签名证书和安装器签名证书显式导入当前用户 login Keychain，
   只对核对过的 WordOllama.JS 身份设置信任。
3. 在 Finder 中按住 Control 点击 PKG 并选择“打开”；若系统仍阻止，在“系统设置 >
   隐私与安全性”中仅为这一个已核验安装器选择“仍要打开”。不要全局关闭 Gatekeeper。
4. 安装完成后运行 `~/Applications/WordOllama.JS/Complete WordOllama.JS Setup.command`，
   查看并确认产品专用 localhost HTTPS 证书，再完全退出并重开 Word。

Mac 仅支持 Apple Silicon，不提供 Intel 构建。若以后改用 Developer ID，才可恢复
公证、stapling 和默认 Gatekeeper 评估流程。

## 模型与首次使用

- 新用户优先使用自动出现的“首次使用向导”；也可以随时点击设置窗口右上角的“使用向导”。
- 需要完整参数时，打开“设置 > 模型 > 新增模型”，选择提供商并读取模型（Ollama 使用其
  专用模型接口），选择模型并保存。一个提供商可以保存任意多个模型。
- 模型列表可切换、查看详情、修改或删除；没有激活模型时，AI 功能会要求先激活，
  不会静默回退到默认 Ollama。
- API Key 保存到 Windows Credential Manager 或 macOS Keychain，不写入普通设置 JSON。
- Ollama 由用户自行安装、升级和配置；WordOllama.JS 只检测及加载已存在的模型。

## 更新与回滚

“设置 > 更新”会读取 stable 索引。开始安装前会显示发布者、签名证书指纹和签名公钥
SHA-256；Bridge 还会核对 runtime、文件大小、SHA-256 和平台签名。任何失败都会删除
临时下载，不会启动安装器。

每次升级保留上一个 Bridge 版本，并原子切换 `current-version`。当上一版本完整可用时，
“设置 > 更新”会显示回滚按钮并要求二次确认；启动平台回滚入口后先完全退出 Word。
安装包也提供独立回滚入口；开发/离线包可运行：

```powershell
pwsh ./packaging/rollback-bridge.ps1 -InstallRoot <DesktopBridge 安装目录>
```

回滚只切换已验证且仍保留的上一版本，不下载未知文件。Ribbon 或 manifest 更新后必须
完全重启 Word，以清除 Office 命令缓存。

## 离线使用

- 桌面前端和 API 均由 localhost Bridge 托管，不依赖在线网页。
- Word 与文档交互所需的 `office.js` 必须按 Microsoft 的 Office Add-in 规范从官方
  CDN 引用。因此，普通 Microsoft 365 桌面版仍需能加载 Office 自身的运行库；本产品
  不把未经支持的 `office.js` 私有副本塞入安装包，也不承诺隔绝 Microsoft CDN 的冷启动。
- 已配置的 Ollama、本地 Word 工具、Skills、本地 MCP、隔离 Python/Node 工作区可离线
  使用；在线 Provider、网页读取和 Search MCP 会快速失败并保持其他本地功能可用。
- 离线前应提前安装所需 Python/Node runtime、Ollama 模型、Skills 和 MCP 依赖。
- Ollama 内存单独显示，不计入 Bridge 资源；可在“设置 > 诊断修复”按需刷新。

除上述 Office 宿主引导脚本外，任务窗格的 React/CSS/SVG、设置、Bridge API 和本地
功能均随安装包在 localhost 提供；构建门禁会拒绝新增的远程字体、图片、脚本或样式。

## 卸载

Windows 在“设置 > 应用 > 已安装的应用”中卸载 WordOllama.JS。卸载器停止本产品
Bridge、移除 Startup、JS manifest、版本目录和产品专用 localhost 证书/密钥；不会
删除 Ollama、模型、旧 COM 版或无关证书。

Mac 运行 `~/Applications/WordOllama.JS/Uninstall WordOllama.JS.command`。脚本移除
LaunchAgent、JS manifest、Bridge 文件和产品专用 localhost 项；发布者签名证书的
信任由用户在 Keychain Access 中单独撤销，避免卸载器扩大证书库写权限。
