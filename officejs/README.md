# WordOllama Office.js 统一版

本目录是 Windows/Mac 统一版实现。COM/VSTO 版保留在独立的
`wordollama-community` 仓库；本项目的自动化产品基线位于
`test-fixtures/legacy-product-contracts.json`，不依赖或复制 COM 源码。

## 目录

- `apps/addin`：Office.js 任务窗格、Ribbon manifest、Word 文档适配器。
- `../src/WordOllama.Contracts`：Office.js 与 Desktop Bridge 共用的协议模型。
- `../src/WordOllama.Core`：跨平台 Agent/Provider/MCP/Skill 的抽象边界。
- `../src/WordOllama.DesktopBridge`：本地配对、会话、命令和健康检查服务。

## 当前状态

第一阶段已完成通信和文档操作骨架。Office.js 适配器目前覆盖原 `WordOllama/lib/Tools` 中的 35 个 Word 工具（文本/段落、批注书签、格式、法律审阅、分页页眉、图片、表格和目录），另提供 `ask_human`；任务窗格配对后会通过 `/capabilities` 将工具名称、schema 和写入属性注册到 Bridge。

Bridge 配对会话有效期为 8 小时，并强制绑定受信任的 Add-in Origin。前端只缓存 session token、协议版本和到期时间，不保存配对码；同源的 Agent、翻译、审阅等独立任务窗格可复用一次配对。缓存过期、损坏、协议不兼容或服务端返回 401 时会自动清除，Bridge 离线等临时网络错误不会误删仍有效的会话。

第二阶段已将 Ollama、OpenAI 兼容端点、Claude 和 Gemini 接入 .NET 8 Core，统一提供 `/providers/chat`、`/providers/chat/stream` 和 `/providers/models`；`/providers/ollama/*` 仍保留为兼容别名。流式接口使用 NDJSON：Bridge 将 Ollama NDJSON、OpenAI/Claude/Gemini SSE 归一化为同一事件；不支持原生流的兼容端点自动降级为单块完成事件。任务窗格可在配对后直接测试本地模型。

Agent 事件闭环也已接入：`/agent/sessions` 创建会话，`/agent/sessions/{id}/events` 输出 NDJSON，Office.js 执行 `tool_call` 后通过 `/tool-results` 回传，Agent 再继续调用模型。会话支持 `plan_pending`/`plan-confirmation`、高风险 `permission_request`/`permissions`、取消和每轮 checkpoint 查询；假 Provider 已验证计划确认、权限拒绝和 checkpoint 状态。

Agent checkpoint 会以 AES-256-GCM 加密写入用户配置目录，随机加密密钥只保存在 Windows Credential Manager 或 macOS Keychain；最多保留 10 个恢复点，并按已配对的 Office.js Origin 隔离。Bridge 重启后只展示恢复入口，不会自动继续执行；用户确认继续后才从已保存消息历史重新执行当前迭代，完成或放弃时删除恢复点。若进程恰好在 Word 写入成功、工具结果回传前退出，界面会明确要求先检查文档，以免当前迭代重复应用。

本地能力已加入 Bridge：`/local/execute-command`、`/local/run-python`、`/local/grep`、`/skills` 和 `/skills/read`。命令使用结构化参数、可执行文件白名单和授权根目录；路径会检查实际文件/目录链接，越界 grep 实测返回 403。高风险 `http_request` 只有在 `Bridge:LocalTools:AllowHttpRequests=true` 时才会注册，并且只允许 HTTPS。

Agent 权限按能力独立控制：本地代码与进程、直接 HTTPS 请求、已授权 MCP 工具
分别有自己的设置开关。旧版 `allowExternalTools` 数据会在读取时迁移，但新会话会
把三类权限分别发送给 Bridge；`read_skill` 始终只读可用，本地执行和 HTTP 请求仍
需要逐次确认。当前执行器不会调用 Shell 解析器，也没有通用文件写入工具：可以运行
白名单中的 Python/.NET 或 Skill 已带的脚本，但不能默认创建任意脚本、使用管道或
执行 PowerShell/CMD。需要稳定自动化时优先封装为 Skill/MCP；临时代码工作区方案见
仓库根目录 `TODO.md`。

文档对比提供 `/documents/compare` 跨平台 v2 引擎：先按正文段落、标题样式和表格单元格进行 LCS/唯一锚点对齐，避免中间插入造成后续级联误报，再为修改块返回词级位置、原/新段落索引、OOXML 位置和结构摘要。任务窗格支持选择两份 DOCX、预览并复制完整 JSON；结果继续明确标记 `isApproximate`，不冒充 Word 原生修订文档。

