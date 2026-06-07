# pi-reminders

> **一个轻量的 pi 包：同时提供 Apple Reminders 的 skill（实验/兼容层）和 extension（长期入口）。**
> 底层复用 `rem` CLI；上层提供 dry-run、确认、常驻理解和更顺手的 `/reminders ...` 入口。

## 当前状态

✅ **已具备两层形态**

- **skill**：`/skill:reminders ...`，继续可用
- **extension**：常驻加载，提供：
  - `/reminders list [query]`
  - `/reminders add <title> [absolute_due]`
  - `/reminders complete <id_or_query>`
  - `/reminders delete <id_or_query>`
  - `reminders` tool（供模型按显式意图调用）

## 为什么同时保留 skill 和 extension

| 形态 | 用途 |
|---|---|
| skill | prompt/实验层，便于继续微调规则、兼容现有工作流 |
| extension | 常驻入口层，满足“时刻加载、时刻理解、时刻可用” |

你的判断是对的：如果目标是**长期日常使用**，最终更合适的形态是 extension。

## 当前能力

| 能力 | skill | extension |
|---|---|---|
| add（dry-run） | ✅ | ✅ |
| list | ✅ | ✅ |
| complete | ✅ | ✅ |
| delete（双确认） | ✅ | ✅ |
| update | ❌ | ❌ |
| list-mgmt | ❌ | ❌ |
| 自动理解提醒意图 | 有限（按需加载） | ✅ 常驻加载 |

## 跟现有方案对比

| | `pi-todo` (extension) | `pi-reminders` |
|---|---|---|
| 后端 | 自家 Swift helper | `rem` CLI |
| 中文日期 | ❌ | ✅ 由 pi 翻成绝对日期 |
| dry-run | ❌ | ✅ |
| 删除双确认 | ❌ | ✅ |
| TUI 浏览器 | ✅ | ❌（刻意不做） |
| 强制单 list | ✅ | ❌ 默认 `近期待办`，可换 |
| 常驻理解 | ✅ | ✅（extension 已开始） |

## 前置依赖

1. **macOS**
2. **`rem` CLI**
   ```bash
   brew install BRO3886/tap/rem-cli
   ```
3. **TCC 权限**
   ```bash
   rem lists
   ```
   在跑 pi 的同一个终端点“允许”
4. **`jq`**（`complete` / `delete` 候选解析依赖）

## 包结构

```text
pi-reminders/
├── package.json               # pi package manifest（当前声明 extension）
├── README.md                  # 本文件
├── SKILL.md                   # skill 源（开发目录）
├── extensions/
│   ├── README.md              # extension 设计说明
│   └── index.ts               # 命令型 + 工具型 extension
├── scripts/
│   ├── README.md              # 脚本说明
│   └── remind.sh              # skill 层脚本（add/list/complete/delete）
└── doc/
    └── extension-roadmap.md   # extension 路线图
```

## 当前部署方式

### skill（B 模式）

- pi 实际扫描：`~/.agents/skills/reminders/SKILL.md`
- 改 `SKILL.md` 后需要手动 sync：

```bash
cp <REPO_ROOT>/SKILL.md ~/.agents/skills/reminders/SKILL.md
```

> 把 `<REPO_ROOT>` 替换成你本地 `pi-reminders` 仓库的实际路径。

- `scripts/remind.sh` 用绝对路径被 skill 调用，所以**改脚本不用 sync**

### extension

- 通过本地 package 路径加入 `~/.pi/agent/settings.json`
- 资源入口：`package.json -> pi.extensions -> extensions/index.ts`
- `/reload` 或重启 pi 后自动加载

## 已验证的事实

### skill
- add/list/complete/delete 全都已跑通
- 测试数据已清理

### extension
- 真实 `pi -e` 已验证能加载
- `reminders` tool 已在真实 pi 里被成功调用
- `list` 场景已通过真实 pi transcript 输出验证
- `/reminders add → list → complete → delete` 已通过真实 `pi --mode rpc` 回归测试验证
- 已补 `scripts/test-extension-rpc.py` 作为可重复执行的真实 runtime 测试脚本

## 下一步

- [ ] `update`
- [ ] `list-mgmt`
- [ ] 把 skill 和 extension 的共享逻辑再收敛一层
- [ ] 去掉 skill 的绝对路径依赖
- [ ] 发到 npm / marketplace

## 相关文档

- `doc/extension-roadmap.md`：为什么现在推进 extension、后续怎么演进
- `extensions/README.md`：extension 设计边界
- `scripts/README.md`：脚本层设计边界

## License

MIT（待定）
