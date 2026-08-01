# Windows/macOS 发布骨架

桌面发行默认由 Desktop Bridge 在 `https://localhost:37421` 同时托管
React 前端与本地 API。Bridge 以当前用户身份登录自启；用户安装后只需打开 Word，
不需要运行 Vite、命令行服务或访问在线前端站点。

`publish-bridge.ps1` 使用同一套 .NET 8 Bridge 生成三种目标，但正式归档必须在目标操作系统执行，以保留平台元数据并进入对应签名链：

```powershell
# 在 Windows 发布机执行；桌面前端与 API 使用本地 HTTPS
pwsh ./packaging/publish-bridge.ps1 -Runtime win-x64 `
  -AddinOrigin https://localhost:37421 `
  -AddinStaticRoot ./artifacts/addin/0.1.0 `
  -UpdateIndexUrl https://downloads.wordollama.com/update-index-0.1.0.json `
  -ExpectedUpdatePublisherSubject "CN=Your Exact Publisher Subject"

# 在 macOS 发布机执行
pwsh ./packaging/publish-bridge.ps1 -Runtime osx-arm64 `
  -AddinOrigin https://localhost:37421 `
  -AddinStaticRoot ./artifacts/addin/0.1.0 `
  -UpdateIndexUrl https://downloads.wordollama.com/update-index-0.1.0.json `
  -ExpectedUpdatePublisherSubject "Developer ID Installer: Example (TEAMID)"
```

非目标平台 CI 只能显式使用 `-CrossBuildOnly` 验证编译和生产配置，不会生成可误传为正式包的 ZIP，例如在 Windows 执行 `pwsh ./packaging/publish-bridge.ps1 -Runtime osx-arm64 -CrossBuildOnly`。

`AddinOrigin` 接受 HTTPS origin；使用回环 origin 时必须同时传入
`AddinStaticRoot`。发布脚本会把任务窗格复制到 Bridge 的 `wwwroot`，
把生产 manifest 作为 `WordOllama.JS.xml` 放入安装载荷，并将 origin 写入
Bridge 的 CORS allowlist。`UpdateIndexUrl` 留空表示不启用检查更新；非空时只接受非回环 HTTPS URL，并强制同时提供 `ExpectedUpdatePublisherSubject`。该发布者固定值由上一版签名安装器部署，不能只相信新下载的更新索引。

推荐通过统一入口同时构建加载项和当前平台 Bridge，避免手工传入两个不同域名：

```powershell
pwsh ./packaging/package-unified-release.ps1 -Runtime win-x64 `
  -Version 0.1.0 -ManifestVersion 1.2.0.0 `
  -BaseUrl https://localhost:37421 `
  -BridgeUrl https://localhost:37421 `
  -UpdateIndexUrl https://downloads.wordollama.com/update-index-0.1.0.json `
  -ExpectedUpdatePublisherSubject "CN=Your Exact Publisher Subject"
