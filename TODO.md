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
MCP、Skills 和 Markdown 设置已完成新 UI。基础设置已拆分为结构化“记忆”和
“输出偏向”，但自动记忆执行链路尚未完成，见下方 P0。

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
- [x] Skills Markdown 全文预览、MCP JSON 导入和 Word Markdown 样式读取/新建。
- [x] Bridge 结构化保存记忆条目和输出偏向，支持旧 `writingProfile` 数据迁移。

## P0：记忆与输出偏向

- [x] 将“用户画像”改为“记忆”，将语气、篇幅、结构、术语、改写幅度和引用
  习惯归入独立“输出偏向”。
- [x] 记忆设置 UI 支持逐条新增、行内修改、单条删除、全选、删除所选和全部删除。
- [x] Bridge 提供结构化记忆的新增、修改和批量删除 API；当前使用本地 JSON，
  保留稳定 ID 和时间戳，不使用 Markdown 作为主存储。
- [x] 前端兼容尚未升级的旧 Bridge 返回格式，避免设置页白屏。
- [ ] 完成“自动记忆”执行链路。目前开关和持久化字段已经存在，但任务结束后
  尚未触发额外模型调用。
- [ ] 明确自动记忆隐私策略后再接通模型调用：
  - 推荐默认仅允许 Ollama、LM Studio、vLLM、llama.cpp 等回环地址本地模型。
  - 如允许在线 Provider，必须在 UI 中明确说明任务信息会再次发送给当前供应商。
  - 只允许记住用户自身信息、长期偏好、近期任务脉络和持续关注点。
  - 禁止保存文档正文、第三方个人信息、密钥、令牌、财务/医疗信息和一次性指令。
- [ ] 为自动记忆增加严格 JSON 输出解析、去重、纠错更新、失败静默和调用次数测试。
- [ ] 将记忆和输出偏向接入翻译、润色、审阅、Agent 等全部提示词，并验证不会
  泄漏到不相关任务。
- [ ] 数据达到需要全文检索、向量召回或大量任务历史时，再将结构化 JSON 无损
  迁移到 SQLite；当前小规模记录不引入数据库原生依赖。

## P0：安装后直接可用

### localhost HTTPS 信任

- [ ] 明确产品采用的证书信任策略。
- [ ] Windows 安装器生成每用户、仅限 `localhost/127.0.0.1` 的服务器叶证书。
- [ ] 如选择自动信任，必须在用户明确同意后写入“当前用户”信任库。
- [ ] 证书必须包含 SAN：`localhost`、`127.0.0.1` 和 `::1`。
- [ ] PFX 使用随机密码，密码只写入 Windows Credential Manager/macOS Keychain。
- [ ] 记录证书指纹，升级时安全轮换，卸载时只删除本产品拥有的证书。
- [ ] macOS 设计一次明确的 Keychain 信任确认；不得绕过系统授权对话框。
- [ ] 为证书创建、信任、轮换和卸载添加目标平台实机回归。

注意：向受信任根证书库写入自签名证书会改变本机信任边界，目前尚未获得针对这一
具体动作的明确授权，因此代码没有自动执行该操作。

### 无感首次配对

- [ ] 桌面同源模式不应要求普通用户从隐藏的 `bridge.log` 复制随机配对码。
- [ ] 设计仅允许 Bridge 自己托管页面获得会话的安全同源引导流程。
- [ ] 保留跨 origin/开发模式的手动配对码。
- [ ] 防止任意本地网页伪造 `Origin` 后获取 Bridge 会话。
- [ ] 添加首次安装、会话过期、Bridge 重启和多任务窗格共享会话回归。

### 安装器体验

- [ ] Windows 安装完成后验证 Bridge `/health` 和 `index.html` 再提示成功。
- [ ] macOS PKG 完成后验证 LaunchAgent、HTTPS 和 manifest。
- [ ] 安装/升级时安全停止旧 Bridge，完成后启动新版本。
- [ ] Word 正在运行时提示用户完全退出并重启，以刷新 manifest/Ribbon 缓存。
- [ ] 为 Windows 安装器补充仓库原生 `.ico`，不要再引用旧 COM 仓库资源。

## P0：目标平台发布验证

- [ ] 使用真实 CA 代码签名证书生成 Windows EXE。
- [ ] 验证 Authenticode、RFC 3161 时间戳和发布者固定值。
- [ ] 在干净 Windows 用户账户完成安装、升级、回滚和卸载。
- [ ] 在真实 Windows Word 重新执行 36/36 工具、长文档和修订验收。
- [ ] 在 Apple Silicon Mac 构建、Developer ID 签名、公证并 staple PKG。
- [ ] 在 Intel Mac 构建、签名、公证并验收。
- [ ] 在真实 Mac Word 检查 16 个独立窗格、设置 Dialog、深浅主题和中英文。
- [ ] 生成新版 Windows/macOS 补充宿主证据后运行终审脚本。

## P1：离线产品闭环

- [ ] 明确 Ollama 是外部依赖还是由安装器提供可选安装入口。
- [ ] 离线状态下检测 Ollama，并给出本地化、可操作的错误提示。
- [ ] 确认内置 Skills、MCP 配置和用户设置全部位于 `WordOllama.JS` 独立目录。
- [ ] 验证完全断网时前端、设置、Word 工具、本地 Agent 和本地 MCP 可运行。
- [ ] 云 Provider 在离线时快速失败，不阻塞本地功能。
- [ ] 明确桌面离线版不支持 Word 网页版。

## P1：运行与资源

- [ ] 保持 Bridge 单实例和当前用户登录自启。
- [ ] Provider、MCP 和 Agent 重型组件继续按需初始化。
- [ ] 建立空闲内存基线门禁；当前 Windows Release 约为：
  - 工作集：65.6 MB。
  - 私有内存：49.3 MB。
  - 空闲 CPU：接近 0。
- [ ] 测量连接多个 MCP Server、长 Agent 会话和多窗格后的资源占用。
- [ ] 不把 Ollama 模型内存计入 Bridge 指标；单独展示本地模型资源。

## P1：发布与更新

- [ ] 配置正式下载域名和三平台更新索引。
- [ ] 完成 Windows/macOS 三个 runtime 的 `releaseReady: true` 终审描述文件。
- [ ] 验证更新下载的大小、SHA-256、签名发布者和失败清理。
- [ ] 验证设置页一键更新、版本回滚和旧版本保留策略。
- [ ] 发布前递增四段 `ManifestVersion`，避免 Word 使用旧 Ribbon 缓存。
- [ ] 准备最终用户安装、升级、卸载和离线使用文档。

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

- `npm run build`：通过。
- Office.js UI parity 与 settings i18n smoke：通过。
- Desktop Bridge Debug 构建：0 警告、0 错误。
- 统一 Release 冒烟已通过前端构建、36 工具注册、宿主能力矩阵、Golden、
  长文档、修订、Provider 设置、结构化记忆存储、MCP/Ollama 设置及更新安全测试。
- 统一脚本最后的独立 Bridge live API 阶段仍返回一次 HTTP 405，需要换设备后优先
  定位具体请求路径；当前开发 Bridge 已重新启动且 `/health` 返回 `ready: true`。

涉及签名、证书、Credential Manager、Keychain、注册表、LaunchAgent 或真实 Word 的
修改，必须在相应目标操作系统上再次实测，不能只凭跨平台编译结果标记完成。
