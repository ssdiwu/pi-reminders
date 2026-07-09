import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
});

function parseCommandArgs(args: string): { action: Action | "help"; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { action: "list", rest: "" };
  const [verb, ...restParts] = trimmed.split(/\s+/);
  const action = ["add", "list", "complete", "delete", "update"].includes(verb) ? (verb as Action) : "help";
  return { action, rest: restParts.join(" ").trim() };
}

function parseAddRest(rest: string): { title: string; due?: string } {
  const trimmed = rest.trim();
  if (!trimmed) return { title: "" };
  const match = trimmed.match(/^(.*?)(?:\s+(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?))?$/);
  if (!match) return { title: trimmed };
  const title = (match[1] || "").trim();
  const due = match[2]?.trim();
  return due ? { title, due } : { title };
}

function parseBatchAddRest(rest: string): AddReminderDraft[] {
  const segments = rest
    .split(/[;\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) {
    const single = parseAddRest(rest);
    return single.title ? [single] : [];
  }
  return segments
    .map((segment) => parseAddRest(segment))
    .filter((draft): draft is AddReminderDraft => Boolean(draft.title));
}

function stripOuterQuotes(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return text.slice(1, -1);
  }
  return text;
}

function parseItemsArg(rest: string): AddReminderDraft[] | null {
  const trimmed = rest.trim();
  if (!trimmed.startsWith("--items")) return null;
  const value = trimmed.slice("--items".length).trim();
  const jsonText = stripOuterQuotes(value.startsWith("=") ? value.slice(1).trim() : value);
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): AddReminderDraft | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const title = typeof record.title === "string" ? record.title.trim() : "";
        if (!title) return null;
        const due = typeof record.due === "string" ? record.due.trim() : undefined;
        return { title, due };
      })
      .filter((draft): draft is AddReminderDraft => Boolean(draft));
  } catch {
    return [];
  }
}

function parseUpdateFlags(rest: string): { query: string; title?: string; due?: string; body?: string } {
  const result: { query: string; title?: string; due?: string; body?: string } = { query: "" };
  const flagRegex = /--(title|due|body)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g;
  const found: { raw: string; key: "title" | "due" | "body" }[] = [];
  let m: RegExpExecArray | null;
  while ((m = flagRegex.exec(rest)) !== null) {
    found.push({ raw: m[0], key: m[1] as "title" | "due" | "body" });
  }
  let remaining = rest;
  for (const f of found) {
    const valueStart = f.raw.indexOf(" ");
    const rawValue = valueStart >= 0 ? f.raw.slice(valueStart + 1) : "";
    result[f.key] = stripOuterQuotes(rawValue);
    remaining = remaining.replace(f.raw, " ");
  }
  result.query = remaining.replace(/\s+/g, " ").trim();
  return result;
}

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

function formatReminderChoices(reminders: Reminder[]): string[] {
  return reminders.map((item) => {
    const shortId = item.id.split("-")[0];
    const due = item.due_date ? ` | ${item.due_date}` : " | （无）";
    return `${shortId} | ${item.name}${due}`;
  });
}

function buildListText(reminders: Reminder[]): string {
  if (reminders.length === 0) return "没有找到 reminder。";
  return reminders.map(formatReminderLine).join("\n");
}