```

正式目标平台构建会生成 `unified-build-<version>-<runtime>.json`，明确标记 `releaseReady: false`，记录 Add-in/Bridge 未签名归档的 SHA-256 与大小，并列出签名、PFX 配置和真实 Word 验收三个后续门槛。Add-in 在终审时必须仍与该记录逐字节一致；Bridge 因平台签名和签后重建 ZIP 必然允许一次受控哈希转换，但终审会重新验证当前归档内所有 PE 的 Authenticode，或 macOS codesign、Gatekeeper 与 Developer ID Authority，并在最终描述中同时固化源描述文件哈希、未签名哈希和签名后哈希。其他替换仍会被拒绝，该描述文件也不能被误当成已签名发布证明。`-CrossBuildOnly` 只验证编译，不生成 Bridge ZIP 或发布描述文件。

`.github/workflows/officejs-unified-ci.yml` 在 Windows x64 和 macOS arm64 两个目标原生 runner 上执行包 smoke 和统一构建，并上传保留 7 天的 unsigned evidence。工作流采用 GitHub 的 `macos-15` Apple Silicon runner；项目不构建或发布 Intel Mac 版本。参考 [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。CI 产物仍明确为 unsigned，工作流不会在缺少发布凭据时自动创建 Release。

每个目标平台 runner 还会直接启动其自包含 Bridge 可执行文件，连接受控本地 Provider 和 stdio MCP fixture，并执行配对鉴权、设置持久化及 Agent 加密恢复的跨进程重启回归。macOS arm64 runner 会真实经过 Keychain，而不是用 Windows 结果代替 Mac 平台证据；它还会为 `smoke` 版本原生执行 unsigned `pkgbuild/productbuild`，用 `pkgutil --expand-full` 展开 PKG，再由系统 `sh -n`/`plutil` 检查 launcher、postinstall、双语卸载器、LaunchAgent 和可执行权限。`-BuildUnsignedForTests` 对非 `smoke`/`test` 版本无效，生产路径仍强制 Developer ID Installer、公证、stapling 和 Gatekeeper。这些 CI 结果仍不等同于 Word 宿主、正式签名或 Apple 公证证据。

需要正式签名候选包时，手动运行 `.github/workflows/officejs-signed-candidate.yml`。Windows runner 从 `WINDOWS_SIGNING_PFX_BASE64` / `WINDOWS_SIGNING_PFX_PASSWORD` 导入临时证书，签署 Bridge PE/ZIP 后继续生成并签署用户级 EXE；macOS runner 从 `MACOS_SIGNING_P12_BASE64` / `MACOS_SIGNING_P12_PASSWORD` 导入同时包含 Application/Installer 身份的临时 Keychain，分别使用 `MACOS_SIGNING_IDENTITY` 和 `MACOS_INSTALLER_IDENTITY`，并用 `APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_PASSWORD` 创建一次性 notarytool profile。临时 Keychain 路径会同时传给凭据存储、公证 ZIP 和公证 PKG。工作流会签名/公证 Bridge 更新 ZIP，继续构建、签名、公证、staple 和 Gatekeeper 验证用户级 `.pkg`，再启动候选 Bridge 执行实时 API 回归；最后删除临时凭据，只上传保留 14 天的 `signed-candidate` 和原始 unsigned descriptor。该候选仍为 `releaseReady: false`；必须在目标 Word 中生成同版本宿主证据并运行终审，不能直接作为 GA 发布。

没有 Developer ID 时，可在 Apple Silicon Mac 上为 `sign-bridge-release.ps1` 传入
`-LocalSelfSignedMacRelease`，并为 `package-macos-installer.ps1` 传入
`-LocalSelfSignedRelease` 与 `-BridgeLocalSignatureEvidencePath`。证据会明确记录
`notarized: false` 和 `explicitUserTrustRequired: true`，不会调用或伪造
notarization/stapling。终审时必须传 `-MacLocalSelfSignedRelease`；用户须按
`docs/USER_GUIDE.zh-CN.md` 显式信任，不能全局关闭 Gatekeeper。

发布前可在当前 Windows 或 macOS 主机运行可重复归档回归；`-IncludeCrossBuilds` 还会验证另外两个 runtime 的编译、平台配置和“不生成 ZIP”约束：

```powershell
pwsh ./tools/bridge-package-smoke-test.ps1 -Configuration Release -IncludeCrossBuilds
```

签名和公证使用同一入口，但必须在对应操作系统和签名环境中执行：

```powershell
pwsh ./packaging/sign-bridge-release.ps1 -Runtime win-x64 -ArtifactRoot ./artifacts/bridge `
  -Version 0.1.0 -WindowsCertificateThumbprint <thumbprint>
pwsh ./packaging/sign-bridge-release.ps1 -Runtime osx-arm64 -ArtifactRoot ./artifacts/bridge `
  -Version 0.1.0 -MacSigningIdentity "Developer ID Application: Example (TEAMID)" `
  -MacNotaryProfile wordollama-notary `
  -MacNotarizationEvidencePath ./artifacts/bridge/macos-arm64-notarization.json
