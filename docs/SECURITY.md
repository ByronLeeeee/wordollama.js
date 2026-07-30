# Security Policy

## Scope

WordOllama can send document text to configured AI providers and can optionally call external Agent tools or MCP servers. Treat provider credentials, document contents, Skill files, and MCP configuration as sensitive.

## Reporting a vulnerability

Please do not publish credentials, private documents, exploit details, or a working malicious MCP configuration in a public issue. Contact the project maintainer privately through the contact channel listed on the project website, and include:

- affected version or commit;
- host application, operating system, Word version, and .NET environment;
- reproduction steps with sanitized input;
- impact and any suggested mitigation.

Allow reasonable time for triage before public disclosure.

## User safety notes

- External Agent tools are disabled by default.
- Local file search is treated as an external permission. It is limited to explicitly authorized roots such as the current document directory and the isolated `WordOllama.JS/Skills` directory, skips sensitive credential files, and requires approval.
- Review every external operation approval, especially commands, URLs, and MCP calls.
- Do not mark an MCP server trusted unless you control and understand it.
- Legacy SSE message endpoints must remain on the same origin as the configured MCP server so authorization headers are not forwarded elsewhere.
- Keep Ollama bound to `127.0.0.1`/`localhost` unless remote access is deliberately required. Ollama does not provide built-in request authentication; a non-loopback `OLLAMA_HOST` can expose models and prompts to the local network. WordOllama requires explicit confirmation before saving such a value.
- Changing `OLLAMA_MODELS` only changes Ollama's configured directory. WordOllama does not move or delete existing model files automatically.
- Gemini OAuth uses the system browser, a random `127.0.0.1` callback port, state validation, and PKCE S256. OAuth access tokens, refresh tokens, and an optional desktop-client secret are stored only in the operating-system credential vault. Never paste OAuth credentials into issue reports or diagnostic logs.
- Agent recovery encrypts up to ten checkpoints with AES-256-GCM. The random key is stored only in Windows Credential Manager or the current user's macOS Keychain, while the task pane stores only reconnect metadata. Recovery is origin-isolated, requires explicit user confirmation after a Bridge restart, and removes the checkpoint when a task finishes, is discarded, or is cancelled.
- Office.js user data and native secrets use the `WordOllama.JS` product namespace. First-run compatibility copies only known legacy Bridge files and bounded, non-linked Skill content; it never moves or deletes COM-era sources, and later JS edits do not synchronize back into the COM profile.
- Never commit API keys, certificates, document samples containing personal data, or local absolute paths.
