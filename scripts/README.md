# scripts

这个目录现在只保留**真实 runtime（运行时）回归测试**。

## 文件

| 文件 | 作用 |
|---|---|
| `test-extension-rpc.py` | 用真实 `pi --mode rpc --no-session` 驱动 extension：空参 `/reminders` 的确定性 list，以及非空文本交回当前 Pi session 的 handoff（转交） |

## 调试方式

```bash
python3 scripts/test-extension-rpc.py
```

脚本会自动：

- 启动真实 `pi --mode rpc --no-session` runtime，不绑定模型
- 自动应答空参 list 的 `select`
- 空参路径等待 `select` 与 RPC response，且断言不会启动 agent 或 tool
- 非空路径等待 RPC response 与 `agent_start`，再以 `get_messages` 断言精确文本已交回当前 Pi session；LLM 如何理解和调用 action 不属于此脚本的兜底范围

## 设计原则

1. 只保留 extension 的真实回归测试
2. 测试必须走真实 runtime，不走假 mock runtime
3. slash command 的 empty / natural-language 两条路径都要真实覆盖
4. 不再保留旧的 shell 包装脚本