```

`-DryRun` 只打印将执行的签名命令；未提供证书/签名身份时，正式运行会失败，不会把未签名产物标记为发布版本。Windows 每个 PE 文件签名后还会立即执行 Authenticode policy verification，并强制使用 CA 签发的代码签名叶证书及 RFC 3161 时间戳；只有版本名含 `smoke`/`test` 且显式传入对应测试开关时才允许自签名或无时间戳测试签名，安装与正式终审仍会拒绝该产物。macOS 生产签名会先逐个签署 .NET 自包含发布中的原生 `.dylib`，最后签署并深度校验 Bridge 主程序；同时强制 `Developer ID Application:` 身份、notary profile 和严格 codesign 校验，仅 smoke/test 可显式使用 `-AllowUnnotarizedMacTestSignature`。macOS 正式归档强制使用 `ditto`，确保保留可执行权限和资源元数据。公证入口要求 `notarytool --output-format json --wait` 返回 `Accepted`，随后下载并校验公证日志，生成包含 submission ID、签名 Authority、Team ID、Hardened Runtime、安全时间戳、ZIP SHA-256 和日志 SHA-256 的可移植证据文件。ZIP 可以提交 Apple 公证，但不能直接 staple；Bridge 是裸命令行程序，也不能附加票据，因此终审使用该证据与 `spctl` 在线 Gatekeeper 评估共同验收，不能把未执行的 stapling 写成通过。

签署 Windows Bridge ZIP 后生成当前用户 EXE 安装器：

```powershell
pwsh ./packaging/package-windows-installer.ps1 `
  -ArtifactRoot ./artifacts/bridge -Version 0.1.0 `
  -WindowsCertificateThumbprint <thumbprint> `
  -ExpectedPublisherSubject "CN=Your Exact Publisher Subject"
```

安装器是 .NET 8 自包含单文件 WinExe，内嵌已签名 Bridge ZIP 及 SHA-256 元数据；
默认安装到 `%LOCALAPPDATA%\WordOllama.JS\DesktopBridge`，维护版本指针，写入当前用户
“应用和功能”卸载登记，并用隐藏 VBS 启动器注册当前用户 Startup。重复安装同版本是幂等的，
卸载只停止和删除该安装根目录内的 Bridge。可信 PFX 尚未配置时 launcher 安静退出；
`provision-bridge-https.ps1` 完成 Credential Manager 写入后会自动启动。生产安装器自身必须
通过 CA 签发证书 Authenticode、RFC 3161 时间戳和 publisher policy verification，并生成
与签名后 Bridge ZIP 哈希绑定的证据 JSON；无签名构建开关只允许 `smoke`/`test` 回归。

签名并公证 Bridge ZIP 后，使用独立的 Developer ID Installer 身份生成用户安装包：

```powershell
pwsh ./packaging/package-macos-installer.ps1 `
  -Runtime osx-arm64 -ArtifactRoot ./artifacts/bridge -Version 0.1.0 `
  -MacInstallerIdentity "Developer ID Installer: Example (TEAMID)" `
  -MacNotaryProfile wordollama-notary `
  -BridgeNotarizationEvidencePath ./artifacts/bridge/macos-arm64-notarization.json
```

