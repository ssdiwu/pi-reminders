# Changelog

本文件记录 pi-reminders 对用户可感知的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)，遵循 [语义化版本](https://semver.org/)。

## [Unreleased]

### Fixed

- **窄终端下长提醒事项渲染崩溃**：`reminders` 工具结果在折叠/展开态改为返回真实 `Text` 组件（此前返回绕过宽度约束的原始字符串），超长提醒行（如含完整 URL 的列表项）在窄终端下由 `Text` 自动换行，不再超出终端宽度触发 pi-tui 断言闪退。
- **short id 无法用于 update/complete/delete**：展示给用户的是 short id（完整 UUID 的第一段，如 `EBFFC5B8`），但定位 reminder 时按完整 id 精确比较，short id 必然匹配不上，回退到按标题搜该 ID 字符串也失败，导致用 short id 操作全部报「未找到」。改为前缀匹配（`starts with`）后，short id 与完整 id 均可正常定位。

## [0.5.1] - 2026-07-16

### Changed

- **工具结果人类可读投影**：`reminders` 默认显示操作摘要，展开时显示完整文字结果；内部 `details` 不再直接展示。

## [0.5.0] - 2026-07-10

### Added

- **`reminders(action=list)` 列表阅读**：新增 `dueFrom` / `dueTo`（绝对闭区间，`YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM`）与正整数 `limit`；结果按到期日升序、无日期项置后。工具层用严格日历校验拒绝空串与 `02-30` / `24:00` 等无效值。
- **`reminders(action=delete)` 批量删除一次确认**：新增 `queries[]` 多目标，逐目标解析并按 ID 去重，一次确认摘要同时展示将删除与未解析项；确认后顺序尽力删除，逐条返回成功与失败原因。单条 `query` 保持兼容。

## [0.4.0] - 2026-07-10

### Changed

- **重构 `/reminders` slash command（斜杠命令）交互**：
  - 空参 `/reminders` 改为确定性列出 `近期待办` 当前未完成项，零 LLM 成本
  - `/reminders <自然语言>` 改为把文本交回当前会话 LLM 理解，再由 LLM 调 `reminders` tool 的 `action`
- 移除旧的人打字命令体系：`/reminders_list`、`/reminders_add`、`/reminders_complete`、`/reminders_delete`、`/reminders_update` 别名，以及 `/reminders add|list|complete|delete|update` 的手写动词解析
- `scripts/test-extension-rpc.py` 迁移到新路径：空参等待真实 `select`，非空等待当前 Pi session 的 `agent_start`；不再把模型理解、批量/update 或模型服务波动变成 extension 回归职责

### Fixed

- command handler 在 agent 忙碌时不再直接抛 `send_user_message` 错误；非空自然语言路径会在 busy 状态下走 `followUp` 队列
- `runOsa()` 报错时补带 `stderr`，便于真实 AppleScript 失败排查
- 新增可复验的 TypeScript typecheck 入口：`tsconfig.json` + `npx tsc --noEmit`，tool result 同时满足官方 `details` 契约

## [0.3.0] - 2026-07-08

### Added

- **新增 `update` 能力**：修改 reminder 的 `title / due / body`（标题/日期/备注）三字段，接入 `/reminders update` 主命令 + `/reminders_update` 别名 + `reminders` tool 的 `update` action 三套入口。
  - 命令形式：`/reminders update <id_or_query> --title / --due / --body`（至少指定一个字段）
  - 风险归 `add / complete` 同档：直接执行，不弹确认框（reminders 廉价可逆；仅 `delete` 保留单确认）
  - 日期必须绝对格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM`
- `scripts/test-extension-rpc.py` 回归流程扩展为 `add → update(title/due/body) → list → complete → delete`

## [0.2.0] - 2026-07-06

### Breaking

- **放弃 rem CLI 依赖，改用 osascript（AppleScript 通道）**：rem 在 macOS 26/27 因无 Apple Developer ID 签名被 TCC 静默拒绝（EventKit hardened runtime 关卡），不可用。改为通过 `osascript` 指挥 Reminders.app 操作数据，走 Apple Events 通道复用 App 权限身份，绕开签名死结。
- **确认机制按风险分级**（原为每次写操作都弹确认框、删除双确认）：
  - `add` / `complete`：直接执行，不再弹确认框（reminders 廉价可逆，对话流已表达意图）
  - `delete`：双确认改为单次确认
  - `list`：无确认（不变）

### Removed

- 移除对 `rem` CLI（`brew install BRO3886/tap/rem-cli`）的依赖，Quick start 不再要求安装 rem
- 移除 `runRem` / `runRemJson` 及 `confirmAdd` / `confirmAddMany` / `confirmDeleteTwice` / `summarizeAddDrafts`

### Fixed

- 修复 macOS 26/27 上 reminders 工具 `access denied`：根因是 rem 二进制无 hardened runtime + Developer ID 签名，TCC 静默拒绝，不弹授权窗

### Changed

- `scripts/test-extension-rpc.py` 的结果核对环节也脱离 rem，改用 osascript 独立验证（确保在 rem 不可用的机器上回归测试可跑）
- 新增 `doc/决策档案/0001-放弃rem改用osascript并按风险分级确认.md`，记录本次后端切换与确认分级的根因、权衡和技术细节

## [0.1.0]

- 初始 extension-only 公开版：`/reminders` 命令族 + `reminders` tool，经 rem CLI 操作 Apple Reminders
