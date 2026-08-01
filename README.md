# WordOllama.JS

WordOllama.JS 是 WordOllama 的 Windows/macOS 统一版。项目使用 React 19、
TypeScript、Vite 和 Office.js 实现 Word 界面，使用跨平台 .NET 8 Desktop Bridge
承载 Agent、Provider、MCP、Skills、本地工具和安全存储。

桌面发行采用本地自托管架构：Desktop Bridge 在
`https://localhost:37421` 同时提供 React 前端和本地 API，安装器负责注册
Office manifest 与当前用户登录自启。完成一次本地 HTTPS 信任配置后，最终用户
不需要运行 Vite、打开终端或手动启动 Bridge。

旧 COM/VSTO 版保留在公开仓库
[`wordollama-community`](https://github.com/ByronLeeeee/wordollama-community)。
本仓库只包含 JS 统一版，默认且唯一开发分支为 `main`。

## 目录

- `officejs/`：React 任务窗格、设置、Office.js 文档适配器和 manifest。
- `src/`：.NET 8 Core、Desktop Bridge、MCP、平台适配器和 Windows 安装器。
- `packaging/`：Add-in、Bridge、Windows EXE、macOS PKG、签名和更新脚本。
- `tools/`：统一回归、打包回归、平台密钥库和真实 Word 验收工具。
- `docs/`：迁移方案、UI 对照矩阵、安全说明和验收证据。
- `TODO.md`：尚未完成的工作及换设备后的接续顺序。

## 环境要求

- Node.js 24 或更新版本。
- .NET SDK 8。
- PowerShell 7（命令名为 `pwsh`）。
- Microsoft 365 Word。
- Windows 需要 WebView2；macOS 使用系统提供的 Office WebView。
- 使用 Ollama 时需另外安装并启动 Ollama。

正式打包还需要目标平台的签名环境。首期采用用户明确确认后安装到当前用户信任库的
自签名证书；该方案不会获得 SmartScreen 或 Apple 公证的公共信誉：

- Windows：Windows SDK `signtool.exe`；安装器负责产品专用证书的创建、固定和清理。
- macOS：本地自签名和显式 Keychain 信任；若未来需要无警告公共分发，仍需
  Developer ID Application、Developer ID Installer 和 Apple 公证凭据。

## 首次准备

```powershell
git clone https://github.com/ByronLeeeee/wordollama.js.git
cd wordollama.js

cd officejs/apps/addin
npm ci
npm run certs:install
cd ../../..
```

`npm run certs:install` 安装开发用 localhost HTTPS 证书。正式桌面包不使用开发
证书，生产证书流程见“打包后本机测试”以及 `TODO.md`。

## 开发启动

开发模式需要一个 Bridge 终端和一个 Vite 终端。只有开发时需要 Vite。

### 1. 注册开发 manifest

在实际运行 Word 的同一个用户账户执行：

```powershell
pwsh ./packaging/install-office-addin-dev.ps1
```

Windows 写入当前用户的 Office WEF Developer 登记；macOS 将 manifest 复制到
Word 容器的 `wef` 目录。它不会注册 COM/VSTO ProgId。

### 2. 启动 Desktop Bridge

终端 A：

```powershell
dotnet run --project ./src/WordOllama.DesktopBridge/WordOllama.DesktopBridge.csproj
```

开发 Bridge 默认监听 `http://127.0.0.1:37421`。受信任的开发前端会自动建立会话，
不需要在 Word 中复制配对码。手动配对接口只在 Development 环境保留给诊断回归，
不会出现在正式 Ribbon。

### 3. 启动 React 前端

终端 B：

```powershell
cd officejs/apps/addin
npm run dev
```

开发前端监听 `https://localhost:3000`。完全退出所有 Word 窗口后重新打开 Word，
进入 `WordOllama.JS` 功能区即可测试。

也可以在 Bridge 已运行时使用：

```powershell
cd officejs/apps/addin
npm run start:desktop
```

该命令由 Office 调试工具启动开发服务器和桌面 Word；如果出现端口占用，不要同时
运行 `npm run dev`。

### 4. 停止与移除开发旁加载

在两个终端按 `Ctrl+C` 停止 Bridge/Vite，然后执行：

```powershell
pwsh ./packaging/uninstall-office-addin-dev.ps1
```

再次完全退出并重启 Word。

## 测试

### 完整统一回归

```powershell
pwsh ./tools/unified-smoke-test.ps1 `
  -Configuration Release `
  -SkipManifestValidation
```

它覆盖 TypeScript、React bundle、i18n、36 个 Word 工具、四档宿主能力矩阵、
Agent、Provider、MCP、Skills、文档比较、加密恢复、OAuth PKCE、更新门禁和真实
Bridge 重启持久化。

如果当前网络可以访问 Microsoft manifest 验证服务，可去掉
`-SkipManifestValidation`。

### 发布包生命周期回归

```powershell
pwsh ./tools/bridge-package-smoke-test.ps1 -Configuration Release
```

它覆盖 Bridge ZIP 布局、本地 `wwwroot`、manifest、HTTPS 失败关闭、自启、回滚、
Windows 安装/卸载以及 macOS PKG 脚本结构。

在目标原生 CI 或具备两个正式 runtime 构建条件的机器上，还可以执行：

```powershell
pwsh ./tools/bridge-package-smoke-test.ps1 `
  -Configuration Release `
  -IncludeCrossBuilds
```

异平台 `CrossBuildOnly` 只验证编译，不生成可冒充正式包的 ZIP。

### 单独测试前端

```powershell
cd officejs/apps/addin
npm run build
npm run test:ui
npm run test:settings-i18n
npm run test:ribbon
npm run bundle
```

所有可用测试命令见 `officejs/apps/addin/package.json`。

## 构建桌面包

正式桌面版的前端和 API 使用同一个本地 origin：
`https://localhost:37421`。

### Windows 测试候选

版本名包含 `smoke` 或 `test` 时可生成未签名测试产物：

```powershell
pwsh ./packaging/package-unified-release.ps1 `
  -Runtime win-x64 `
  -Configuration Release `
  -Version desktop-smoke `
  -ManifestVersion 1.1.0.1 `
  -SkipManifestValidation
```

主要输出：

```text
artifacts/unified/addin/WordOllama.JS-Addin-desktop-smoke.zip
artifacts/unified/bridge/desktop-smoke-win-x64/
artifacts/unified/bridge/WordOllama-Bridge-desktop-smoke-win-x64.zip
artifacts/unified/unified-build-desktop-smoke-win-x64.json
```

Bridge 发布目录中应包含：

```text
WordOllama.DesktopBridge.exe
WordOllama.JS.xml
appsettings.json
wwwroot/index.html
wwwroot/settings.html
wwwroot/assets/
```

生成仅供 smoke 的未签名 Windows EXE：

```powershell
pwsh ./packaging/package-windows-installer.ps1 `
  -ArtifactRoot ./artifacts/unified/bridge `
  -Version desktop-smoke `
  -BuildUnsignedForTests
```

未签名开关不能用于普通正式版本。

### macOS 测试构建

必须在对应架构的 macOS 上生成正式 ZIP：

```powershell
pwsh ./packaging/package-unified-release.ps1 `
  -Runtime osx-arm64 `
  -Configuration Release `
  -Version desktop-smoke `
  -ManifestVersion 1.1.0.1 `
  -SkipManifestValidation
```

macOS 正式版仅支持 Apple Silicon（`osx-arm64`）。在 Windows 上只能加
`-CrossBuildOnly` 验证，不会生成正式 macOS ZIP。

## 正式签名与安装器

先生成统一包，然后在目标操作系统签名 Bridge：

```powershell
# Windows
pwsh ./packaging/sign-bridge-release.ps1 `
  -Runtime win-x64 `
  -ArtifactRoot ./artifacts/unified/bridge `
  -Version 1.0.0 `
  -WindowsCertificateThumbprint <thumbprint>

pwsh ./packaging/package-windows-installer.ps1 `
  -ArtifactRoot ./artifacts/unified/bridge `
  -Version 1.0.0 `
  -WindowsCertificateThumbprint <thumbprint> `
  -ExpectedPublisherSubject "CN=<exact publisher subject>"
```

```powershell
# macOS Apple Silicon
pwsh ./packaging/sign-bridge-release.ps1 `
  -Runtime osx-arm64 `
  -ArtifactRoot ./artifacts/unified/bridge `
  -Version 1.0.0 `
  -MacSigningIdentity "Developer ID Application: <name> (<TEAMID>)" `
  -MacNotaryProfile wordollama-notary `
  -MacNotarizationEvidencePath ./artifacts/unified/bridge/macos-notarization.json

pwsh ./packaging/package-macos-installer.ps1 `
  -Runtime osx-arm64 `
  -ArtifactRoot ./artifacts/unified/bridge `
  -Version 1.0.0 `
  -MacInstallerIdentity "Developer ID Installer: <name> (<TEAMID>)" `
  -MacNotaryProfile wordollama-notary `
  -BridgeNotarizationEvidencePath ./artifacts/unified/bridge/macos-notarization.json
```

完整签名、终审证据和更新索引流程见
[`packaging/README.zh-CN.md`](packaging/README.zh-CN.md)。

## 打包后本机测试

当前版本尚未自动修改操作系统证书信任库。安装 EXE/PKG 后，需要为当前用户准备一个
受信任的 PFX，SAN 必须同时包含 `localhost` 和 `127.0.0.1`：

```powershell
# Windows
pwsh ./packaging/provision-bridge-https.ps1 `
  -InstallRoot "$env:LOCALAPPDATA/WordOllama.JS/DesktopBridge" `
  -CertificatePath <trusted-localhost.pfx>
```

```powershell
# macOS
pwsh ./packaging/provision-bridge-https.ps1 `
  -InstallRoot "$HOME/Library/Application Support/WordOllama.JS/DesktopBridge" `
  -CertificatePath <trusted-localhost.pfx>
```

脚本验证证书、复制 PFX、将密码写入 Credential Manager/Keychain，并启动已注册的
用户级自启项。随后访问：

```text
https://localhost:37421/health
https://localhost:37421/index.html
```

两者正常后，完全退出并重新打开 Word。安装器携带的 manifest 已指向本地 Bridge，
不再需要 Vite 或在线前端。

## 当前验证状态

在提交 `97efd94` 上已通过：

- .NET Release 零警告构建。
- 完整 `unified-smoke-test.ps1`。
- 完整 `bridge-package-smoke-test.ps1`（Windows x64）。
- 打包后的 Bridge 实进程返回 `/health`、`index.html`、`settings.html` 和静态资源。
- Windows smoke EXE 安装/卸载，前端、manifest、launcher 和 Startup 载荷完整。
- Bridge 空闲实测约 65.6 MB 工作集、49.3 MB 私有内存，空闲 CPU 接近 0。

下一步和未完成事项见 [`TODO.md`](TODO.md)。
