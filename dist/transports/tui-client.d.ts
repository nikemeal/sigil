/**
 * TUI Client
 *
 * Standalone CLI process that connects to the running Sigil service via WebSocket.
 * This is what runs when you do `sigil tui`.
 *
 * The service runs headless in the background. This client connects to it,
 * sends messages, and displays responses. Multiple TUI clients can connect
 * simultaneously (they all see the same conversation).
 *
 * Input is blocked while waiting for a response — keeps the display clean
 * and matches the sequential nature of conversation.
 */
export {};
//# sourceMappingURL=tui-client.d.ts.map