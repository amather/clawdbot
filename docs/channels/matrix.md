---
summary: "Matrix channel setup, access control, and restart behavior"
read_when:
  - Setting up Matrix as a chat channel
  - Debugging Matrix sync or replies
---
# Matrix

Status: native Matrix channel (matrix-js-sdk).

## Quick setup
1) Create a dedicated Matrix user for the bot (recommended).
2) Configure Matrix in Clawdbot and start the gateway.

Minimal config:
```json5
{
  channels: {
    matrix: {
      enabled: true,
      serverUrl: "https://matrix.example",
      username: "@clawd:matrix.example",
      password: "replace-me",
      dmPolicy: "pairing",
      allowFrom: ["@you:matrix.example"],
      autoJoinRooms: ["!roomId:matrix.example", "#room-alias:matrix.example"]
    }
  }
}
```

## Access control (DMs)
DMs are locked down by default:
- Default: `channels.matrix.dmPolicy = "pairing"`.
- Unknown senders receive a pairing code; messages are ignored until approved.
- Approve via:
  - `clawdbot pairing list matrix`
  - `clawdbot pairing approve matrix <CODE>`
- `channels.matrix.allowFrom` stores approved user IDs (or `"*"` for open).

## Auto-join room invites
`channels.matrix.autoJoinRooms` controls which invites are accepted. Entries are matched
against room IDs, room aliases, or inviter user IDs. Wildcards are allowed (for
example, `!*:matrix.example`, `#*:matrix.example`, `@*:matrix.example`).

## Restart replay protection
Matrix sync can replay recent timeline events after a restart if the sync token
is missing. Clawdbot persists the sync token plus per-room last-seen timestamps
to avoid replying to old messages.

State file:
- `~/.clawdbot/matrix/<accountId>/sync.json` (or `$CLAWDBOT_STATE_DIR`)

If you intentionally want to reprocess old messages, delete that file or use the
Matrix device reset flow in the Control UI.
