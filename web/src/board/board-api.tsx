import type { Transport } from "@connectrpc/connect"
import type { ComponentChildren } from "preact"
import { createContext } from "preact"
import { useContext } from "preact/hooks"
import { subscribeWorkspace } from "../connect/watch"
import { create } from "@bufbuild/protobuf"
import type { GetInboxResponse } from "../gen/yaru/v1/inbox_pb"
import { GetInboxRequestSchema } from "../gen/yaru/v1/inbox_pb"
import type { SaveIssueRequest, SaveIssueResponse } from "../gen/yaru/v1/issue_pb"
import type { GetPageRequest, GetPageResponse } from "../gen/yaru/v1/page_pb"
import type { Issue } from "../domain/issue"
import type { InboxWorkspace, PageData, SaveInput } from "./page-data"
import { errorFromLoad, errorFromSave, issueFromSave, pageFromResponse, pageRequestFromHref, saveIssueRequest } from "./proto"

// 板が使う Connect の口。テストはここを偽の返事に差し替える (docs/spec/routes.md の GetPage・SaveIssue・GetInbox・WatchWorkspace)

export type BoardApi = {
  loadPage: (href: string) => Promise<PageData>
  saveIssue: (input: Partial<SaveInput>) => Promise<Issue>
  loadWorkspaces: () => Promise<InboxWorkspace[]>
  subscribe: (refetch: () => void, signal: AbortSignal) => Promise<void>
}

export type BoardClients = {
  page: { getPage: (request: GetPageRequest) => Promise<GetPageResponse> }
  issues: { saveIssue: (request: SaveIssueRequest) => Promise<SaveIssueResponse> }
  inbox: { getInbox: (request: ReturnType<typeof create<typeof GetInboxRequestSchema>>) => Promise<GetInboxResponse> }
  transport: Transport
}

export function createBoardApi(clients: BoardClients, workspace: string): BoardApi {
  return {
    async loadPage(href) {
      try {
        const response = await clients.page.getPage(pageRequestFromHref(workspace, href))
        return pageFromResponse(response)
      } catch (error) {
        throw errorFromLoad(error)
      }
    },
    async saveIssue(input) {
      try {
        const response = await clients.issues.saveIssue(saveIssueRequest(workspace, input))
        return issueFromSave(response)
      } catch (error) {
        throw errorFromSave(error)
      }
    },
    async loadWorkspaces() {
      const inbox = await clients.inbox.getInbox(create(GetInboxRequestSchema))
      return inbox.workspaces.map((item) => ({
        slug: item.slug,
        basePath: item.basePath,
        awaiting: item.awaiting,
      }))
    },
    subscribe(refetch, signal) {
      return subscribeWorkspace({
        transport: clients.transport,
        workspace,
        refetch,
        signal,
      })
    },
  }
}

const BoardApiContext = createContext<BoardApi | null>(null)

const MISSING_BOARD_API: BoardApi = {
  loadPage: async () => {
    throw new Error("missing board api: expected BoardApiProvider, actual null")
  },
  saveIssue: async () => {
    throw new Error("missing board api: expected BoardApiProvider, actual null")
  },
  loadWorkspaces: async () => {
    throw new Error("missing board api: expected BoardApiProvider, actual null")
  },
  subscribe: async () => {},
}

export function BoardApiProvider({ api, children }: { api: BoardApi; children?: ComponentChildren }) {
  return <BoardApiContext.Provider value={api}>{children}</BoardApiContext.Provider>
}

export function useBoardApi(): BoardApi {
  return useContext(BoardApiContext) ?? MISSING_BOARD_API
}
