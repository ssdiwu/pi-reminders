// Deterministic unit tests for list-query semantics (filtering / sorting / limit).
// Run: node --experimental-strip-types scripts/test-list-query.ts
// These cover the pure list-reading behavior (ADR 0002): not the LLM action choice.

import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import remindersExtension, { applyListQuery, sortRemindersByDue, normalizeDueBound, coerceListBounds, coerceListLimit } from "../index.ts";

initTheme(undefined, false);

interface R {
  id: string;
  name: string;
  due_date?: string;
  completed?: boolean;
}

let failures = 0;

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function r(id: string, due_date?: string): R {
  return { id, name: id, due_date };
}

// --- normalizeDueBound ---

eq(normalizeDueBound("2026-07-12", "start"), "2026-07-12 00:00", "bound: date-only start -> 00:00");
eq(normalizeDueBound("2026-07-12", "end"), "2026-07-12 23:59", "bound: date-only end -> 23:59");
eq(normalizeDueBound("2026-07-12 09:30", "start"), "2026-07-12 09:30", "bound: datetime start unchanged");
eq(normalizeDueBound("2026-07-12 09:30", "end"), "2026-07-12 09:30", "bound: datetime end unchanged");

// --- coerceListBounds (tool-layer validation) ---

eq(coerceListBounds(undefined, undefined), { dueFrom: undefined, dueTo: undefined }, "coerce: absent bounds ok");
eq(coerceListBounds("", ""), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: empty string rejected");
eq(coerceListBounds("  ", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: whitespace-only rejected");
eq(coerceListBounds("2026-07-12", undefined), { dueFrom: "2026-07-12", dueTo: undefined }, "coerce: valid date-only from");
eq(coerceListBounds(undefined, "2026-07-13 09:30"), { dueFrom: undefined, dueTo: "2026-07-13 09:30" }, "coerce: valid datetime to");
eq(coerceListBounds("2026-07-12", "2026-07-13"), { dueFrom: "2026-07-12", dueTo: "2026-07-13" }, "coerce: both valid");
eq(coerceListBounds("2026\t07-12", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: tab separator rejected");
eq(coerceListBounds("2026-07  -12", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: malformed rejected");
eq(coerceListBounds("2026-99-99", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: invalid month/day rejected");
eq(coerceListBounds("2026-02-30", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: nonexistent day 02-30 rejected");
eq(coerceListBounds("2025-02-29", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: non-leap 02-29 rejected");
eq(coerceListBounds("2026-04-31", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: 30-day month 04-31 rejected");
eq(coerceListBounds("2026-07-12 24:00", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: hour 24 rejected");
eq(coerceListBounds("2026-07-12 09:60", undefined), { error: "dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }, "coerce: minute 60 rejected");

// --- coerceListLimit (tool-layer limit validation) ---

eq(coerceListLimit(undefined), {}, "limit: absent ok");
eq(coerceListLimit(5), { limit: 5 }, "limit: positive integer ok");
eq(coerceListLimit(1), { limit: 1 }, "limit: one ok");
eq(coerceListLimit(0), { error: "limit must be a positive integer" }, "limit: zero rejected");
eq(coerceListLimit(-3), { error: "limit must be a positive integer" }, "limit: negative rejected");
eq(coerceListLimit(2.5), { error: "limit must be a positive integer" }, "limit: non-integer rejected");

// --- sortRemindersByDue ---

eq(
  sortRemindersByDue([r("c", "2026-07-13 09:00"), r("a", "2026-07-12 09:00"), r("b", "2026-07-12 09:00"), r("z"), r("d", "2026-07-11 09:00")]).map((x) => x.id),
  ["d", "a", "b", "c", "z"],
  "sort: ascending due date, same-date by id, no-date last",
);

eq(
  sortRemindersByDue([r("x"), r("y"), r("a", "2026-07-10 09:00")]).map((x) => x.id),
  ["a", "x", "y"],
  "sort: dated before undated, undated keeps id order",
);

eq(
  sortRemindersByDue([r("m", "2026-07-14 09:00"), r("z"), r("a", "2026-07-10 09:00"), r("q", "2026-07-12 09:00"), r("b", "2026-07-10 09:00"), r("w")]).map((x) => x.id),
  ["a", "b", "q", "m", "w", "z"],
  "sort: fully shuffled fixture still stable (date asc, id tiebreak, undated last)",
);

// undated-only set must remain id-sorted (Infinity - Infinity is not NaN-dependent)
eq(
  sortRemindersByDue([r("c"), r("a"), r("b")]).map((x) => x.id),
  ["a", "b", "c"],
  "sort: all-undated uses id tiebreak (no NaN)",
);

// --- applyListQuery ---

// no window: keep items with and without due date
eq(
  applyListQuery([r("a", "2026-07-12 09:00"), r("b")], {}).map((x) => x.id),
  ["a", "b"],
  "filter: no window keeps undated",
);

// window present: drop undated
eq(
  applyListQuery([r("a", "2026-07-12 09:00"), r("b")], { dueFrom: "2026-07-12" }).map((x) => x.id),
  ["a"],
  "filter: window drops undated",
);

// closed interval: date-only bounds include full day on both edges
eq(
  applyListQuery(
    [r("edge0", "2026-07-12 00:00"), r("in", "2026-07-12 12:00"), r("edge1", "2026-07-13 23:59"), r("out-pre", "2026-07-11 23:59"), r("out-post", "2026-07-14 00:00"), r("nodue")],
    { dueFrom: "2026-07-12", dueTo: "2026-07-13" },
  ).map((x) => x.id),
  ["edge0", "in", "edge1"],
  "filter: date-only window is inclusive on both edges",
);

// minute-precise bound includes that minute
eq(
  applyListQuery([r("a", "2026-07-12 09:30"), r("b", "2026-07-12 09:31")], { dueFrom: "2026-07-12 09:30", dueTo: "2026-07-12 09:30" }).map((x) => x.id),
  ["a"],
  "filter: minute-precise closed interval",
);

// limit after filtering
eq(
  applyListQuery([r("a", "2026-07-12 09:00"), r("b", "2026-07-12 10:00"), r("c", "2026-07-12 11:00")], { limit: 2 }).map((x) => x.id),
  ["a", "b"],
  "limit: takes first N after sort",
);

// limit larger than result keeps all
eq(
  applyListQuery([r("a", "2026-07-12 09:00")], { limit: 5 }).map((x) => x.id),
  ["a"],
  "limit: larger than result keeps all",
);

// invalid limit (0 / negative / non-integer) does not truncate
eq(applyListQuery([r("a"), r("b")], { limit: 0 }).length, 2, "limit: 0 does not truncate");
eq(applyListQuery([r("a"), r("b")], { limit: -1 }).length, 2, "limit: negative does not truncate");

// window + limit compose
eq(
  applyListQuery(
    [r("a", "2026-07-12 09:00"), r("b", "2026-07-13 09:00"), r("c", "2026-07-14 09:00"), r("d")],
    { dueFrom: "2026-07-12", dueTo: "2026-07-14", limit: 2 },
  ).map((x) => x.id),
  ["a", "b"],
  "compose: window filter then limit",
);

// sort + limit joined (production chain: listReminders sorts, then applyListQuery limits)
eq(
  applyListQuery(sortRemindersByDue([r("c", "2026-07-14 09:00"), r("a", "2026-07-12 09:00"), r("b", "2026-07-13 09:00")]), { limit: 2 }).map((x) => x.id),
  ["a", "b"],
  "chain: sort then limit keeps earliest due first",
);

// --- tool execute path: public execute rejects invalid input before any osascript call ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captured: { tool?: { execute: (...args: any[]) => Promise<{ content: { text: string }[] }>; renderResult: (...args: any[]) => { render: (width: number) => string[] } } } = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakePi: any = {
  registerTool: (def: any) => {
    captured.tool = def;
  },
  registerCommand: () => {},
};
remindersExtension(fakePi);

async function execListText(params: Record<string, unknown>): Promise<string> {
  const res = await captured.tool!.execute("t1", { action: "list", ...params }, undefined, undefined, undefined);
  return res.content[0].text;
}

eq(await execListText({ dueFrom: "2026-02-30" }), "Error: dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM", "execute: invalid calendar dueFrom rejected");
eq(await execListText({ dueTo: "2026-07-12 24:00" }), "Error: dueTo must be YYYY-MM-DD or YYYY-MM-DD HH:MM", "execute: invalid hour dueTo rejected");
eq(await execListText({ dueFrom: "" }), "Error: dueFrom must be YYYY-MM-DD or YYYY-MM-DD HH:MM", "execute: empty dueFrom rejected");
eq(await execListText({ limit: 0 }), "Error: limit must be a positive integer", "execute: zero limit rejected");
eq(await execListText({ limit: 2.5 }), "Error: limit must be a positive integer", "execute: fractional limit rejected");
eq(await execListText({ limit: -1 }), "Error: limit must be a positive integer", "execute: negative limit rejected");

// --- tool result projection (behaviour: never emit a line wider than the render width) ---
// renderResult must return a real Component (Text); its render(width) wraps long lines
// instead of returning one raw unbounded string. Regression: a long reminder line under a
// narrow terminal used to exceed the terminal width and trip pi-tui's width assertion (crash).
const projectionTheme = { fg: (_color: string, text: string) => text };
const projectionResult = { content: [{ type: "text", text: "Created: first\nDetails: second" }], details: { id: "private-id" } };

function renderResultLines(result: { content: { type: string; text: string }[]; details: unknown }, opts: { expanded: boolean; isPartial: boolean }, width: number): string[] {
  return captured.tool!.renderResult(result, opts, projectionTheme).render(width);
}
function maxVisibleWidth(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
}

// compact summary: hides the remaining lines and fits the render width
{
  const lines = renderResultLines(projectionResult, { expanded: false, isPartial: false }, 80);
  eq(maxVisibleWidth(lines) <= 80, true, "render: compact lines never exceed width");
  eq(lines.join("").includes("Created: first"), true, "render: compact shows first line");
  eq(lines.join("").includes("Details: second"), false, "render: compact hides remaining lines");
}
// expanded: shows the full text and fits the render width
{
  const lines = renderResultLines(projectionResult, { expanded: true, isPartial: false }, 80);
  eq(maxVisibleWidth(lines) <= 80, true, "render: expanded lines never exceed width");
  eq(lines.join("").includes("Created: first") && lines.join("").includes("Details: second"), true, "render: expanded shows full text");
}
// partial status: fits the render width
{
  const lines = renderResultLines(projectionResult, { expanded: false, isPartial: true }, 80);
  eq(maxVisibleWidth(lines) <= 80, true, "render: partial lines never exceed width");
  eq(lines.join("").includes("Working…"), true, "render: partial status");
}
// crash regression: a very long reminder line under a narrow terminal must wrap, not overflow
{
  const longResult = { content: [{ type: "text", text: "https://github.com/Jarvis322/MacWake 完成汉化 ".repeat(20) }], details: { count: 1 } };
  const collapsed = renderResultLines(longResult, { expanded: false, isPartial: false }, 30);
  const expanded = renderResultLines(longResult, { expanded: true, isPartial: false }, 30);
  eq(maxVisibleWidth(collapsed) <= 30, true, "render: long collapsed line wraps within narrow terminal (crash regression)");
  eq(maxVisibleWidth(expanded) <= 30, true, "render: long expanded line wraps within narrow terminal (crash regression)");
  eq(expanded.length > 1, true, "render: long line actually wraps to multiple lines");
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log(`\nall list-query tests passed`);