该 `.pkg` 只允许安装到当前用户 Home，不要求管理员权限；载荷位于
`~/Library/Application Support/WordOllama.JS/DesktopBridge`，并安装用户级
LaunchAgent。安装器维护 `current-version`/`current.json`，保留旧版本目录供回滚。
首次安装会在 `~/Applications/WordOllama.JS` 放置
`Complete WordOllama.JS Setup.command`。用户双击并明确确认后，它才会创建仅包含
`localhost`、`127.0.0.1` 和 `::1` SAN 的独立证书，并调用 macOS `security`
写入当前用户 Trust Settings；系统仍可显示自己的授权提示，脚本不会绕过。随后密码通过
Bridge 标准输入写入 Keychain、LaunchAgent 启动，并同时检查 `/health` 与
`/index.html`。取消或系统拒绝授权时 Bridge 不会启动。已经完成该设置的升级安装会复用
证书，自动重启并执行同样的健康检查。PKG 使用
`productbuild` 和 Developer ID Installer 签名，要求 Apple 公证 Accepted、日志无错误、
stapler staple/validate 和 `spctl --type install` 全部通过，并输出独立安装器证据 JSON。
PKG 还会在 `~/Applications/WordOllama.JS` 安装可双击的
`Uninstall WordOllama.JS Desktop Bridge.command`，使用独立中英文消息资源且不依赖
PowerShell。卸载器只接受固定的用户 Bridge/LaunchAgent 路径，先 bootout LaunchAgent，
只终止当前版本目录内的 Bridge，再删除专用 HTTPS Keychain 项、Bridge 文件和
`com.wordollama.desktopbridge` 安装收据；Provider、MCP、API Key 与用户设置默认保留。

桌面 Office.js 静态包使用：

```powershell
pwsh ./packaging/package-addin.ps1 `
  -BaseUrl https://localhost:37421 `
  -BridgeUrl https://localhost:37421
```

`BaseUrl` 接受无凭据、路径、查询或片段的 HTTPS origin；桌面回环模式要求
`BaseUrl` 与 `BridgeUrl` 完全相同。脚本会在 Vite 构建时注入 Bridge 地址，
检查生产 JavaScript 不含开发 HTTP 地址，替换 manifest 地址并生成
`WordOllama.JS-Addin-<version>.zip`。统一打包随后把静态文件和 manifest 合并进
Bridge/安装器。任何一步失败都不会继续生成新的发布 ZIP。

开发机旁加载与生产部署是两条不同路径。Windows/macOS 的本地开发旁加载可使用：

```powershell
pwsh ./packaging/install-office-addin-dev.ps1
pwsh ./packaging/uninstall-office-addin-dev.ps1
```

Windows 安装脚本在 `HKCU\SOFTWARE\Microsoft\Office\16.0\Wef\Developer` 创建“值名为 manifest GUID、数据为 manifest 绝对路径”的字符串值；不会创建或修改 `Office\Word\Addins\<ProgId>`，因此可与现有 VSTO 版共存。macOS 安装脚本只管理 Word 容器 `Data/Documents/wef/WordOllama.JS.xml`。这两种方式仅用于开发/测试；正式组织部署应在 Microsoft 365 管理中心的 Integrated apps 上传生产 manifest，公共分发则走 Microsoft Marketplace。

Windows 脚本必须由实际运行 Word 的同一用户执行；不要用切换到另一账户的管理员上下文写 HKCU，否则目标 Word 用户看不到该注册。

Bridge 发布脚本按 runtime 将 `production.appsettings.windows.template.json` 或 `production.appsettings.macos.template.json` 复制为产物中的活动 `appsettings.json`。必须由安装器把 PFX 放到模板路径，并通过 `WORDOLLAMA_HTTPS_CERTIFICATE_PASSWORD` 或受保护配置提供密码；证书缺失时发布版会拒绝启动。

安装签名 Bridge ZIP 后，用同一用户执行 HTTPS 配置。脚本会验证 PFX 包含私钥、有效期、SAN 同时匹配 `localhost` 和 `127.0.0.1`，并验证当前用户信任链；随后把 PFX 复制到安装根目录，通过 Bridge 的标准输入专用命令将密码写入 Windows Credential Manager 或 macOS Keychain。密码不会进入命令行、日志或 `appsettings.json`：

```powershell
pwsh ./packaging/provision-bridge-https.ps1 `
  -InstallRoot <install-root> -CertificatePath <trusted-localhost.pfx>
```

