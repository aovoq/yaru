#!/bin/sh
# シナリオ (spec/ui/scenarios.md) を agent-browser で開き、状態に着いてから撮る。
# 着かなければ、状態の名前と理由を出して、最後に終了コード 1 で終わる。
# ファイルを変える状態は、撮る前に fixture の写しを取る。元の fixture は変えない。
# 確かめで起動する yaru serve は、写しか fixture のディレクトリをカレントにして、別ポートで起動する。
# 既定は 47900。空の登録は 47901。使用中ならエラーにする。終わったら、ここで起動したプロセスだけを止める。
#
# 使い方: spec/ui/capture.sh [fixture の出力先]
# 高さがソースに無いので、1280×800 と 390×844 で撮る。

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
WORKTREE=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ROOT=${1:-${YARU_UI_FIXTURE:-}}
PORT=${YARU_UI_PORT:-47900}
EMPTY_PORT=${YARU_UI_EMPTY_PORT:-47901}
SESSION=yaru-p0-ui
FAILED=0
STATE=""
WIDTH=1280

if [ "$PORT" = 47811 ] || [ "$EMPTY_PORT" = 47811 ]; then
  echo "refusing to use the resident port 47811" >&2
  exit 1
fi
if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "port $PORT is already in use" >&2
  exit 1
fi
if curl -sf -o /dev/null "http://127.0.0.1:$EMPTY_PORT/"; then
  echo "port $EMPTY_PORT is already in use" >&2
  exit 1
fi

if [ -z "$ROOT" ]; then
  ROOT=$(mktemp -d "${TMPDIR:-/tmp}/yaru-ui-capture.XXXXXX")
  "$SCRIPT_DIR/fixture/make-fixture.sh" "$ROOT"
fi
ROOT=$(CDPATH= cd -- "$ROOT" && pwd -P)
PRISTINE=$ROOT
if [ ! -f "$ROOT/fixture.env" ] || [ ! -f "$ROOT/manifest.json" ]; then
  echo "fixture.env or manifest.json is missing in $ROOT" >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$ROOT/fixture.env"
YARU_BIN=${YARU_BIN:-$WORKTREE/src/index.ts}
SHOTS=$ROOT/shots
mkdir -p "$SHOTS/1280" "$SHOTS/390"
LOG=$ROOT/serve.log
PID_FILE=$ROOT/serve.pid
EMPTY_PID_FILE=$ROOT/serve-empty.pid
SERVE_NOW=$YARU_NOW
COPY=""
COPY_MAIN=""
COPY_STATE=""

bun -e '
  const fs = require("node:fs")
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  const line = (key, value) => key + "=" + JSON.stringify(String(value))
  const issues = manifest.main.issues
  const questions = manifest.main.questions
  fs.writeFileSync(process.argv[2], [
    line("MAIN_SLUG", manifest.main.slug),
    line("DONE_SLUG", manifest.done.slug),
    line("EMPTY_SLUG", manifest.empty.slug),
    line("SHIP", issues.ship),
    line("SPEC", issues.spec),
    line("STALE", issues.stale),
    line("BACKLOG", issues.backlog),
    line("BLOCKING", questions.blocking),
    line("DUE", questions.dueSoon),
    line("EXPIRED", questions.expired),
  ].join("\n") + "\n")
' "$ROOT/manifest.json" "$ROOT/capture.vars"
# shellcheck disable=SC1091
. "$ROOT/capture.vars"

ab() {
  agent-browser --session "$SESSION" "$@"
}

cleanup() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  if [ -f "$EMPTY_PID_FILE" ]; then
    kill "$(cat "$EMPTY_PID_FILE")" 2>/dev/null || true
    rm -f "$EMPTY_PID_FILE"
  fi
  agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

