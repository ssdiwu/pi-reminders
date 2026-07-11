# pi-reminders

Pi extension for Apple Reminders on macOS, powered by `osascript`（AppleScript 命令行）。

This repository is **extension-first**:

- Always-on `/reminders` smart slash command
- Empty `/reminders` = deterministic list of current incomplete reminders in `近期待办`
- `/reminders <自然语言>` = hand back to the current-session LLM, which calls the `reminders` tool with `action`
- `reminders` tool for explicit model-driven calls
- Risk-tiered confirmation: add and complete execute directly, only delete asks once
- Default list: `近期待办`

## Features

- `/reminders` → deterministic list, zero LLM cost
- `/reminders <自然语言>` → let the current LLM understand add / update / complete / delete intent
- `reminders(action=list)` supports `query` (title contains), inclusive `dueFrom` / `dueTo` (absolute `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`), and a positive integer `limit`; results sort by due date ascending with undated items last
- `reminders` tool keeps the structured `action=add|list|complete|delete|update` contract unchanged
- Bounded real RPC smoke: deterministic empty-command list plus nonempty handoff to the current Pi session

## Quick start

1. No install needed — `osascript` is built into macOS. On first use, grant automation permission when prompted (System Settings → Privacy & Security → Automation).
2. Add this repository path to `~/.pi/agent/settings.json` under `packages`.
3. Reload pi.
4. Use:
   ```bash
   /reminders
   /reminders 明天上午九点提醒我给 Curio 发测试邀请
   /reminders 把 ID 为 1234ABCD 的提醒事项标题改成 给 Curio 发正式邀请
   /reminders 把 ID 为 1234ABCD 的提醒事项标记为完成
   /reminders 删除 ID 为 1234ABCD 的提醒事项
   ```

## Real runtime regression test

Run the extension through the actual `pi --mode rpc --no-session` protocol:

```bash
npx tsc --noEmit
python3 scripts/test-extension-rpc.py
node --experimental-strip-types scripts/test-list-query.ts
```

The smoke test auto-selects the empty-command list UI and verifies that nonempty `/reminders` input starts a Pi agent run and delivers its exact text to the current session. `test-list-query.ts` deterministically covers list-reading semantics (due window, sorting, limit, validation) without touching the LLM or real reminders. Natural-language interpretation and action selection remain the current LLM's responsibility; this extension does not bind a model or automate a model behavior matrix.

## Repository layout

```text
pi-reminders/
├── README.md
├── AGENTS.md
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── index.ts
├── scripts/
│   ├── README.md
│   ├── test-extension-rpc.py
│   └── test-list-query.ts
└── doc/
    ├── README.md
    ├── 00-产品与原则/
    ├── 10-架构与运行/
    ├── 30-路线图/
    ├── 40-版本实施方案/
    ├── 术语表.md
    └── 决策档案/
```

## Design notes

- The extension talks to `Reminders.app` directly via `osascript`.
- No MCP backend is used.
- The public repo is extension-only.
- The goal is a small, always-loaded reminder workflow that stays out of your way.
- The `reminders` tool contract is for LLM work; the slash command is only the human entrypoint.

## License

MIT
