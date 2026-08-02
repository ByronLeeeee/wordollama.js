# WordOllama.JS TODO

本文记录换设备后需要继续的工作。仓库为
`https://github.com/ByronLeeeee/wordollama.js.git`，只使用 `main` 分支。

## 接续起点

换设备后先执行：

```powershell
git clone https://github.com/ByronLeeeee/wordollama.js.git
cd wordollama.js
git status

cd officejs/apps/addin
npm ci
cd ../../..

pwsh ./tools/unified-smoke-test.ps1 `
  -Configuration Release `
  -SkipManifestValidation
```

当前接续重点：设置 UI 已统一为居中单列布局，小窗口使用折叠导航；模型管理、
MCP、Skills 和 Markdown 设置已完成新 UI。自动记忆、会话 CSRF、Agent 目标和
隔离文件工作区与操作系统级 Python/Node 沙箱已经接通；当前先完成可自动实现的功能，
真实 Word、目标设备和正式签名验收统一留到功能冻结后执行。

截至 2026-08-02，可在当前开发机完成的产品功能与自动化门禁已冻结并通过。下方仍未
勾选的项目只包含真实 Word/目标设备操作、正式下载域名与由这些真实证据生成的终审
描述文件；按当前安排暂不让它们阻塞功能完成，也不会用模拟报告冒充实机通过。
Windows 与 macOS arm64 的安装、升级、证书信任、回滚、卸载（以及 Mac Agent 沙箱）
现可分别通过 `tools/record-windows-release-lifecycle.ps1` 和
`tools/record-macos-release-lifecycle.ps1` 在干净账户生成不可覆盖的实测证据；终审器
强制校验该证据与构建描述文件及安装包哈希一致。

