// 真实 osascript 集成测试：验证 short id（展示给用户的 UUID 第一段，如 03F105F0）
// 能正确定位 reminder，用于 update / complete / delete。
// Run: node --experimental-strip-types scripts/test-id-match.ts
// 需要「近期待办」至少有 1 条真实未完成 reminder；只读，不创建/修改/删除任何 reminder。
//
// 回归背景：resolveCandidates 此前用 showReminder 的 (id of r) is targetId 精确比较，
// short id（完整 UUID 的真前缀）匹配不上 → 回退到按标题搜 ID 字符串 → update/complete/delete
// 用 short id 全部失败。改 starts with 后 short id 命中。

import { listReminders, resolveCandidates } from "../index.ts";

let failures = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.error(`FAIL ${label}`);
  }
}

const reminders = await listReminders();
if (reminders.length === 0) {
  console.error("SKIP: 「近期待办」需要至少 1 条真实未完成 reminder 才能验证 id 匹配");
  process.exit(0);
}

const target = reminders[0]!;
const shortId = target.id.split("-")[0];

// 核心：short id 必须命中（修复前 is 精确比较命中不了）
const byShort = await resolveCandidates(shortId, "all");
ok(byShort.some((r) => r.id === target.id), `short id ${shortId} 命中目标 reminder`);

// guard：完整 id（stripReminderId 后）仍命中
const byFull = await resolveCandidates(target.id, "all");
ok(byFull.some((r) => r.id === target.id), "完整 id 命中目标 reminder");

// guard：标题 ref 走标题匹配路径命中（不受 id 比较改动影响）
const byTitle = await resolveCandidates(target.name, "all");
ok(byTitle.some((r) => r.id === target.id), "标题 ref 命中目标 reminder");

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log(`\nall id-match tests passed`);
