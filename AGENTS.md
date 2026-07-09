# AGENTS.md — pi-reminders

## 项目一句话定位

`pi-reminders` 是一个 `Pi extension（Pi 扩展）`：通过 `osascript（AppleScript 命令行）` 直接操作 macOS `Apple Reminders（苹果提醒事项）`，提供始终可用的 `/reminders` 工作流。

## 先读

1. `README.md`：功能、命令形式、安装与真实回归测试。
2. `scripts/README.md`：RPC 回归测试脚本怎么跑、覆盖哪些场景。
3. `index.ts`：扩展入口与全部行为实现。

## 代码边界

- 平台边界：只支持 macOS；依赖系统自带 `osascript`，不引入 MCP 或额外后台服务。
- 产品边界：这是一个 **extension-first** 小扩展，不做完整任务管理系统。
- 命令边界：保留 `/reminders` 主命令、快捷别名和 `reminders` tool；不要平白扩一套新命令体系。
- 默认清单：当前默认列表是 `近期待办`；改默认值前先同步 `README.md`。
- 风险边界：`add` / `complete` 直接执行，只有 `delete` 做单次确认；不要把低风险动作也升级成重确认流程。
- 数据边界：日期输入最终要落成绝对时间；不要把模糊自然语言原样透传给 Apple Reminders。
- 安全边界：不硬编码密钥，不读写无关系统数据，不绕过系统 Automation 权限提示。

## 修改时特别注意

- AppleScript 返回值和字段格式不稳定时，优先在现有解析上做最小修正，不要为了“更优雅”重写整条链路。
- 批量添加能力已经通过 `;` 快捷格式和 `--items` 结构化格式覆盖；新增输入形态前先证明现有形态不够用。
- 这是公开 npm 包，改动 `index.ts` 的对外行为时，要同步检查 `README.md` 里的示例命令是否仍然成立。
- `package.json` 当前只发布 `index.ts` 和 `README.md`；如果新增运行所必需文件，必须同步更新 `files`。

## 验证

改动后优先跑真实 `RPC（远程过程调用）` 回归，不拿 mock 代替：

```bash
python3 scripts/test-extension-rpc.py
python3 scripts/test-extension-rpc.py --batch-runs 1 --triple-batch-runs 1
```

至少覆盖：

- 单条 `add → list → complete → delete`
- 双条批量添加
- 三条批量添加
- 自动应答确认 / 选择提示后结果仍正确

## 文档分工

- `README.md`：给人看的功能、安装、命令示例、回归测试入口。
- `scripts/README.md`：测试脚本和调试方式。
- `AGENTS.md`：给 agent 的实现边界、风险边界和验证纪律。

## 不要做

- 不要把它扩成带数据库或云同步的提醒事项系统。
- 不要引入与当前问题无关的抽象层。
- 不要为了统一风格把真实 runtime 测试改成纯单元测试。