自动化基线已由提交 `6a9993d` 的
[Office.js unified CI #30725877376](https://github.com/ByronLeeeee/wordollama.js/actions/runs/30725877376)
验证通过：Windows 统一回归、Windows x64 与 macOS arm64 原生 Bridge 包、两端平台
密钥库、Bridge live API/重启恢复以及未签名构建证据全部成功。该结果证明跨平台代码与
自动构建链路可用，但不替代下方仍未勾选的真实 Word、证书信任和安装生命周期验收。

## 已完成

- [x] COM/VSTO 与 JS 仓库完全分离。
- [x] 新仓库只保留 `main`，没有 `office.js` 分支。
- [x] React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + daisyUI 5。
- [x] 设置、Skills、MCP、Agent、审阅等 UI 重构与 i18n。
- [x] 36 个 Office.js Word 工具和四档宿主能力矩阵。
- [x] Desktop Bridge 的 Provider、Agent、MCP、Skills、本地工具和安全存储。
- [x] Bridge 同时托管 React 前端和本地 API。
- [x] 桌面 manifest 默认指向 `https://localhost:37421`。
- [x] Windows 安装器将 manifest 注册到当前用户 Office WEF Developer。
- [x] macOS PKG 将 manifest 安装到 Word 容器 `wef` 目录。
- [x] Windows Startup 与 macOS LaunchAgent 当前用户登录自启。
- [x] 完整统一回归和 Windows 发布包生命周期回归。
- [x] 设置窗口统一保存/关闭、未保存关闭确认和小窗口折叠导航。
- [x] 设置页统一为居中单列布局，移除 AI 模式和生成内容语言。
- [x] 模型配置保存为可切换列表，支持详情、修改、删除和 Provider 默认地址。
- [x] Skills Markdown 全文预览、MCP JSON 导入和 Word 现有样式读取/映射；设置页
  不再代替用户新建 Word 段落样式。
- [x] Bridge 结构化保存记忆条目和输出偏向，支持旧 `writingProfile` 数据迁移。
- [x] 将自定义提示词收拢为 Ribbon“我的指令”入口；右侧快捷面板支持搜索、
  收藏、最近使用、点击即运行、管理、批量删除和 JSON 导入导出。
- [x] Ribbon 将现有创作、编辑与法务工具展开为独立入口，并为格式、图片和法务
  工具提供各自图标；不同功能使用独立 TaskpaneId，不再先闪现 Agent 面板。
- [x] 润色、扩写、简化、改错等即时编辑工具统一支持载入选区、多个提示方案、
  默认方案、默认修改、重试、插入、替换和精确修订。
- [x] 续写、摘要、公平性分析和风险分析也支持默认方案与自动应用；续写采用插入，
  摘要/公平性采用精确修订，风险分析采用 Word 批注，避免错误覆盖正文。
- [x] 翻译将术语/风格放到原文上方，保留多个翻译提示方案和管理入口；移除不适合
  翻译的默认方案、默认修改控件，结果支持重试、插入、替换和精确修订。
- [x] 文档审阅重构为全文/多段长文档入口，保留问题扫描、修改建议、批量操作、
  Word 修订读取，并增加独立静默审查模型设置。
- [x] Agent 设置字段统一为实际运行时字段，修复“设置已保存但启动时读取旧字段”的
  问题；本地进程、直接 HTTPS 和 MCP 权限已经拆分并在 Bridge 执行边界过滤。
- [x] Provider 不再生成默认 Ollama/llama3.2 配置，允许清空模型列表；无激活模型时
  Bridge 返回本地化提示，要求先在设置中激活模型。
- [x] 修复 Bridge live API smoke 使用废弃 Provider 测试路径导致的 HTTP 405。

## P1：功能图标体系

- [x] 为每个 Ribbon 命令、任务窗格功能入口和设置导航项配置语义不同的仓库原生
  SVG 图标；统一使用当前 Word 蓝白视觉和一致的描边、画布、留白规范，不复用旧
  COM/XAML 位图，也不以同一个通用 AI 图标代替不同功能。
- [x] 建立 SVG 图标清单与自动校验，确保 manifest/Ribbon 和 React UI 引用的图标
  都存在、无重复错误映射，并验证浅色、深色、高对比度与高 DPI 下的辨识度。

## P0：记忆与输出偏向

- [x] 将“用户画像”改为“记忆”，将语气、篇幅、结构、术语、改写幅度和引用
  习惯归入独立“输出偏向”。
- [x] 记忆设置 UI 支持逐条新增、行内修改、单条删除、全选、删除所选和全部删除。
- [x] Bridge 提供结构化记忆的新增、修改和批量删除 API；当前使用本地 JSON，
  保留稳定 ID 和时间戳，不使用 Markdown 作为主存储。
- [x] 前端兼容尚未升级的旧 Bridge 返回格式，避免设置页白屏。
- [x] 产品决策：自动记忆可以使用在线 Provider，不再把“仅本地模型”作为默认限制；
  设置页允许单独选择“记忆模型”，留空时跟随当前激活模型。
- [x] 产品决策：结构化 JSON 继续作为当前记忆主存储；数据量真正需要全文检索、
  向量召回或大量历史后再无损迁移到 SQLite。
- [x] 产品决策：输出偏向作用于 Agent、自由创作、润色、扩写、简化、续写、摘要，
  以及其他会生成用户可见自然语言的功能；翻译、法务和结构化 JSON 任务只注入
  与任务相关的偏好，不能强行改变术语、事实或输出 schema。
- [x] 完成“自动记忆”执行链路。只在 Agent 成功完成后，从 Agent 输入中筛选用户
  明确表达的长期偏好，按 30 秒空闲窗口批量处理；普通编辑/翻译 Provider 请求可能
  混有文档正文，因此明确不接入自动记忆队列。
- [x] 增加独立“记忆模型”选择器并保存模型配置 ID；被删模型自动回退到当前激活
  模型，无可用模型时跳过自动记忆且不影响原任务结果。
- [x] 只允许记住用户自身信息、长期偏好、近期任务脉络和持续关注点；禁止保存
  文档正文、第三方个人信息、密钥、令牌和一次性指令。财务/医疗内容仅在明确属于
  用户希望长期记住的个人偏好时允许，不能从任务文档中自行推断。
- [x] 自动记忆已包含严格 JSON 操作解析、已知 ID 校验、去重、更新/删除和失败静默
  测试；仍需在真实 Provider 验收中记录 30 秒批处理的实际调用次数。
- [x] 将记忆和输出偏向按上述作用范围接入提示词，并验证不会泄漏到不相关任务、
  破坏翻译忠实度、法务事实或结构化输出。Agent 使用记忆和偏向；创作/编辑只使用
  输出偏向；翻译、法务、风险/公平性和结构化审阅明确不注入。
- [x] 已定义 SQLite 迁移门槛：只有数据达到需要全文检索、向量召回或大量任务历史
  时才无损迁移；当前小规模结构化 JSON 不引入数据库原生依赖。

## P0：安装后直接可用

### localhost HTTPS 信任

- [x] 产品决策：安装器可以在用户明确确认后，为当前用户安装并信任本产品生成的
  localhost HTTPS 证书；不写入机器级信任库。
- [x] Windows 安装器生成每用户、仅限 `localhost/127.0.0.1` 的服务器叶证书。
- [x] 安装器在用户明确同意后写入“当前用户”信任库，并在界面显示用途、范围和
  证书指纹。
- [x] 证书必须包含 SAN：`localhost`、`127.0.0.1` 和 `::1`。
- [x] PFX 使用随机密码，密码只写入 Windows Credential Manager/macOS Keychain。
- [x] 记录证书指纹，升级时安全轮换，卸载时只删除本产品拥有的证书。
- [x] macOS PKG 安装显式的“完成安全设置”入口；用户再次确认后才调用当前用户
  Trust Settings，且不绕过 macOS 自己的授权提示，随后执行启动与双端健康检查。
- [ ] 为证书创建、信任、轮换和卸载添加目标平台实机回归。
  自动化安装器和失败关闭门禁已完成；此项只等待干净 Windows 用户与 Apple Silicon
  Mac 上实际变更当前用户证书库并记录前后状态。

注意：该授权只覆盖 WordOllama.JS 自有的 localhost HTTPS 证书和当前用户信任库；
不得静默安装、不得写入机器级根证书库，也不得信任可签发任意站点证书的通用 CA。

### 无感首次配对

- [x] 产品决策：取消正式版手动配对；Ribbon 不显示配对码、Bridge 调试或开发入口。
- [x] 桌面同源模式改为 Bridge 托管页面自动建立 HttpOnly、SameSite 会话，普通用户
  不需要从日志复制随机配对码。生产环境不再向 JavaScript 返回 bearer token；只有
  CSRF 元数据保存在 WebView sessionStorage，跨 origin 开发模式继续使用兼容会话头。
- [x] 跨 origin 开发模式使用仅开发构建可见的诊断授权，不进入正式 Ribbon；相关
  状态、日志导出和连接测试统一放到“设置 > 进阶 > 诊断”。
- [x] 防止任意本地网页伪造 `Origin` 后获取 Bridge 会话；生产环境自动会话只接受
  与 Bridge 完全同源的页面，跨端口兼容 bearer 仅保留在 Development 环境。
- [x] 增加 CSRF token、自定义请求头和严格 CORS；配对凭据只保存在当前 WebView
  会话，Bridge 会清理过期会话并限制池大小。同源自动会话不等同于无鉴权 API。
- [x] 敏感 JSON API 拒绝非 JSON 请求体，live smoke 覆盖缺少 CSRF 的 403 和错误
  Content-Type 的 415。
- [ ] 在不破坏 Office Dialog/Taskpane 的前提下验证 frame 限制；不能直接使用会阻断
  Office WebView 的通用 `frame-ancestors 'none'`。
  Bridge/live smoke 已强制 `frame-ancestors 'self'` 且拒绝 `'none'`；补充宿主报告现在
  也强制包含 `office-frame-policy-allows-dialog-and-taskpane`，只等待真实 Word 执行。
- [x] 添加首次安装、会话过期、Bridge 重启和多任务窗格共享会话回归。

### 安装器体验

- [x] Windows 安装完成后验证 Bridge `/health` 和 `index.html` 再提示成功。
- [x] macOS PKG 对已有证书的升级会验证 LaunchAgent、HTTPS `/health`、前端
  `index.html` 和 manifest；首次安装在用户完成证书授权入口后执行同样检查。
- [x] 安装/升级时安全停止旧 Bridge，完成后启动新版本。
- [x] Word 正在运行时提示用户完全退出并重启，以刷新 manifest/Ribbon 缓存。
- [x] 为 Windows 安装器补充仓库原生 `.ico`，不要再引用旧 COM 仓库资源。

## P0：目标平台发布验证

- [x] 产品决策：首发支持 Windows x64 和 macOS arm64；只提供 stable
  更新通道。构建由 GitHub Actions 完成，安装包和签名更新索引发布到独立 HTTPS
  下载域名/对象存储，不让客户端依赖私有仓库鉴权。
- [x] 产品决策：首期使用自签名，不购买商业代码签名证书。
- [x] Windows 发布包签署 Bridge 和 EXE，导出受哈希保护的产品发布证书供当前用户
  显式信任；安装器不静默扩大系统信任。更新器固定证书指纹/公钥并继续校验 SHA-256。
- [ ] 验证 Authenticode、自签名发布者固定值、证书轮换和卸载清理；文档明确说明
  自签名无法获得 SmartScreen 公共信誉。
- [ ] 在干净 Windows 用户账户完成安装、升级、回滚和卸载。
- [ ] 在真实 Windows Word 重新执行 36/36 工具、长文档和修订验收。
- [ ] 在 Apple Silicon Mac 构建并使用自签名/本地信任方式验收 arm64 PKG。
- [x] 产品支持范围确定为 Apple Silicon Mac；不构建或发布 Intel Mac 版本。
- [x] macOS 安装文档明确说明：没有 Apple Developer ID 时不能完成 Apple 公证和
  默认 Gatekeeper 无警告分发；安装器必须引导用户执行系统允许的显式信任步骤，
  不能伪造 notarization/stapling 通过状态。
- [ ] 在真实 Mac Word 检查 16 个独立窗格、设置 Dialog、深浅主题和中英文。
- [ ] 生成新版 Windows/macOS 补充宿主证据后运行终审脚本。

## P1：离线产品闭环

- [x] 产品决策：Ollama 完全作为外部依赖，WordOllama.JS 不安装、不更新、不配置、
  不删除 Ollama 或其模型。
- [x] 检测 Ollama 是否已安装/运行；不可用时给出本地化安装指引、官方链接和重新
  检测按钮，不在 WordOllama.JS 中提供 Ollama 服务级设置。
- [x] 确认内置 Skills、MCP 配置和用户设置全部位于 `WordOllama.JS` 独立目录。
- [x] 建立离线产品边界门禁：React/CSS/SVG、设置、Word 工具、Bridge、本地 Agent、
  本地 Provider 和本地 MCP 均不新增公网资源；仅保留 Microsoft 规范要求的官方
  `office.js` CDN 引导依赖，并在用户文档明确不承诺 CDN 被阻断时的冷启动。
- [x] 云 Provider 在离线时快速失败，不阻塞本地功能。
- [x] 明确桌面离线版不支持 Word 网页版。

## P1：Agent 扩展能力

- [x] MCP 工具在连接、授权并开启 Agent MCP 权限后自动加入工具 schema。
- [x] 本地进程使用可执行文件白名单、授权根目录、结构化参数和逐次确认；不经过
  Shell 解析器。Skill 中已有 Python 脚本可以受控运行。
- [x] 直接网络工具默认关闭；启用本地策略后仍只允许 HTTPS，并由独立 Agent
  权限控制，不与 MCP 或本地进程共用一个开关。
- [x] 产品决策：网页搜索使用可选 Search MCP；网页读取优先提供 Bridge 内置的
  受控 Fetch 工具，也允许用户安装兼容的 Fetch MCP。任务窗格不直接执行任意网页
  JavaScript `fetch`。
- [x] 产品决策：Agent 默认拥有每任务隔离临时工作区，只允许 Python/Node；另提供
  “完全终端”危险权限，可开放 Windows PowerShell/CMD 或 macOS bash/zsh。
- [x] 产品决策：Agent 面板增加权限模式和“目标”。权限模式为“请求批准”、
  “替我审批”和“完全访问权限”；“目标”保存任务目标、完成条件和可选迭代/费用
  限制，并支持暂停、继续和停止。
- [x] 接入可选 Search MCP，提供搜索结果、正文摘要和来源元数据；默认不开启，支持
  域名权限、调用次数和结果大小限制。
- [x] 将现有直接 HTTPS 工具收敛为 `fetch_url`：限制 HTTPS、重定向、DNS 重绑定、
  私网地址、响应大小、MIME、超时和凭据，并提取可供模型使用的正文与来源信息。
- [x] 新增每任务隔离文件工作区和 list/read/write 工具；限制相对路径、单文件与总
  容量，拒绝 `..`、绝对路径、符号链接/重解析点，并在完成或取消后清理。
- [x] `run_python`、`run_node` 仅在操作系统隔离后端可用时开放：Windows 使用
  AppContainer/Job Object，macOS 使用 sandbox-exec；两端均限制进程树并默认断网。
- [x] 实现三档权限：请求批准始终确认副作用，替我审批只自动允许隔离工作区内的
  低风险操作，完全访问权限才开放完整终端、外部文件和网络。完全访问权限启用时
  显示持续危险状态并至少进行会话级二次确认，不能由提示词或模型自行开启。
- [x] Agent 面板可设置目标；目标进入协议并随加密恢复快照、检查点与异常恢复持久化，
  仍受既有循环上限和工具权限约束，不能扩大文件/网络范围。
- [x] Windows 本地临时代码工作区已覆盖清理、取消、进程树终止、默认断网、越界写入、
  符号链接/重解析点和输出上限；完整终端审计只保留命令哈希与元数据，不记录敏感参数。
- [ ] 在 Apple Silicon Mac 对 sandbox-exec 工作区与 bash/zsh 完整终端执行同等回归；
  Mac 真机可用前继续推荐把稳定脚本封装为 Skill 或 MCP。

## P1：运行与资源

- [x] 保持 Bridge 单实例和当前用户登录自启。
- [x] Provider、MCP 和 Agent 重型组件继续按需初始化。
- [x] 建立 Windows Release 空闲资源门禁：工作集不超过 160 MB、私有内存不超过
  128 MB、采样 CPU 不超过 5%；2026-08-02 实测工作集 71.9 MB、私有内存
  52.7 MB、CPU 1.8%。
- [x] 测量两个 MCP Server、活动 Agent 和多个任务窗格会话后的资源占用；
  2026-08-02 实测工作集 87.7 MB、私有内存 59.8 MB、CPU 3.4%，并由 live API
  smoke 持续验证组件计数和 Bridge 单实例。
- [x] 不把 Ollama 模型内存计入 Bridge 指标；单独展示本地模型资源。

## P1：发布与更新

- [x] 产品决策：首期只有 stable 通道；Windows x64、macOS arm64 共用签名索引，
  下载文件托管于独立 HTTPS 域名/对象存储。
- [ ] 配置正式下载域名和双平台 stable 更新索引。
  索引生成器现已强制非回环 HTTPS、精确 `IndexUrl`、两个 runtime 的终审描述文件、
  产物哈希/大小/发布者和分发信任模式；此项只等待实际域名与对象存储凭据。
- [ ] 完成 Windows x64/macOS arm64 两个 runtime 的 `releaseReady: true` 终审描述文件。
  终审器与证据门禁已完成；描述文件必须由上述真实平台/Word 验收生成，不能预先勾选。
- [x] 验证更新下载的大小、SHA-256、签名发布者和失败清理。
- [x] 验证设置页一键更新、版本回滚和旧版本保留策略：前端确认流、Bridge 下载/签名
  门禁、两版本原子指针切换、上一版本保留、设置页回滚确认、Windows“修改/回滚”入口、
  macOS 独立回滚入口和失败残留清理均已通过自动 smoke。
- [x] 将首发自签名决策贯通候选工作流和 stable 索引：Windows 固定 Authenticode
  身份，macOS arm64 固定本地自签名 Application/Installer 身份并记录
  `explicit-local-user-trust`，不再错误要求 Apple ID、公证或 Intel Mac 产物。
- [x] 发布前将四段 `ManifestVersion` 从 `1.1.0.0` 递增到 `1.2.0.0`，避免 Word
  使用旧 Ribbon 缓存；正式 CI 仍使用单调递增的 `1.2.<run>.<attempt>`。
- [x] 准备最终用户安装、升级、卸载和离线使用文档。

## 每次提交前

```powershell
pwsh ./tools/unified-smoke-test.ps1 `
  -Configuration Release `
  -SkipManifestValidation

pwsh ./tools/bridge-package-smoke-test.ps1 `
  -Configuration Release

git diff --check
git status
```

## 本次交接验证状态

- TypeScript 类型检查、23 组 Office.js smoke 与 Vite 生产构建：通过。
- Desktop Bridge Release 构建：0 警告、0 错误；统一 Core smoke：通过。
- 统一 Release 冒烟已通过前端构建、36 工具注册、宿主能力矩阵、Golden、
  长文档、修订、Provider 设置、结构化记忆存储、MCP/Ollama 设置、更新安全测试和
  双平台生命周期证据防篡改门禁。
- 独立 Bridge live API 已通过配对、Provider 模型读取、MCP、加密 Agent 恢复和
  重启持久化；此前 HTTP 405 已修复。macOS CI 的 live API 子进程输出改为直接继承
  runner 输出；非 Windows 重启不再调用可能卡在 MCP 子进程树枚举的
  `Kill(entireProcessTree)`，并增加阶段日志、7 分钟子进程 watchdog 和 8 分钟步骤超时。
- Bridge package smoke 已通过 win-x64 自包含包、安装/回滚、HTTPS 失败关闭、
  Windows/macOS 自启模拟、Windows 安装器和 macOS 签名/安装器 dry-run；测试脚本
  已修复为可重复执行。
- 2026-08-02 最新 Windows Release 实测：Bridge 空闲工作集 69.1 MB、私有内存
  52.8 MB、CPU 0.2%；载入两个 MCP 和一个 Agent 后为 86.8 MB、60.1 MB、4.6%。
  CI 空闲 CPU 门禁仍固定为 5%，但会先 JIT 诊断端点并在最多 6 个 1.5 秒窗口中等待
  真正的稳定空闲样本，避免把 Kestrel 启动编译误判为常驻 CPU。
- 已在 360px 窄窗中实际检查基础设置、Agent 设置、翻译和编辑工作流，无控制台
  error/warn；开发 Bridge 测试后已恢复运行。

涉及签名、证书、Credential Manager、Keychain、注册表、LaunchAgent 或真实 Word 的
修改，必须在相应目标操作系统上再次实测，不能只凭跨平台编译结果标记完成。
