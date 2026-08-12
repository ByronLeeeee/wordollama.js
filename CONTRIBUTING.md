# Contributing

Thank you for improving WordOllama.JS. Contributions are accepted under the
project's GPL-3.0-only license. By submitting a change, you confirm that you have
the right to contribute it under that license.

## Set up a development checkout

Install Node.js 24, .NET SDK 8, and PowerShell 7, then run:

```powershell
cd officejs/apps/addin
npm ci
npm run build
cd ../../..
dotnet build ./src/WordOllama.DesktopBridge/WordOllama.DesktopBridge.csproj -c Release
```

The user guides and platform setup are linked from `README.md`. Real Word or WPS
host tests are required only when a change touches host behavior; clearly say
which host/platform combinations you actually tested.

## Development rules

- Keep user-visible strings in both en-US and zh-CN i18n resources.
- Preserve default-deny behavior for commands, local files, network tools, and
  untrusted MCP tools.
- Never store API keys in Office.js state, JSON settings, logs, or fixtures.
- Keep Windows, macOS, Linux, Word, and WPS behavior behind explicit capability
  checks; do not claim a host as tested without real-host evidence.
- Add focused coverage for UI, protocol, policy, packaging, or host-capability
  changes.
- Update `docs/THIRD-PARTY-NOTICES.md` and package notice generation when adding
  a runtime dependency.
- Do not commit `node_modules`, `dist`, `bin`, `obj`, certificates, signing
  identities, private documents, generated release artifacts, or real API keys.

Run the directly relevant `npm run test:*` command while iterating. Before a
release-affecting pull request, run the local full gate:

```powershell
pwsh ./tools/unified-smoke-test.ps1 `
  -Configuration Release `
  -SkipManifestValidation
```

GitHub package workflows are intentionally manual and do not replace local
validation. A pull request should describe user-visible behavior, security and
privacy impact, platform/host coverage, tests performed, and any remaining
manual verification.

Use public issues for non-sensitive bugs and proposals. Follow `SECURITY.md` for
vulnerabilities and `CODE_OF_CONDUCT.md` for community interactions.
