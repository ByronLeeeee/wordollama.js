# WordOllama.JS

WordOllama.JS is the Windows/macOS unified edition of WordOllama. It uses a
React 19 + TypeScript + Vite Office.js add-in and a cross-platform .NET 8
Desktop Bridge for Agent, Provider, MCP, Skill, local-tool, and secure
platform integration.

The installed desktop edition is self-hosted: the per-user Desktop Bridge
serves the bundled React frontend and local API from
`https://localhost:37421`, registers the Office manifest, and starts
automatically at sign-in after the one-time local HTTPS trust provisioning.
End users do not run Vite or start a separate service.

The legacy COM/VSTO edition is maintained separately in
[`wordollama-community`](https://github.com/ByronLeeeee/wordollama-community).
This repository contains no COM registration, XAML task pane, or VSTO project.

## Layout

- `officejs/`: Office Add-in, React task panes/settings, manifest, and host tests.
- `src/`: .NET 8 contracts, Agent/provider core, MCP, platform adapters, Bridge,
  and the Windows installer.
- `packaging/`: add-in, Bridge, Windows EXE, macOS PKG, signing, update, and
  rollback workflows.
- `tools/`: unified, platform-vault, packaging, and real-host evidence runners.
- `docs/`: migration plan, UI parity matrix, security notes, and acceptance
  evidence.

## Verify

```powershell
cd officejs/apps/addin
npm ci
cd ../../..
pwsh ./tools/unified-smoke-test.ps1 -Configuration Release -SkipManifestValidation
```

Target-native package and live tests run on Windows x64, Apple Silicon macOS,
and Intel macOS in `.github/workflows/officejs-unified-ci.yml`.

See [the unified implementation plan](docs/OFFICE_JS_UNIFIED_DESKTOP_PLAN.zh-CN.md)
and [UI parity matrix](docs/OFFICE_JS_UI_PARITY_MATRIX.zh-CN.md).
