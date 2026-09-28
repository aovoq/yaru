import type { ComponentChild } from "preact"
import { afterEach, expect, test } from "vitest"
import { QuestionStatus } from "../gen/yaru/v1/common_pb"
import { installTestDom } from "../test-dom"
import { ProjectsScreen, type ProjectsClient } from "./projects-screen"

const window = installTestDom()

let container: HTMLElement

afterEach(async () => {
  const { render } = await import("preact")
  if (container) render(null, container)
  window.document.body.innerHTML = ""
})

async function mount(node: ComponentChild): Promise<void> {
  const { render } = await import("preact")
  container = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(container as never)
  render(node, container)
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("the project list comes from ListProjects and shows the folder path", async () => {
  const client: ProjectsClient = {
    listProjects: async () => ({
      now: "2026-09-28T12:00:00.000Z",
      projects: [
        {
          slug: "app",
          root: "/tmp/app",
          inProgress: 2,
          awaiting: [
            {
              id: "3",
              title: "色を決める",
              status: QuestionStatus.OPEN,
              options: [],
              author: "agent",
              createdAt: "2026-09-28T10:00:00.000Z",
              updatedAt: "2026-09-28T10:00:00.000Z",
              body: "",
            },
          ],
        },
      ],
    }),
  }
  await mount(<ProjectsScreen client={client} pollIntervalMs={3_600_000} />)
  expect(container.textContent).toContain("app")
  expect(container.textContent).toContain("1 awaiting")
  expect(container.textContent).toContain("2 in progress")
  expect(container.textContent).toContain("/tmp/app")
  expect(container.textContent).toContain("Blocking")
  expect(container.querySelector("a[href='/p/app/dashboard']")).not.toBeNull()
})

test("a failed project list says it could not load", async () => {
  const client: ProjectsClient = {
    listProjects: async () => {
      throw new Error("offline")
    },
  }
  await mount(<ProjectsScreen client={client} pollIntervalMs={3_600_000} />)
  expect(container.textContent).toContain("failed to load projects")
})
