# WordOllama → Office.js UI 对照矩阵

更新时间：2026-07-30

本文件以现有 VSTO 源码为产品基准，不以 Office.js 测试页面或工具数量代替 UI 等价性。统一版必须在 Windows 与 macOS Word 上保持同一产品结构、交互顺序和用户可见能力；底层实现可以按宿主能力降级，但“通用聊天面板可运行”不构成迁移完成。权威基线包括：

Office.js 前端不再复制受 XAML 约束的视觉外观。XAML 与后台代码仅作为能力、工作流、默认值和安全语义基线；统一版采用现代 Agent 交互结构与 Word 蓝白视觉系统（主色 `#185ABD`），使用安静页头、单一主操作、底部对话输入框、渐进披露结果和按任务拆分的独立窗格。普通控件保持白/中性色，只有当前主操作使用 Word 蓝；说明性开发文字不进入用户界面。

2026-07-29 已在真实 Windows Word 16.0.20228.20110 中确认现有 COM `WordOllama` 与 Office.js `WordOllama.JS` 是两个独立功能区标签；此前误打开 COM 版“审阅工作台”的结果全部撤销，不作为 Office.js 证据。使用最新 manifest 新建的调试文档已逐一打开并确认 16 个独立任务窗格：Agent、自由创作、按需修改、图片理解、文本转表格、HTML 应用、Markdown 转换、编辑、翻译、文档比较、文档审阅、法律通用、模拟法庭、法律检索、自定义提示词和诊断；Word 右侧窗格标签栏在连续打开后保留并可切换多个窗格，没有退回单一万能面板。设置不再占用第 17 个任务窗格，而由 Ribbon `ExecuteFunction` 直接打开宽版 Office Dialog。实机发现的泛化页头也已改为当前任务的精确名称。macOS 视觉验收仍待完成。

同日又在真实窄 Word 任务窗格中检查模型、Gemini OAuth 与 Ollama 服务设置：字段与按钮可见、纵向滚动可达；发现设置页在深处切换分类时沿用旧滚动位置，已改为每次切页回到顶部并将当前分类保持在横向导航可见区域。该检查未使用真实 Google OAuth 凭据，也未改写本机 Ollama 环境。

随后按原版“多个工作台”结构重构 manifest：16 类高频或需直接操作文档的任务分别使用独立 `TaskpaneId`，只在同一任务的子命令之间共享窗格。设置使用 Office Dialog，36 工具金样本与运行日志移入独立诊断窗格；前端继续共用同一 TypeScript bundle，以 `surface`/`workflow` 路由保持 Windows/Mac 一致。微软在线 manifest 验证已通过。Windows 真机已验证上述 16 个 Office.js 窗格可连续打开并由 Word 右侧窗格标签切换，设置弹窗可独立打开和切换分类。macOS 多窗格与弹窗仍须实测。

同日完成新版 UI 的 340×700、640×760、浅色和深色浏览器回归，并重新旁加载到真实 Windows Word 窄任务窗格，逐页确认 Agent、按需修改、文档审阅与设置：没有横向溢出或重复标题，Agent 输入框固定在底部，文本生成结果在产生内容前隐藏，审阅工作区按范围/生成/要求纵向分组，设置分类可横向滑动。该结果只覆盖 Windows 当前 Office WebView2；macOS Word 的字体、滚动、深色和触控板行为仍需独立验收。

