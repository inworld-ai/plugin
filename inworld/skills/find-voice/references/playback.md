# Native audio presentation

Use existing saved files; presentation alone does not authorize new generation,
listening claims or sending to another destination.

- **Codex desktop:** put returned `playbackMarkdown`, or
  `![Voice or model name](/absolute/path/to/clip.mp3)`, in the final answer,
  outside code blocks. A local MP3 embed was user-confirmed in this host.
- **Claude Code desktop:** return a labeled absolute file link or the tool's
  `playbackMarkdown`. In the tested build, the chat renders a file link; clicking
  it opens the native Files pane with Play, seek and volume controls. Playback
  through the full clip was verified there. Do not promise an inline chat player
  or describe an initial loading state as a playback failure before testing Play.
- **OpenClaw:** prefer native audio attachments. In automatic visible-reply mode,
  put `MEDIA:/absolute/path/to/clip.mp3` on its own line in the final answer;
  double-quote paths containing spaces. This is final-answer delivery syntax,
  not a raw tool-output protocol. When the session requires `message_tool_only`,
  follow its structured attachment contract and the authorized destination.
  Never message an external channel merely to preview audio.
- **Cursor:** prefer its native file preview. Absolute paths, relative paths and
  `file://` Markdown audio embeds did not produce working inline players in the
  tested IDE session. This does not establish every Cursor UI route's limits.
- **Other hosts:** use verified native media support, or a capability-advertised
  MCP Apps card. Keep file preview as a fallback. Do not promise inline controls
  merely because the host accepts Markdown or audio tool results.

OpenClaw 2026.10.6's real Control UI passed single-clip playback, two-player
coordination and keyboard seeking using existing audio fixtures. These checks
validate its renderer, not an installed plugin's model-driven workflow. Hermes
inline presentation remains unverified. Claude Code desktop's tested route is
the native Files preview, not an inline chat player.
