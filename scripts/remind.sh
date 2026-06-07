#!/bin/bash
# remind.sh - Apple Reminders workflow wrapper via rem CLI
#
# Usage:
#   remind.sh add <title> [absolute_due]
#   remind.sh list [query]
#   remind.sh complete <id_or_query>
#   remind.sh delete <id_or_query>
#   remind.sh help
#
# Notes:
# - `add` accepts an optional absolute due date: YYYY-MM-DD or YYYY-MM-DD HH:MM
# - `complete` / `delete` accept either a reminder ID or a title query
# - Natural-language date translation is done by pi before calling this script

set -euo pipefail

DEFAULT_LIST="${REMINDERS_LIST:-近期待办}"

show_add_dry_run() {
  local title="$1"
  local due="$2"
  local list="$3"

  echo "我准备创建一条 reminder："
  echo "  标题:  $title"
  if [ -n "$due" ]; then
    echo "  日期:  $due"
  else
    echo "  日期:  （无具体时间，只在 Reminders 列表里）"
  fi
  echo "  列表:  $list"
  echo ""
  printf "对吗? (y/n/e) "
}

show_action_dry_run() {
  local action_label="$1"
  local candidate_json="$2"

  echo "我准备${action_label}这条 reminder："
  echo "$candidate_json" | jq -r '
    "  ID:    " + (.id | split("-")[0]) + "\n" +
    "  标题:  " + .name + "\n" +
    "  列表:  " + .list_name + "\n" +
    "  日期:  " + (.due_date // "（无）") + "\n" +
    "  状态:  " + (if .completed then "已完成" else "未完成" end)'
  echo ""
  printf "对吗? (y/n/e) "
}

validate_due_format() {
  local due="$1"
  [[ "$due" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]][0-9]{2}:[0-9]{2})?$ ]]
}

validate_add_args() {
  local title="${1:-}"
  local due="${2:-}"

  if [ -z "$title" ]; then
    echo "❌ 错误：缺少 title" >&2
    echo "用法: /skill:reminders add <title> [absolute_due]" >&2
    return 1
  fi

  if [ -n "$due" ] && ! validate_due_format "$due"; then
    echo "❌ 错误：due 必须是绝对日期格式" >&2
    echo "  YYYY-MM-DD            (all-day)" >&2
    echo "  YYYY-MM-DD HH:MM      (with time)" >&2
    echo "  got: '$due'" >&2
    return 1
  fi
}

require_query() {
  local ref="${1:-}"
  local verb="$2"
  if [ -z "$ref" ]; then
    echo "❌ 错误：缺少参数" >&2
    echo "用法: /skill:reminders $verb <id_or_query>" >&2
    return 1
  fi
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "❌ 缺少 jq，请先安装 jq" >&2
    return 1
  fi
}

resolve_candidate_to_file() {
  local ref="$1"
  local mode="$2"
  local out_file="$3"
  local json=""
  local -a args=(rem list -l "$DEFAULT_LIST" -o json --search "$ref")

  if json=$(rem show "$ref" -o json 2>/dev/null); then
    echo "$json" > "$out_file"
    return 0
  fi

  if [ "$mode" = "incomplete" ]; then
    args+=(--incomplete)
  elif [ "$mode" = "completed" ]; then
    args+=(--completed)
  fi

  json="$(${args[@]})"
  echo "$json" > "$out_file"

  local count
  count=$(echo "$json" | jq 'length')
  if [ "$count" -eq 1 ]; then
    return 0
  elif [ "$count" -eq 0 ]; then
    return 2
  fi
  return 3
}

extract_candidate_json() {
  local in_file="$1"
  jq 'if type == "array" then .[0] else . end' "$in_file"
}

print_multiple_matches() {
  local in_file="$1"
  echo "匹配到多条 reminder，请改用更精确的标题或 ID："
  jq -r '.[] | "  - " + (.id | split("-")[0]) + " | " + .name + " | " + (.due_date // "（无）")' "$in_file"
}

execute_add() {
  local title="$1"
  local due="$2"
  local list="$3"
  local -a args=("$title" --list "$list" -o json)

  echo "→ 写入 Reminders..."
  if [ -n "$due" ]; then
    args+=(--due "$due")
  fi

  if rem add "${args[@]}" > /tmp/remind_output.json 2> /tmp/remind_error.log; then
    echo "✅ 已添加"
    if command -v jq >/dev/null 2>&1; then
      jq -r 'if type=="array" then .[0].id else .id end // empty' /tmp/remind_output.json 2>/dev/null | while read -r uid; do
        [ -n "$uid" ] && echo "   UID: $uid"
      done
    fi
    rm -f /tmp/remind_output.json /tmp/remind_error.log
  else
    echo "❌ rem 调用失败：" >&2
    cat /tmp/remind_error.log >&2
    echo "" >&2
    echo "可能原因：" >&2
    echo "  - TCC 权限未给：在跑 pi 的终端跑一次 'rem lists' 触发弹窗" >&2
    echo "  - rem 未装：brew install BRO3886/tap/rem-cli" >&2
    rm -f /tmp/remind_output.json /tmp/remind_error.log
    return 1
  fi
}

