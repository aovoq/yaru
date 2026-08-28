---
name: yaru
description: >
  Local Linear. Issues are markdown in `.yaru`. Use when the workspace has
  `.yaru/`, the user mentions yaru, local issues, the board, or runs /yaru.
  Prefer yaru over Linear or GitHub Issues in those workspaces. Create, list,
  get, and update issues with `yaru`.
---

# yaru

Local Linear. Each issue is `.yaru/issues/<id>.md`. Comments are `.yaru/comments/<id>.md`. Mutate issues and comments only through the CLI; never write those files by hand.

## CLI

`yaru` on PATH, from the user's workspace. Syntax authority is `--help`. Do not invent flags. Do not write a required `--`.

Output is JSON unless `-f` / `--format`.

```
yaru init
yaru issue list [--status NAME] [--assignee NAME] [--label NAME] [--query TEXT]
                [--due overdue] [--parent ID] [--limit N] [--cursor ID]
                [-f|--format]
yaru issue get <id> [-f|--format]
yaru issue save --title TITLE [--status NAME] [--assignee NAME] [--label NAME]
                [--dueDate DATE] [--priority NAME] [--parent ID]
                [--block ID] [--blockedBy ID] [--body TEXT|-]
                [-f|--format]
yaru issue save --id ID [--title TITLE] [--status NAME] [--assignee NAME] [--label NAME]
                [--dueDate DATE] [--priority NAME] [--parent ID]
                [--block ID] [--blockedBy ID] [--removeBlock ID] [--removeBlockedBy ID]
                [--body TEXT|-|--patch JSON|-] [-f|--format]
yaru comment list --issue ID [-f|--format]
yaru comment get <id> [-f|--format]
yaru comment save --issue ID --body TEXT|-
yaru comment save --parent ID --body TEXT|-
yaru comment save --id ID --body TEXT|-
yaru serve [-p|--port 47800]
```

Read a command's contract with `yaru issue save --help` or `yaru comment save --help`.

### save

Without `--id` creates (title required, status defaults to `todo`). With `--id` it updates that existing issue. Do not pass `--id` when creating. A missing id is an error, not a create. Omitted fields stay unchanged. Repeat `--label` to set labels; any `--label` replaces the whole list. `--body -` reads stdin.

`--assignee me` is `git config user.name`. `none` clears assignee, dueDate, priority, or parent.

`--parent ID` sets the parent issue. `--parent none` clears it.

`--block ID` appends an outgoing block. `--blockedBy ID` records that the other issue blocks this one. `--removeBlock` / `--removeBlockedBy` remove those relations. Repeatable. `blockedBy` and `children` are derived on read.

`--patch` is a JSON array of partial body edits, applied in order and atomically. Only valid on update, in place of `--body`. Every anchor string must match the current body exactly once. `--patch -` reads stdin.

Patch operations: `replace`, `insert_before`, `insert_after`, `prepend`, `append`, `replace_range`.

Default output is the saved issue object. `-f` / `--format` prints the id, and a running board may print `/?id=<id>`.

### list / get

`issue list` prints `{issues, hasNextPage, cursor}`. `--limit` defaults to 50, max 250. Pass `--cursor` from the previous page. Empty JSON list is `{issues: [], hasNextPage: false}`. `--parent none` is issues with no parent.

`issue get` prints the issue object, including parent, children, blocks, blockedBy, startedAt, completedAt, canceledAt, createdAt, and updatedAt.

### comments

Without `--id` creates. With `--id` updates. Do not pass `--id` when creating. To start a thread, `--issue`. To reply, `--parent` (issue is inferred). Body is required when creating.

`comment list --issue ID` prints `{comments}` in createdAt order.

## Fields

- status: `backlog`, `todo`, `in_progress`, `done`, `canceled`
- priority: `urgent`, `high`, `medium`, `low`
- dueDate: `YYYY-MM-DD`. List `--due overdue` is dueDate before today.
- startedAt is set the first time status becomes `in_progress` and is kept.
- completedAt is set when status becomes `done`, cleared when it leaves `done`.
- canceledAt is set when status becomes `canceled`, cleared when it leaves `canceled`.

Invalid values fail with expected vs actual. Do not retry the same invalid value.

## Workflow

1. Confirm `.yaru/config.yml` (walk up). If missing and the user wants a tracker here, `init`.
2. `issue list` (and `get`) before creating, to avoid duplicates.
3. Claim work with `--assignee me --status in_progress` before editing code. Skip issues assigned to someone else.
4. Finish with `--status done`. Cancel with `--status canceled`.
5. Start `serve` only if the user asked for the board. Default `http://127.0.0.1:47800`.