Agent 对本地工具采用 Bridge 内部执行，事件中标记 `execution: "bridge"`，Office.js 不会重复执行；假 Ollama 实测 `execute_command` 调用、结果回传和 Agent 完成事件均正常。

更新页优先使用当前平台的签名用户安装器。用户确认后，Bridge 会重新读取 HTTPS 索引，限制下载大小并核对 SHA-256；索引发布者必须与上一版已签名 Bridge 配置中固定的发布者一致，随后还要通过 Windows Authenticode CA/时间戳或 macOS Developer ID Installer/Gatekeeper 验证才会启动。失败下载会删除，旧索引或 ZIP 只提供手动兼容下载。

MCP stdio 已独立为 `WordOllama.Mcp` net8.0 项目，Bridge 提供 `/mcp/servers`、`/mcp/servers/{name}/tools` 和 `/mcp/tools/call`。使用假 MCP Server 实测 initialize、tools/list 和 tools/call 均通过；HTTP 端同时支持新版 `streamable-http` 与旧版 `sse` transport，均实测远程工具发现和调用。

已授权并连接的 MCP 工具会以 `mcp__server__tool` 名称自动加入 Agent schema，并在 Bridge 内部执行；Office.js 不需要了解 MCP 进程或传输细节。

Bridge 当前使用本机回环 HTTP 便于开发；程序会拒绝非回环 HTTP。正式桌面版由同一个 Bridge 在 `https://localhost:37421` 同时托管 React 前端与本地 API，生成的 manifest 也指向该本地宿主，因此用户安装后不需要 Vite、在线静态站点或手动启动 Bridge。Windows EXE/macOS PKG 会安装本地前端、manifest 和用户级登录自启项；生产配置使用回环 HTTPS PFX，`provision-bridge-https.ps1` 会验证受信任 PFX 并通过标准输入把密码写入 Windows Credential Manager 或 macOS Keychain，避免密码进入命令行和 JSON。真实证书签名、公证及目标平台信任链仍须在对应发布环境执行。Windows/Mac 统一版的受支持基线是 Microsoft 365 Word（Windows、Mac）；老版本或缺少对应 WordApi 集的宿主会隐藏/拒绝不支持的工具，保留基础文本操作。完全离线的桌面发行不支持 Word 网页版。

Windows EXE 会登记当前用户卸载入口；macOS PKG 会在
`~/Applications/WordOllama.JS` 安装双语原生卸载器。两端卸载都删除安装文件、
自启项和专用 HTTPS 凭据，但默认保留 Provider/MCP/API Key 与用户设置。

Bridge 不会把 API Key 写入 Office.js 状态或 Skill 文件；`WordOllama.Platform` 已优先从 Windows Credential Manager 的 `WordOllama.JS/<name>` 或 macOS Keychain 同名 service 读取，无法访问平台密钥库时才回退到 provider 专用或通用环境变量。

为避免与仍可并存的 COM `WordOllama` 相互覆盖，统一版的配置、恢复点、更新缓存和 Skills 现在都位于独立的 `WordOllama.JS` 用户目录，系统密钥也使用 `WordOllama.JS/<name>` 命名空间。首次启动会以有界、拒绝链接的复制方式导入旧 Bridge 的已知 JSON/恢复文件和旧 Skills；源文件不移动、不删除，迁移标记写入后不再反复同步，因此 JS 版后续新增、修改或删除 Skill 不会影响 COM 版。已有旧 Bridge 密钥只在新命名空间缺失时读取并复制，新写入和卸载均只触及 JS 命名空间。

原版 Ollama 高级设置也已进入统一设置页。Bridge 在 Windows 写入当前用户环境变量，在 macOS 使用 `launchctl setenv/unsetenv` 并重放持久化配置，覆盖模型目录、监听地址、默认 keep-alive/上下文、最大加载模型数、并行数与队列。修改后必须完全退出并重启 Ollama。为避免破坏或长时间搬移数十 GB 的模型，统一版只修改目标目录，不自动移动旧目录内容；向非回环地址开放监听前会要求再次确认。

Gemini Provider 保留 OAuth 登录能力，但不会复制 VSTO 版把短期 access token 当 API Key 的旧实现。统一版由 Bridge 打开系统浏览器，以随机 `127.0.0.1` 回环端口接收回调，校验 state 并使用 PKCE S256；access/refresh token 与客户端 secret 编码后只写入平台密钥库，Provider 在 access token 到期时用 refresh token 自动刷新。Google Cloud Project ID 可作为 `x-goog-user-project` 配额项目发送。

