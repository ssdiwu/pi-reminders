// Deterministic tests for batch-delete orchestration (dependency-injected, no osascript).
// Run: node --experimental-strip-types scripts/test-batch-delete.ts
//
// The delete flow is split into injectable pure functions so core behavior
// (resolution / ambiguity / dedup / summary / best-effort delete) can be tested
// without touching real Reminders or the Automation bridge.

import {
  resolveBatchTargets,
  buildBatchConfirmBody,
  executeBatchDelete,
  buildBatchDeleteResult,
  collectDeleteRefs,
  runBatchDeleteFlow,
  type BatchResolveDeps,
} from "../index.ts";

interface R {
  id: string;
  name: string;
  due_date?: string;
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

function r(id: string, name: string, due_date?: string): R {
  return { id, name, due_date };
}

const rA = r("x-apple-reminder://AA", "任务A", "2026-07-12 09:00");
const rB = r("x-apple-reminder://BB", "任务B");
const rX = r("x-apple-reminder://XX", "任务X");
const rY = r("x-apple-reminder://YY", "任务Y");

function makeDeps(
  resolveMap: Record<string, R[]>,
  pickChoice: (candidates: R[]) => R | null,
): { deps: BatchResolveDeps; pickSizes: number[] } {
  const pickSizes: number[] = [];
  const deps: BatchResolveDeps = {
    resolve: async (ref) => resolveMap[ref] ?? [],
    pick: async (candidates) => {
      pickSizes.push(candidates.length);
      return pickChoice(candidates as R[]);
    },
  };
  return { deps, pickSizes };
}

const ids = (arr: { id: string }[]) => arr.map((x) => x.id);

// --- resolveBatchTargets ---

// single-candidate refs resolve directly; missing ref recorded; pick never called
{
  const { deps, pickSizes } = makeDeps({ a: [rA], b: [rB], none: [] }, () => rX);
  const out = await resolveBatchTargets(["a", "b", "none"], deps);
  eq(ids(out.resolved), ["x-apple-reminder://AA", "x-apple-reminder://BB"], "resolve: multi single-candidate");
  eq(out.unresolved, [{ ref: "none", reason: "未找到匹配项" }], "resolve: missing recorded");
  eq(pickSizes.length, 0, "resolve: pick not called for single candidates");
}

// ambiguous ref triggers pick, chosen target kept
{
  const { deps, pickSizes } = makeDeps({ amb: [rX, rY] }, (c) => c[0]);
  const out = await resolveBatchTargets(["amb"], deps);
  eq(ids(out.resolved), ["x-apple-reminder://XX"], "resolve: ambiguity uses pick result");
  eq(pickSizes, [2], "resolve: pick called with candidate count");
}

// pick cancelled -> unresolved
{
  const { deps } = makeDeps({ amb: [rX, rY] }, () => null);
  const out = await resolveBatchTargets(["amb"], deps);
  eq(out.resolved.length, 0, "resolve: pick cancel yields no resolved");
  eq(out.unresolved, [{ ref: "amb", reason: "未选定或取消选择" }], "resolve: pick cancel recorded");
}

// dedup by reminder id
{
  const { deps } = makeDeps({ a: [rA], dup: [rA] }, () => rX);
  const out = await resolveBatchTargets(["a", "dup"], deps);
  eq(ids(out.resolved), ["x-apple-reminder://AA"], "resolve: duplicate id deduped");
  eq(out.unresolved.length, 0, "resolve: dedup not treated as unresolved");
}

// mixed: ok + missing + ambiguous + duplicate
{
  const { deps, pickSizes } = makeDeps({ a: [rA], none: [], amb: [rX, rY], dup: [rA] }, (c) => c[1]);
  const out = await resolveBatchTargets(["a", "none", "amb", "dup"], deps);
  eq(ids(out.resolved), ["x-apple-reminder://AA", "x-apple-reminder://YY"], "resolve: mixed resolved order");
  eq(out.unresolved, [{ ref: "none", reason: "未找到匹配项" }], "resolve: mixed only missing unresolved");
  eq(pickSizes, [2], "resolve: mixed pick called once for ambiguous");
}

// --- buildBatchConfirmBody ---

eq(
  buildBatchConfirmBody([rA], []),
  "将删除 1 条：\n- x | 任务A | 2026-07-12 09:00",
  "confirm body: resolved only",
);
eq(
  buildBatchConfirmBody([rA, rB], [{ ref: "none", reason: "未找到匹配项" }]),
  "将删除 2 条：\n- x | 任务A | 2026-07-12 09:00\n- x | 任务B | （无）\n未能定位 1 条：\n- none（未找到匹配项）",
  "confirm body: resolved plus unresolved",
);

// --- executeBatchDelete ---

// all succeed
{
  const deletedIds: string[] = [];
  const out = await executeBatchDelete([rA, rB], async (id) => {
    deletedIds.push(id);
  });
  eq(ids(out.deleted), ["x-apple-reminder://AA", "x-apple-reminder://BB"], "exec: all deleted");
  eq(out.failed.length, 0, "exec: no failures");
  eq(deletedIds, ["x-apple-reminder://AA", "x-apple-reminder://BB"], "exec: deleteFn called per id in order");
}

// middle failure does not stop the rest
{
  const out = await executeBatchDelete([rA, rB, rX], async (id) => {
    if (id === rB.id) throw new Error("boom");
  });
  eq(ids(out.deleted), ["x-apple-reminder://AA", "x-apple-reminder://XX"], "exec: continues after failure");
  eq(out.failed.length, 1, "exec: one failure recorded");
  eq(out.failed[0].reminder.id, "x-apple-reminder://BB", "exec: failed id correct");
  eq(out.failed[0].error, "boom", "exec: failed error message captured");
}

// all fail
{
  const out = await executeBatchDelete([rA, rB], async () => {
    throw new Error("x");
  });
  eq(out.deleted.length, 0, "exec: all fail -> none deleted");
  eq(out.failed.length, 2, "exec: all fail -> all recorded");
}

// --- buildBatchDeleteResult (pure aggregation) ---

eq(buildBatchDeleteResult([], [], []), "没有可删除的 reminder。", "result: empty fallback");
eq(buildBatchDeleteResult([rA], [], []), "已删除：任务A", "result: deleted only");
eq(
  buildBatchDeleteResult([], [{ ref: "X", reason: "未找到匹配项" }], []),
  "未定位：X｜未找到匹配项",
  "result: unresolved only",
);
eq(
  buildBatchDeleteResult([rA], [{ ref: "X", reason: "未找到匹配项" }], [{ reminder: rB, error: "err" }]),
  "已删除：任务A\n删除失败：任务B｜err\n未定位：X｜未找到匹配项",
  "result: ordered deleted/failed/unresolved",
);

// --- collectDeleteRefs (controller entry: queries preferred, query fallback) ---

eq(collectDeleteRefs({ queries: ["a", "b"] }), ["a", "b"], "refs: queries preferred");
eq(collectDeleteRefs({ queries: ["a", "   ", ""], query: "ignore" }), ["a"], "refs: queries blanks filtered, query ignored when queries present");
eq(collectDeleteRefs({ query: "x" }), ["x"], "refs: single query");
eq(collectDeleteRefs({ queries: [], query: "x" }), ["x"], "refs: empty queries falls back to query");
eq(collectDeleteRefs({}), [], "refs: nothing -> empty");
eq(collectDeleteRefs({ query: "   " }), [], "refs: whitespace query -> empty");

// --- runBatchDeleteFlow (controller: confirm count, cancel zero-delete, best-effort) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFlowDeps(resolveMap: Record<string, R[]>, pickChoice: (c: R[]) => R | null, confirmReturn: boolean): any {
  const confirmCalls: { resolved: R[]; unresolved: unknown[] }[] = [];
  const deleteCalls: string[] = [];
  return {
    deps: {
      resolve: async (ref: string) => resolveMap[ref] ?? [],
      pick: async (c: R[]) => pickChoice(c),
      confirm: async (resolved: R[], unresolved: unknown[]) => {
        confirmCalls.push({ resolved, unresolved });
        return confirmReturn;
      },
      deleteFn: async (id: string) => {
        deleteCalls.push(id);
      },
    },
    confirmCalls,
    deleteCalls,
  };
}

