# 决策档案索引

只收「难逆转 + 无上下文会困惑 + 真实权衡」的决策。一条一文件，顺序编号 `0001-中文标题.md`。

| 编号 | 标题 | 一句话主旨 |
|------|------|-----------|
| 0001 | 放弃 rem CLI，改用 osascript，并按风险分级简化确认机制 | rem 在 macOS 26/27 因无 Developer ID 签名被 TCC 静默拒绝，改走 osascript；reminders 廉价可逆，add/complete 去确认、仅 delete 单确认 |
| 0002 | LLM 负责意图理解，并分离慢速回归 | extension 只做命令路由与 tool 执行；模型波动不阻塞产品 phase 建检 |
| 0003 | 工具结果人类可读投影 | reminders 工具以摘要与文字展开投影展示，details 不直出 |
