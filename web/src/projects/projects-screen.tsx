import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { connectErrorMessage, isRequestCanceled } from "../components/connect-error"
import { ErrorView } from "../components/error-view"
import { POLL_INTERVAL_MS, RELATIVE_TIME_INTERVAL_MS } from "../components/live-refresh"
import { createYaruClients } from "../connect/client"
import { questionFromProto, type QuestionLike } from "../domain/from-proto"
import { pageTitle } from "../domain/page-title"
import {
  browserMonotonic,
  dateFromIso,
  serverClock,
  type ServerClock,
} from "../domain/server-clock"
import { ProjectsView } from "./projects-view"
import type { ProjectSummary } from "./project-card"

// / 。ListProjects を 30 秒ごとに取り直す。src/projects.tsx:44-46、docs/spec/routes.md の「決定」2

type ProjectsResponseLike = {
  projects?:
    | readonly {
        slug: string
        root?: string | undefined
        awaiting?: readonly QuestionLike[] | undefined
        inProgress?: number | undefined
      }[]
    | undefined
  now: string
}

export type ProjectsClient = {
  listProjects(
    request: Record<string, never>,
    options?: { signal?: AbortSignal },
  ): Promise<ProjectsResponseLike>
}

export function ProjectsScreen({
  client,
  monotonicNow = browserMonotonic,
  pollIntervalMs = POLL_INTERVAL_MS,
}: {
  client?: ProjectsClient
  monotonicNow?: () => number
  pollIntervalMs?: number
}) {
  const owned = useMemo(() => createYaruClients(""), [])
  const projectsClient = client ?? (owned.projects as unknown as ProjectsClient)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const clockRef = useRef<ServerClock | null>(null)

  const apply = (response: ProjectsResponseLike) => {
    clockRef.current = serverClock(response.now, monotonicNow)
    setNow(dateFromIso(response.now))
    setProjects(
      (response.projects ?? []).map((project) => ({
        slug: project.slug,
        root: project.root ?? "",
        awaiting: (project.awaiting ?? []).map(questionFromProto),
        inProgress: project.inProgress ?? 0,
      })),
    )
    setFailure(null)
  }

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await projectsClient.listProjects({}, { signal: controller.signal })
        if (controller.signal.aborted) return
        apply(response)
      } catch (error) {
        if (controller.signal.aborted || isRequestCanceled(error)) return
        setFailure(connectErrorMessage(error, "failed to load projects"))
      }
    }
    void load()
    const timer = setInterval(() => {
      void load()
    }, pollIntervalMs)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [monotonicNow, pollIntervalMs, projectsClient])

  useEffect(() => {
    document.title = pageTitle("Projects")
  }, [])

  useEffect(() => {
    if (projects === null) return
    const timer = setInterval(() => {
      const clock = clockRef.current
      if (clock !== null) setNow(clock.now())
    }, RELATIVE_TIME_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [projects === null])

  if (failure !== null && projects === null) return <ErrorView message={failure} />
  if (projects === null || now === null) return null
  return <ProjectsView projects={projects} now={now} />
}
