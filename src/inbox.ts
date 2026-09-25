import {
  groupAwaitingQuestions,
  listQuestions,
  type AwaitingQuestionGroups,
  type Question,
} from "./questions"
import { open } from "./store"
import { listWorkspaces } from "./workspaces"

// 全ワークスペースの答えを待っている質問を 1 か所に集める (/inbox と /api/inbox)
// 人は複数のプロジェクトのエージェントを並べて動かすので、ワークスペースごとの dashboard を順に開かなくても、先に答えるべき質問から答えられるようにする

export type InboxItem = {
  workspace: string
  // そのワークスペースの URL の接頭辞。回答フォームの action (<basePath>/questions/<id>/answer) を作るのに使う
  basePath: string
  // その質問をワークスペースの dashboard で開くリンク
  href: string
  // /inbox の中でのカードの id。質問の番号はワークスペースごとなので、ワークスペースの名前を含める
  anchor: string
  question: Question
}

export type InboxWorkspace = {
  slug: string
  basePath: string
  awaiting: number
}

export type Inbox = {
  groups: AwaitingQuestionGroups<InboxItem>
  workspaces: InboxWorkspace[]
}

// ワークスペースごとに分けてから並べると、別のワークスペースのもっと急ぐ質問が後ろに回るので、全て混ぜてから分ける
export function readInbox(directory: string, now: Date): Inbox {
  const items: InboxItem[] = []
  const workspaces: InboxWorkspace[] = []
  for (const workspace of listWorkspaces(directory)) {
    const basePath = workspaceBasePath(workspace.slug)
    const awaiting = listQuestions(open(workspace.root), {}, now).filter(
      (question) => question.status === "open" || question.status === "expired",
    )
    workspaces.push({ slug: workspace.slug, basePath, awaiting: awaiting.length })
    for (const question of awaiting) {
      items.push({
        workspace: workspace.slug,
        basePath,
        href: `${basePath}/dashboard#q-${encodeURIComponent(question.id)}`,
        anchor: inboxQuestionAnchor(workspace.slug, question.id),
        question,
      })
    }
  }
  return { groups: groupAwaitingQuestions(items, (item) => item.question), workspaces }
}

// フォームの後に /inbox へ戻るときの fragment にも使う。ワークスペースの名前は [A-Za-z0-9._-] だけなので、そのまま id に使える
export function inboxQuestionAnchor(slug: string, id: string): string {
  return `q-${slug}-${id}`
}

export function workspaceBasePath(slug: string): string {
  return `/p/${encodeURIComponent(slug)}`
}