function usageText(): string {
  return [
    "用法：",
    "  /reminders               （默认 list）",
    "  /reminders_list [query]",
    "  /reminders_add <title> [absolute_due]",
    "  /reminders_complete <id_or_query>",
    "  /reminders_delete <id_or_query>",
    "  /reminders_update <id_or_query> --title / --due / --body",
    "",
    "也支持：",
    "  /reminders list [query]",
    "  /reminders add <title> [absolute_due]",
    "  /reminders add <title> [absolute_due]; <title> [absolute_due]",
    "  /reminders add --items '\''[{\"title\":\"...\",\"due\":\"YYYY-MM-DD\"}]'\''",
    "  /reminders complete <id_or_query>",
    "  /reminders delete <id_or_query>",
    "  /reminders update <id_or_query> [--title \"新标题\"] [--due \"YYYY-MM-DD HH:MM\"] [--body \"备注\"]",
    "",
    "日期格式：YYYY-MM-DD 或 YYYY-MM-DD HH:MM",
    "自然语言日期请先翻成绝对日期。",
    "update 至少指定一个字段（--title / --due / --body），风险同 add/complete 直接执行。",
  ].join("\n");
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
  const lines = script.split("\n").filter((l) => l.trim().length > 0);
  const args: string[] = [];
  for (const line of lines) args.push("-e", line);
  const { stdout } = await execFileAsync("osascript", args, { encoding: "utf-8", timeout: 15000 });
  return stdout.replace(/\n+$/, "");
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
  return parseOsaRecords(raw).map(osaRecordToReminder);
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

async function confirmAction(
  label: string,
  reminder: Reminder,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<boolean> {
  if (!ctx.hasUI) throw new Error(`当前没有可用 UI，无法做 ${label} 的确认`);
  return ctx.ui.confirm(`${label} reminder？`, summarizeReminder(reminder));
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

async function handleAddCommand(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  const items = parseItemsArg(rest);
  const drafts = items !== null ? items : parseBatchAddRest(rest);
  if (drafts.length === 0) {
    ctx.ui.notify(usageText(), "error");
    await settleUi();
    return;
  }
  if (drafts.some((draft) => !isAbsoluteDue(draft.due))) {
    ctx.ui.notify("日期必须是绝对格式：YYYY-MM-DD 或 YYYY-MM-DD HH:MM", "error");
    await settleUi();
    return;
  }
  if (drafts.length === 1) {
    const [draft] = drafts;
    const created = await addReminder(draft.title, draft.due);
    ctx.ui.notify(`已创建：${created.name}`, "info");
    await settleUi();
    return;
  }
  const { created, failures } = await addReminders(drafts);
  const summary = buildAddSummary(created, failures);
  ctx.ui.notify(summary || "未创建任何 reminder", failures.length > 0 && created.length === 0 ? "error" : "info");
  await settleUi();
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

async function handleCompleteCommand(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!rest.trim()) {
    ctx.ui.notify("用法：/reminders complete <id_or_query>", "error");
    await settleUi();
    return;
  }
  const reminder = await resolveOneForWrite(rest.trim(), "incomplete", "选择要完成的 reminder", ctx);
  if (!reminder) {
    ctx.ui.notify("未找到匹配的未完成 reminder。", "error");
    await settleUi();
    return;
  }
  await completeReminder(reminder.id);
  ctx.ui.notify(`已完成：${reminder.name}`, "info");
  await settleUi();
}

async function handleDeleteCommand(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!rest.trim()) {
    ctx.ui.notify("用法：/reminders delete <id_or_query>", "error");
    await settleUi();
    return;
  }
  const reminder = await resolveOneForWrite(rest.trim(), "all", "选择要删除的 reminder", ctx);
  if (!reminder) {
    ctx.ui.notify("未找到匹配的 reminder。", "error");
    await settleUi();
    return;
  }
  if (!(await confirmAction("删除", reminder, ctx))) return;
  await deleteReminder(reminder.id);
  ctx.ui.notify(`已删除：${reminder.name}`, "info");
  await settleUi();
}

async function handleUpdateCommand(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!rest.trim()) {
    ctx.ui.notify("用法：/reminders update <id_or_query> --title / --due / --body", "error");
    await settleUi();
    return;
  }
  const parsed = parseUpdateFlags(rest);
  if (!parsed.query) {
    ctx.ui.notify("用法：/reminders update <id_or_query> --title / --due / --body", "error");
    await settleUi();
    return;
  }
  if (parsed.due !== undefined && !isAbsoluteDue(parsed.due)) {
    ctx.ui.notify("日期必须是绝对格式：YYYY-MM-DD 或 YYYY-MM-DD HH:MM", "error");
    await settleUi();
    return;
  }
  const updates: { title?: string; due?: string; body?: string } = {};
  if (parsed.title) updates.title = parsed.title;
  if (parsed.due) updates.due = parsed.due;
  if (parsed.body) updates.body = parsed.body;
  if (!updates.title && !updates.due && !updates.body) {
    ctx.ui.notify("请至少指定一个要更新的字段：--title / --due / --body", "error");
    await settleUi();
    return;
  }
  const reminder = await resolveOneForWrite(parsed.query, "all", "选择要更新的 reminder", ctx);
  if (!reminder) {
    ctx.ui.notify("未找到匹配的 reminder。", "error");
    await settleUi();
    return;
  }
  await updateReminder(reminder.id, updates);
  const updated = await showReminder(reminder.id);
  ctx.ui.notify(updated ? `已更新：\n${summarizeReminder(updated)}` : `已更新：${reminder.name}`, "info");
  await settleUi();
}

async function executeToolAction(
  action: Action,
  params: { title?: string; due?: string; body?: string; query?: string; items?: AddReminderDraft[] },
  ctx: ExtensionContext,
): Promise<{ content: { type: "text"; text: string }[]; details?: Record<string, unknown> }> {
  if (action === "list") {
    const reminders = await listReminders(params.query || "");
    return { content: [{ type: "text", text: buildListText(reminders) }], details: { count: reminders.length } };
  }

  if (action === "add") {
    const drafts = normalizeAddDrafts(params);
    if (drafts.length === 0) return { content: [{ type: "text", text: "Error: title required for add" }] };
    if (drafts.some((draft) => !isAbsoluteDue(draft.due))) {
      return { content: [{ type: "text", text: "Error: due must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }] };
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
      return { content: [{ type: "text", text: "Error: query required for update" }] };
    }
    if (params.due && !isAbsoluteDue(params.due)) {
      return { content: [{ type: "text", text: "Error: due must be YYYY-MM-DD or YYYY-MM-DD HH:MM" }] };
    }
    const updates: { title?: string; due?: string; body?: string } = {};
    if (params.title && params.title.trim()) updates.title = params.title.trim();
    if (params.due && params.due.trim()) updates.due = params.due.trim();
    if (params.body && params.body.trim()) updates.body = params.body.trim();
    if (!updates.title && !updates.due && !updates.body) {
      return { content: [{ type: "text", text: "Error: at least one of title/due/body required for update" }] };
    }
    const reminder = await resolveOneForWrite(params.query.trim(), "all", "选择要更新的 reminder", ctx);
    if (!reminder) return { content: [{ type: "text", text: "No matching reminder found" }] };
    await updateReminder(reminder.id, updates);
    const updated = await showReminder(reminder.id);
    const text = updated ? `Updated:\n${summarizeReminder(updated)}` : `Updated: ${reminder.name}`;
    return { content: [{ type: "text", text }], details: { id: reminder.id } };
  }

  if (!params.query?.trim()) {
    return { content: [{ type: "text", text: `Error: query required for ${action}` }] };
  }

  const reminder = await resolveOneForWrite(
    params.query.trim(),
    action === "complete" ? "incomplete" : "all",
    `选择要${action === "complete" ? "完成" : "删除"}的 reminder`,
    ctx,
  );
  if (!reminder) return { content: [{ type: "text", text: "No matching reminder found" }] };

  if (action === "complete") {
    await completeReminder(reminder.id);
    return { content: [{ type: "text", text: `Completed: ${reminder.name}` }], details: { id: reminder.id } };
  }

  if (!(await confirmAction("删除", reminder, ctx))) return { content: [{ type: "text", text: "Cancelled" }] };
  await deleteReminder(reminder.id);
  return { content: [{ type: "text", text: `Deleted: ${reminder.name}` }], details: { id: reminder.id } };
}

export default function remindersExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "reminders",
    label: "Reminders",
    description: "Manage Apple Reminders in the user's default list. Actions: add, list, complete, delete, update.",
    promptSnippet:
      "Create, list, complete, delete, or update Apple Reminders when the user explicitly asks. If the user asks for multiple reminders, batch them in one add call using items.",
    promptGuidelines: [
      "Use reminders only when the user explicitly asks to create, list, complete, delete, or update a reminder or todo.",
      "Before calling reminders with action add or update, translate any Chinese or English natural-language date into an absolute YYYY-MM-DD or YYYY-MM-DD HH:MM value.",
      "If the user asks to create multiple reminders in one message, prefer a single add call with items[] instead of multiple separate add calls.",
      "Never create, complete, delete, or update reminders without explicit user intent. Only delete shows a confirmation prompt; add, complete, and update execute directly.",
    ],
    parameters: RemindersParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeToolAction(params.action as Action, params, ctx);
    },
  });

  const registerAlias = (
    name: string,
    description: string,
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>,
  ) => {
    pi.registerCommand(name, { description, handler });
  };

  registerAlias("reminders_list", "List Apple Reminders in the default list", async (args, ctx) => {
    await handleListCommand(args, ctx);
  });

  registerAlias("reminders_add", "Add an Apple Reminder", async (args, ctx) => {
    await handleAddCommand(args, ctx);
  });

  registerAlias("reminders_complete", "Complete an Apple Reminder", async (args, ctx) => {
    await handleCompleteCommand(args, ctx);
  });

  registerAlias("reminders_delete", "Delete an Apple Reminder", async (args, ctx) => {
    await handleDeleteCommand(args, ctx);
  });

  registerAlias("reminders_update", "Update an Apple Reminder's title/due/body", async (args, ctx) => {
    await handleUpdateCommand(args, ctx);
  });

  pi.registerCommand("reminders", {
    description: "Manage Apple Reminders: default list, add, complete, delete, update",
    getArgumentCompletions: (prefix) => {
      const verbs = ["list", "add", "complete", "delete", "update"];
      const filtered = verbs.filter((v) => v.startsWith(prefix));
      return filtered.length ? filtered.map((v) => ({ value: v, label: v })) : null;
    },
    handler: async (args, ctx) => {
      const parsed = parseCommandArgs(args);
      switch (parsed.action) {
        case "list":
          await handleListCommand(parsed.rest, ctx);
          return;
        case "add":
          await handleAddCommand(parsed.rest, ctx);
          return;
        case "complete":
          await handleCompleteCommand(parsed.rest, ctx);
          return;
        case "delete":
          await handleDeleteCommand(parsed.rest, ctx);
          return;
        case "update":
          await handleUpdateCommand(parsed.rest, ctx);
          return;
        default:
          ctx.ui.notify(usageText(), "info");
          await settleUi();
      }
    },
  });
}
