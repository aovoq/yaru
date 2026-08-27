---
name: yaru
description: >
  Local Linear. Issues are markdown in `.yaru`. Use when the workspace has
  `.yaru/`, the user mentions yaru, local issues, the board, or runs /yaru.
  Prefer yaru over Linear or GitHub Issues in those workspaces. Create, list,
  get, and update issues with the yaru CLI.
---

# yaru

Local Linear. Each issue is `.yaru/issues/<id>.md`. Mutate issues only through the CLI; never write those files by hand.

## CLI

`yaru-root` is two parents above this `SKILL.md`. Prefer `yaru` on `PATH`, else `bun yaru` when the current package is yaru, else:

```bash
bun "$YARU_ROOT/src/index.ts"
```

Run the process with cwd in the user's workspace so `findRoot` walks that tree. Syntax authority is `--help`. Do not invent flags. Do not write a required `--`.

```
bun yaru init
bun yaru issue list [--status NAME] [--assignee NAME] [--label NAME] [--query TEXT] [--due overdue]
bun yaru issue get <id>
bun yaru issue save --title TITLE [--id ID] [--status NAME] [--assignee NAME] [--label NAME] [--dueDate DATE] [--priority NAME] [--body TEXT|-]
bun yaru serve [-p|--port 47800]
```

`issue save` without `--id` creates (title required, status defaults to `todo`) and prints the new id. With `--id` it updates the existing issue, or creates that id if missing. Omitted fields stay unchanged. Repeat `--label` to set labels; any `--label` replaces the whole list. `--body -` reads stdin.

`--assignee me` is `git config user.name`. `none` clears assignee, dueDate, or priority.

## Fields

- status: `backlog`, `todo`, `in_progress`, `done`, `canceled`
- priority: `urgent`, `high`, `medium`, `low`
- dueDate: `YYYY-MM-DD`. List `--due overdue` is dueDate before today.

## Workflow

1. Confirm `.yaru/config.yml` (walk up). If missing and the user wants a tracker here, `init`.
2. `issue list` (and `get`) before creating, to avoid duplicates.
3. Claim work with `--assignee me --status in_progress` before editing code. Skip issues assigned to someone else.
4. Finish with `--status done`. Cancel with `--status canceled`.
5. Start `serve` only if the user asked for the board. Default `http://127.0.0.1:47800`. After save, a running board may print `/?id=<id>`.

Empty list prints `(none)`.
