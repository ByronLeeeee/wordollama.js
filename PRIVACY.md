# Privacy

WordOllama.JS has no product analytics, advertising SDK, or developer-operated
telemetry endpoint. It does not automatically send documents or prompts to the
project maintainer.

## Data that can leave the device

When you run an AI feature, the selected text, document content, prompt,
conversation context, memory, or tool result required by that feature can be
sent to the model provider you configured. Online search, URL retrieval, OAuth,
MCP servers, and other external tools can send the query or task data to their
respective services. Their privacy policies and retention rules apply.

Use a local provider and disable network/MCP permissions when a document must
remain on the device. Review source cards before relying on externally retrieved
information.

## Local storage

Settings, task history, Skills, memories, diagnostics, and recovery data are
stored locally by the Desktop Bridge. API keys and supported recovery secrets
are stored through the operating-system credential vault where available. The
Office.js frontend must not persist API keys in browser storage.

Local diagnostic logs can contain provider names, URLs, error messages, and
limited task metadata. Do not publish logs without reviewing and redacting them.

## Control and deletion

You can remove model credentials and local data from the settings interface.
Uninstalling the application removes program files; user-created Skills,
settings, or recovery data may be retained to avoid accidental loss and can be
deleted manually after backup. Platform-specific paths are documented in the
user guides.

Security issues or privacy concerns should be reported privately to
liboyang@lslby.com. Do not attach private documents, credentials, or unredacted
logs to a public issue.
