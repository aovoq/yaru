#!/bin/sh
# 画面の確認用ワークスペースを、リポジトリの外に作る。
# issue、コメント、質問、コミットは、この worktree の yaru (src/index.ts) で書く。
# 質問の期限と、止まった issue、7 日より前に終わった issue は、作ったあとに frontmatter の時刻だけをずらす。
# ずらす前の createdAt も、ずらした時刻も、同じ YARU_NOW から数える。既定は 2026-09-28T12:00:00.000Z。
# 使い方: testdata/ui/fixture/make-fixture.sh [出力先] [--state-dir 登録先] [--force]
# 登録先の既定は <出力先>/state。できた fixture.env の YARU_STATE_DIR を serve に渡す。
# 実行中の環境変数 YARU_STATE_DIR は使わない。本物の登録を上書きしないため。
# 本物の ~/.local/state/yaru と、リポジトリの .yaru には書かない。

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
WORKTREE=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
YARU_BIN="$WORKTREE/src/index.ts"
FORCE=0
ROOT=""
STATE_DIR_ARG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --state-dir)
      shift
      STATE_DIR_ARG=${1:-}
      if [ -z "$STATE_DIR_ARG" ]; then
        echo "missing value for --state-dir" >&2
        exit 1
      fi
      ;;
    --*)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
    *)
      if [ -n "$ROOT" ]; then
        echo "unexpected argument: $1" >&2
        exit 1
      fi
      ROOT=$1
      ;;
  esac
  shift
done

if [ -z "$ROOT" ]; then
  ROOT="${TMPDIR:-/tmp}/yaru-ui-fixture"
