# Contributing

WordOllama.JS supports Microsoft 365 Word on Windows and macOS through one
Office.js frontend and a cross-platform .NET 8 Desktop Bridge.

- Keep user-visible strings in the en-US and zh-CN i18n resources.
- Preserve default-deny behavior for commands, local files, network tools, and
  untrusted MCP tools.
- Never store API keys in Office.js state, JSON settings, logs, or fixtures.
- Keep Windows and macOS behavior behind tested platform boundaries.
- Add focused smoke coverage for UI, protocol, policy, packaging, or host
  capability changes.
- Do not commit `node_modules`, `dist`, `bin`, `obj`, certificates, signing
  identities, private documents, or generated release artifacts.

Before submitting a change, run the relevant focused test and:

```powershell
pwsh ./tools/unified-smoke-test.ps1 -Configuration Release -SkipManifestValidation
```

Describe the user-visible behavior, security impact, Windows/macOS coverage,
and tests in the pull request.
