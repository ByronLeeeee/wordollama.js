# Security Policy

WordOllama.JS can send document content to configured model providers and can
optionally invoke local tools or MCP servers. Treat documents, credentials,
Skills, MCP configuration, signing material, and diagnostics as sensitive.

Do not publish credentials, private documents, exploit details, or a working
malicious MCP configuration in a public issue. Report vulnerabilities privately
to [liboyang@lslby.com](mailto:liboyang@lslby.com). You may also use GitHub's
private vulnerability reporting if it is enabled for this repository.

Security fixes are provided for the current `main` branch and the most recent
published release candidate. Old test packages and unmaintained commits do not
receive separate security updates.

Include the affected version or commit, platform and host, reproduction steps,
impact, and any suggested mitigation. Remove document content, API keys, OAuth
tokens, certificate private keys, and personal information before sending a
report. The maintainer will coordinate disclosure and credit with the reporter;
do not publicly disclose an unpatched vulnerability before that coordination.

See [docs/SECURITY.md](docs/SECURITY.md) for the reporting checklist, platform
vault behavior, Agent recovery encryption, and user-safety guidance.

The data-flow and deletion summary is in [PRIVACY.md](PRIVACY.md).
