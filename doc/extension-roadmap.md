# extension 路线图

> 目标：把 `pi-reminders` 维护成一个稳定、常驻、公开可复用的 Pi extension。

## 当前状态

- [x] `/reminders list / add / complete / delete` 跑通
- [x] 真实 `pi --mode rpc` 回归测试跑通
- [x] 公开仓库已完成
- [x] 旧入口形态已从公开仓库移除
- [ ] `update`
- [ ] `list-mgmt`
- [ ] 更友好的安装/发布文档
- [ ] package/marketplace 发布准备

## 为什么只保留 extension

你给出的长期目标很明确：

> **时刻加载，时刻能够理解我想要什么**

这意味着长期形态应该是**常驻 extension**。

## 设计原则

1. **理解常驻，但写入不静默**
   - extension 始终加载
   - 但 `add / complete / delete` 都必须确认

2. **先做命令型，再考虑自动化**
   - 当前优先 `/reminders ...`
   - 后面才考虑更强的自动工具调用

3. **继续复用 `rem`**
   - 不重写 EventKit
   - 不复制 Apple Reminders 逻辑

## 推荐演进顺序

### Phase 1：当前形态

- `/reminders list [query]`
- `/reminders add <title> [absolute_due]`
- `/reminders complete <id_or_query>`
- `/reminders delete <id_or_query>`
- `reminders` tool

### Phase 2：补齐能力

- `update`
- `list-mgmt`

### Phase 3：包装发布

- 更好的 README / 安装文档
- release tag
- marketplace 准备

## 目前建议

- 继续把 extension 当成唯一入口维护
- 让 `scripts/test-extension-rpc.py` 作为回归保障
- 不再恢复旧入口版本