stop_serve() {
  if [ ! -f "$PID_FILE" ]; then
    return 0
  fi
  pid=$(cat "$PID_FILE")
  kill "$pid" 2>/dev/null || true
  i=0
  while [ "$i" -lt 50 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    i=$((i + 1))
    sleep 0.1
  done
  rm -f "$PID_FILE"
}

wait_port() {
  port=$1
  i=0
  while [ "$i" -lt 50 ]; do
    if curl -sf -o /dev/null "http://127.0.0.1:$port/"; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.2
  done
  echo "yaru serve did not start on $port" >&2
  return 1
}

start_serve() {
  root=$1
  state=$2
  now=$3
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "port $PORT is already in use" >&2
    return 1
  fi
  cd "$root"
  env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID \
    YARU_STATE_DIR="$state" YARU_NOW="$now" \
    bun "$YARU_BIN" serve -p "$PORT" >"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  SERVE_NOW=$now
  wait_port "$PORT"
}

# 登録ファイルの root を写しのパスへ書き換える。質問は git に無いので、ディレクトリごと写す。
use_copy() {
  now=${1:-$YARU_NOW}
  ab set offline off >/dev/null 2>&1 || true
  ab network unroute >/dev/null 2>&1 || true
  stop_serve
  COPY=$(mktemp -d "${TMPDIR:-/tmp}/yaru-ui-copy.XXXXXX")
  cp -a "$PRISTINE/ui-fixture" "$PRISTINE/ui-fixture-done" "$PRISTINE/ui-fixture-empty" "$COPY/"
  mkdir -p "$COPY/state"
  bun -e '
    const fs = require("node:fs")
    const path = require("node:path")
    const registry = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const copy = process.argv[2]
    for (const workspace of registry.workspaces) {
      workspace.root = path.join(copy, path.basename(workspace.root))
    }
    fs.writeFileSync(process.argv[3], JSON.stringify(registry, null, 2) + "\n")
  ' "$PRISTINE/state/workspaces.json" "$COPY" "$COPY/state/workspaces.json"
  COPY_MAIN=$COPY/ui-fixture
  COPY_STATE=$COPY/state
  start_serve "$COPY_MAIN" "$COPY_STATE" "$now"
}

yaru_copy() {
  (
    cd "$COPY_MAIN"
    env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID \
      YARU_STATE_DIR="$COPY_STATE" YARU_NOW="$SERVE_NOW" \
      bun "$YARU_BIN" "$@"
  )
}

step() {
  if ! "$@" >"$ROOT/step.out" 2>"$ROOT/step.err"; then
    echo "state failed: $WIDTH $STATE: $*" >&2
    cat "$ROOT/step.err" >&2
    FAILED=1
    return 1
  fi
}

shot() {
  if ! ab screenshot "$SHOTS/$WIDTH/$STATE.png" >"$ROOT/step.out" 2>"$ROOT/step.err"; then
    echo "state failed: $WIDTH $STATE: screenshot" >&2
    cat "$ROOT/step.err" >&2
    FAILED=1
    return 1
  fi
  echo "shot $WIDTH $STATE"
}

# ボタンの中心が隣の header に乗ることがあるので、取れなければ左端を押す。
click_el() {
  sel=$1
  if ab click "$sel" >"$ROOT/step.out" 2>"$ROOT/step.err"; then
    return 0
  fi
  if ! grep -q -i "cover" "$ROOT/step.err"; then
    cat "$ROOT/step.err" >&2
    return 1
  fi
  box=$(ab get box "$sel" --json 2>/dev/null || true)
  point=$(printf '%s' "$box" | bun -e '
    let text = ""
    process.stdin.on("data", (chunk) => { text += chunk })
    process.stdin.on("end", () => {
      const parsed = JSON.parse(text)
      const box = parsed.data || parsed
      if (typeof box.x !== "number") process.exit(1)
      process.stdout.write((box.x + 2) + " " + (box.y + box.height / 2))
    })
  ') || {
    cat "$ROOT/step.err" >&2
    return 1
  }
  # shellcheck disable=SC2086
  ab mouse move $point >"$ROOT/step.out" 2>"$ROOT/step.err" || return 1
  ab mouse down left >"$ROOT/step.out" 2>"$ROOT/step.err" || return 1
  ab mouse up left >"$ROOT/step.out" 2>"$ROOT/step.err"
}

# eval --stdin はページの JS。題名は input だけ出して、離れない。
set_title_draft() {
  ab eval --stdin >"$ROOT/step.out" 2>"$ROOT/step.err" <<'EOF'
const field = document.querySelector("#issue-view textarea[name='title']")
if (!field) throw new Error("title field is missing")
field.focus()
field.value = "Local title only"
field.dispatchEvent(new InputEvent("input", { bubbles: true }))
EOF
}

BASE="http://127.0.0.1:$PORT"
if ! start_serve "$PRISTINE/ui-fixture" "$YARU_STATE_DIR" "$YARU_NOW"; then
  echo "state failed: serve: could not start" >&2
  exit 1
fi

board() {
  step ab open "$BASE/p/$MAIN_SLUG/" || return 0
  step ab wait --text "Ship the board" || return 0
}

state_projects() {
  STATE=projects
  step ab open "$BASE/" || return 0
  step ab wait --text "Inbox" || return 0
  step ab wait --text "$MAIN_SLUG" || return 0
  shot
}

state_inbox() {
  STATE=inbox
  step ab open "$BASE/inbox" || return 0
  step ab wait --text "Blocking" || return 0
  step ab wait --text "Proceeded with default" || return 0
  shot
}

state_board_list() {
  STATE=board-list
  board
  step ab wait --text "Stale" || return 0
  step ab wait --text "past the deadline" || return 0
  shot
}

state_board_columns() {
  STATE=board-columns
  step ab open "$BASE/p/$MAIN_SLUG/?view=board" || return 0
  step ab wait --text "Backlog" || return 0
  shot
}

state_board_awaiting() {
  STATE=board-awaiting
  step ab open "$BASE/p/$MAIN_SLUG/?awaiting=1" || return 0
  step ab wait --text "Awaiting answer" || return 0
  shot
}

state_board_label() {
  STATE=board-label
  step ab open "$BASE/p/$MAIN_SLUG/?label=bug" || return 0
  step ab wait --text "Remove label bug" || return 0
  shot
}

state_board_search_empty() {
  STATE=board-search-empty
  step ab open "$BASE/p/$MAIN_SLUG/?query=no-such-issue" || return 0
  step ab wait --text "No matching issues" || return 0
  shot
}

state_board_no_open() {
  STATE=board-no-open
  step ab open "$BASE/p/$DONE_SLUG/" || return 0
  step ab wait --text "No open issues" || return 0
  shot
}

state_board_no_issues() {
  STATE=board-no-issues
  if ! ab open "$BASE/p/$EMPTY_SLUG/" >"$ROOT/step.out" 2>"$ROOT/step.err"; then
    if ! ab open "$BASE/p/$EMPTY_SLUG/" >"$ROOT/step.out" 2>"$ROOT/step.err"; then
      echo "state failed: $WIDTH $STATE: ab open $BASE/p/$EMPTY_SLUG/" >&2
      cat "$ROOT/step.err" >&2
      FAILED=1
      return 0
    fi
  fi
  step ab wait --text "No issues yet" || return 0
  shot
}

open_awaiting() {
  if [ "$WIDTH" != 390 ]; then
    return 0
  fi
  # 見出しの「awaiting answer」は issue 画面の下に隠れる。開くボタンは issue 画面の中にある。
  step ab click "button[aria-controls='issue-awaiting-questions']" || return 1
  step ab wait --fn "document.getElementById('issue-awaiting-questions')?.hasAttribute('data-expanded')" || return 1
}

state_issue_ship() {
  STATE=issue-ship
  step ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" || return 0
  step ab wait --text "Ship the board" || return 0
  open_awaiting || return 0
  step ab wait --text "Keep server rendering?" || return 0
  shot
}

state_issue_spec() {
  STATE=issue-spec
  step ab open "$BASE/p/$MAIN_SLUG/?id=$SPEC" || return 0
  step ab wait --text "Write the spec" || return 0
  open_awaiting || return 0
  step ab wait --text "Which API shape?" || return 0
  shot
}

state_dashboard() {
  STATE=dashboard
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab wait --text "Expired" || return 0
  step ab wait --text "Proceeded with default" || return 0
  step ab wait --text "Ship the fallback?" || return 0
  shot
}

state_dashboard_empty() {
  STATE=dashboard-empty
  step ab open "$BASE/p/$DONE_SLUG/dashboard" || return 0
  step ab wait --text "No questions awaiting an answer" || return 0
  shot
}

state_issue_missing() {
  STATE=issue-missing
  step ab open "$BASE/p/$MAIN_SLUG/?id=999" || return 0
  step ab wait --text "issue not found: 999" || return 0
  shot
}

state_error_not_found() {
  STATE=error-not-found
  step ab open "$BASE/no-such-page" || return 0
  step ab wait --text "not found" || return 0
  shot
}

state_error_workspace() {
  STATE=error-workspace
  step ab open "$BASE/p/no-such-workspace/" || return 0
  step ab wait --text "workspace not found: no-such-workspace" || return 0
  shot
}

state_error_sort() {
  STATE=error-invalid-sort
  step ab open "$BASE/p/$MAIN_SLUG/?sort=nope" || return 0
  step ab wait --text "invalid sort" || return 0
  shot
}

state_display() {
  STATE=board-display
  board
  step ab click "#display-menu" || return 0
  step ab wait --text "Grouping" || return 0
  shot
}

state_search_open() {
  STATE=board-search-open
  if [ "$WIDTH" != 390 ]; then
    return 0
  fi
  board
  step ab click "#search-open" || return 0
  step ab wait "#q" || return 0
  step ab wait --fn "getComputedStyle(document.getElementById('q').closest('form')).display !== 'none'" || return 0
  shot
}

state_workspaces() {
  STATE=board-workspaces
  if [ "$WIDTH" != 1280 ]; then
    return 0
  fi
  board
  step ab click "#workspace-switcher" || return 0
  step ab wait --text "Workspaces" || return 0
  shot
}

state_sidebar() {
  STATE=board-sidebar
  if [ "$WIDTH" != 1280 ]; then
    return 0
  fi
  board
  step click_el "#sidebar-toggle" || return 0
  step ab wait --fn "document.documentElement.getAttribute('data-sidebar') === 'closed'" || return 0
  step ab wait --fn "getComputedStyle(document.getElementById('sidebar-open')).display !== 'none'" || return 0
  shot
  step ab click "#sidebar-open" || return 0
  step ab wait --fn "document.documentElement.getAttribute('data-sidebar') !== 'closed'" || return 0
}

state_dashboard_sidebar() {
  STATE=dashboard-sidebar
  if [ "$WIDTH" != 1280 ]; then
    return 0
  fi
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab wait --text "Dashboard" || return 0
  step click_el "#sidebar-toggle" || return 0
  step ab wait --fn "document.documentElement.getAttribute('data-sidebar') === 'closed'" || return 0
  step ab wait --fn "getComputedStyle(document.getElementById('sidebar-open')).display !== 'none'" || return 0
  shot
  step ab click "#sidebar-open" || return 0
  step ab wait --fn "document.documentElement.getAttribute('data-sidebar') !== 'closed'" || return 0
}

state_palette() {
  STATE=board-command-palette
  board
  step ab click "#command-palette-open" || return 0
  step ab wait "input[placeholder='Search issues, questions, or commands…']" || return 0
  shot
}

state_menu() {
  STATE=board-context-menu
  board
  step ab focus "a[data-id='$SHIP']" || return 0
  step ab press Shift+F10 || return 0
  step ab wait --text "Open issue" || return 0
  step ab wait --text "Copy ID" || return 0
  shot
}

state_bulk() {
  STATE=board-bulk
  board
  step ab hover "a[data-id='$SHIP']" || return 0
  step ab click "button[aria-label='Select #$SHIP']" || return 0
  step ab wait --text "1 selected" || return 0
  shot
}

state_description() {
  STATE=issue-description-edit
  step ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" || return 0
  step ab wait --text "Ship the board" || return 0
  step ab click "button[aria-label='Edit description']" || return 0
  step ab wait "#issue-description-editor" || return 0
  shot
}

state_new() {
  STATE=issue-new
  step ab open "$BASE/p/$MAIN_SLUG/?id=new" || return 0
  step ab wait --text "Create issue" || return 0
  shot
}

state_discard() {
  STATE=issue-discard
  step ab open "$BASE/p/$MAIN_SLUG/?id=new" || return 0
  step ab wait "textarea[name='title']" || return 0
  step ab fill "textarea[name='title']" "Discard me" || return 0
  step ab click "#drawer-close" || return 0
  step ab wait --text "Discard changes?" || return 0
  shot
}

state_relation() {
  STATE=issue-relation-kind
  step ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" || return 0
  step ab wait "button[aria-label='Add relation']" || return 0
  step ab click "button[aria-label='Add relation']" || return 0
  step ab wait --text "Blocked by" || return 0
  step ab find role button click --name "Blocks" || return 0
  step ab wait --fn "Array.from(document.querySelectorAll('[aria-label=Relation] button')).some((button) => button.textContent.trim() === 'Blocks' && button.getAttribute('aria-pressed') === 'true')" || return 0
  shot
}

state_parent_empty() {
  STATE=issue-parent-empty
  step ab open "$BASE/p/$MAIN_SLUG/?id=$STALE" || return 0
  step ab wait --text "Set parent" || return 0
  step ab find text "Set parent" click || return 0
  step ab wait "input[aria-label='Parent issue']" || return 0
  step ab fill "input[aria-label='Parent issue']" "zzzz-no-such" || return 0
  step ab wait --text "No results" || return 0
  shot
}

state_fragment() {
  STATE=dashboard-fragment-proceeded
  step ab open "$BASE/" || return 0
  step ab wait "a[href='/p/$MAIN_SLUG/dashboard#q-$EXPIRED']" || return 0
  step ab click "a[href='/p/$MAIN_SLUG/dashboard#q-$EXPIRED']" || return 0
  step ab wait --fn "document.getElementById('q-$EXPIRED')?.closest('details')?.open === true" || return 0
  step ab wait --text "Ship the fallback?" || return 0
  shot
}

state_relative() {
  STATE=dashboard-relative-time
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab wait "time[data-relative]" || return 0
  before=$(ab get text "time[data-prefix='Answered ']" 2>"$ROOT/step.err") || {
    echo "state failed: $WIDTH $STATE: could not read the relative time" >&2
    cat "$ROOT/step.err" >&2
    FAILED=1
    return 0
  }
  step ab wait 65000 || return 0
  after=$(ab get text "time[data-prefix='Answered ']" 2>"$ROOT/step.err") || {
    echo "state failed: $WIDTH $STATE: could not read the relative time after a minute" >&2
    cat "$ROOT/step.err" >&2
    FAILED=1
    return 0
  }
  if [ "$before" = "$after" ]; then
    echo "state failed: $WIDTH $STATE: relative time stayed '$before'" >&2
    FAILED=1
    return 0
  fi
  shot
}

readonly_states() {
  state_projects
  state_inbox
  state_board_list
  state_board_columns
  state_board_awaiting
  state_board_label
  state_board_search_empty
  state_board_no_open
  state_board_no_issues
  state_issue_ship
  state_issue_spec
  state_dashboard
  state_dashboard_empty
  state_issue_missing
  state_error_not_found
  state_error_workspace
  state_error_sort
  state_display
  state_search_open
  state_workspaces
  state_palette
  state_menu
  state_bulk
  state_description
  state_new
  state_discard
  state_relation
  state_parent_empty
  state_fragment
  state_sidebar
  state_dashboard_sidebar
  state_relative
}

for WIDTH in 1280 390; do
  if [ "$WIDTH" = 1280 ]; then
    step ab set viewport 1280 800 || exit 1
  else
    step ab set viewport 390 844 || exit 1
  fi
  readonly_states
done

state_live_draft() {
  STATE=board-live-draft
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" || return 0
  step ab wait "textarea[name='title']" || return 0
  step set_title_draft || return 0
  step yaru_copy issue save --id "$SHIP" --priority low || return 0
  step ab wait --text "Local title only" || return 0
  step ab wait --text "Low" || return 0
  shot
}

state_live_online() {
  STATE=board-live-online
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/" || return 0
  step ab wait --text "Backlog idea" || return 0
  step ab set offline on || return 0
  step yaru_copy issue save --id "$BACKLOG" --title "Renamed while offline" || return 0
  step ab set offline off || return 0
  step ab wait --text "Renamed while offline" || return 0
  shot
}

state_dash_draft() {
  STATE=dashboard-draft
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab wait "textarea[form='answer-question-$BLOCKING']" || return 0
  step ab fill "textarea[form='answer-question-$BLOCKING']" "draft text" || return 0
  step ab reload || return 0
  step ab wait --fn "document.querySelector(\"textarea[form='answer-question-$BLOCKING']\")?.value === 'draft text'" || return 0
  shot
}

state_inbox_draft() {
  STATE=inbox-draft
  step ab open "$BASE/inbox" || return 0
  step ab wait "textarea[form='answer-question-$MAIN_SLUG-$BLOCKING']" || return 0
  step ab fill "textarea[form='answer-question-$MAIN_SLUG-$BLOCKING']" "draft text" || return 0
  step ab reload || return 0
  step ab wait --fn "document.querySelector(\"textarea[form='answer-question-$MAIN_SLUG-$BLOCKING']\")?.value === 'draft text'" || return 0
  shot
}

state_show_new() {
  STATE=dashboard-show-new
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab fill "textarea[form='answer-question-$BLOCKING']" "still typing" || return 0
  step yaru_copy question save --title "A new question" --issue "$BACKLOG" --default "Wait" || return 0
  step ab wait --text "1 new — Show" || return 0
  shot
}

state_show_updated() {
  STATE=dashboard-show-updated
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab fill "textarea[form='answer-question-$BLOCKING']" "still typing" || return 0
  step yaru_copy issue save --id "$BACKLOG" --priority high || return 0
  step ab wait --text "Updated — Show" || return 0
  shot
}

state_answer() {
  STATE=dashboard-answer
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab fill "textarea[form='answer-question-$BLOCKING']" "Because the draft is enough." || return 0
  step ab click "button[form='answer-question-$BLOCKING']" || return 0
  step ab wait --text "Answered Q$BLOCKING" || return 0
  shot
  STATE=dashboard-undo
  step ab find role button click --name "Undo" || return 0
  step ab wait --fn "document.querySelector(\"textarea[form='answer-question-$BLOCKING']\")?.value.includes('Because the draft is enough')" || return 0
  shot
}

open_proceeded() {
  step ab find text "Ship the fallback?" click || return 1
  step ab wait "button[form='$1']" || return 1
}

scroll_click() {
  sel=$1
  ab eval --stdin >"$ROOT/step.out" 2>"$ROOT/step.err" <<EOF
const target = document.querySelector("$sel")
if (!target) throw new Error("missing $sel")
target.scrollIntoView({ block: "center" })
EOF
  step ab click "$sel"
}

state_dismiss() {
  surface=$1
  STATE=dismiss-$surface
  use_copy || return 0
  case "$surface" in
    dashboard)
      step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
      open_proceeded "cancel-question-$EXPIRED" || return 0
      scroll_click "button[form='cancel-question-$EXPIRED']" || return 0
      ;;
    issue)
      step ab open "$BASE/p/$MAIN_SLUG/?id=$STALE" || return 0
      open_awaiting || return 0
      scroll_click "button[form='cancel-question-$EXPIRED']" || return 0
      step ab wait --fn "!document.querySelector(\"[aria-label='Questions awaiting answer']\")" || return 0
      shot
      return 0
      ;;
    inbox)
      step ab open "$BASE/inbox" || return 0
      open_proceeded "cancel-question-$MAIN_SLUG-$EXPIRED" || return 0
      scroll_click "button[form='cancel-question-$MAIN_SLUG-$EXPIRED']" || return 0
      ;;
  esac
  step ab wait --fn "!document.body.innerText.includes('Ship the fallback?')" || return 0
  shot
}

