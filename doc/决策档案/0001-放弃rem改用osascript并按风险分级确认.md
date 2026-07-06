# 0001 — 放弃 rem CLI，改用 osascript，并按风险分级简化确认机制

- 状态：已采纳
- 日期：2026-07-06

## 背景

pi-reminders 原本通过 `rem` CLI（BRO3886/rem）操作 Apple Reminders，走 EventKit 通道。

在 macOS 26/27 上，`rem` 的二进制是 `adhoc` + `linker-signed`（无 Apple Developer ID），触发 TCC 的「hardened runtime」关卡：系统**静默拒绝**，不弹授权窗，`rem` 完全不可用。这是 rem 作者本人在 BRO3886/rem#41 确认的已知问题（需 Developer ID + 公证才能修，尚未完成）。

本机（macOS 27 beta）因此 reminders 工具全部 `access denied`。

## 决策

1. **数据层：从 rem CLI 改为 osascript（AppleScript 通道）**
   - 通过 `osascript` 指挥 Reminders.app 操作数据，复用 App 自带的权限身份
   - 走 Apple Events 通道（与 EventKit 是两套独立 TCC 体系），绕开 rem 的签名死局
   - 彻底去掉对 rem 的依赖（单后端，不做双后端 / 自动探测）

2. **确认机制：按风险分级**
   - `add` / `complete`：直接执行，不弹确认框
   - `delete`：保留单次确认（取消原来的双确认）
   - `list`：无确认（原本就没有）

## 理由（权衡）

### 为什么放弃 rem（不保留双后端）

- rem 的相对优势（EventKit 速度快、priority/alarms/tags 等高级字段）在当前用例都用不到（上层只用了 name/due/completed/list）
- osascript 零外部依赖、苹果签名身份合规、维护成本低
- 「双后端 + 自动探测」看似稳健，实则是**假设接缝**——为一个不存在的需求预设可切换性，违反接缝纪律。用「删除测试」判：删掉 rem 那套（接口 + 探测 + 缓存），复杂度消失、无调用处重新出现复杂度，证明是纯透传，该删

### 为什么 add/complete 去确认

- reminders 是**廉价、可逆**数据（记错了删了重建成本极低），不同于发邮件、转账、删文件
- 对话流里 agent 调 tool 本身就是执行用户已表达的意图，再弹确认框是双重确认、负价值
- 出错靠对话纠错（reminders 可重建），不靠逐条拦截

### 为什么 delete 保留单次确认

- delete 不可逆（虽然后果也小）
- 作为唯一不可逆操作的最低护栏，一次确认足够；双确认过重

## 影响

- `index.ts`：数据层全部 osascript 化（runOsa + 5 语义函数），删除 runRem/runRemJson
- 确认函数：删除 confirmAdd / confirmAddMany / confirmDeleteTwice / summarizeAddDrafts，保留 confirmAction（delete 用）
- 文档：README / AGENTS / package.json / scripts-README / roadmap 全部同步
- 测试：test-extension-rpc.py 验证环节脱离 rem，改用 osascript

## 关键技术细节

- osascript 通过 `osascript -e <每行>` 传脚本（execFile 的 `input` 选项和 osascript 无参读 stdin 不兼容，会报 `Command failed: osascript`）
- id 体系：osascript 返回 `x-apple-reminder://<UUID>`，剥前缀后与 rem 的纯 UUID 对齐
- 序列化：用 `\x1f`（unit separator）/ `\x1e`（record separator）自定义文本协议（JSON 的 ObjC 桥接 `NSArray arrayWithArray:` 对含 record 的 list 失败，不可行）
- due date：用 `NSDateFormatter` 解析 ISO 字符串，绕开中文系统 locale
- complete/delete：用 `whose id is` + `first reminder` 子句定位，避开「循环内 delete」的 -1728 引用悬空错误