// empty refs -> error, no confirm, no delete
{
  const { deps, confirmCalls, deleteCalls } = makeFlowDeps({}, () => null, false);
  const res = await runBatchDeleteFlow([], deps);
  eq(res.content[0].text, "Error: query required for delete", "flow: empty refs error");
  eq(confirmCalls.length, 0, "flow: empty refs no confirm");
  eq(deleteCalls.length, 0, "flow: empty refs no delete");
}

// nothing resolvable -> unresolved summary, no confirm, no delete
{
  const { deps, confirmCalls, deleteCalls } = makeFlowDeps({ none: [] }, () => null, false);
  const res = await runBatchDeleteFlow(["none"], deps);
  eq(res.details.deleted, 0, "flow: nothing resolvable deleted 0");
  eq(confirmCalls.length, 0, "flow: nothing resolvable no confirm");
  eq(deleteCalls.length, 0, "flow: nothing resolvable no delete");
  eq(res.content[0].text.includes("未定位：none"), true, "flow: nothing resolvable summary");
}

// confirmed -> delete each in order, confirm exactly once
{
  const { deps, confirmCalls, deleteCalls } = makeFlowDeps({ a: [rA], b: [rB] }, () => null, true);
  const res = await runBatchDeleteFlow(["a", "b"], deps);
  eq(res.details.deleted, 2, "flow: confirmed deletes both");
  eq(deleteCalls, ["x-apple-reminder://AA", "x-apple-reminder://BB"], "flow: confirmed deletes in order");
  eq(confirmCalls.length, 1, "flow: confirm called exactly once");
}

// cancelled -> no delete, confirm once, Cancelled text
{
  const { deps, confirmCalls, deleteCalls } = makeFlowDeps({ a: [rA] }, () => null, false);
  const res = await runBatchDeleteFlow(["a"], deps);
  eq(res.content[0].text, "Cancelled", "flow: cancel returns Cancelled");
  eq(deleteCalls.length, 0, "flow: cancel deletes nothing");
  eq(confirmCalls.length, 1, "flow: cancel still confirms once");
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log(`\nall batch-delete tests passed`);
