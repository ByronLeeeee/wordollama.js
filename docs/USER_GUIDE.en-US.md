# WordOllama.JS User Guide

WordOllama.JS initially supports Windows x64 and Apple Silicon Mac. Ollama is an
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

## Install on Apple Silicon Mac

The local self-signed release cannot obtain Apple notarization, stapling, or a
warning-free Gatekeeper result. Its evidence is marked
`explicitUserTrustRequired: true`; it is never represented as Apple-notarized.

Verify the PKG hash and identities, import the supplied application and installer
certificates into the current user's login Keychain, and trust only the verified
WordOllama.JS identities. Control-click the verified PKG and choose Open; if it is
still blocked, use Privacy & Security > Open Anyway for that exact package. Never
disable Gatekeeper globally. After installation, run
`~/Applications/WordOllama.JS/Complete WordOllama.JS Setup.command` and approve the
separate localhost certificate. Intel Mac is not supported.

## Models, updates, offline use, and removal

- Settings > Models can store unlimited models per provider. No active model
  means AI features stop with an activation prompt instead of silently choosing
  Ollama. API keys live in Credential Manager or Keychain.
- Settings > Updates shows the pinned publisher, certificate thumbprint, and
  public-key SHA-256. The Bridge verifies runtime, size, SHA-256, and platform
  signature before opening an installer; failed downloads are removed.
- The previous Bridge version is retained and can be selected with the packaged
  rollback entry. Development/offline deployments can run
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
