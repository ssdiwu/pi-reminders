# scripts

这个目录现在只保留**真实 runtime 回归测试**。

## 文件

| 文件 | 作用 |
|---|---|
| `test-extension-rpc.py` | 用真实 `pi --mode rpc --no-session` 驱动 extension，回归测试单条 `/reminders add → list → complete → delete`，以及批量 `/reminders add ...; ...` |

## 调试方式

```bash
python3 scripts/test-extension-rpc.py
python3 scripts/test-extension-rpc.py --runs 2
python3 scripts/test-extension-rpc.py --batch-runs 2
python3 scripts/test-extension-rpc.py --triple-batch-runs 2
python3 scripts/test-extension-rpc.py --runs 1 --batch-runs 1 --triple-batch-runs 1 --list "近期待办" --due "2026-06-08 11:30"
```

脚本会自动：

- 启动真实 pi RPC runtime
- 自动应答 `confirm` / `select` / `notify`
- 用 `rem` 验证单条、双条批量、三条批量的增删改查结果

## 设计原则

1. 只保留 extension 的真实回归测试
2. 测试必须走真实 runtime，不走假 mock runtime
3. 不再保留旧的 shell 包装脚本
