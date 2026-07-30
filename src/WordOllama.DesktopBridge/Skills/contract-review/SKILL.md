---
name: contract-reviewer
description: 中英文合同审查与修订工作流。
compatibility: 需要 WordOllama Office.js 文档工具。
metadata:
  version: "1.0"
  type: built-in
---

# 合同审查与修订工作流

先读取文档大纲和定义，再检查交叉引用、必备条款与风险条款。发现确定性文字错误时使用 `replace_exact_text` 或 `replace_paragraph`；事实不明、需要谈判或法律判断时使用 `add_comment` / `highlight_risk`，不要擅自改写。完成后输出修改摘要、风险等级和待人工确认事项。

审查时可按需读取 `references/essential-clauses.md` 与 `references/risk-guidelines.md`。