可重复回归：`pwsh ./tools/unified-smoke-test.ps1 -SkipManifestValidation` 会严格检查每个外部命令的退出码，并执行 TypeScript 类型检查、36 项金样本运行器逻辑、Office.js registry mock dispatch、四档宿主 capability matrix、Vite bundle、安全生产域名拒绝、`WordOllama.JS` Add-in ZIP/manifest、.NET Bridge 构建、安全默认值和内置 Skill 复制检查。该回归还会启动真实 Desktop Bridge 进程和受控的本地 Provider/MCP 服务，验证配对鉴权、Provider 设置、MCP 工具调用与权限、进程重启后的设置持久化，以及 Agent 加密检查点恢复；Windows 需要允许测试访问当前用户 Credential Manager，macOS 对应使用 Keychain。任务窗格还可在 Windows/Mac 的一次性空白文档中运行全部 36 个真实 Word 宿主金样本并导出 JSON。Bridge 的 `win-x64` 正式 ZIP 必须在 Windows 生成，`osx-arm64`/`osx-x64` 正式 ZIP 必须在 macOS 生成；异平台仅使用 `-CrossBuildOnly`。签名/公证使用 `packaging/sign-bridge-release.ps1`。

文档比较在独立窗格中展示原稿/修订稿结构位置，并允许逐项勾选后以 Word 修订批量应用到已确认的原稿副本；取消勾选即保留原稿。普通段落新增、删除、修改和唯一表格单元格文本修改可应用，无法可靠重建/删除的表格结构差异只读展示。`tools/create-compare-host-fixtures.ps1` 可生成不含用户数据的宿主验收 DOCX。

2026-07-29 已在 Windows Word 16.0.20228.20110（zh-CN）通过 36/36 真实宿主金样本，报告位于 `../docs/evidence/windows-word-16.0.20228.20110-golden-2026-07-29.json`。同一真实宿主还通过 1,000/5,000 段长文档验收，覆盖全文读取、末端分块、语义映射和模拟共同编辑后的稳定锚点重定位；原始报告位于 `../docs/evidence/windows-word-16.0.20228.20110-long-document-2026-07-29.json`。`WordApiDesktop 1.4` 修订运行器也已通过读取、定位、单项接受/拒绝和全部接受，报告位于 `../docs/evidence/windows-word-16.0.20228.20110-revisions-2026-07-29.json`；缺少相应要求集的旧宿主由自动化回归验证明确降级。Word WebView2 不可靠支持原生 `window.confirm()`/`window.prompt()`，因此危险测试确认与 `ask_human` 均使用任务窗格内 HTML 交互。

Ribbon 不再把所有命令复用到一个拥挤容器，也不再把 Office.js 命令混进“开始”页或现有 COM 页签。Manifest 建立独立的 `WordOllama.JS` 自定义页签，并通过稳定的 `TaskpaneId` 打开 Agent、编辑、翻译、比较、审阅、法律工具和“我的指令”等工作区。用户自定义提示词统一收拢到“我的指令”：右侧快捷面板提供搜索、收藏、最近使用和管理，点击列表项后直接读取当前选区并流式执行；旧版 C1–C4 快捷槽会自动迁移为收藏。前端仍使用同一个 TypeScript bundle，通过 `surface` 与 `workflow` 路由显示对应工作区，Windows/Mac 保持统一实现。不同 `TaskpaneId` 的真实 Windows/Mac 并存行为仍须在发布宿主中逐项验收。

基础设置不再只是浏览器偏好：模型页管理可切换的 Provider/模型配置，基础页保存记忆和输出偏向，默认文档操作会按选区稳定性安全选择插入、修订、替换、批注或交给独立审阅窗格。Agent 完成 Word 写操作后可按偏好提示审阅；支持 `WordApiDesktop 1.4` 的 Windows/Mac Word 可在“文档审阅”窗格读取、定位、逐项接受/拒绝或批量处理真实 Word 修订，旧宿主会明确降级。

设置使用独立 `settings.html` React 应用（React 19、TypeScript 7、Vite 8、Tailwind CSS 4、daisyUI 5、i18next），Skills 与 MCP 分页呈现。界面默认跟随 Office 显示语言，当前提供 `en-US` 与 `zh-CN`，并由 `test:settings-i18n` 强制校验资源键、翻译引用和“实现源码不得写死中文”。发布包必须包含 `settings.html`。
