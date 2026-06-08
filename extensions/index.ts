import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LIST = process.env.REMINDERS_LIST || "近期待办";

type Action = "add" | "list" | "complete" | "delete";

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
  action: StringEnum(["add", "list", "complete", "delete"] as const),
  title: Type.Optional(Type.String({ description: "Reminder title for add" })),
  due: Type.Optional(
    Type.String({
      description: "Absolute due date: YYYY-MM-DD or YYYY-MM-DD HH:MM. Translate natural language before calling.",
    }),
  ),
  items: Type.Optional(Type.Array(AddReminderDraftParams)),
  query: Type.Optional(Type.String({ description: "Search query for list or ID/title for complete/delete" })),
});

function parseCommandArgs(args: string): { action: Action | "help"; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { action: "list", rest: "" };
  const [verb, ...restParts] = trimmed.split(/\s+/);
  const action = ["add", "list", "complete", "delete"].includes(verb) ? (verb as Action) : "help";
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

function summarizeAddDrafts(drafts: AddReminderDraft[]): string {
  return drafts.map((draft, index) => `${index + 1}. ${renderAddDraft(draft)}`).join("\n");
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
    "",
    "也支持：",
    "  /reminders list [query]",
    "  /reminders add <title> [absolute_due]",
    "  /reminders add <title> [absolute_due]; <title> [absolute_due]",
    "  /reminders add --items '\''[{\"title\":\"...\",\"due\":\"YYYY-MM-DD\"}]'\''",
    "  /reminders complete <id_or_query>",
    "  /reminders delete <id_or_query>",
    "",
    "日期格式：YYYY-MM-DD 或 YYYY-MM-DD HH:MM",
    "自然语言日期请先翻成绝对日期。",
  ].join("\n");
}

async function settleUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function runRem(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("rem", args, { encoding: "utf-8", timeout: 15000 });
  return stdout.trim();
}

async function runRemJson<T>(args: string[]): Promise<T> {
  const raw = await runRem([...args, "-o", "json"]);
  return JSON.parse(raw) as T;
}

async function addReminder(title: string, due?: string, list = DEFAULT_LIST): Promise<Reminder> {
  const args = ["add", title, "--list", list];
  if (due) args.push("--due", due);
  const result = await runRemJson<Reminder | Reminder[]>(args);
  return Array.isArray(result) ? result[0] : result;
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

async function listReminders(query = "", list = DEFAULT_LIST): Promise<Reminder[]> {
  const args = ["list", "-l", list, "--incomplete"];
  if (query) args.push("--search", query);
  return runRemJson<Reminder[]>(args);
}

async function showReminder(id: string): Promise<Reminder | null> {
  try {
    return await runRemJson<Reminder>(["show", id]);
  } catch {
    return null;
  }
}

async function resolveCandidates(ref: string, mode: "all" | "incomplete", list = DEFAULT_LIST): Promise<Reminder[]> {
  const byId = await showReminder(ref);
  if (byId) return [byId];
  const args = ["list", "-l", list, "--search", ref];
  if (mode === "incomplete") args.push("--incomplete");
  return runRemJson<Reminder[]>(args);
}

async function completeReminder(id: string): Promise<string> {
  return runRem(["complete", id]);
}

async function deleteReminder(id: string): Promise<string> {
  return runRem(["delete", id, "--force"]);
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

async function confirmAdd(
  title: string,
  due: string | undefined,
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<boolean> {
  if (!ctx.hasUI) throw new Error("当前没有可用 UI，无法做 add 的确认");
  const dueLine = due || "（无具体时间，只在 Reminders 列表里）";
  return ctx.ui.confirm("创建 reminder？", `标题: ${title}\n日期: ${dueLine}\n列表: ${DEFAULT_LIST}`);
}

async function confirmAddMany(
  drafts: AddReminderDraft[],
  ctx: ExtensionContext | ExtensionCommandContext,
): Promise<boolean> {
  if (!ctx.hasUI) throw new Error("当前没有可用 UI，无法做批量 add 的确认");
  return ctx.ui.confirm(`创建 ${drafts.length} 个 reminder？`, `${summarizeAddDrafts(drafts)}\n\n列表: ${DEFAULT_LIST}`);
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

async function confirmDeleteTwice(reminder: Reminder, ctx: ExtensionContext | ExtensionCommandContext): Promise<boolean> {
  const once = await confirmAction("删除", reminder, ctx);
  if (!once) return false;
  return ctx.ui.confirm("二次确认删除？", `再次确认删除：\n${summarizeReminder(reminder)}\n\n此操作不可撤销。`);
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
    if (!(await confirmAdd(draft.title, draft.due, ctx))) return;
    const created = await addReminder(draft.title, draft.due);
    ctx.ui.notify(`已创建：${created.name}`, "info");
    await settleUi();
    return;
  }
  if (!(await confirmAddMany(drafts, ctx))) return;
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
  if (!(await confirmAction("完成", reminder, ctx))) return;
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
  if (!(await confirmDeleteTwice(reminder, ctx))) return;
  await deleteReminder(reminder.id);
  ctx.ui.notify(`已删除：${reminder.name}`, "info");
  await settleUi();
}

async function executeToolAction(
  action: Action,
  params: { title?: string; due?: string; query?: string; items?: AddReminderDraft[] },
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
      if (!(await confirmAdd(draft.title, draft.due, ctx))) return { content: [{ type: "text", text: "Cancelled" }] };
      const created = await addReminder(draft.title, draft.due);
      return { content: [{ type: "text", text: `Created: ${created.name}` }], details: { id: created.id } };
    }
    if (!(await confirmAddMany(drafts, ctx))) return { content: [{ type: "text", text: "Cancelled" }] };
    const { created, failures } = await addReminders(drafts);
    return {
      content: [{ type: "text", text: buildAddSummary(created, failures) || "No reminders created" }],
      details: { created: created.length, failed: failures.length },
    };
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
    if (!(await confirmAction("完成", reminder, ctx))) return { content: [{ type: "text", text: "Cancelled" }] };
    await completeReminder(reminder.id);
    return { content: [{ type: "text", text: `Completed: ${reminder.name}` }], details: { id: reminder.id } };
  }

  if (!(await confirmDeleteTwice(reminder, ctx))) return { content: [{ type: "text", text: "Cancelled" }] };
  await deleteReminder(reminder.id);
  return { content: [{ type: "text", text: `Deleted: ${reminder.name}` }], details: { id: reminder.id } };
}

export default function remindersExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "reminders",
    label: "Reminders",
    description: "Manage Apple Reminders in the user's default list. Actions: add, list, complete, delete.",
    promptSnippet:
      "Create, list, complete, or delete Apple Reminders when the user explicitly asks. If the user asks for multiple reminders, batch them in one add call using items.",
    promptGuidelines: [
      "Use reminders only when the user explicitly asks to create, list, complete, or delete a reminder or todo.",
      "Before calling reminders with action add, translate any Chinese or English natural-language date into an absolute YYYY-MM-DD or YYYY-MM-DD HH:MM value.",
      "If the user asks to create multiple reminders in one message, prefer a single add call with items[] instead of multiple separate add calls.",
      "Never create, complete, or delete reminders without explicit user intent and user confirmation.",
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

  pi.registerCommand("reminders", {
    description: "Manage Apple Reminders: default list, add, complete, delete",
    getArgumentCompletions: (prefix) => {
      const verbs = ["list", "add", "complete", "delete"];
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
        default:
          ctx.ui.notify(usageText(), "info");
          await settleUi();
      }
    },
  });
}
