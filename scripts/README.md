# scripts

这个目录放 extension 的回归与确定性测试：真实 runtime（运行时）冒烟测试覆盖命令路由，纯函数单测覆盖列表阅读的结果语义。

## 文件

| 文件 | 作用 |
|---|---|
| `test-extension-rpc.py` | 用真实 `pi --mode rpc --no-session` 驱动 extension：空参 `/reminders` 的确定性 list，以及非空文本交回当前 Pi session 的 handoff（转交） |
| `test-list-query.ts` | 列表阅读结果语义的确定性单测：到期窗口闭区间、无日期项排除/保留、到期日升序排序、limit 截取、工具层非法拒绝；并覆盖工具结果渲染在窄终端下换行不溢出（崩溃回归）。不经 LLM、不写真实提醒事项 |
| `test-batch-delete.ts` | 批量删除编排的确定性单测（注入 mock）：refs 收集、多目标解析、歧义选择、ID 去重、确认摘要、最终确认只一次、取消零删除、尽力删除失败后继续。不触达 osascript、不写真实提醒事项 |
| `test-id-match.ts` | 真实 osascript 只读集成测试：验证展示给用户的 short id（UUID 第一段）能正确定位 reminder，用于 update/complete/delete。需要「近期待办」至少 1 条真实未完成 reminder；只读，不创建/修改/删除任何提醒事项 |

## 运行

```bash
# 真实命令路由回归（约 15-35 秒，驱动真实 pi runtime）
python3 scripts/test-extension-rpc.py

# 列表阅读纯函数单测（秒级）
node --experimental-strip-types scripts/test-list-query.ts

# 批量删除单测（秒级，纯函数注入，不触达 osascript）
node --experimental-strip-types scripts/test-batch-delete.ts

# short id 定位的真实 osascript 只读集成测试（秒级，需要至少 1 条真实 reminder）
node --experimental-strip-types scripts/test-id-match.ts
```

脚本会自动：

- 启动真实 `pi --mode rpc --no-session` runtime，不绑定模型
- 自动应答空参 list 的 `select`
- 空参路径等待 `select` 与 RPC response，且断言不会启动 agent 或 tool
- 非空路径等待 RPC response 与 `agent_start`，再以 `get_messages` 断言精确文本已交回当前 Pi session；LLM 如何理解和调用 action 不属于此脚本的兜底范围

## 设计原则

1. 命令路由必须走真实 runtime，不走假 mock runtime
2. 列表结果语义是 extension 内部确定性逻辑（ADR 0002），用纯函数单测覆盖；slash command 的空参/非空两条路径用真实 runtime 覆盖
3. 不把模型 action 选择、额度、跨 session 行为纳入本目录回归
4. 不创建写入默认清单的测试夹具
