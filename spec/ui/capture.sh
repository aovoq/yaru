#!/bin/sh
# シナリオ (spec/ui/scenarios.md) の状態を、agent-browser で開いて撮る。
# 確かめで起動する yaru serve は、fixture のディレクトリをカレントにして、別ポートで起動する。
# 既定のポートは 47900。空の登録だけは 47901。終わったら、ここで起動したプロセスだけを止める。
# 常駐の yaru serve と、本物の .yaru、~/.local/state/yaru には触らない。
#
# 使い方:
#   spec/ui/capture.sh [fixture の出力先]
# fixture が無ければ make-fixture.sh で作る。
# 高さはソースが決めていないので、1280×800 と 390×844 で撮る。

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
WORKTREE=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
ROOT=${1:-${YARU_UI_FIXTURE:-}}
PORT=${YARU_UI_PORT:-47900}
EMPTY_PORT=${YARU_UI_EMPTY_PORT:-47901}
SESSION=yaru-p0-ui

if [ "$PORT" = 47811 ] || [ "$EMPTY_PORT" = 47811 ]; then
  echo "refusing to use the resident port 47811" >&2
  exit 1
fi

if [ -z "$ROOT" ]; then
  ROOT=$(mktemp -d /tmp/yaru-ui-capture.XXXXXX)
  "$SCRIPT_DIR/fixture/make-fixture.sh" "$ROOT"
fi
ROOT=$(CDPATH= cd -- "$ROOT" && pwd -P)
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

if curl -sf -o /dev/null "http://127.0.0.1:$PORT/" ; then
  echo "port $PORT is already in use" >&2
  exit 1
fi

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

MAIN_ROOT=$(bun -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).main.root)' "$ROOT/manifest.json")
cd "$MAIN_ROOT"
env YARU_STATE_DIR="$YARU_STATE_DIR" YARU_NOW="$YARU_NOW" bun "$YARU_BIN" serve -p "$PORT" >"$LOG" 2>&1 &
echo $! >"$PID_FILE"

ready=0
i=0
while [ "$i" -lt 50 ]; do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 0.2
done
if [ "$ready" != 1 ]; then
  echo "yaru serve did not start on $PORT" >&2
  echo "log: $LOG" >&2
  exit 1
fi

BASE="http://127.0.0.1:$PORT"
bun -e '
  const fs = require("node:fs")
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  const line = (key, value) => key + "=" + JSON.stringify(String(value))
  fs.writeFileSync(process.argv[2], [
    line("MAIN_SLUG", manifest.main.slug),
    line("DONE_SLUG", manifest.done.slug),
    line("EMPTY_SLUG", manifest.empty.slug),
    line("SHIP", manifest.main.issues.ship),
    line("SPEC", manifest.main.issues.spec),
  ].join("\n") + "\n")
' "$ROOT/manifest.json" "$ROOT/capture.vars"
# shellcheck disable=SC1091
. "$ROOT/capture.vars"

ab() {
  agent-browser --session "$SESSION" "$@"
}

FAILED=0
shot() {
  name=$1
  if ab screenshot "$SHOTS/$WIDTH/$name.png"; then
    echo "shot $WIDTH $name"
  else
    echo "failed $WIDTH $name" >&2
    FAILED=1
  fi
}

open_shot() {
  name=$1
  url=$2
  ab open "$url" >/dev/null
  ab wait --load domcontentloaded >/dev/null || true
  shot "$name"
}