state_dismiss_failed() {
  surface=$1
  STATE=dismiss-failed-$surface
  use_copy || return 0
  case "$surface" in
    dashboard)
      step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
      step ab fill "textarea[form='answer-question-$BLOCKING']" "keep the page" || return 0
      open_proceeded "cancel-question-$EXPIRED" || return 0
      step yaru_copy question answer "$EXPIRED" --body "late answer" || return 0
      scroll_click "button[form='cancel-question-$EXPIRED']" || return 0
      ;;
    issue)
      step ab open "$BASE/p/$MAIN_SLUG/?id=$STALE" || return 0
      open_awaiting || return 0
      step ab network route "**/api/page*" --abort || return 0
      step yaru_copy question answer "$EXPIRED" --body "late answer" || return 0
      scroll_click "button[form='cancel-question-$EXPIRED']" || return 0
      ;;
    inbox)
      step ab open "$BASE/inbox" || return 0
      open_proceeded "cancel-question-$MAIN_SLUG-$EXPIRED" || return 0
      step yaru_copy question answer "$EXPIRED" --body "late answer" || return 0
      scroll_click "button[form='cancel-question-$MAIN_SLUG-$EXPIRED']" || return 0
      ;;
  esac
  step ab wait --text "cannot cancel question $EXPIRED" || return 0
  shot
  ab network unroute >/dev/null 2>&1 || true
}