随后根据真实使用反馈再次调整设置架构和视觉：设置已成为独立的 React 19 + TypeScript 7 应用，使用 Vite 8、Tailwind CSS 4、daisyUI 5 和 i18next。基础、模型、Agent、Markdown、Skills、MCP、进阶、更新和关于均使用 Word 蓝白配置工作区；Skills 与 MCP 是两个独立页面，不再共用拥挤的组合页。左侧导航按偏好/扩展/系统分组，字段采用紧凑的无阴影卡片、标签/控件双列和稳定操作区，选中项使用 Word 主题色及白字，模型与 MCP 在宽屏下使用“资源列表 + 配置编辑”双栏。浏览器已覆盖中英文、浅色/深色和 1280×720 实际渲染，并修复页面切换引起的横向溢出。2026-07-30 又在当前真实 Windows Word 调试宿主中打开最新 React 弹窗，逐页确认基础、Skills 与 MCP：弹窗独立于右侧任务窗格，左侧分类稳定，Skills/MCP 已完全拆分，MCP 保持“服务器/权限 + 配置”双栏，选中项为 Word 蓝底白字，卡片无阴影且没有横向溢出。Office Dialog 不能直接调用文档 API，Markdown 的 Word 样式读取和创建通过父级命令运行时消息代理执行；诊断仍保留任务窗格，以便运行 Word 宿主验收。

2026-07-30 进一步把主任务窗格从静态 `index.html` 全量迁移为单一 React 19 应用根：应用外壳、Agent 对话、Issues、Review、文本/表格/Markdown、HTML/图片、法律/模拟法庭/自定义提示，以及比较和诊断对话框均由 `TaskpaneApp.tsx` 下的模块化组件渲染。原 `main.ts` 暂作为 Office.js/Bridge 行为控制器，在 React 同步挂载后按稳定 DOM ID 绑定，避免一次重写流式 Agent、Word 批次和宿主降级逻辑造成能力丢失。正式任务窗格样式由 Vite 处理 Tailwind CSS 4 与 daisyUI 5，使用 Word 蓝白主题、`depth: 0` 和全局无阴影门禁；此前根目录手工 `style.css` 不再由 `index.html` 重复加载。完整统一烟测随后通过，包括 36 工具、四宿主矩阵、全部工作流、发布 ZIP/更新索引、.NET 8 零警告构建、HTTPS 密钥、加密恢复、MCP、Ollama、Google OAuth PKCE 和真实 Bridge 重启持久化。macOS 视觉与原生发布验收仍未完成。

设置实现遵循资源化 i18n，不在 React/HTML 实现中写死中文；默认跟随 `Office.context.displayLanguage`，并提供英文回退和显式语言选择。自动化门禁会校验 `en-US`/`zh-CN` 资源键完全一致、所有 `t(...)` 引用存在、实现源码无 CJK 文本，并确认发布 ZIP 包含独立 `settings.html`。

设置窗口继续使用 Office Dialog，以保留 Windows/Mac 的同一实现、原生移动和缩放。`displayInIframe: true` 可在 Office Web 中使用无浏览器弹窗外壳的浮层，但微软明确规定该选项在桌面平台会被忽略；`DialogOptions` 只提供宽度、高度、Web iframe 和打开提示控制，没有隐藏桌面安全标题栏/地址的选项。2026-07-30 Windows 真机再次确认：即使页面在加载后通过 History API 清理 Office 自动附加的查询串，Word 仍显示创建 Dialog 时缓存的完整初始 URL，因此该尝试已撤回，没有把无效代码留在产品中。桌面版只能保留 Word 管理的安全标题栏；若强制完全移除，必须另建 Windows/macOS 原生 WebView 外壳，并同时重新实现当前 Office Dialog 的父级 Word 样式 RPC，这会形成第二套 UI 宿主，不属于纯 Office.js 的跨平台能力。依据：`https://learn.microsoft.com/en-us/javascript/api/office/office.dialogoptions` 与 `https://learn.microsoft.com/en-us/office/dev/add-ins/develop/dialog-api-in-office-add-ins`。

- `WordOllama/NewUI/AgentTaskPaneUI.xaml` 与 `.xaml.cs`
- `WordOllama/NewUI/NewSetting.xaml` 与 `.xaml.cs`
- `WordOllama/Ribbon1.Designer.cs` 与 `Ribbon1.cs`
- `WordOllama/NewUI` 下的独立工作窗口

