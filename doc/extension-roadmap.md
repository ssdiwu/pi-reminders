# extension 路线图

> 目的：先用 skill 验证真实工作流，再把稳定交互收敛成长期可用的 extension。

## 当前状态（2026-06-07）

- [x] skill 路径跑通
- [x] `add / list / complete / delete` 跑通
- [x] `rem` 权限、写入、查询、删除全验证
- [x] **extension 骨架已开始**（命令型 + 工具型双入口）
- [ ] `update`
- [ ] `list-mgmt`
- [ ] extension 在你真实日常工作流里跑一段时间

## 为什么现在开始做 extension

之前 skill 已经证明核心链路成立：

1. pi 能识别 reminder 意图
2. pi 能把中文/英文时间翻成绝对日期
3. dry-run + 确认机制成立
4. `rem` 能稳定写入 / 查询 / 完成 / 删除 Apple Reminders

而你补充了一个更强的产品约束：

> **需要时刻加载，时刻能够理解我想要什么**

这说明长期形态应当从“按需 skill”升级成“常驻 extension”。

## extension 的设计原则

1. **理解常驻，但写入不静默**
   - extension 始终加载
   - 但 `add / complete / delete` 都必须确认

2. **先做命令型，再考虑自动化**
   - 当前优先 `/reminders ...`
   - 后面才考虑更强的自动工具调用

3. **继续复用 `rem`**
   - 不重写 EventKit
   - 不复制 Apple Reminders 逻辑

4. **保留 skill 作为实验层**
   - skill 继续存在，用于 prompt 规则试验和兼容
   - extension 是长期入口层

## 推荐形态

### Phase 1：命令型 extension（已开始）

提供：

- `/reminders list [query]`
- `/reminders add <title> [absolute_due]`
- `/reminders complete <id_or_query>`
- `/reminders delete <id_or_query>`

特点：

- 常驻加载
- 入口更短
- 不依赖用户记住 `/skill:...`
- 仍然保持“用户主动触发”

### Phase 2：工具型入口（已开始，但边界要克制）

注册 `reminders` tool，让模型在**用户明确表达意图**时直接调用。

必须坚持：

- 不自动从普通聊天里偷抽 todo
- 不静默写 reminder
- 一切写操作都先确认

### Phase 3：共享逻辑收敛

当前 skill 和 extension 还各自维护一套壳层逻辑。

后续应收敛：

- 提取共享 helper
- skill / extension 只做不同的入口层
- `rem` 保持唯一后端

## 当前 package 结构的意义

```text
pi-reminders/
├── package.json        # extension 资源声明
├── extensions/         # 常驻入口层
├── scripts/            # skill 当前的脚本层
├── SKILL.md            # skill 源
└── doc/                # 路线图/设计文档
```

它表达的是：

- **scripts/** = 当前最稳定的底层工作流
- **SKILL.md** = 现有 prompt/实验层
- **extensions/** = 正在成型的长期入口层

## 什么时候值得继续往“更重”的 extension 演进

只有出现以下信号时，才考虑更重的能力：

1. 你频繁觉得 `/reminders` 还不够顺，需要更强的 UI
2. 你希望默认 list、候选选择、最近操作有状态记忆
3. 你想让 reminder 工作流跟别的 agent 工作流组合（例如计划、复盘、项目管理）

## marketplace 前必须完成的事

1. 去掉 skill 的绝对路径依赖
2. 补 `update` / `list-mgmt`
3. 把 extension 的交互跑顺一段时间
4. README 改成“skill + extension 双形态”的正式文案
5. 给非 macOS 用户明确失败提示

## 当前建议

**短期**：继续用 extension 跑你的真实工作流，同时保留 skill 作为后备和实验层。

**中期**：把共享逻辑抽出来，减少 skill/extension 的重复实现。

**长期**：如果真实使用频率高，再做更完整的 command UX 或轻量 TUI。
