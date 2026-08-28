---
name: yaru
description: >
  Local Linear. Issues are markdown in `.yaru`. Use when the workspace has
  `.yaru/`, the user mentions yaru, local issues, the board, or runs /yaru.
  Prefer yaru over Linear or GitHub Issues in those workspaces. Create, list,
  get, and update issues with `yaru`.
---

# yaru

Local Linear. Each issue is `.yaru/issues/<id>.md`. Mutate issues only through the CLI; never write those files by hand.

## CLI

`yaru` on PATH, from the user's workspace. Syntax authority is `--help`. Do not invent flags. Do not write a required `--`.

```
yaru init
yaru issue list [--status NAME] [--assignee NAME] [--label NAME] [--query TEXT]
                [--due overdue] [--limit N] [--cursor ID] [--json]
yaru issue get <id> [--json]
yaru issue save --title TITLE [--status NAME] [--assignee NAME] [--label NAME]
                [--dueDate DATE] [--priority NAME] [--body TEXT|-] [--json]
yaru issue save --id ID [--title TITLE] [--status NAME] [--assignee NAME] [--label NAME]
                [--dueDate DATE] [--priority NAME] [--body TEXT|-|--patch JSON|-] [--json]
yaru serve [-p|--port 47800]
```

Read a command's contract with `yaru issue list --help`, `yaru issue get --help`, or `yaru issue save --help`.

### save

Without `--id` creates (title required, status defaults to `todo`) and prints the new id. With `--id` it updates that existing issue. Do not pass `--id` when creating. A missing id is an error, not a create. Omitted fields stay unchanged. Repeat `--label` to set labels; any `--label` replaces the whole list. `--body -` reads stdin.

`--assignee me` is `git config user.name`. `none` clears assignee, dueDate, or priority.

`--patch` is a JSON array of partial body edits, applied in order and atomically. Only valid on update, in place of `--body`. Every anchor string must match the current body exactly once. `--patch -` reads stdin.

Patch operations: `replace`, `insert_before`, `insert_after`, `prepend`, `append`, `replace_range`. Same shape as Linear `save_issue.patch`.

`--json` prints the saved issue object and does not print a board URL.

### list / get

`--json` on list prints `{issues, hasNextPage, cursor}`. `--limit` defaults to 50, max 250. Pass `--cursor` from the previous JSON page. Empty text list prints `(none)`; empty JSON list is `{issues: [], hasNextPage: false}`.

`--json` on get prints the issue object, including labels, body, createdAt, and updatedAt.

`--assignee me` is `git config user.name`. `--assignee none` is unassigned.

## Fields

- status: `backlog`, `todo`, `in_progress`, `done`, `canceled`
- priority: `urgent`, `high`, `medium`, `low`
- dueDate: `YYYY-MM-DD`. List `--due overdue` is dueDate before today.

Invalid values fail with expected vs actual. Do not retry the same invalid value.

## Workflow

1. Confirm `.yaru/config.yml` (walk up). If missing and the user wants a tracker here, `init`.
2. `issue list --json` (and `get`) before creating, to avoid duplicates.
3. Claim work with `--assignee me --status in_progress` before editing code. Skip issues assigned to someone else.
4. Finish with `--status done`. Cancel with `--status canceled`.
5. Start `serve` only if the user asked for the board. Default `http://127.0.0.1:47800`. After a non-JSON save, a running board may print `/?id=<id>`.