状态定义：

- `已迁移`：Office.js 中已有对应产品界面和可用交互。
- `部分迁移`：已有界面或底层能力，但用户工作流尚不完整。
- `未迁移`：不能以底层 API、Bridge 端点或测试工具存在作为完成证据。
- `诊断专用`：只用于开发/验收，不属于原产品主界面。

## Agent 主面板

| 原版能力 | Office.js 状态 | 当前证据 | 剩余工作 |
|---|---|---|---|
| Agent 头部、运行状态、停止按钮 | 已迁移 | `TaskpaneApp.tsx`、`TaskpaneChrome.tsx`、`main.ts` | 真 Word 中验证状态更新与取消时序 |
| Agent 对话工作台 | 已迁移 | `AgentPane` 独立 `TaskpaneId`；Agent 窗格不再承载设置与诊断 | Windows/Mac 视觉对照 |
| 用户/Agent/系统/工具消息卡片 | 已迁移 | `appendMessage`、安全 Markdown 渲染与消息样式 | 折叠步骤、富文本复制真机验收 |
| 流式输出 | 已迁移 | Agent SSE `text_delta` 渲染 | 长输出性能与自动滚动真机验证 |
| 计划确认 / 修改需求 | 已迁移 | 面板内确认；修改需求会取消旧计划、回填文字/图片并聚焦输入框 | 真实 Provider 计划质量验收 |
| 高风险工具权限确认 | 已迁移 | 面板内提供“仅允许本次 / 本次运行均允许 / 拒绝”，并明确说明记忆边界；运行级授权只匹配完全相同的工具名和规范化参数组合，不跨 Agent 运行或重启保存，参数变化会重新确认 | Windows/Mac 真实命令、URL 与 MCP 高风险调用真机验收 |
| 停止 Agent / checkpoint 恢复 | 已迁移 | `/cancel`、checkpoint 记录、重载后继续/放弃入口及事件流重连；Bridge 使用 AES-256-GCM 持久化最多 10 个恢复点，随机密钥只存 Windows Credential Manager/macOS Keychain，按已配对 Origin 隔离并惰性恢复，完成或放弃后删除 | Windows/Mac 强制终止 Bridge 后真机恢复；恢复当前迭代前仍提示检查是否存在“写入成功但结果尚未回传”的边界情况 |
| Enter 发送、Shift+Enter 换行 | 已迁移 | `main.ts` 键盘处理 | IME 与 macOS 键盘真机验证 |
| 图片粘贴/预览/移除/视觉模型 | 已迁移 | File/Clipboard、8 MB/MIME 校验、预览与四类 Provider 多模态协议 | Windows/Mac 视觉模型真机验收 |
| `/` 命令菜单和自定义提示词 | 已迁移 | 命令弹层、键盘导航、Skill/提示词命令、自定义提示词工作台和 C1-C4 快捷槽 | IME 与 macOS 键盘真机验收 |
| Markdown → FlowDocument 等价渲染 | 已迁移 | 安全 Markdown、代码块、表格和链接渲染 | 超长消息性能真机验收 |

## 问题页

| 原版能力 | Office.js 状态 | 当前证据 | 剩余工作 |
|---|---|---|---|
| 审查选区 / 审查全文入口 | 已迁移 | 独立严格 JSON Issue 协议与 Provider 调用 | Windows/Mac 真实 Provider 验收 |
| 问题数量、严重程度、类别和理由卡片 | 已迁移 | `ReviewIssue` 解析、双语字段和严重程度卡片 | 长列表与坏模型输出真机验收 |
| 定位原文 | 已迁移 | 段落文本指纹、前后文指纹与原索引共同解析；插入导致的漂移可重定位，重复原文无法消歧或目标被修改时安全拒绝 | Windows/Mac 共同编辑真机验收 |
| 添加批注 | 已迁移 | Issue 卡片直接批注并回写按钮状态 | WordApi 1.4 降级真机验收 |
| 忽略 / 清空 | 已迁移 | 单项忽略、清空、静默问题指纹去重；审阅状态按文档全文指纹隔离并跨任务窗格会话恢复 | Windows/Mac 重开窗格验收 |