fi
case "$ROOT" in
  "$WORKTREE"|"$WORKTREE"/*)
    echo "fixture root is inside the repository: $ROOT" >&2
    exit 1
    ;;
esac

if [ -e "$ROOT" ] && [ ! -d "$ROOT" -o -n "$(ls -A "$ROOT" 2>/dev/null)" ]; then
  if [ "$FORCE" != 1 ]; then
    echo "already exists: $ROOT (pass --force to replace it)" >&2
    exit 1
  fi
  case "$ROOT" in
    /|/tmp|/private/tmp|"$HOME")
      echo "refusing to replace: $ROOT" >&2
      exit 1
      ;;
  esac
  rm -rf "$ROOT"
fi

if [ ! -f "$YARU_BIN" ]; then
  echo "yaru entry was not found: $YARU_BIN" >&2
  exit 1
fi

mkdir -p "$ROOT"
ROOT=$(CDPATH= cd -- "$ROOT" && pwd -P)
case "$ROOT" in
  "$WORKTREE"|"$WORKTREE"/*)
    echo "fixture root is inside the repository: $ROOT" >&2
    exit 1
    ;;
esac
if [ -n "$STATE_DIR_ARG" ]; then
  mkdir -p "$STATE_DIR_ARG"
  STATE_DIR=$(CDPATH= cd -- "$STATE_DIR_ARG" && pwd -P)
else
  STATE_DIR=$ROOT/state
  mkdir -p "$STATE_DIR"
fi
REAL_STATE=$(CDPATH= cd -- "${XDG_STATE_HOME:-$HOME/.local/state}/yaru" 2>/dev/null && pwd -P || printf '%s' "$HOME/.local/state/yaru")
if [ "$STATE_DIR" = "$REAL_STATE" ] || [ "$STATE_DIR" = "$HOME/.local/state/yaru" ]; then
  echo "refusing to write the real state directory: $STATE_DIR" >&2
  exit 1
fi
# 環境の YARU_NOW は使わない。シナリオの確認は、この固定した時刻で行う。
CLOCK=2026-09-28T12:00:00.000Z

iso_shift() {
  bun -e '
    const clock = new Date(process.argv[1])
    const match = process.argv[2].match(/^([+-])(\d+)([hd])$/)
    if (Number.isNaN(clock.getTime()) || !match) {
      console.error("invalid clock shift: " + process.argv[2])
      process.exit(1)
    }
    const sign = match[1] === "-" ? -1 : 1
    const unit = match[3] === "d" ? 86400000 : 3600000
    process.stdout.write(new Date(clock.getTime() + sign * Number(match[2]) * unit).toISOString())
  ' "$CLOCK" "$1"
}

local_day() {
  bun -e '
    const clock = new Date(process.argv[1])
    const match = process.argv[2].match(/^([+-])(\d+)$/)
    if (Number.isNaN(clock.getTime()) || !match) process.exit(1)
    const sign = match[1] === "-" ? -1 : 1
    const date = new Date(clock.getTime())
    date.setDate(date.getDate() + sign * Number(match[2]))
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    process.stdout.write(date.getFullYear() + "-" + month + "-" + day)
  ' "$CLOCK" "$1"
}

set_field() {
  bun -e '
    const fs = require("node:fs")
    const file = process.argv[1]
    const key = process.argv[2]
    const value = process.argv[3]
    const text = fs.readFileSync(file, "utf8")
    const pattern = new RegExp("^" + key + ": .+$", "m")
    if (!pattern.test(text)) {
      console.error("missing frontmatter value " + key + " in " + file)
      process.exit(1)
    }
    fs.writeFileSync(file, text.replace(pattern, key + ": " + value))
  ' "$1" "$2" "$3"
}

# セッションの環境変数を渡すと、質問と issue の session に実行環境の値が入る。外す。
# worktree は git の最上位なので、一時ディレクトリのパスが入る。比べるときは正規化する。
in_ws() {
  workspace=$1
  shift
  (
    cd "$workspace"
    env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID \
      YARU_STATE_DIR="$STATE_DIR" YARU_NOW="$CLOCK" \
      bun "$YARU_BIN" "$@"
  )
}

id_of() {
  workspace=$1
  shift
  err=$(mktemp)
  out=$(in_ws "$workspace" "$@" 2>"$err") || {
    cat "$err" >&2
    exit 1
  }
  if [ -s "$err" ]; then
    cat "$err" >&2
    echo "yaru wrote an unexpected warning" >&2
    exit 1
  fi
  rm -f "$err"
  printf '%s' "$out" | bun -e '
    let text = ""
    process.stdin.on("data", (chunk) => { text += chunk })
    process.stdin.on("end", () => {
      const value = JSON.parse(text)
      if (!value.id) {
        console.error("yaru did not return an id")
        process.exit(1)
      }
      process.stdout.write(String(value.id))
    })
  '
}

prepare_git() {
  workspace=$1
  git init -b main "$workspace" >/dev/null
  git -C "$workspace" config user.name Fixture
  git -C "$workspace" config user.email fixture@example.test
  # bun は実行時のカレントディレクトリの tsconfig で JSX を決める。
  # カレントをリポジトリにすると、worktree の .yaru を読んでしまう。
  # なのでワークスペース側に tsconfig と node_modules のリンクを置き、yaru の cwd はここにする。
  ln -s "$WORKTREE/tsconfig.json" "$workspace/tsconfig.json"
  ln -s "$WORKTREE/node_modules" "$workspace/node_modules"
  printf '%s\n' '/node_modules' '/tsconfig.json' >"$workspace/.gitignore"
}

commit_yaru() {
  workspace=$1
  message=$2
  git -C "$workspace" add -- .gitignore
  find "$workspace/.yaru" -type f ! -path '*/questions/*' | while IFS= read -r file; do
    relative=${file#"$workspace/"}
    git -C "$workspace" add -- "$relative"
  done
  git -C "$workspace" commit -m "$message" >/dev/null
}

MAIN="$ROOT/ui-fixture"
DONE="$ROOT/ui-fixture-done"
EMPTY="$ROOT/ui-fixture-empty"
YESTERDAY=$(local_day -1)
TOMORROW=$(local_day +1)
LATER=$(local_day +14)
DUE_SOON=$(iso_shift +168h)
EXPIRED=$(iso_shift -1h)
OLD=$(iso_shift -8d)
RECENT=$(iso_shift -1d)
STALE_AT=$(iso_shift -48h)

prepare_git "$MAIN"
in_ws "$MAIN" init >/dev/null

SHIP=$(id_of "$MAIN" issue save --title "Ship the board" --status todo --priority urgent --assignee Fixture --label bug --dueDate "$YESTERDAY")
SPEC=$(id_of "$MAIN" issue save --title "Write the spec" --status todo --priority high --assignee Ada --label docs --dueDate "$TOMORROW")
in_ws "$MAIN" issue save --id "$SPEC" --status in_progress >/dev/null
STALE=$(id_of "$MAIN" issue save --title "Stale migration" --status in_progress --priority medium)
OLD_DONE=$(id_of "$MAIN" issue save --title "Old done work" --status done --priority low)
RECENT_DONE=$(id_of "$MAIN" issue save --title "Recent done work" --status done)
CANCELED=$(id_of "$MAIN" issue save --title "Canceled spike" --status canceled)
BACKLOG=$(id_of "$MAIN" issue save --title "Backlog idea" --status backlog --priority low --label chore --dueDate "$LATER")
CHILD=$(id_of "$MAIN" issue save --title "Child task" --status todo --parent "$SHIP" --label bug)
BLOCKED=$(id_of "$MAIN" issue save --title "Blocked note" --status todo)
in_ws "$MAIN" issue save --id "$SHIP" --block "$BLOCKED" >/dev/null
printf '%s\n' "See #$SPEC." "" "- [ ] write the notes" "- [x] pick the layout" | in_ws "$MAIN" issue save --id "$SHIP" --body - >/dev/null

# 既定も期限も無い質問は、エージェントが止まることを警告する。Blocking はこの警告が出るのが正しい。
blocking_err=$(mktemp)
BLOCKING=$(
  out=$(in_ws "$MAIN" question save --title "Which API shape?" --issue "$SPEC" --body "The agent is waiting." 2>"$blocking_err") || {
    cat "$blocking_err" >&2
    exit 1
  }
  if ! grep -q "no --default and no --answerBy" "$blocking_err"; then
    echo "expected the blocking question to warn that it has no default and no answerBy" >&2
    cat "$blocking_err" >&2
    exit 1
  fi
  printf '%s' "$out" | bun -e '
    let text = ""
    process.stdin.on("data", (chunk) => { text += chunk })
    process.stdin.on("end", () => {
      const value = JSON.parse(text)
      process.stdout.write(String(value.id))
    })
  '
)
rm -f "$blocking_err"
DUE=$(id_of "$MAIN" question save --title "Keep server rendering?" --issue "$SHIP" --default "Drop SSR" --answerBy "$DUE_SOON" --option "Keep SSR" --option "Drop SSR")
NO_DEADLINE=$(id_of "$MAIN" question save --title "Proceed with the draft?" --issue "$BACKLOG" --default "Proceed with the draft")
EXPIRED_Q=$(id_of "$MAIN" question save --title "Ship the fallback?" --issue "$STALE" --default "Ship the fallback" --answerBy "$EXPIRED")
ANSWERED=$(id_of "$MAIN" question save --title "Already decided" --issue "$SHIP" --default "Noted" --body "Context for the decision.")
in_ws "$MAIN" question answer "$ANSWERED" --body "Use the board." >/dev/null
CANCELED_Q=$(id_of "$MAIN" question save --title "Withdrawn question" --issue "$RECENT_DONE" --default "Noted")
in_ws "$MAIN" question save --id "$CANCELED_Q" --status canceled >/dev/null

COMMENT=$(id_of "$MAIN" comment save --issue "$SHIP" --body "First note")
REPLY=$(id_of "$MAIN" comment save --parent "$COMMENT" --body "Reply to the note")

set_field "$MAIN/.yaru/issues/$STALE.md" createdAt "$STALE_AT"
set_field "$MAIN/.yaru/issues/$STALE.md" startedAt "$STALE_AT"
set_field "$MAIN/.yaru/issues/$STALE.md" updatedAt "$STALE_AT"
set_field "$MAIN/.yaru/issues/$OLD_DONE.md" completedAt "$OLD"
set_field "$MAIN/.yaru/issues/$OLD_DONE.md" updatedAt "$OLD"
set_field "$MAIN/.yaru/issues/$RECENT_DONE.md" completedAt "$RECENT"
set_field "$MAIN/.yaru/issues/$CANCELED.md" canceledAt "$RECENT"

commit_yaru "$MAIN" "Add the fixture issues"
printf '%s\n' "Fixture notes for the board." >"$MAIN/README.md"
git -C "$MAIN" add -- README.md
git -C "$MAIN" commit -m "Note #$SHIP on the board" >/dev/null
printf '%s\n' "uncommitted" >"$MAIN/notes.txt"

prepare_git "$DONE"
in_ws "$DONE" init >/dev/null
DONE_ISSUE=$(id_of "$DONE" issue save --title "Archived only" --status done)
set_field "$DONE/.yaru/issues/$DONE_ISSUE.md" completedAt "$OLD"
set_field "$DONE/.yaru/issues/$DONE_ISSUE.md" updatedAt "$OLD"
commit_yaru "$DONE" "Archive the only issue"

prepare_git "$EMPTY"
in_ws "$EMPTY" init >/dev/null
commit_yaru "$EMPTY" "Initialize an empty workspace"

slug_of() {
  bun -e '
    const fs = require("node:fs")
    const registry = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    const found = registry.workspaces.find((workspace) => workspace.root === process.argv[2])
    if (!found) {
      console.error("workspace was not registered: " + process.argv[2])
      process.exit(1)
    }
    process.stdout.write(found.slug)
  ' "$STATE_DIR/workspaces.json" "$1"
}

MAIN_SLUG=$(slug_of "$MAIN")
DONE_SLUG=$(slug_of "$DONE")
EMPTY_SLUG=$(slug_of "$EMPTY")

env \
  CLOCK="$CLOCK" \
  STATE_DIR="$STATE_DIR" \
  ROOT="$ROOT" \
  MAIN="$MAIN" \
  DONE="$DONE" \
  EMPTY="$EMPTY" \
  MAIN_SLUG="$MAIN_SLUG" \
  DONE_SLUG="$DONE_SLUG" \
  EMPTY_SLUG="$EMPTY_SLUG" \
  SHIP="$SHIP" \
  SPEC="$SPEC" \
  STALE="$STALE" \
  OLD_DONE="$OLD_DONE" \
  RECENT_DONE="$RECENT_DONE" \
  CANCELED="$CANCELED" \
  BACKLOG="$BACKLOG" \
  CHILD="$CHILD" \
  BLOCKED="$BLOCKED" \
  BLOCKING="$BLOCKING" \
  DUE="$DUE" \
  NO_DEADLINE="$NO_DEADLINE" \
  EXPIRED_Q="$EXPIRED_Q" \
  ANSWERED="$ANSWERED" \
  CANCELED_Q="$CANCELED_Q" \
  COMMENT="$COMMENT" \
  REPLY="$REPLY" \
  DONE_ISSUE="$DONE_ISSUE" \
  bun -e '
    const fs = require("node:fs")
    const env = process.env
    const manifest = {
      clock: env.CLOCK,
      stateDir: env.STATE_DIR,
      main: {
        slug: env.MAIN_SLUG,
        root: env.MAIN,
        issues: {
          ship: env.SHIP,
          spec: env.SPEC,
          stale: env.STALE,
          oldDone: env.OLD_DONE,
          recentDone: env.RECENT_DONE,
          canceled: env.CANCELED,
          backlog: env.BACKLOG,
          child: env.CHILD,
          blocked: env.BLOCKED,
        },
        questions: {
          blocking: env.BLOCKING,
          dueSoon: env.DUE,
          noDeadline: env.NO_DEADLINE,
          expired: env.EXPIRED_Q,
          answered: env.ANSWERED,
          canceled: env.CANCELED_Q,
        },
        comments: { onShip: env.COMMENT, reply: env.REPLY },
      },
      done: { slug: env.DONE_SLUG, root: env.DONE, issue: env.DONE_ISSUE },
      empty: { slug: env.EMPTY_SLUG, root: env.EMPTY },
    }
    fs.writeFileSync(env.ROOT + "/manifest.json", JSON.stringify(manifest, null, 2) + "\n")
  '

cat >"$ROOT/fixture.env" <<EOF
YARU_STATE_DIR=$STATE_DIR
YARU_NOW=$CLOCK
YARU_UI_FIXTURE=$ROOT
YARU_BIN=$YARU_BIN
EOF

echo "fixture: $ROOT"
echo "state: $STATE_DIR"
echo "clock: $CLOCK"
echo "main: /p/$MAIN_SLUG/"
echo "done: /p/$DONE_SLUG/"
echo "empty: /p/$EMPTY_SLUG/"
