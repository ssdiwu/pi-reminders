# pi-reminders

Pi extension for Apple Reminders on macOS, powered by osascript (AppleScript).

This repository is **extension-first**:

- Always-on `/reminders` smart slash command
- Short aliases: `/reminders_list`, `/reminders_add`, `/reminders_complete`, `/reminders_delete`
- `reminders` tool for explicit model-driven calls
- Risk-tiered confirmation: add and complete execute directly, only delete asks once
- Default list: `近期待办`

## Features

- `list [query]` or just `/reminders`
- `add <title> [absolute_due]`
- `add <title> [absolute_due]; <title> [absolute_due]` for quick batch creation
- `add --items '[{"title":"...","due":"YYYY-MM-DD"}]'` for structured batch creation
- `complete <id_or_query>`
- `delete <id_or_query>`
- Real RPC regression test for the full add → list → complete → delete flow

## Quick start

1. No install needed — osascript is built into macOS. On first use, grant automation permission when prompted (System Settings → Privacy & Security → Automation).
2. Add this repository path to `~/.pi/agent/settings.json` under `packages`.
3. Reload pi.
4. Use:
   ```bash
   /reminders
   /reminders_list
   /reminders_add "Buy milk" 2026-06-17
   /reminders_add "Call mom" 2026-06-17; "Pay rent" 2026-06-18
   /reminders_add --items '[{"title":"Task A","due":"2026-06-17"},{"title":"Task B"}]'
   /reminders_complete "Buy milk"
   /reminders_delete "Buy milk"
   ```

## Real runtime regression test

Run the extension through the actual `pi --mode rpc --no-session` protocol:

```bash
python3 scripts/test-extension-rpc.py
python3 scripts/test-extension-rpc.py --runs 2
python3 scripts/test-extension-rpc.py --batch-runs 2
python3 scripts/test-extension-rpc.py --triple-batch-runs 2
python3 scripts/test-extension-rpc.py --runs 1 --batch-runs 1 --triple-batch-runs 1
```

The test script automatically replies to extension UI prompts and verifies the result via osascript.

## Repository layout

```text
pi-reminders/
├── README.md
├── AGENTS.md
├── package.json
├── index.ts
├── scripts/
│   ├── README.md
│   └── test-extension-rpc.py
└── doc/
    ├── extension-roadmap.md
    └── 决策档案/
```

## Design notes

- The extension talks to Reminders.app directly via osascript (AppleScript).
- No MCP backend is used.
- The public repo is extension-only.
- The goal is a small, always-loaded reminder workflow that stays out of your way.

## License

MIT
