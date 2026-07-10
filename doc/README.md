# doc/

`doc/` 用来放项目级设计说明、路线图和决策记录。

## 文件索引

| 文件 | 作用 |
|---|---|
| `extension-roadmap.md` | 当前产品形态、设计原则与后续演进方向 |
| `术语表.md` | 项目中的命令路由、意图理解与 tool 执行职责定义 |
| `决策档案/README.md` | 决策档案索引 |
| `决策档案/0001-放弃rem改用osascript并按风险分级确认.md` | 为什么放弃 rem CLI、改走 osascript，以及为什么只给 delete 保留单确认 |
| `决策档案/0002-LLM负责意图理解并分离慢速回归.md` | 为什么 extension 只做命令路由，慢速模型回归不阻塞产品阶段 |

## 当前约束

- `/reminders` 是唯一的人类 slash command（斜杠命令）入口
- 空参 `/reminders` = 确定性列出 `近期待办`
- `/reminders <自然语言>` = 交回当前会话 LLM 理解，再调用 `reminders` tool
- `reminders` tool 的 `action=add|list|complete|delete|update` 契约保持稳定，不跟随人类入口一起折腾
- 默认列表保持 `近期待办`
