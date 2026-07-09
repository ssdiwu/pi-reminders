# Changelog

本文件记录 pi-reminders 对用户可感知的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/)，遵循 [语义化版本](https://semver.org/)。

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