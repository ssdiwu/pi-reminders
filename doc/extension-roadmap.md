# extension 路线图

> 目标：把 `pi-reminders` 维护成一个稳定、常驻、公开可复用的 Pi extension。

## 当前状态

- [x] `/reminders` 空参确定性 list 跑通
- [x] `/reminders <自然语言>` 回交当前会话 LLM 跑通
- [x] `reminders` tool 的 `add / list / complete / delete / update` action 契约稳定
- [x] 有界真实 `pi --mode rpc` smoke（空参 list + 非空 handoff）跑通
- [x] 公开仓库已完成
- [x] 旧 alias / 动词解析入口已从公开仓库移除
- [ ] `list-mgmt`
- [ ] 更友好的安装/发布文档
- [ ] package / marketplace 发布准备

## 为什么只保留 extension

你给出的长期目标很明确：

> **时刻加载，时刻能够理解我想要什么**

这意味着长期形态应该是**常驻 extension**。

## 设计原则

1. **理解常驻，删除有护栏**
   - extension 始终加载
   - 空参 `/reminders` 走确定性 list
   - 非空 `/reminders <自然语言>` 交给当前会话 LLM 理解并调 `reminders` tool
   - `add / complete` 直接执行（廉价可逆，对话流已表达意图）
   - 仅 `delete` 单次确认（不可逆操作的最低护栏）

2. **人入口简化，LLM 接口结构化**
   - 人只需要 `/reminders` 一个 slash command
   - LLM 继续使用 `reminders` tool 的结构化 `action` 契约

3. **通过 osascript 操作 Reminders.app**
   - 不依赖第三方 CLI（rem 在 macOS 26/27 因无 Developer ID 签名被 TCC 静默拒绝，不可用）
   - 走 AppleScript 通道，复用系统 Reminders.app 自带的权限身份

## 推荐演进顺序

### Phase 1：当前形态

- `/reminders` 默认 list
- `/reminders <自然语言>`
- `reminders` tool

### Phase 2：补齐能力

- `list-mgmt`
- 更强的列表筛选 / 排序 / 限量语义（另起目标，不混入当前瘦身）

### Phase 3：包装发布

- 更好的 README / 安装文档
- release tag
- marketplace 准备

## 目前建议

- 继续把 extension 当成唯一入口维护
- 让 `scripts/test-extension-rpc.py` 作为命令路由 smoke；不把模型理解矩阵纳入 extension 回归
- 不再恢复旧 alias / 手写动词解析入口