`-SkipTrustValidation -SkipSecretStoreWrite` 只供仓库内临时自签名 smoke 使用，不能用于正式安装。Bridge 启动时按“平台密钥库、进程环境变量、配置文件”的顺序解析 PFX 密码；正式配置文件必须保持空密码。

正式配置时应传入 `-EvidencePath`。脚本会在写入后调用 Bridge 的只显式返回“存在/不存在”的校验命令，确认密码确实能从 Windows Credential Manager 或 macOS Keychain 读回；只有证书链受信任、SAN 完整、密钥库读回成功且 JSON 密码为空时才会生成 HTTPS 证据。任何 `Skip*` 开关与 `-EvidencePath` 同时使用都会失败。

加载项发布时用 `package-addin.ps1 -Version <产物版本> -ManifestVersion <四段递增版本>`；`ManifestVersion` 必须在每次 Ribbon/manifest 发布时单调递增，否则已经侧载或集中部署的 Word 可能继续使用旧命令缓存。

Bridge 更新流程：两个受支持 runtime 都完成终审后，用 `create-update-index.ps1` 读取对应的 `releaseReady: true` 描述文件并生成 SHA-256 索引，再由签名/分发系统发布；脚本会逐项核对版本、runtime、归档路径、哈希、大小和安装器发布者，正式模式缺少任一 runtime 或描述文件都会拒绝。`-AllowUnsignedForTests` 只供仓库 smoke 使用。设置页的一键更新会由已配对 Bridge 重新读取索引，只接受当前 runtime 的 EXE/PKG；下载时限制 512 MB、逐字节核对大小与 SHA-256，并同时要求索引发布者、上一版 Bridge 配置中固定的发布者和平台签名发布者完全一致。Windows 还要求 CA 链与 RFC 3161 时间戳，macOS 同时执行 `pkgutil --check-signature` 和安装类 Gatekeeper 评估；任何失败都会删除下载文件且不会启动。旧索引或 ZIP 仍仅提供手动兼容下载。

离线/兼容 ZIP 安装时调用 `install-bridge-update.ps1` 做哈希校验、版本目录切换和保留旧版本，随后运行 `provision-bridge-https.ps1` 写入该安装根目录的证书路径，异常时用 `rollback-bridge.ps1` 原子回退。`ExpectedSha256` 是强制参数，不能用空值跳过完整性校验：

```powershell
pwsh ./packaging/install-bridge-update.ps1 `
  -ArchivePath ./WordOllama-Bridge-0.1.0-win-x64.zip `
  -InstallRoot "$env:LOCALAPPDATA/WordOllama.JS/DesktopBridge" `
  -Version 0.1.0 -ExpectedSha256 <update-index 中的 sha256> `
  -RequirePlatformSignature -ExpectedPublisherSubject "<证书 Subject 或 Developer ID Authority>"
```

Windows 与 macOS 的新 ZIP 都把可执行文件、`appsettings.json` 和 `Skills/` 放在归档根目录；安装器也会把旧版 macOS `--keepParent` 产生的单层目录规范化。多可执行文件、深层/混合载荷或缺少配置的归档会被拒绝。正式安装必须传 `-RequirePlatformSignature`：Windows 要求有效 Authenticode 并可固定证书 Subject；macOS 要求 codesign 与 Gatekeeper 均通过，并可固定 Developer ID Authority。省略该开关只用于仓库内无签名 smoke，不能作为生产安装命令。

安装或回滚会在安装根目录原子更新 `current-version`；稳定 launcher 每次启动都读取该指针，因此不用在升级后重写登录启动项。Bridge 自身还有按用户单实例锁，重复启动不会产生两个监听进程。安装器完成证书和平台密钥库配置后，注册用户级登录自启动：

```powershell
pwsh ./packaging/register-bridge-autostart.ps1 -InstallRoot <install-root>
```

Windows 会创建 Startup `.lnk` 和安装根目录下的 `start-bridge.cmd`；macOS 会创建 `~/Library/LaunchAgents/com.wordollama.desktopbridge.plist` 和 `start-bridge`。两者都不要求系统级服务权限。卸载前执行：

