# scripts

这个目录放 `pi-reminders` 的实际可执行脚本。

## 文件

| 文件 | 作用 |
|---|---|
| `remind.sh` | 对 `rem` CLI 的薄包装，负责 `add` / `list` / `complete` / `delete` 的 dry-run、确认、候选解析和实际调用 |
| `test-extension-rpc.py` | 用真实 `pi --mode rpc` 驱动 extension，回归测试 `/reminders add → list → complete → delete` |

## 设计原则

1. **不解析中文自然语言日期** —— 这一步交给 pi（LLM）在调用前翻成绝对日期
2. **不重做 EventKit** —— 所有底层操作直接调 `rem`
3. **写操作先确认** —— `add` / `complete` / `delete` 都有确认；`delete` 额外二次确认
4. **默认 list 固定** —— 通过 `REMINDERS_LIST` 覆盖，默认 `近期待办`

## 调试方式

### skill 脚本层

```bash
bash scripts/remind.sh help
bash scripts/remind.sh list
bash scripts/remind.sh add "测试" "2026-06-20"
bash scripts/remind.sh complete "标题或ID"
bash scripts/remind.sh delete "标题或ID"
```

### extension RPC 回归测试

```bash
python3 scripts/test-extension-rpc.py
python3 scripts/test-extension-rpc.py --runs 2
python3 scripts/test-extension-rpc.py --list "近期待办" --due "2026-06-08 11:30"
```

这个测试不是假 runtime，而是直接启动：

```bash
pi --mode rpc --no-session
```

然后通过 JSON 协议自动应答 extension 的：

- `confirm`
- `select`
- `notify`

并在每轮后用 `rem` 直接验真：

- add 后确实能查到
- delete 后确实查不到

## 与 B 模式部署的关系

当前 skill 采用 **B 模式**：

- pi 实际扫描：`~/.agents/skills/reminders/SKILL.md`
- 这个目录只放 **复制后的 `SKILL.md`**
- `SKILL.md` 里建议用**仓库根目录相对路径**调用本目录下的脚本：
  - `./scripts/remind.sh`

> 使用时请在仓库根目录执行，或把路径替换成你本机的实际仓库路径。

因此：

- **改脚本** → 直接生效，**不用 sync**
- **改 SKILL.md** → 需要手动 `cp` 到 `~/.agents/skills/reminders/SKILL.md`