## 非破坏式审阅

| 原版能力 | Office.js 状态 | 当前证据 | 剩余工作 |
|---|---|---|---|
| 载入选区 / 段落 / 全文 | 已迁移 | 选区、10 段页、300 段页均可前后翻页；页内再按 9 万字符分块且保留绝对段落号与稳定锚点 | 真实超长合同性能验收 |
| 自定义要求 | 已迁移 | 独立 ReviewSuggestion JSON 协议携带自定义要求 | 真实 Provider 提示词验收 |
| 写作画像 | 已迁移 | Bridge JSON 配置跨重启持久化，并自动迁移旧 localStorage 数据 | Windows/Mac 配置目录真机验收 |
| 逐条生成 / 全部生成 / 取消 | 已迁移 | 全部生成、单条重新生成、严格解析、进度与 AbortController 已接入 | 大文档性能真机验收 |
| 接受替换 / 插入下方 / 批注 / 复制 / 跳过 | 已迁移 | 可编辑建议卡片直接调用段落 Word API | 编辑后段落漂移与撤销真机验收 |
| 批量接受 / 插入 / 批注 / 跳过 | 已迁移 | 先统一解析全部稳定锚点并拒绝重复目标，再在单个 `Word.run`/`context.sync` 批次提交；选区多建议拒绝不安全批量覆盖，含进度与状态持久化 | Windows/Mac Undo 栈真机验收 |
| Word 修订读取、定位、接受与拒绝 | 已迁移 | 独立审阅窗格通过 `WordApiDesktop 1.4` 读取修订，操作前同时复核修订索引与类型/作者/时间/格式/文本复合身份，列表或目标变化时安全拒绝；支持逐项定位、接受、拒绝及全部接受/拒绝。Windows Word 16.0.20228.20110 已完成真实运行器验收，旧宿主明确降级由自动化回归覆盖 | macOS WordApiDesktop 1.4 真机验收 |

## 设置工作台

`NewSetting.xaml` 的下列页均不能因 Bridge 已有端点而视为已迁移：

