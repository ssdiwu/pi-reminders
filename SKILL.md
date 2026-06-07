---
name: reminders
description: Add, list, complete, and delete Apple Reminders entries from pi. Use when the user wants to create a todo, task, reminder, or schedule entry. Translate Chinese and English natural language dates into absolute dates, then call the rem CLI with dry-run confirmation. macOS only.
---

# Apple Reminders

A pi skill that bridges Apple Reminders into your pi sessions. Powered by the [`rem`](https://github.com/BRO3886/rem) CLI (Go + EventKit, but only English natural-language dates).

## Prerequisite

Before using this skill, ensure:

- **macOS 10.12+**
- **`rem` CLI installed** — `brew install BRO3886/tap/rem-cli`
- **TCC permission granted** — run `rem lists` once in the terminal where pi runs, then click "Allow"
- **`jq` installed** — used by `complete` / `delete` for candidate resolution

If `rem` is not installed, tell the user how to install it. **Do not silently fall back to other approaches.**

## Trigger

This skill is triggered by:

- **Slash command**: `/skill:reminders <verb> <args>`
- **Auto-trigger phrases**:
  - "Add a reminder to…"
  - "把 XXX 加到提醒"
  - "提醒我下周三…"
  - "列一下提醒"
  - "把 XXX 标记完成"
  - "删掉那条 reminder"

## Supported verbs

| Verb | Description | Confirmation |
|---|---|---|
| `add <title> [absolute_due]` | Create a reminder | dry-run |
| `list [query]` | List incomplete reminders in the default list | none |
| `complete <id_or_query>` | Mark one reminder as complete | dry-run |
| `delete <id_or_query>` | Delete one reminder | dry-run + second `delete` confirm |

## Default list

Use the environment variable `REMINDERS_LIST` when present. Otherwise, default to:

```text
近期待办
```

All `list` / `complete` / `delete` operations work in that default list unless the user explicitly asks for a different list and you re-run with a different `REMINDERS_LIST` value.

## Workflow: `add`

### 1. Parse user input into `<title>` and `<when>`

Examples:

- "加个待办下周三跟张三吃饭" → `title="跟张三吃饭"`, `when="下周三"`
- "Remind me tomorrow 9am to do standup" → `title="do standup"`, `when="tomorrow 9am"`
- "Add a reminder to review the PR" → `title="review the PR"`, `when=""`

If the user gives **no time**, leave `when=""`.

### 2. Translate `<when>` into an absolute date

`rem` only understands **English** date expressions. To avoid ambiguity, translate user input into **absolute date strings** before calling the script.

#### Output format

- All-day: `YYYY-MM-DD`
- With time: `YYYY-MM-DD HH:MM`

#### Translation examples

| User says | Output |
|---|---|
| 今天 | current date |
| 明天 | current date + 1 day |
| 后天 | current date + 2 days |
| 大后天 | current date + 3 days |
| 下周三 | next Wednesday as `YYYY-MM-DD` |
| 这周五下午 3 点 | this Friday as `YYYY-MM-DD 15:00` |
| 6月20日 | `YYYY-06-20` |
| tomorrow 9am | `YYYY-MM-DD 09:00` |
| next friday | `YYYY-MM-DD` |
| in 2 hours | absolute timestamp |

Ask the user only when the time expression is genuinely ambiguous.

### 3. Call the script

```bash
bash ./scripts/remind.sh add "<title>" "<absolute_due>"
```

> 以上示例假设你在 `pi-reminders` 仓库根目录执行命令。

Examples:

```bash
bash ./scripts/remind.sh add "跟张三吃饭" "2026-06-17"
bash ./scripts/remind.sh add "跟张三吃饭" "2026-06-17 18:00"
bash ./scripts/remind.sh add "Take out trash"
```

### 4. Let the script handle confirmation

The script itself performs the dry-run and waits for `y/n/e`.

## Workflow: `list`

Use for read-only listing.

```bash
bash ./scripts/remind.sh list
bash ./scripts/remind.sh list "张三"
```

- Default behavior: list **incomplete reminders** in the default list
- If a query is provided, filter by that query
- No dry-run needed

## Workflow: `complete`

The script accepts **ID or title query**.

```bash
bash ./scripts/remind.sh complete "03F105F0"
bash ./scripts/remind.sh complete "跟张三吃饭"
```

The script will:
1. Try `rem show <id>` first
2. If that fails, search the default list by title/notes
3. If exactly one match is found, show a dry-run confirmation
4. If multiple matches are found, print candidates and stop
5. If confirmed, call `rem complete <id>`

## Workflow: `delete`

Also accepts **ID or title query**.

```bash
bash ./scripts/remind.sh delete "03F105F0"
bash ./scripts/remind.sh delete "跟张三吃饭"
```

The script will:
1. Resolve the candidate (same logic as `complete`)
2. Show a dry-run preview
3. Ask `y/n/e`
4. If `y`, ask the user to type **`delete`** for second confirmation
5. Only then call `rem delete <id> --force`

## Error handling

- **`rem` not installed** → tell user to run `brew install BRO3886/tap/rem-cli`
- **TCC permission denied** → tell user to run `rem lists` in the same terminal as pi
- **`jq` missing** → tell user to install `jq`
- **No match** → report no match
- **Multiple matches** → print candidates, ask the user to re-run with exact ID/title
- **Invalid date format** → fix the translated date and re-run

## What this skill does NOT do

- ❌ Auto-extract todos from any conversation without user intent
- ❌ Silent writes (all write operations confirm first)
- ❌ Cross-platform support (macOS only)
- ❌ Replace `pi-todo` (different philosophy: skill + dry-run vs extension + TUI)
