# WordOllama.JS Office.js Add-in

这是 Windows/Mac 统一版的任务窗格起点。`src/officejs-word-adapter.ts` 只依赖 Office.js，`src/runtime-client.ts` 通过版本化协议连接跨平台 Desktop Bridge。

## 本地运行

1. 安装 Node.js 依赖：`npm install`
2. 首次运行执行 `npm run certs:install`，安装 Microsoft Office Add-in 本地 HTTPS 开发证书。
3. Windows 或 Mac 桌面 Word 执行 `npm run start:desktop`，工具会启动 HTTPS 开发服务器并旁加载 `manifest.xml`；结束调试时执行 `npm run stop:desktop` 清理注册。
4. 启动 `WordOllama.DesktopBridge`，从控制台读取配对码。
5. 在任务窗格输入配对码，点击“检查 Bridge”。

当前 Bridge 已支持健康检查、配对、会话校验、Office.js 工具目录注册、统一 Provider chat/models、带计划确认/权限确认/checkpoint 的 Agent NDJSON 事件会话和受策略保护的本地命令/grep/Skill 接口。Office.js 侧已覆盖原 VSTO 的 35 个 Word 文档工具及 `ask_human` 交互工具；现有 VSTO 实现保持不变，继续作为回退基线。Bridge 连接地址必须是 HTTPS，只有本机开发地址允许 HTTP。

OpenAI-compatible Provider 通过配置的 `ApiMode` 统一支持 `Responses`、`Chat Completions` 和自动选择：原生 `api.openai.com` 在 `Auto` 下使用 `/v1/responses`，第三方兼容端点保持 `/chat/completions`；两种响应及 SSE 流都会归一化为 Bridge 的聊天/流式协议。API Key 只写入 Desktop Bridge 使用的系统密钥库，不写入 Provider JSON 或 Office.js 存储。

一次配对可供同源的多个独立任务窗格复用：页面只缓存 8 小时 session token 及其到期/协议元数据，不保存配对码；新窗格启动时会重新向 Bridge 注册自身的 Office 工具。过期、无效或收到 401 的 token 会立即从缓存移除。

界面以原 `AgentTaskPaneUI` 和现有 VSTO 独立工作台为产品基准。Manifest 按原版窗口边界为 Agent、自由创作、按需修改、图片、表格、HTML、Markdown、编辑、翻译、文档比较、文档审阅、法律通用、模拟法庭、法律检索、自定义提示词、设置和诊断配置独立 `TaskpaneId`。前端共用一个 bundle，但 `surface`/`workflow` 路由只显示当前职责，避免把所有能力堆进 Agent 面板。现已覆盖 Agent 消息与确认流程、写作、翻译、法律检索、模拟法庭、图片、表格、HTML、Markdown、自定义提示词、模型/服务设置和诊断；金样本只位于独立诊断窗格。仍须按 `docs/OFFICE_JS_UI_PARITY_MATRIX.zh-CN.md` 完成真实 Windows/Mac Word 多窗格并存、视觉与宿主验收，不得仅凭 manifest 或无宿主测试通过就宣称与 VSTO 等价。

设置由 Ribbon 命令打开独立 `settings.html`，该页面使用 React 19、TypeScript 7、Vite 8、Tailwind CSS 4、daisyUI 5 和 i18next；Skills 与 MCP 是两个独立页面。`npm run test:settings-i18n` 会验证中英文资源完全对应、所有翻译键存在且实现源码没有写死中文。

前端样式只有两个入口：任务窗格使用 `src/styles.css`，独立设置窗口使用 `src/settings/settings.css`。两者都通过 Vite 导入 Tailwind CSS 4 和 daisyUI 5，并统一采用 Word 蓝白主题、零阴影组件和主题色选中态；不要在应用根目录另建或修改未被模块导入的 CSS 文件。

Vite 8 开发客户端的 `__BUNDLED_DEV__` 与 `__SERVER_FORWARD_CONSOLE__` 内部标志必须由 `vite.config.ts` 显式注入。Office Dialog 使用全新的 WebView 全局环境，缺少这两个标志时 `/@vite/client` 会在 React 启动前抛错并显示空白窗；设置入口保留了宿主级加载占位与启动错误边界，防止此类问题再次静默失败。

Bridge 还提供 `/documents/compare` 结构/词级 DOCX 对比；任务窗格的“AI 文档修订分析”会读取原文和修订稿的结构化变化，再交给当前模型总结修改内容、风险与建议，不再在界面展示原始 JSON、逐项勾选或直接写入 Word 修订。两个文件合计限制 20 MB，只发送到已配对的本机 Bridge；复杂 OOXML 修订仍标记为近似结果。

## 与现有 COM/VSTO 版共存

统一版在 Word 中显示为 `WordOllama.JS`，不会修改原 VSTO 项目的 `WordOllama` ProductName、FriendlyName 或 COM 注册。

Windows 开发旁加载使用 `HKCU\SOFTWARE\Microsoft\Office\16.0\Wef\Developer` 下的字符串值：值名为 `manifest.xml` 的 `<Id>` GUID，数据为 manifest 的绝对路径；它不是名为 GUID 的子键。`WordOllama.JS` 用作 manifest 显示名、ProviderName、Ribbon 组和任务窗格标识。该 WEF 注册与 VSTO/COM 的 `Office\Word\Addins\<ProgId>` 是两套独立机制。

可用仓库根目录的脚本创建或移除精确的开发旁加载注册：

```powershell
pwsh ./packaging/install-office-addin-dev.ps1
pwsh ./packaging/uninstall-office-addin-dev.ps1
```

Windows 脚本只写入/删除上述 GUID 对应的 WEF 值；macOS 脚本只复制/删除 `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/WordOllama.JS.xml`。两者都不会改动现有 COM/VSTO 注册。开发旁加载不属于生产分发；组织内部生产部署使用 Microsoft 365 管理中心的 Integrated apps 上传生产 manifest。

Windows 开发注册必须在“实际启动 Word 的同一用户”下执行，通常不应使用切换到另一账户的管理员终端。否则注册会落在另一个用户的 HKCU，Word 不会读取。日常调试优先使用 `npm run start:desktop`，它会通过微软官方调试工具完成注册、刷新和 Word 启动。

## 真实 Word 金样本回归

Ribbon 的独立“诊断”窗格提供 Word 宿主金样本，用于在 Windows 与 Mac 的真实 Word 中按当前 API 能力执行全部 40 个工具。它会覆盖当前文档正文，并可能改动页眉、页边距、分页、目录和批注，因此只能在新建且未保存的空白文档中运行。

1. 启动 Bridge 与 Add-in，在 Word 中新建一个未保存的空白文档。
2. 打开 `WordOllama.JS` 任务窗格并完成配对。
3. 点击“运行 40 项金样本”，阅读覆盖警告后确认。
4. 完成后点击“复制 JSON”，把报告连同 Word 版本和平台纳入发布验收记录。

运行器会先写入固定测试夹具，再逐项设置需要的选区；单项失败不会阻断后续工具。不受当前宿主 API 支持的工具记为 `unsupported`，夹具无法建立时其余受支持工具记为 `blocked`。预期能力上限如下：

- WordApi 1.1 基线：31 项。
- WordApi 1.4：34 项。
- WordApiDesktop 1.3：35 项。
- Microsoft 365 新版桌面 Word（WordApiDesktop 1.4）：40 项。