state_labels() {
  STATE=issue-labels-multi
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/?id=$STALE" || return 0
  step ab find text "Add labels" click || return 0
  step ab wait --text "bug" || return 0
  step ab find role option click --name "bug" || return 0
  step ab wait --fn "Array.from(document.querySelectorAll('[role=option]')).some((option) => option.textContent.trim() === 'bug' && option.getAttribute('aria-selected') === 'true')" || return 0
  step ab wait "[role=listbox]" || return 0
  shot
}

state_deadline() {
  STATE=dashboard-deadline-passed
  serve_now=$(bun -e 'process.stdout.write(new Date(Date.now() - 120000).toISOString())')
  answer_by=$(bun -e 'process.stdout.write(new Date(Date.now() - 30000).toISOString())')
  use_copy "$serve_now" || return 0
  bun -e '
    const fs = require("node:fs")
    const file = process.argv[1]
    const text = fs.readFileSync(file, "utf8")
    const next = text.replace(/^answerBy:.*$/m, "answerBy: " + process.argv[2])
    if (next === text) process.exit(1)
    fs.writeFileSync(file, next)
  ' "$COPY_MAIN/.yaru/questions/$DUE.md" "$answer_by" || {
    echo "state failed: $WIDTH $STATE: could not set answerBy" >&2
    FAILED=1
    return 0
  }
  step ab open "$BASE/p/$MAIN_SLUG/dashboard" || return 0
  step ab wait "[data-answer-by]" || return 0
  step ab wait 65000 || return 0
  step ab wait --text "Deadline passed — Show" || return 0
  shot
}

