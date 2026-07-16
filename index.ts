import { StringEnum } from "@earendil-works/pi-ai";
import { keyHint } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LIST = process.env.REMINDERS_LIST || "近期待办";

type Action = "add" | "list" | "complete" | "delete" | "update";

interface Reminder {
  id: string;
  name: string;
  body?: string;
  list_name: string;
  due_date?: string;
  creation_date?: string;
  modification_date?: string;
  priority?: number;
  priority_label?: string;
  flagged?: boolean;
  completed?: boolean;
  alarms?: unknown[];
  tags?: string[];
}

interface AddReminderDraft {
  title: string;
  due?: string;
}

const AddReminderDraftParams = Type.Object({
  title: Type.String({ description: "Reminder title" }),
  due: Type.Optional(
    Type.String({
      description: "Absolute due date: YYYY-MM-DD or YYYY-MM-DD HH:MM. Translate natural language before calling.",
    }),
  ),
});

const RemindersParams = Type.Object({
  action: StringEnum(["add", "list", "complete", "delete", "update"] as const),
  title: Type.Optional(
    Type.String({
      description: "Reminder title (add: the title to create; update: the new title to set)",
    }),
  ),
  due: Type.Optional(
    Type.String({
      description: "Absolute due date: YYYY-MM-DD or YYYY-MM-DD HH:MM. Translate natural language before calling.",
    }),
  ),
  body: Type.Optional(
    Type.String({ description: "Reminder body/note text (update: the new note to set)" }),
  ),
  items: Type.Optional(Type.Array(AddReminderDraftParams)),
  query: Type.Optional(
    Type.String({ description: "Search query for list, or ID/title for complete/delete/update" }),
  ),
  queries: Type.Optional(
    Type.Array(
      Type.String({ description: "Delete only: multiple ID/title references resolved in one batch confirm" }),
    ),
  ),
  dueFrom: Type.Optional(
    Type.String({
      description: "List only: absolute due-date lower bound (inclusive) YYYY-MM-DD or YYYY-MM-DD HH:MM. Translate natural language before calling.",
    }),
  ),
  dueTo: Type.Optional(
    Type.String({
      description: "List only: absolute due-date upper bound (inclusive) YYYY-MM-DD or YYYY-MM-DD HH:MM. Translate natural language before calling.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({ description: "List only: max items to return after sorting. Positive integer." }),
  ),
});

function normalizeAddDrafts(params: { title?: string; due?: string; items?: AddReminderDraft[] }): AddReminderDraft[] {
  if (params.items && params.items.length > 0) {
    return params.items
      .map((item) => ({ title: item.title.trim(), due: item.due?.trim() }))
      .filter((item) => item.title);
  }
  const title = params.title?.trim() || "";
  if (!title) return [];
  return [{ title, due: params.due?.trim() }];
}

function renderAddDraft(draft: AddReminderDraft): string {
  return draft.due ? `${draft.title}｜${draft.due}` : draft.title;
}

function isAbsoluteDue(due?: string): boolean {
  if (!due) return true;
  return /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/.test(due);
}

function summarizeReminder(reminder: Reminder): string {
  const shortId = reminder.id.split("-")[0];
  const due = reminder.due_date || "（无）";
  const status = reminder.completed ? "已完成" : "未完成";
  return `ID: ${shortId}\n标题: ${reminder.name}\n列表: ${reminder.list_name}\n日期: ${due}\n状态: ${status}`;
}

function formatReminderLine(reminder: Reminder): string {
  const shortId = reminder.id.split("-")[0];
  const due = reminder.due_date ? ` (due: ${reminder.due_date})` : "";
  const status = reminder.completed ? "[x]" : "[ ]";
  return `${status} ${shortId} ${reminder.name}${due}`;
}

function formatReminderChoice(r: Reminder): string {
  const shortId = r.id.split("-")[0];
  const due = r.due_date ? ` | ${r.due_date}` : " | （无）";
  return `${shortId} | ${r.name}${due}`;
}

function formatReminderChoices(reminders: Reminder[]): string[] {
  return reminders.map(formatReminderChoice);
}

function buildListText(reminders: Reminder[]): string {
  if (reminders.length === 0) return "没有找到 reminder。";
  return reminders.map(formatReminderLine).join("\n");
}

async function settleUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const US = "\x1f";
const RS = "\x1e";

function osaEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function stripReminderId(rawId: string): string {
  return rawId.replace(/^x-apple-reminder:\/\//, "").trim();
}

function osaDateFormat(due: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm";
}

async function runOsa(script: string): Promise<string> {
  const lines = script.split("\n").filter((line) => line.trim().length > 0);
  const args = lines.flatMap((line) => ["-e", line]);
  try {
    const { stdout } = await execFileAsync("osascript", args, { encoding: "utf-8", timeout: 120000 });
    return stdout.replace(/\n+$/, "");
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error) {
      const stderr = String((error as { stderr?: string }).stderr || "").trim();
      if (stderr) {
        throw new Error(`osascript failed: ${stderr}`);
      }
    }
    throw error;
  }
}

interface OsaRecord {
  id: string;
  name: string;
  due_date: string;
  completed: boolean;
  body: string;
  list_name: string;
}

function parseOsaRecords(raw: string): OsaRecord[] {
  const records: OsaRecord[] = [];
  for (const chunk of raw.split(RS)) {
    if (!chunk) continue;
    const fields = chunk.split(US);
    while (fields.length < 6) fields.push("");
    const [id, name, dueDate, completed, body, listName] = fields;
    records.push({
      id: stripReminderId(id),
      name,
      due_date: dueDate,
      completed: completed === "true",
      body,
      list_name: listName,
    });
  }
  return records;
}

function osaRecordToReminder(rec: OsaRecord): Reminder {
  return {
    id: rec.id,
    name: rec.name,
    body: rec.body || undefined,
    list_name: rec.list_name,
    due_date: rec.due_date || undefined,
    completed: rec.completed,
  };
}

async function addReminder(title: string, due?: string, list = DEFAULT_LIST): Promise<Reminder> {
  const lines = [
    `use framework "Foundation"`,
    `tell application "Reminders"`,
  ];
  if (due) {
    const fmt = osaDateFormat(due);
    lines.push(`set df to current application's NSDateFormatter's alloc()'s init()`);
    lines.push(`df's setDateFormat:"${fmt}"`);
    lines.push(`set dueDate to (df's dateFromString:"${due}") as date`);
  }
  const props = `name:"${osaEscape(title)}"` + (due ? ", due date:dueDate" : "");
  lines.push(`set newRem to make new reminder with properties {${props}} at end of reminders of list "${osaEscape(list)}"`);
  lines.push(`return (id of newRem) as string`);
  lines.push(`end tell`);
  const rawId = await runOsa(lines.join("\n"));
  return {
    id: stripReminderId(rawId),
    name: title,
    list_name: list,
    due_date: due,
    completed: false,
  };
}

async function addReminders(drafts: AddReminderDraft[], list = DEFAULT_LIST): Promise<{ created: Reminder[]; failures: { draft: AddReminderDraft; error: string }[] }> {
  const created: Reminder[] = [];
  const failures: { draft: AddReminderDraft; error: string }[] = [];
  for (const draft of drafts) {
    try {
      created.push(await addReminder(draft.title, draft.due, list));
    } catch (error) {
      failures.push({ draft, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, failures };
}

export function sortRemindersByDue(reminders: Reminder[]): Reminder[] {
  const ts = (r: Reminder): number => {
    if (!r.due_date) return Number.POSITIVE_INFINITY;
    const t = Date.parse(r.due_date);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return [...reminders].sort((a, b) => {
    const ta = ts(a);
    const tb = ts(b);
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function normalizeDueBound(bound: string, edge: "start" | "end"): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bound)) return edge === "start" ? `${bound} 00:00` : `${bound} 23:59`;
  return bound;
}

const LIST_DUE_BOUND_RE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/;

function isValidCalendar(s: string): boolean {
  const m = s.match(LIST_DUE_BOUND_RE);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = m[4] !== undefined ? +m[4] : 0;
  const mi = m[5] !== undefined ? +m[5] : 0;
  if (h > 23 || mi > 59) return false;
  const dt = new Date(y, mo - 1, d, h, mi);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === mo - 1 &&
    dt.getDate() === d &&
    dt.getHours() === h &&
    dt.getMinutes() === mi
  );
}

export function coerceListBounds(
  dueFrom?: string,
  dueTo?: string,
): { dueFrom?: string; dueTo?: string; error?: string } {
  const check = (v: string | undefined, label: string): string | undefined => {
    if (v === undefined) return undefined;
    const t = v.trim();
    if (!t || !isValidCalendar(t)) return `${label} must be YYYY-MM-DD or YYYY-MM-DD HH:MM`;
    return undefined;
  };
  const eFrom = check(dueFrom, "dueFrom");
  if (eFrom) return { error: eFrom };
  const eTo = check(dueTo, "dueTo");
  if (eTo) return { error: eTo };
  return { dueFrom: dueFrom?.trim(), dueTo: dueTo?.trim() };
}

export function coerceListLimit(limit?: number): { limit?: number; error?: string } {
  if (limit === undefined) return {};
  if (!Number.isInteger(limit) || limit <= 0) return { error: "limit must be a positive integer" };
  return { limit };
}

export function applyListQuery(
  reminders: Reminder[],
  opts: { dueFrom?: string; dueTo?: string; limit?: number },
): Reminder[] {
  const { dueFrom, dueTo, limit } = opts;
  let result = reminders;
  if (dueFrom || dueTo) {
    const lo = dueFrom ? normalizeDueBound(dueFrom, "start") : "";
    const hi = dueTo ? normalizeDueBound(dueTo, "end") : "";
    result = result.filter((r) => !!r.due_date && (!lo || r.due_date >= lo) && (!hi || r.due_date <= hi));
  }
  if (limit !== undefined && Number.isInteger(limit) && limit > 0) result = result.slice(0, limit);
  return result;
}

async function listReminders(query = "", list = DEFAULT_LIST, includeCompleted = false): Promise<Reminder[]> {
  const lines = [
    `use framework "Foundation"`,
    `tell application "Reminders"`,
    `set us to character id 31`,
    `set df to current application's NSDateFormatter's alloc()'s init()`,
    `df's setDateFormat:"yyyy-MM-dd HH:mm"`,
    `set out to ""`,
    `set q to "${osaEscape(query)}"`,
    `set lstName to "${osaEscape(list)}"`,
    `set onlyIncomplete to ${!includeCompleted}`,
    `repeat with r in reminders of list lstName`,
    `  set isMatch to true`,
    `  if q is not "" then set isMatch to (name of r contains q)`,
    `  if isMatch and (not onlyIncomplete or not (completed of r)) then`,
    `    set rId to (id of r as string)`,
    `    set rName to name of r`,
    `    set rDue to ""`,
    `    try`,
    `      set d to due date of r`,
    `      if d is not missing value then set rDue to (df's stringFromDate:(d as date)) as string`,
    `    end try`,
    `    set rBody to ""`,
    `    try`,
    `      set theBody to body of r`,
    `      if theBody is not missing value then set rBody to theBody`,
    `    end try`,
    `    set out to out & rId & us & rName & us & rDue & us & (completed of r as string) & us & rBody & us & lstName & character id 30`,
    `  end if`,
    `end repeat`,
    `return out`,
    `end tell`,
  ];
  const raw = await runOsa(lines.join("\n"));
  return sortRemindersByDue(parseOsaRecords(raw).map(osaRecordToReminder));
}

async function showReminder(id: string): Promise<Reminder | null> {
  const fullId = id.startsWith("x-apple-reminder://") ? id : "x-apple-reminder://" + id;
  const lines = [
    `use framework "Foundation"`,
    `tell application "Reminders"`,
    `set us to character id 31`,
    `set df to current application's NSDateFormatter's alloc()'s init()`,
    `df's setDateFormat:"yyyy-MM-dd HH:mm"`,
    `set targetId to "${osaEscape(fullId)}"`,
    `repeat with lst in lists`,
    `  set lstName to name of lst`,
    `  repeat with r in reminders of lst`,
    `    if (id of r as string) is targetId then`,
    `      set rName to name of r`,
    `      set rDue to ""`,
    `      try`,
    `        set d to due date of r`,
    `        if d is not missing value then set rDue to (df's stringFromDate:(d as date)) as string`,
    `      end try`,
    `      set rBody to ""`,
    `      try`,
    `        set theBody to body of r`,
    `        if theBody is not missing value then set rBody to theBody`,
    `      end try`,
    `      return (id of r as string) & us & rName & us & rDue & us & (completed of r as string) & us & rBody & us & lstName`,
    `    end if`,
    `  end repeat`,
    `end repeat`,
    `return "NOT_FOUND"`,
    `end tell`,
  ];
  const raw = await runOsa(lines.join("\n"));
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "NOT_FOUND") return null;
  const records = parseOsaRecords(trimmed);
  return records[0] ? osaRecordToReminder(records[0]) : null;
}

async function resolveCandidates(ref: string, mode: "all" | "incomplete", list = DEFAULT_LIST): Promise<Reminder[]> {
  const byId = await showReminder(ref);
  if (byId) return [byId];
  return listReminders(ref, list, mode === "all");
}

async function completeReminder(id: string): Promise<void> {
  const fullId = id.startsWith("x-apple-reminder://") ? id : "x-apple-reminder://" + id;
  const script = [
    `tell application "Reminders"`,
    `set targetId to "${osaEscape(fullId)}"`,
    `set done to false`,
    `repeat with lst in lists`,
    `  try`,
    `    set completed of (first reminder of lst whose id is targetId) to true`,
    `    set done to true`,
    `    exit repeat`,
    `  end try`,
    `end repeat`,
    `if not done then error "reminder not found: " & targetId`,
    `end tell`,
  ].join("\n");
  await runOsa(script);
}

async function deleteReminder(id: string): Promise<void> {
  const fullId = id.startsWith("x-apple-reminder://") ? id : "x-apple-reminder://" + id;
  const script = [
    `tell application "Reminders"`,
    `set targetId to "${osaEscape(fullId)}"`,
    `set done to false`,
    `repeat with lst in lists`,
    `  try`,
    `    delete (first reminder of lst whose id is targetId)`,
    `    set done to true`,
    `    exit repeat`,
    `  end try`,
    `end repeat`,
    `if not done then error "reminder not found: " & targetId`,
    `end tell`,
  ].join("\n");
  await runOsa(script);
}

async function updateReminder(
  id: string,
  updates: { title?: string; due?: string; body?: string },
): Promise<void> {
  const fullId = id.startsWith("x-apple-reminder://") ? id : "x-apple-reminder://" + id;
  const lines = [
    `use framework "Foundation"`,
    `tell application "Reminders"`,
    `set targetId to "${osaEscape(fullId)}"`,
    `set done to false`,
  ];
  if (updates.due !== undefined) {
    const fmt = osaDateFormat(updates.due);
    lines.push(`set df to current application's NSDateFormatter's alloc()'s init()`);
    lines.push(`df's setDateFormat:"${fmt}"`);
    lines.push(`set dueDate to (df's dateFromString:"${osaEscape(updates.due)}") as date`);
  }
  lines.push(`repeat with lst in lists`);
  lines.push(`  try`);
  lines.push(`    set theReminder to (first reminder of lst whose id is targetId)`);
  if (updates.title !== undefined) {
    lines.push(`    set name of theReminder to "${osaEscape(updates.title)}"`);
  }
  if (updates.due !== undefined) {
    lines.push(`    set due date of theReminder to dueDate`);
  }
  if (updates.body !== undefined) {
    lines.push(`    set body of theReminder to "${osaEscape(updates.body)}"`);
  }
  lines.push(`    set done to true`);
  lines.push(`    exit repeat`);
  lines.push(`  end try`);
  lines.push(`end repeat`);
  lines.push(`if not done then error "reminder not found: " & targetId`);
  lines.push(`end tell`);
  await runOsa(lines.join("\n"));
}

async function pickCandidate(
  reminders: Reminder[],
  title: string,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<Reminder | null> {
  if (reminders.length === 0) return null;
  if (reminders.length === 1) return reminders[0];
  if (!ctx.hasUI) throw new Error("匹配到多条 reminder，但当前没有 UI 可供选择，请改用精确 ID");
  const choices = formatReminderChoices(reminders);
  const selected = await ctx.ui.select(title, choices);
  if (!selected) return null;
  const index = choices.indexOf(selected);
  return index >= 0 ? reminders[index] : null;
}

function buildAddSummary(created: Reminder[], failures: { draft: AddReminderDraft; error: string }[]): string {
  const createdText = created.map((reminder) => `已创建：${reminder.name}`).join("\n");
  const failureText = failures.map((item) => `失败：${renderAddDraft(item.draft)}｜${item.error}`).join("\n");
  return [createdText, failureText].filter(Boolean).join("\n");
}

interface UnresolvedTarget {
  ref: string;
  reason: string;
}

export interface BatchResolveDeps {
  resolve: (ref: string) => Promise<Reminder[]>;
  pick: (candidates: Reminder[]) => Promise<Reminder | null>;
}

export async function resolveBatchTargets(
  refs: string[],
  deps: BatchResolveDeps,
): Promise<{ resolved: Reminder[]; unresolved: UnresolvedTarget[] }> {
  const resolved: Reminder[] = [];
  const unresolved: UnresolvedTarget[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const candidates = await deps.resolve(ref);
    if (candidates.length === 0) {
      unresolved.push({ ref, reason: "未找到匹配项" });
      continue;
    }
    const target = candidates.length === 1 ? candidates[0] : await deps.pick(candidates);
    if (!target) {
      unresolved.push({ ref, reason: "未选定或取消选择" });
      continue;
    }
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    resolved.push(target);
  }
  return { resolved, unresolved };
}

export function buildBatchConfirmBody(resolved: Reminder[], unresolved: UnresolvedTarget[]): string {
  const lines: string[] = [`将删除 ${resolved.length} 条：`, ...resolved.map((r) => `- ${formatReminderChoice(r)}`)];
  if (unresolved.length) {
    lines.push(`未能定位 ${unresolved.length} 条：`, ...unresolved.map((u) => `- ${u.ref}（${u.reason}）`));
  }
  return lines.join("\n");
}

async function confirmBatchDelete(
  resolved: Reminder[],
  unresolved: UnresolvedTarget[],
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<boolean> {
  if (!ctx.hasUI) throw new Error("当前没有可用 UI，无法做批量删除的确认");
  return ctx.ui.confirm("确认删除以上 reminder？", buildBatchConfirmBody(resolved, unresolved));
}

export async function executeBatchDelete(
  resolved: Reminder[],
  deleteFn: (id: string) => Promise<void>,
): Promise<{ deleted: Reminder[]; failed: { reminder: Reminder; error: string }[] }> {
  const deleted: Reminder[] = [];
  const failed: { reminder: Reminder; error: string }[] = [];
  for (const r of resolved) {
    try {
      await deleteFn(r.id);
      deleted.push(r);
    } catch (error) {
      failed.push({ reminder: r, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}

export function collectDeleteRefs(params: { query?: string; queries?: string[] }): string[] {
  if (params.queries?.length) return params.queries.map((s) => s.trim()).filter(Boolean);
  const q = params.query?.trim();
  return q ? [q] : [];
}

export interface BatchDeleteDeps {
  resolve: (ref: string) => Promise<Reminder[]>;
  pick: (candidates: Reminder[]) => Promise<Reminder | null>;
  confirm: (resolved: Reminder[], unresolved: UnresolvedTarget[]) => Promise<boolean>;
  deleteFn: (id: string) => Promise<void>;
}

export async function runBatchDeleteFlow(
  refs: string[],
  deps: BatchDeleteDeps,
): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  if (refs.length === 0) return { content: [{ type: "text", text: "Error: query required for delete" }], details: {} };
  const { resolved, unresolved } = await resolveBatchTargets(refs, { resolve: deps.resolve, pick: deps.pick });
  if (resolved.length === 0) {
    return {
      content: [{ type: "text", text: buildBatchDeleteResult([], unresolved, []) }],
      details: { deleted: 0, unresolved: unresolved.length },
    };
  }
  const ok = await deps.confirm(resolved, unresolved);
  if (!ok) return { content: [{ type: "text", text: "Cancelled" }], details: { deleted: 0, unresolved: unresolved.length } };
  const { deleted, failed } = await executeBatchDelete(resolved, deps.deleteFn);
  return {
    content: [{ type: "text", text: buildBatchDeleteResult(deleted, unresolved, failed) }],
    details: { deleted: deleted.length, failed: failed.length, unresolved: unresolved.length },
  };
}

export function buildBatchDeleteResult(
  deleted: Reminder[],
  unresolved: UnresolvedTarget[],
  failed: { reminder: Reminder; error: string }[],
): string {
  const parts: string[] = [];
  if (deleted.length) parts.push(deleted.map((r) => `已删除：${r.name}`).join("\n"));
  if (failed.length) parts.push(failed.map((f) => `删除失败：${f.reminder.name}｜${f.error}`).join("\n"));
  if (unresolved.length) parts.push(unresolved.map((u) => `未定位：${u.ref}｜${u.reason}`).join("\n"));
  return parts.length ? parts.join("\n") : "没有可删除的 reminder。";
}

async function handleListCommand(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  const reminders = await listReminders(rest);
  if (!ctx.hasUI) {
    ctx.ui.notify(buildListText(reminders), "info");
    await settleUi();
    return;
  }
  const choices = reminders.length ? formatReminderChoices(reminders) : ["没有找到 reminder"];
  const selected = await ctx.ui.select(`近期待办（${reminders.length}）`, choices);
  if (!selected) return;
  const index = choices.indexOf(selected);
  if (index >= 0 && reminders[index]) {
    ctx.ui.notify(summarizeReminder(reminders[index]), "info");
    await settleUi();
  }
}

async function resolveOneForWrite(
  ref: string,
  mode: "all" | "incomplete",
  title: string,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<Reminder | null> {
  const candidates = await resolveCandidates(ref, mode);
  if (candidates.length === 0) return null;
  return pickCandidate(candidates, title, ctx);
}

function renderToolResultText(result: { content?: Array<{ type?: string; text?: string }> }, expanded: boolean, theme: Theme) {
  const text = result.content?.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text!).join("\n") ?? "";
  const visible = expanded ? text : `${text.split("\n").find(Boolean) ?? "Completed"} (${keyHint("app.tools.expand", "to expand")})`;
  return {
    render: () => [theme.fg(expanded ? "toolOutput" : "success", visible)],
    invalidate: () => {},
  };
}

async function executeToolAction(
  action: Action,
  params: { title?: string; due?: string; body?: string; query?: string; queries?: string[]; items?: AddReminderDraft[]; dueFrom?: string; dueTo?: string; limit?: number },
  ctx: ExtensionContext,
): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  if (action === "list") {
    const bounds = coerceListBounds(params.dueFrom, params.dueTo);
    if (bounds.error) return { content: [{ type: "text", text: `Error: ${bounds.error}` }], details: {} };
    const lim = coerceListLimit(params.limit);
    if (lim.error) return { content: [{ type: "text", text: `Error: ${lim.error}` }], details: {} };
    const reminders = applyListQuery(await listReminders(params.query || ""), {
      dueFrom: bounds.dueFrom,
      dueTo: bounds.dueTo,
      limit: lim.limit,
    });
    return { content: [{ type: "text", text: buildListText(reminders) }], details: { count: reminders.length } };
  }

  if (action === "add") {
    const drafts = normalizeAddDrafts(params);
    if (drafts.length === 0) return { content: [{ type: "text", text: "Error: title required for add" }], details: {} };
    if (drafts.some((draft) => !isAbsoluteDue(draft.due))) {
      return { content: [{ type: "text", text: "Error: due must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }], details: {} };
    }
    if (drafts.length === 1) {
      const [draft] = drafts;
      const created = await addReminder(draft.title, draft.due);
      return { content: [{ type: "text", text: `Created: ${created.name}` }], details: { id: created.id } };
    }
    const { created, failures } = await addReminders(drafts);
    return {
      content: [{ type: "text", text: buildAddSummary(created, failures) || "No reminders created" }],
      details: { created: created.length, failed: failures.length },
    };
  }

  if (action === "update") {
    if (!params.query?.trim()) {
      return { content: [{ type: "text", text: "Error: query required for update" }], details: {} };
    }
    if (params.due && !isAbsoluteDue(params.due)) {
      return { content: [{ type: "text", text: "Error: due must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }], details: {} };
    }
    const updates: { title?: string; due?: string; body?: string } = {};
    if (params.title && params.title.trim()) updates.title = params.title.trim();
    if (params.due && params.due.trim()) updates.due = params.due.trim();
    if (params.body && params.body.trim()) updates.body = params.body.trim();
    if (!updates.title && !updates.due && !updates.body) {
      return { content: [{ type: "text", text: "Error: at least one of title/due/body required for update" }], details: {} };
    }
    const reminder = await resolveOneForWrite(params.query.trim(), "all", "选择要更新的 reminder", ctx);
    if (!reminder) return { content: [{ type: "text", text: "No matching reminder found" }], details: {} };
    await updateReminder(reminder.id, updates);
    const updated = await showReminder(reminder.id);
    const text = updated ? `Updated:\n${summarizeReminder(updated)}` : `Updated: ${reminder.name}`;
    return { content: [{ type: "text", text }], details: { id: reminder.id } };
  }

  if (action === "delete") {
    return runBatchDeleteFlow(collectDeleteRefs(params), {
      resolve: (ref) => resolveCandidates(ref, "all"),
      pick: (candidates) => pickCandidate(candidates, "选择要删除的 reminder", ctx),
      confirm: (resolved, unresolved) => confirmBatchDelete(resolved, unresolved, ctx),
      deleteFn: (id) => deleteReminder(id),
    });
  }

  if (!params.query?.trim()) {
    return { content: [{ type: "text", text: `Error: query required for ${action}` }], details: {} };
  }

  const reminder = await resolveOneForWrite(params.query.trim(), "incomplete", "选择要完成的 reminder", ctx);
  if (!reminder) return { content: [{ type: "text", text: "No matching reminder found" }], details: {} };

  await completeReminder(reminder.id);
  return { content: [{ type: "text", text: `Completed: ${reminder.name}` }], details: { id: reminder.id } };
}

export default function remindersExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "reminders",
    label: "Reminders",
    description: "Manage Apple Reminders in the user's default list. Actions: add, list (filter by due window, sort by due date, limit), complete, delete (single or batch), update.",
    promptSnippet:
      "Create, list, complete, delete, or update Apple Reminders when the user explicitly asks. If the user asks for multiple reminders, batch them in one add call using items.",
    promptGuidelines: [
      "Use reminders only when the user explicitly asks to create, list, complete, delete, or update a reminder or todo.",
      "Before calling reminders with action add or update, translate any Chinese or English natural-language date into an absolute YYYY-MM-DD or YYYY-MM-DD HH:MM value.",
      "For action list, translate natural-language date ranges (today/this week) into absolute dueFrom/dueTo (inclusive). Use a positive integer limit only when the user asks for a bounded count; omit dueFrom/dueTo to keep items with no due date.",
      "If the user asks to create multiple reminders in one message, prefer a single add call with items[] instead of multiple separate add calls.",
      "For action delete with multiple targets, pass them as queries[] for a single batch confirm; resolved targets are deleted after one confirmation, unresolved ones are reported.",
      "Never create, complete, delete, or update reminders without explicit user intent. Only delete shows a confirmation prompt; add, complete, and update execute directly.",
    ],
    parameters: RemindersParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeToolAction(params.action as Action, params, ctx);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return { render: () => [theme.fg("warning", "Working…")], invalidate: () => {} };
      return renderToolResultText(result, expanded, theme);
    },
  });

  pi.registerCommand("reminders", {
    description: "列出最近待办；或带自然语言交由助手理解后操作 Apple Reminders",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        await handleListCommand("", ctx);
        return;
      }
      if (ctx.isIdle()) {
        pi.sendUserMessage(text);
        return;
      }
      pi.sendUserMessage(text, { deliverAs: "followUp" });
    },
  });
}