execute_complete() {
  local id="$1"
  echo "→ 标记完成..."
  rem complete "$id"
  echo "✅ 已完成"
}

execute_delete() {
  local id="$1"
  echo "→ 删除 reminder..."
  rem delete "$id" --force
  echo "✅ 已删除"
}

confirm_standard() {
  local confirm
  read -r confirm
  case "$confirm" in
    y|Y|yes|YES) return 0 ;;
    n|N|no|NO) echo "❌ 取消"; return 1 ;;
    e|E|edit|EDIT) echo "请改用更精确的标题或 ID 重新执行"; return 1 ;;
    *) echo "未识别的输入：'$confirm'。请输入 y / n / e"; return 1 ;;
  esac
}

confirm_delete() {
  local confirm
  read -r confirm
  case "$confirm" in
    y|Y|yes|YES)
      printf "危险操作，请输入 delete 再确认: "
      read -r confirm
      if [ "$confirm" = "delete" ]; then
        return 0
      fi
      echo "❌ 二次确认失败，已取消"
      return 1
      ;;
    n|N|no|NO) echo "❌ 取消"; return 1 ;;
    e|E|edit|EDIT) echo "请改用更精确的标题或 ID 重新执行"; return 1 ;;
    *) echo "未识别的输入。请输入 y / n / e"; return 1 ;;
  esac
}

cmd_add() {
  local title="${1:-}"
  local due="${2:-}"

  validate_add_args "$title" "$due" || return 1
  show_add_dry_run "$title" "$due" "$DEFAULT_LIST"
  if confirm_standard; then
    execute_add "$title" "$due" "$DEFAULT_LIST"
  fi
}

cmd_list() {
  local query="${1:-}"
  local -a args=(rem list -l "$DEFAULT_LIST" --incomplete)
  if [ -n "$query" ]; then
    args+=(--search "$query")
  fi
  "${args[@]}"
}

cmd_complete() {
  local ref="${1:-}"
  local tmp
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' RETURN

  require_jq || return 1
  require_query "$ref" "complete" || return 1

  if resolve_candidate_to_file "$ref" "incomplete" "$tmp"; then
    local candidate
    candidate=$(extract_candidate_json "$tmp")
    show_action_dry_run "完成" "$candidate"
    if confirm_standard; then
      execute_complete "$(echo "$candidate" | jq -r '.id')"
    fi
  else
    case $? in
      2) echo "❌ 未找到匹配的未完成 reminder：$ref" ;;
      3) print_multiple_matches "$tmp" ;;
      *) echo "❌ 查询 reminder 失败" ;;
    esac
    return 1
  fi
}

cmd_delete() {
  local ref="${1:-}"
  local tmp
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' RETURN

  require_jq || return 1
  require_query "$ref" "delete" || return 1

  if resolve_candidate_to_file "$ref" "all" "$tmp"; then
    local candidate
    candidate=$(extract_candidate_json "$tmp")
    show_action_dry_run "删除" "$candidate"
    if confirm_delete; then
      execute_delete "$(echo "$candidate" | jq -r '.id')"
    fi
  else
    case $? in
      2) echo "❌ 未找到匹配的 reminder：$ref" ;;
      3) print_multiple_matches "$tmp" ;;
      *) echo "❌ 查询 reminder 失败" ;;
    esac
    return 1
  fi
}

cmd_help() {
  cat <<EOF
pi-reminders skill — Apple Reminders via rem CLI

Usage:
  /skill:reminders add <title> [absolute_due]
  /skill:reminders list [query]
  /skill:reminders complete <id_or_query>
  /skill:reminders delete <id_or_query>
  /skill:reminders help

Commands:
  add       Create a reminder (dry-run + confirm)
  list      List incomplete reminders in the default list
  complete  Mark one reminder as complete (dry-run + confirm)
  delete    Delete one reminder (dry-run + double confirm)

Arguments:
  <title>        Reminder title
  [absolute_due] YYYY-MM-DD or YYYY-MM-DD HH:MM
  [query]        Search keyword in title/notes
  <id_or_query>  Reminder ID or title query

Environment:
  REMINDERS_LIST   Override default list (default: 近期待办)
EOF
}

SUBCMD="${1:-help}"
shift || true

case "$SUBCMD" in
  add) cmd_add "$@" ;;
  list) cmd_list "$@" ;;
  complete) cmd_complete "$@" ;;
  delete) cmd_delete "$@" ;;
  help|--help|-h) cmd_help ;;
  *) echo "未知子命令: $SUBCMD" >&2; cmd_help; exit 1 ;;
esac
