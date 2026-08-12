# Open-source readiness

Last reviewed: 2026-08-12

WordOllama.JS is ready for public source collaboration, but the repository does
not yet claim a stable production release. “Source is open” and “every packaged
platform has completed release acceptance” are separate gates.

## Repository gate

| Area | Status | Evidence |
| --- | --- | --- |
| License | Ready | `LICENSE`, `NOTICE`, GPL-3.0-only package metadata |
| Corresponding source | Ready | `SOURCE.md`, public repository, documented build scripts |
| Binary legal notices | Automated | Add-in and Bridge packagers include project and dependency notices |
| Secrets | Ready | No tracked signing keys, credentials, `.env`, or private documents in the audited tree/history patterns |
| Privacy and security | Ready | `PRIVACY.md`, `SECURITY.md`, `docs/SECURITY.md` |
| Contribution process | Ready | `CONTRIBUTING.md`, issue forms, pull-request template, code of conduct |
| Reproducible toolchain | Ready | lockfile, Node 24 declaration, .NET SDK selection, deterministic build metadata |
| Automated packaging | Ready with manual dispatch | Native Windows/macOS/Linux jobs exist; expensive package workflows remain manual by design |

## Stable-release gate still open

- Complete clean-account Windows install/upgrade/rollback/uninstall acceptance.
- Complete real Microsoft Word acceptance on supported Windows and macOS hosts.
- Complete real WPS acceptance on Windows, Apple Silicon macOS, and Linux x64.
- Activate and verify the selected `downloads.wordollama.com/js/` R2 update
  channel and an immutable source archive for the matching release tag.
- Enable GitHub branch protection and private vulnerability reporting.
- Publish versioned release notes and cryptographic hashes; sign/notarize only
  platforms for which production credentials and trust expectations are clear.

These release-maintainer gates require target-host or repository-administration
evidence. A simulated or cross-compiled result must not be described as
real-host acceptance.
