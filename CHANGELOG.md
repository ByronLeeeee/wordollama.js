# Changelog

Notable user-visible changes will be recorded here. This project has not yet
declared a stable release; test build identifiers are not compatibility promises.

## Unreleased

### Added

- Unified Microsoft Word and WPS frontend with a cross-platform Desktop Bridge.
- Agent tasks, Skills, MCP, model-provider management, source cards, prompt
  optimization, writing, editing, translation, review, image, table, Markdown,
  HTML, comparison, and legal workflows.
- Windows, Apple Silicon macOS, and Linux x64 packaging paths with explicit
  host/platform capability checks.
- GPL license, corresponding-source, privacy, third-party notice, contribution,
  security, and community-governance documentation in source and binary packages.

### Security

- Local session pairing, origin checks, OS credential-vault integration,
  default-deny Agent permissions, restricted update metadata, and package
  signing/finalization gates.

### Fixed

- Standard .NET 8 SDK builds no longer fail on ambiguous `string.Split`
  collection-expression overloads.
- Local integration and package tests can run alongside an installed Bridge
  without weakening the production per-user single-instance lock.
