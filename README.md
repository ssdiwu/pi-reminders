# pi-reminders

Pi extension for Apple Reminders on macOS, powered by the `rem` CLI.

This repository is **extension-first**:

- Always-on `/reminders` smart slash command
- Short aliases: `/reminders_list`, `/reminders_add`, `/reminders_complete`, `/reminders_delete`
- `reminders` tool for explicit model-driven calls
- Dry-run confirmations before every write
- Double confirmation for delete
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

1. Install `rem` and grant macOS permissions:
   ```bash
   brew install BRO3886/tap/rem-cli
   rem lists
   ```
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

The test script automatically replies to extension UI prompts and verifies the result with `rem`.

## Repository layout

```text
pi-reminders/
├── README.md
├── package.json
├── extensions/
├── scripts/
│   ├── README.md
│   └── test-extension-rpc.py
└── doc/
```

## Design notes

- The extension talks to `rem` directly.
- No MCP backend is used.
- The public repo is extension-only.
- The goal is a small, always-loaded reminder workflow that stays out of your way.

## License

MIT