for WIDTH in 1280 390; do
  if [ "$WIDTH" = 1280 ]; then
    ab set viewport 1280 800 >/dev/null
  else
    ab set viewport 390 844 >/dev/null
  fi

  open_shot projects "$BASE/"
  open_shot inbox "$BASE/inbox"
  open_shot board-list "$BASE/p/$MAIN_SLUG/"
  open_shot board-columns "$BASE/p/$MAIN_SLUG/?view=board"
  open_shot board-awaiting "$BASE/p/$MAIN_SLUG/?awaiting=1"
  open_shot board-label "$BASE/p/$MAIN_SLUG/?label=bug"
  open_shot board-search-empty "$BASE/p/$MAIN_SLUG/?query=no-such-issue"
  open_shot board-no-open "$BASE/p/$DONE_SLUG/"
  open_shot board-no-issues "$BASE/p/$EMPTY_SLUG/"
  open_shot issue-ship "$BASE/p/$MAIN_SLUG/?id=$SHIP"
  open_shot issue-spec "$BASE/p/$MAIN_SLUG/?id=$SPEC"
  open_shot dashboard "$BASE/p/$MAIN_SLUG/dashboard"
  open_shot dashboard-empty "$BASE/p/$DONE_SLUG/dashboard"
  open_shot issue-missing "$BASE/p/$MAIN_SLUG/?id=999"
  open_shot error-not-found "$BASE/no-such-page"
  open_shot error-workspace "$BASE/p/no-such-workspace/"
  open_shot error-invalid-sort "$BASE/p/$MAIN_SLUG/?sort=nope"

  ab open "$BASE/p/$MAIN_SLUG/" >/dev/null
  if [ "$WIDTH" = 390 ]; then
    ab click "#search-open" >/dev/null || true
    shot board-search-open
  else
    ab click "#display-menu" >/dev/null || true
    shot board-display
    ab press Escape >/dev/null || true
    ab click "#workspace-switcher" >/dev/null || true
    ab wait --text "Workspaces" >/dev/null || true
    shot board-workspaces
    ab press Escape >/dev/null || true
    ab click "#sidebar-toggle" >/dev/null || true
    shot board-sidebar-collapsed
    ab click "#sidebar-open" >/dev/null || true
  fi

  ab open "$BASE/p/$MAIN_SLUG/" >/dev/null
  ab click "#command-palette-open" >/dev/null || true
  ab wait --text "Search issues and commands" >/dev/null || true
  shot board-command-palette
  ab press Escape >/dev/null || true

  ab focus "a[data-id='$SHIP']" >/dev/null || true
  ab press Shift+F10 >/dev/null || true
  shot board-context-menu
  ab press Escape >/dev/null || true

  ab click "button[aria-label='Select #$SHIP']" >/dev/null || true
  shot board-bulk

  ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" >/dev/null
  ab click "button[aria-label='Edit description']" >/dev/null || true
  shot issue-description-edit

  ab open "$BASE/p/$MAIN_SLUG/?id=new" >/dev/null
  shot issue-new
  ab fill "textarea[name='title']" "Discard me" >/dev/null || true
  if [ "$WIDTH" = 1280 ]; then
    ab click "#sidebar a[href$='/dashboard']" >/dev/null || true
  else
    ab click "#mobile-dashboard-link" >/dev/null || true
  fi
  ab wait --text "Discard changes?" >/dev/null || true
  shot issue-discard
  ab find text "Keep editing" click >/dev/null || true
done

# 空の登録。起動場所はワークスペースにしない。
if ! curl -sf -o /dev/null "http://127.0.0.1:$EMPTY_PORT/"; then
  EMPTY_STATE=$(mktemp -d /tmp/yaru-ui-empty-state.XXXXXX)
  EMPTY_CWD=$(mktemp -d /tmp/yaru-ui-empty-cwd.XXXXXX)
  ln -s "$WORKTREE/tsconfig.json" "$EMPTY_CWD/tsconfig.json"
  ln -s "$WORKTREE/node_modules" "$EMPTY_CWD/node_modules"
  cd "$EMPTY_CWD"
  env YARU_STATE_DIR="$EMPTY_STATE" YARU_NOW="$YARU_NOW" \
    bun "$YARU_BIN" serve -p "$EMPTY_PORT" >"$ROOT/serve-empty.log" 2>&1 &
  echo $! >"$EMPTY_PID_FILE"
  cd "$MAIN_ROOT"
  j=0
  while [ "$j" -lt 50 ]; do
    if curl -sf -o /dev/null "http://127.0.0.1:$EMPTY_PORT/"; then
      break
    fi
    j=$((j + 1))
    sleep 0.2
  done
  ab set viewport 1280 800 >/dev/null
  WIDTH=1280
  open_shot projects-empty "http://127.0.0.1:$EMPTY_PORT/"
  ab set viewport 390 844 >/dev/null
  WIDTH=390
  open_shot projects-empty "http://127.0.0.1:$EMPTY_PORT/"
fi

# ここから先は fixture を変える。読み取りの撮影のあとに行う。
WIDTH=1280
ab set viewport 1280 800 >/dev/null
ab open "$BASE/p/$MAIN_SLUG/?id=$SHIP" >/dev/null
ab offline on >/dev/null || true
ab fill "textarea[name='title']" "Offline edit" >/dev/null || true
ab press Tab >/dev/null || true
ab wait --text "Unsaved" >/dev/null || true
shot issue-save-failed
ab offline off >/dev/null || true

ab open "$BASE/p/$MAIN_SLUG/dashboard" >/dev/null
ab find placeholder "Answer" fill "Because the draft is enough." >/dev/null || true
# Proceed with the draft? は既定があり、回答欄の placeholder は Answer。
# 同じ placeholder のカードが複数あるので、最初の Answer ではなく、そのカードのボタンを押す。
ab snapshot -i >"$ROOT/inbox-snapshot.txt" || true
echo "mutating answer is best-effort; see spec/ui/scenarios.md dashboard-answer" >&2

echo "shots: $SHOTS"
if [ "$FAILED" != 0 ]; then
  exit 1
fi