```powershell
pwsh ./packaging/unregister-bridge-autostart.ps1 -InstallRoot <install-root>
```

`-RegistrationRoot` 与 `-SkipActivation`/`-SkipDeactivation` 仅用于安装器测试和离线制作；正式安装使用默认用户级目录并立即启动。

输出 ZIP 只是可复现的构建产物，不代表已经签名。正式发布前必须：

- Windows 使用受信任证书签名安装器/可执行文件；打包流程同时导出受证据哈希保护的
  `.publisher.cer`，由用户核对后显式加入当前用户信任，再把 Bridge 配置为回环 HTTPS；
- macOS 使用 Developer ID Application/Installer 双签名和公证，或明确选择本地自签名模式并保留显式用户信任证据；
- 将模型 API Key 放入平台密钥库，不把密钥写入 `appsettings.json`；
- Bridge 已接入可读写平台密钥库：Windows 使用 Credential Manager 的 `WordOllama.JS/<name>`，macOS 使用当前账户 Keychain generic password 的同名 service；新命名空间缺失时会兼容读取并复制早期 Bridge 的 `WordOllama/<name>`，无法访问平台密钥库时才回退到 `WORDOLLAMA_OPENAI_API_KEY`、`WORDOLLAMA_ANTHROPIC_API_KEY`、`WORDOLLAMA_GEMINI_API_KEY` 或通用环境变量。卸载只删除 JS 版专用 HTTPS 项，不触及旧命名空间。
- 通过 Office 管理中心或受信任目录部署 `officejs/apps/addin/manifest.xml`；
- 发布前运行 `tools/unified-smoke-test.ps1 -Configuration Release`，再在 Windows Word、Mac Word 和 Word 网页版分别执行 Host 回归矩阵。

目标原生 CI 还会运行 `tools/platform-secret-store-smoke`，以随机唯一键验证
Credential Manager/Keychain 的写入、精确读回和删除，并在 `finally` 清理。该工具必须显式传入
`--allow-user-vault-test`，不应在含有真实同名测试键的共享账户中运行。

签名、HTTPS 和宿主测试全部完成后，使用 `finalize-unified-release.ps1` 生成唯一允许标记 `releaseReady: true` 的终审描述文件。该命令必须在产物目标系统执行，会重新解包并校验所有 Windows PE 的 Authenticode 发布者，或校验 macOS codesign、Gatekeeper 和 Developer ID Authority；同时要求目标版本生成后的 HTTPS 证据、36/36 工具报告、1,000/5,000 段报告、修订报告，以及复杂合同、双客户端共同编辑、16 个独立任务窗格、设置 Office Dialog 和中英文/明暗主题/窄宽窗格补充报告：

```powershell
pwsh ./packaging/finalize-unified-release.ps1 `
  -BuildDescriptorPath ./artifacts/unified/unified-build-1.2.3-win-x64.json `
  -HttpsEvidencePath ./evidence/windows-https.json `
  -GoldenReportPath ./evidence/windows-golden.json `
  -LongDocumentReportPath ./evidence/windows-long.json `
  -RevisionReportPath ./evidence/windows-revisions.json `
  -SupplementalHostReportPath ./evidence/windows-supplemental.json `
  -ExpectedPublisherSubject "CN=Your Exact Publisher Subject"