| 设置页 | 状态 |
|---|---|
| 基础设置、语言、输出模式、主题 | 已迁移：AI 模式会切换 Bridge 活动 Provider；语言约束贯通普通聊天、专用工作流与 Agent；默认输出方式控制插入、修订、替换、批注或跨窗格审阅，并在缺少稳定选区时安全降级；主题、计划确认和差异审阅提醒均已接入。Windows 多窗格已验收，macOS 多窗格及双平台修订仍待真机验收 |
| Ollama 端点、模型、下载、删除、温度与 token | 已迁移：多档案、热切换、流式下载进度、载入/删除、温度和最大 token 已贯通 Bridge 与各 Provider；待本机 Ollama 真机验收 |
| 在线模型 Provider、OAuth、能力标记、连接测试 | 已迁移：Provider 增删改、能力标记、连接测试、启用和系统密钥库已接入；Gemini OAuth 保留原版入口语义，但替换旧版“无 PKCE、只保存短期 access token”的实现，改为系统浏览器、随机回环端口、state、PKCE S256、refresh token 系统密钥库保存与自动刷新。待使用真实 Google 桌面客户端凭据在 Windows/macOS 验收 |
| 高级 Ollama 路径、监听、keep-alive、上下文、并发、队列 | 已迁移：设置页通过 Bridge 管理 `OLLAMA_MODELS`、`OLLAMA_HOST`、`OLLAMA_KEEP_ALIVE`、`OLLAMA_CONTEXT_LENGTH`、`OLLAMA_MAX_LOADED_MODELS`、`OLLAMA_NUM_PARALLEL` 与 `OLLAMA_MAX_QUEUE`；Windows 写入当前用户环境，macOS 通过 `launchctl` 写入当前登录会话并在 Bridge 启动时重放。保存后明确要求重启 Ollama，非回环监听二次确认。统一版不会自动搬移可能很大的模型目录，用户需先自行迁移文件；待 Windows/macOS Ollama 真机验收 |
| Skills 列表与导入 | 已迁移：独立 Skills 页面提供列表、ZIP 安全导入、删除和打开系统目录；JS 版使用独立 `WordOllama.JS/Skills`，首次有界复制旧目录后停止同步，增删不再影响并存 COM 版 | Windows/Mac 系统目录与首次迁移真机验收 |
| MCP 服务器、健康与权限 | 已迁移：独立 MCP 页面提供持久化、增删改、连接/断开、自动重连、脱敏错误、连接耗时、主动健康检查、密钥库和逐工具权限 | Windows/Mac 真实 stdio/HTTP/SSE MCP 真机验收 |
| Agent 迭代、执行模式、外部工具、Linter、诊断日志 | 已迁移：执行限制贯通 Bridge；静默审查使用定时段落快照、最多 5 个变化段落和可选轻量模型；任务窗格诊断日志可复制/清空；待 Word 双平台长时运行验收 |
| Markdown 样式映射 | 已迁移：H1/H2/H3/正文/代码/引用/无序列表/有序列表分别映射到 Word 样式；两类列表保持独立设置并分别应用到 `ul`/`ol` block。WordApi 1.5 可读取和创建自定义样式，旧主机降级到可移植内置样式 |
| 更新说明、关于 | 已迁移：加载项/Bridge 版本、更新说明和完整声明已恢复；经授权 Bridge 读取 HTTPS 更新索引并选择当前平台安装器。设置页用内嵌确认区展示版本和发布者，不依赖 Word WebView 原生确认框；Bridge 重新读取索引后限制 512 MB，流式核对大小与 SHA-256，并要求索引发布者、上一版签名 Bridge 配置中固定的发布者和平台签名发布者完全一致。Windows 强制当前用户信任的 Authenticode、RFC 3161 时间戳以及固定 Subject/指纹/公钥哈希，允许用户显式信任的产品自签名证书；macOS 按 Developer ID 或明确的本地自签名模式校验 PKG 身份；失败文件删除且不启动。旧索引只回退手动兼容包下载 | 正式发布源、自签名安装器显式信任、启动及升级后 Bridge/Word 重连仍待发布环境验收 |

当前 Office.js 已建立独立 React 宽版设置弹窗，包含基础、模型、Agent、Markdown、Skills、MCP、进阶、更新和关于导航；诊断使用独立 Ribbon 窗格。设置工作流的代码迁移已完成，表中列出的真实外部服务和双平台宿主门槛仍需发布环境验收。

## Ribbon 与独立窗口

原 Ribbon 包含创作、按需修改、图片理解、生成表格、HTML 应用、Markdown、Agent、编辑/续写/改错/对比、翻译、法务、自定义功能、设置和状态等入口。当前 manifest 已通过微软官方 schema 验证，Office.js 命令使用明确命名的独立 `WordOllama.JS` 自定义页签，避免与现有 COM `WordOllama` 页签或“开始”页混淆；并按工作边界建立 Agent、自由创作、按需修改、图片、表格、HTML、Markdown、编辑、翻译、文档比较、文档审阅、法律通用、模拟法庭、法律检索、自定义提示词和诊断 `TaskpaneId`，避免命令因复用类别容器而互相覆盖。设置使用 `ExecuteFunction` 打开独立 Office Dialog，不占右侧窗格；同一 TypeScript bundle 仍通过路由复用实现。16 个不同 `TaskpaneId` 和设置弹窗已在真实 Windows Word 验证，macOS 仍待同项验收。动态 Ribbon 标签受静态 XML 限制，任务窗格现以紧凑状态栏等价显示 Bridge 配对/不可用状态及活动 Provider/模型，并在重新聚焦或恢复可见时刷新；仍需 Windows/Mac 真机确认字体和超长模型名截断。