state_save_failed() {
  STATE=issue-save-failed
  use_copy || return 0
  step ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" || return 0
  step ab wait "textarea[name='title']" || return 0
  step ab set offline on || return 0
  step ab fill "textarea[name='title']" "Offline edit" || return 0
  step ab press Tab || return 0
  step ab wait --text "Unsaved" || return 0
  step ab wait --text "Failed to fetch" || return 0
  shot
  ab set offline off >/dev/null 2>&1 || true
}

start_empty_serve() {
  if [ -f "$EMPTY_PID_FILE" ]; then
    return 0
  fi
  empty_state=$(mktemp -d "${TMPDIR:-/tmp}/yaru-ui-empty-state.XXXXXX")
  empty_cwd=$(mktemp -d "${TMPDIR:-/tmp}/yaru-ui-empty-cwd.XXXXXX")
  ln -s "$WORKTREE/tsconfig.json" "$empty_cwd/tsconfig.json"
  ln -s "$WORKTREE/node_modules" "$empty_cwd/node_modules"
  cd "$empty_cwd"
  env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID \
    YARU_STATE_DIR="$empty_state" YARU_NOW="$YARU_NOW" \
    bun "$YARU_BIN" serve -p "$EMPTY_PORT" >"$ROOT/serve-empty.log" 2>&1 &
  echo $! >"$EMPTY_PID_FILE"
  cd "$PRISTINE/ui-fixture"
  if ! wait_port "$EMPTY_PORT"; then
    echo "state failed: projects-empty: empty serve did not start" >&2
    FAILED=1
    return 1
  fi
}

state_projects_empty() {
  STATE=projects-empty
  if ! start_empty_serve; then
    return 0
  fi
  step ab open "http://127.0.0.1:$EMPTY_PORT/" || return 0
  step ab wait --text "No workspaces yet" || return 0
  shot
}

for WIDTH in 1280 390; do
  if [ "$WIDTH" = 1280 ]; then
    step ab set viewport 1280 800 || exit 1
  else
    step ab set viewport 390 844 || exit 1
  fi
  state_live_draft
  state_live_online
  state_dash_draft
  state_inbox_draft
  state_show_new
  state_show_updated
  state_answer
  state_dismiss dashboard
  state_dismiss issue
  state_dismiss inbox
  state_dismiss_failed dashboard
  state_dismiss_failed issue
  state_dismiss_failed inbox
  state_labels
  state_deadline
  state_save_failed
  state_projects_empty
done

echo "shots: $SHOTS"
if [ "$FAILED" != 0 ]; then
  exit 1
fi
