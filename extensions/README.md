# extensions

这个目录放 `pi-reminders` 的 **pi extension** 实现。

## 当前定位

这是一个 **命令型 + 工具型的轻量 extension**：

- **命令型**：提供 `/reminders ...` 入口，适合你显式触发
- **工具型**：注册 `reminders` 工具，让模型在你明确表达意图时也能调用

## 设计边界

1. **理解常驻，但写入不静默**
   - extension 始终加载
   - 但 `add / complete / delete` 都必须确认

2. **继续复用 `rem`，不重写 EventKit**
   - extension 只做交互、解析、确认、输出
   - Apple Reminders 的底层仍由 `rem` 完成

3. **不抢 skill 的职责**
   - 现有 skill 继续是 prompt/实验层
   - extension 是长期入口层

## 当前功能

- `/reminders list [query]`
- `/reminders add <title> [absolute_due]`
- `/reminders complete <id_or_query>`
- `/reminders delete <id_or_query>`
- `reminders` tool（同样支持 add/list/complete/delete）

## 测试策略

当前优先使用**真实 pi runtime** 做回归，而不是假 runtime。

### 已采用的方式

通过：

```bash
pi --mode rpc --no-session
```

让脚本按 JSON 协议自动应答 extension 的：

- `confirm`
- `select`
- `notify`

对应脚本：

- `../scripts/test-extension-rpc.py`

### 为什么这样测

因为这能直接覆盖：

- slash command 注册是否成功
- RPC 下的 UI 请求是否正常
- `add / list / complete / delete` 是否真实闭环
- `rem` 侧的最终状态是否正确

这比伪造 runtime 更接近你真实日常使用的路径。