最终用户界面只保留任务名称、输入控件、操作、必要状态/错误及安全确认；“对应原版”“迁移状态”“跨平台实现方式”等开发说明不进入任务窗格。兼容性和实现细节保留在本矩阵及诊断页，避免占用窄窗格。

Writing、Translator、LawSearch、MootCourt、TextToTable、CreateHTML、ChatWithIMG、CustomPrompt、UpdateLog 和 About 已转换为任务窗格内专用工作台或设置页。DocxDiffAnalyze/Compare 与 DiffReview 已有独立统一版比较窗格；comparer v2 会同时返回原稿/修订稿的样式、结构位置和新增项的原稿插入锚点。用户可逐项勾选接受/保留原稿，确认当前文档为原稿副本后，在一个 Office.js 批次中以 Word 修订写入，随后到独立“文档审阅 → Word 修订”逐项接受或拒绝。自动回归覆盖中间插段、文首插入、同锚点多项顺序、标题样式变化、段落删除、表格单元格文本修改、表格前插导致的位置迁移、重复段落和 2,100 段非二次内存路径；Office.js 无法安全重建或删除的表格结构差异会禁用应用并明确标记仅供审阅。真实复杂合同宿主验收仍待完成。

## 诊断专用功能

36 工具金样本与运行日志位于独立 `DiagnosticsPane`。配对、Bridge 健康和 Ollama 服务管理保留在设置弹窗的进阶页；DOCX comparer 使用专注的比较页面。它们不再占据 Agent 主面板，开发验收能力也不计入原版 UI 完成度。

Windows Word 16.0.20228.20110（zh-CN）真实宿主金样本已完成 36/36，通过报告归档于 `docs/evidence/windows-word-16.0.20228.20110-golden-2026-07-29.json`。实测同时发现 Word WebView2 不可靠支持 `window.confirm()`/`window.prompt()` 的交互，金样本启动确认与 `ask_human` 已改为窗格内 HTML 交互；修复后的第二次运行失败、不支持和阻塞均为 0。

同一真实 Windows Word 宿主已完成 1,000/5,000 段长文档验收，两档均通过全文读取、末端 50 段分块、语义映射和“在目标前插入段落”后的稳定锚点重定位，所有单项均低于 30 秒预算。5,000 段档共 393,892 字符，建档 3,567 ms、全文读取 279 ms、末端分块 288 ms、语义映射 278 ms、重定位 4,306 ms；原始报告归档于 `docs/evidence/windows-word-16.0.20228.20110-long-document-2026-07-29.json`。该结果证明 Windows 当前版本的单客户端长文档与模拟插入漂移，不替代真实双客户端共同编辑、修订降级和 macOS 验收。

Windows Word 16.0.20228.20110 还通过了 `WordApiDesktop 1.4` 修订真实运行器：建立测试修订后可读取并验证复合身份、定位目标、接受单条并保留文本、拒绝单条并移除文本、全部接受并清空修订集合，同时恢复原修订模式；报告归档于 `docs/evidence/windows-word-16.0.20228.20110-revisions-2026-07-29.json`。自动化 runner 另验证缺少 `WordApi 1.4` 或 `WordApiDesktop 1.4` 时返回明确的 `unsupported` 降级结果；macOS 仍待真机执行同一报告。

## 完成判定

只有当上表每一项达到“已迁移”，并在 Windows Word 与 macOS Word 以对应任务窗格宽度、浅色/深色、中文/英文完成视觉和交互验收后，才能宣称 UI 与原 WordOllama 统一。自动化工具矩阵只能证明底层调用，不足以证明产品界面等价。
