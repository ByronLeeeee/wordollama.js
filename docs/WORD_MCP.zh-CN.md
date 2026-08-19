# 让外部 Agent 控制当前 Word 文档

WordOllama.JS 可以把已打开任务窗格中的 Word 工具作为本机 Streamable HTTP MCP
提供给 Codex 等外部 Agent。Word 文档仍由 Office.js/WPS 适配器操作；Desktop Bridge
只负责鉴权、工具目录和请求转发。因此不需要 COM/VSTO。Microsoft Word 在支持
`SharedRuntime 1.1` 时会让 Ribbon、任务窗格和 MCP 宿主共用一个长生命周期运行时；
首次打开一次插件后，即使关闭任务窗格，当前文档的 MCP 宿主仍可继续工作，并会为下次
重新打开该文档设置后台自动加载。WPS 没有 Office Shared Runtime，仍需保持任务窗格打开。

## 安全边界

- 外部 Word MCP 默认关闭。
- 启用后 Bridge 仍必须只绑定回环地址。
- MCP 请求必须携带至少 32 字符的 Bearer Token。
- 读工具标记为只读；所有 Word 写工具标记为写入/破坏性操作，建议 MCP 客户端对写入逐次确认。
- 只有一个任务窗格时工具直接作用于该窗格；存在多个任务窗格时，写入前必须使用
  `wordollama_status` 返回的随机 `host_id` 明确选择目标。状态不会暴露文档路径或内容。
- `apply_precise_revision` 会先确认当前选区仍与 `original` 完全一致，再把差异片段写成
  Word 修订；选区变化时拒绝执行。
- 所有依赖当前选区或光标的写工具都必须提交 `expected_selection_hash`：
  `insert_at_cursor`、`add_comment`、`format_text`、`insert_page_break`、`format_list` 和
  `apply_precise_revision`。哈希绑定当前文档、选区起止位置和文本；校验与写入在同一个宿主
  操作中完成。用户移动光标、改变选区或目标位置发生变化后，旧哈希会失效，工具不会写入。
- `select_exact_text` 只在全文存在唯一、区分大小写的精确匹配时改变选区；0 个或多个
  匹配都会拒绝，避免外部 Agent 静默选错位置。输入长度限制为 1–255 个字符。虽然不改正文，
  它会改变共享的可见选区，因此在 MCP 元数据中仍按写操作标记，要求写权限/确认。

## 启用 Bridge 端点

推荐在 WordOllama 设置的“MCP → 外部 Agent 控制 Word”中点击“随机生成并启用”。
程序会自动生成满足安全要求的令牌、写入系统凭据库并立即启用端点。用户只需复制一次，
无需手工输入 32 个字符；再次生成会立即使旧令牌失效。
设置页同时提供“复制 Agent 配置”和“关闭 Word MCP”：前者把包含地址与 Bearer Header
的标准 `mcpServers` JSON 写入剪贴板，后者立即停止端点但保留凭据库中的令牌。
重新生成令牌前必须通过二次确认。

为当前用户设置以下环境变量，然后完全重启 Desktop Bridge 和 Word：

```powershell
$token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
[Environment]::SetEnvironmentVariable("WORDOLLAMA_WORD_MCP_TOKEN", $token, "User")
[Environment]::SetEnvironmentVariable("Bridge__WordMcp__Enabled", "true", "User")
```

也可以在 Bridge 的 `appsettings.json` 中设置：

```json
{
  "Bridge": {
    "WordMcp": {
      "Enabled": true,
      "AccessToken": "至少 32 个字符的随机令牌"
    }
  }
}
```

不要把真实令牌提交到仓库。正式 Windows/macOS 桌面包默认使用
`https://127.0.0.1:37421/mcp/word`；Linux WPS 默认使用
`http://127.0.0.1:37421/mcp/word`。开发配置以 `Bridge:Urls` 为准。

## 连接 Codex

确保启动 Codex 的进程能够读取 `WORDOLLAMA_WORD_MCP_TOKEN`，然后在 Codex
`config.toml` 中加入：

```toml
[mcp_servers.wordollama_word]
url = "https://127.0.0.1:37421/mcp/word"
bearer_token_env_var = "WORDOLLAMA_WORD_MCP_TOKEN"
default_tools_approval_mode = "writes"
tool_timeout_sec = 120
enabled = true
```

保存后重启 Codex。首次使用时先在目标文档中打开一次 WordOllama.JS，再用
`wordollama_status` 检查连接；若返回多个 host，请先用带 `host_id` 的只读工具确认目标，
后续每次写入都携带同一个 `host_id`。若 MCP 客户端在任务窗格打开前缓存了工具目录，请刷新
MCP 工具或重启该 MCP 连接。

## 安全精确选中工具

外部 Agent 不应先用模糊搜索选中第一处结果。先读取文档内容，截取一段可唯一定位的原文，
再调用：

```json
{
  "name": "select_exact_text",
  "arguments": {
    "text": "文档中唯一存在的完整原文"
  }
}
```

成功时返回 `{"selected":true,"matchCount":1,"text":"…","selectionHash":"…"}`。失败不会改变当前选区；
Agent 应扩大上下文使目标唯一，而不是反复改用较短文本。

随后把返回的 `selectionHash` 原样传给选区写工具：

```json
{
  "name": "add_comment",
  "arguments": {
    "text": "请复核此处依据。",
    "expected_selection_hash": "select_exact_text 返回的 64 位哈希"
  }
}
```

也可以调用 `get_selection` 获取当前选区文本和 `selectionHash`。不要自行计算或复用另一
文档、另一运行会话的哈希；收到选区已变化错误后应重新读取/选中，再由用户确认写入。

## 精确修订工具

内置 Agent 和外部 MCP 共用同一个工具：

```json
{
  "name": "apply_precise_revision",
  "arguments": {
    "original": "当前选区的完整原文",
    "revised": "修改后的完整文本",
    "expected_selection_hash": "get_selection 或 select_exact_text 返回的 64 位哈希"
  }
}
```

调用成功时返回 `{"precise":true}`。`revised` 可以是空字符串，以修订方式删除当前
选区；`original` 不允许为空。外部 Agent 应先调用 `get_selection`，保留返回的完整文本，
再把它原样作为 `original` 提交，并把同一响应中的 `selectionHash` 作为
`expected_selection_hash`，不要自行裁剪空格或换行。