```

Developer ID 模式的 macOS 终审还必须传入签名阶段产生的
`-MacNotarizationEvidencePath ./artifacts/bridge/macos-arm64-notarization.json`、
`-MacInstallerEvidencePath ./artifacts/bridge/WordOllama-Installer-1.2.3-osx-arm64.installer.json`
和 `-ExpectedMacInstallerPublisherSubject "Developer ID Installer: Example (TEAMID)"`。
终审会复核 submission ID、`Accepted` 状态、公证日志哈希、Application Authority、
Hardened Runtime、安全时间戳、签名后 ZIP 哈希，以及 PKG 的 Developer ID Installer、
stapled ticket 和安装类 Gatekeeper 评估；证据不能在不同版本或架构之间复用。
本地自签名模式改传 `*.local-signature.json`、本地安装器证据、两个精确签名身份和
`-MacLocalSelfSignedRelease`；该模式不会要求或生成 Apple 公证证据。

Windows 终审必须传入
`-WindowsInstallerEvidencePath ./artifacts/bridge/WordOllama-Installer-1.2.3-win-x64.installer.json`；
终审会重新核对 EXE 哈希/大小、Bridge ZIP 哈希、精确发布者、签名证书指纹及 RFC 3161
时间戳证书指纹。最终生产分发索引要求两个受支持 runtime 都包含经过终审的用户安装器；
更新页优先提供 `installers` 中当前平台的用户安装器，仅对旧索引回退 Bridge ZIP。

补充宿主验收使用两阶段采集器，避免手工复制模板时写错版本、时间戳、runtime
或合同哈希。开始真实 Word 验收前运行：

```powershell
pwsh ./tools/record-word-host-supplemental.ps1 -Mode Start `
  -BuildDescriptorPath ./artifacts/unified/unified-build-1.2.3-osx-arm64.json `
  -WordVersion "16.99.12345" -DisplayLanguage zh-CN `
  -OriginalDocumentPath ./fixtures/contract-original.docx `
  -RevisedDocumentPath ./fixtures/contract-revised.docx `
  -SharedDocumentId your-shared-document-id `
  -SecondClientPlatform Web -SecondClientVersion "2026.07" `
  -OutputPath ./evidence/macos-supplemental.json
```

脚本会锁定 unsigned 构建描述文件及两份合同的 SHA-256，并生成全部待验证项。
完成复杂合同、双客户端共同编辑、16 个独立任务窗格、设置 Office Dialog，以及
明暗主题 × 中英文 × 窄宽窗格的 8 个组合后，逐项确认并记录实际修订数量：

```powershell
pwsh ./tools/record-word-host-supplemental.ps1 -Mode Complete `
  -ReportPath ./evidence/macos-supplemental.json -AppliedRevisionCount 3 `
  -ConfirmComplexContractComparison `
  -ConfirmSelectedDifferencesAppliedAsRevisions `
  -ConfirmConcurrentEditRelocation -ConfirmStaleWriteRejected `
  -ConfirmIndependentTaskPanes -ConfirmSettingsOfficeDialog `
  -ConfirmAppearanceMatrix
```

完成阶段会重新验证构建描述文件和合同未被替换，再调用
`validate-word-host-supplemental.ps1`。缺少任一显式确认、旧版本、早于构建时间、
缺少或重复用例、匿名客户端或被替换的输入都会被拒绝。原始模板仍保留用于查看
schema，但不再建议手工填写；不能通过修改 unsigned descriptor 绕过。

两个目标系统的终审描述文件收齐后才能创建生产更新索引：

```powershell
pwsh ./packaging/create-update-index.ps1 `
  -ArtifactRoot ./artifacts/unified `
  -Version 1.2.3 `
  -DownloadBaseUrl https://updates.example.com/wordollama `
  -VerifiedReleaseDescriptorPaths @(
    "./artifacts/unified/unified-release-1.2.3-win-x64.json"
    "./artifacts/unified/unified-release-1.2.3-osx-arm64.json"
  )
```

默认 HTTP 仅用于本地开发/测试；发布配置必须通过 Kestrel 证书配置切换到 HTTPS，并限制允许的 Add-in origin。

Ollama 是完全独立的外部依赖。安装器与 Bridge 不安装、不更新、不配置 Ollama，
也不迁移或删除模型目录；设置页只检测服务、读取模型并在不可用时提供官方安装指引。
监听地址、模型目录和运行参数由用户在 Ollama 中自行维护。
