# WordOllama.JS User Guide

WordOllama.JS supports Windows x64 and Apple Silicon Mac, with a Linux x64 WPS
preview. Ollama is an
optional external dependency. The Desktop Bridge starts for the current user and
hosts both the add-in UI and local API, so a packaged installation does not need
Vite or a terminal.

## Install on Windows

1. Download the installer, its SHA-256, and the WordOllama.JS code-signing
   certificate from the official download location. Verify both the hash and
   certificate thumbprint.
2. A self-signed release has no SmartScreen reputation. After verifying its
   origin, explicitly import the code-signing-only, non-CA certificate into the
   current user's Trusted Publishers store. If Windows still reports an untrusted
   chain, import that same end certificate into the current user's Trusted Root
   Certification Authorities store. Never use the Local Machine store or trust a
   mismatched certificate.
3. Run `WordOllama-Installer-<version>-win-x64.exe`. Approve the separate localhost
   HTTPS certificate only after checking the purpose, SHA-256 thumbprint, and
   expiry shown by the installer.
4. Fully quit and reopen Word, then add and activate a model in Settings. No
   Ollama or llama3.2 profile is created automatically.

A normal update reuses the product-owned localhost certificate when it remains
valid for at least 30 days and its purpose, PFX, private key, credential, and
thumbprint are intact. It replaces the Bridge, frontend, and manifest without
changing certificate trust. The installer rotates the certificate only when it
is missing, damaged, near expiry, or an explicit security-maintenance rotation
is requested. Uninstall removes the owned localhost certificate and credential.

## Install on Apple Silicon Mac

The current CI produces an unsigned macOS package. It has no Apple notarization,
stapling, Developer ID identity, or warning-free Gatekeeper result and must never
be represented as Apple-notarized.

Verify the PKG hash, then Control-click the verified PKG and choose Open; if it is
still blocked, use Privacy & Security > Open Anyway for that exact package. Never
disable Gatekeeper globally. After installation, run
`~/Applications/WordOllama.JS/Complete WordOllama.JS Setup.command` and approve the
separate localhost certificate. Intel Mac is not supported.

## Install for WPS Writer on Linux x64

The Linux build targets WPS Writer only. Verify the `.tar.gz` against its
`.sha256` sidecar, extract it, and run `./install.sh` as the desktop user—never
with `sudo`. The installer registers the add-in in
`~/.local/share/Kingsoft/wps/jsaddons/publish.xml`, enables a systemd user
service, and checks the loopback Bridge before asking you to restart WPS.
`libsecret-tools` is required to save cloud API keys and `bubblewrap` enables
sandboxed Agent Python/Node execution. Linux updates are manual in this preview.

## Models, updates, offline use, and removal

- Settings > Models can store unlimited models per provider. No active model
  means AI features stop with an activation prompt instead of silently choosing
  Ollama. API keys live in Credential Manager, Keychain, or Linux Secret Service.
- Settings > Updates shows the pinned publisher, certificate thumbprint, and
  public-key SHA-256. The Bridge verifies runtime, size, SHA-256, and platform
  signature before opening an installer; failed downloads are removed.
- The previous Bridge version is retained. Settings > Updates shows a confirmed
  rollback action only when that retained version validates successfully; the
  packaged rollback entry remains available independently. Development/offline deployments can run
  `packaging/rollback-bridge.ps1` against their install root.
- The local UI, Word tools, Ollama, Skills, local MCP, and isolated Python/Node
  workspace can run offline when their dependencies were installed in advance.
  Cloud providers and web tools fail fast without disabling local features.
- Microsoft requires Word API pages to reference `office.js` from the official
  Office CDN. Word must therefore be able to load its own runtime bootstrap; the
  installer does not ship an unsupported private copy of `office.js` and does
  not promise a cold start when the Microsoft CDN is blocked. Apart from that
  host bootstrap, React/CSS/SVG, settings, Bridge APIs, and local features are
  served from localhost, with a build gate preventing extra remote assets.
- On Windows, uninstall from Installed apps. On Mac, run
  `~/Applications/WordOllama.JS/Uninstall WordOllama.JS.command`. Removal does not
  delete Ollama, its models, the old COM add-in, or unrelated certificates.
- On Linux, run `~/.local/share/WordOllama.JS/uninstall.sh`.
