export const MEL_AUTHOR_AGENT_MEL = `domain MelAuthorAgent {
  type AuthorPhase = "idle" | "drafting" | "building" | "simulating" | "stalled" | "finalized" | "failed"
  type BuildStatus = "unknown" | "ok" | "fail"

  state {
    phase: AuthorPhase = "idle"
    requestText: string | null = null
    workspaceId: string | null = null
    draftVersion: number = 0
    buildStatus: BuildStatus = "unknown"
    diagnosticCount: number = 0
    readCount: number = 0
    guideSearchCount: number = 0
    inspectionCount: number = 0
    simulationCount: number = 0
    retryCount: number = 0
    maxRetries: number = 3
    toolErrorCount: number = 0
    stallCount: number = 0
    lastToolName: string | null = null
    lastStallReason: string | null = null
    finalProposalId: string | null = null
  }

  computed hasWorkspace = isNotNull(workspaceId)
  computed hasDiagnostics = gt(diagnosticCount, 0)
  computed hasReadSource = gt(readCount, 0)
  computed hasDraftedSomething = gt(draftVersion, 0)
  computed canRetry = lt(retryCount, maxRetries)
  computed seemsStalled = and(hasReadSource, not(hasDraftedSomething), eq(lastToolName, "readSource"))
  computed canFinalize = and(eq(buildStatus, "ok"), hasDraftedSomething)

  action start(nextRequest: string, nextWorkspaceId: string) {
    onceIntent {
      patch phase = "drafting"
      patch requestText = nextRequest
      patch workspaceId = nextWorkspaceId
      patch draftVersion = 0
      patch buildStatus = "unknown"
      patch diagnosticCount = 0
      patch readCount = 0
      patch guideSearchCount = 0
      patch inspectionCount = 0
      patch simulationCount = 0
      patch retryCount = 0
      patch maxRetries = 3
      patch toolErrorCount = 0
      patch stallCount = 0
      patch lastToolName = null
      patch lastStallReason = null
      patch finalProposalId = null
    }
  }

  action recordReadSource() {
    onceIntent {
      patch phase = "drafting"
      patch readCount = add(readCount, 1)
      patch lastToolName = "readSource"
    }
  }

  action recordMutationAttempt(toolName: string, changed: boolean) {
    onceIntent {
      patch phase = "drafting"
      patch draftVersion = cond(changed, add(draftVersion, 1), draftVersion)
      patch buildStatus = "unknown"
      patch lastToolName = toolName
      patch lastStallReason = null
    }
  }

  action recordBuild(status: BuildStatus, diagnostics: number) {
    onceIntent {
      patch phase = cond(eq(status, "ok"), "building", "failed")
      patch buildStatus = status
      patch diagnosticCount = diagnostics
      patch lastToolName = "build"
    }
  }

  action recordGuideSearch() {
    onceIntent {
      patch guideSearchCount = add(guideSearchCount, 1)
      patch lastToolName = "searchAuthorGuide"
    }
  }

  action recordInspection(toolName: string) {
    onceIntent {
      patch inspectionCount = add(inspectionCount, 1)
      patch lastToolName = toolName
    }
  }

  action recordSimulation() {
    onceIntent {
      patch phase = "simulating"
      patch simulationCount = add(simulationCount, 1)
      patch lastToolName = "simulate"
    }
  }

  action markStalled(reason: string)
    dispatchable when not(or(eq(phase, "finalized"), eq(phase, "failed")))
  {
    onceIntent {
      patch phase = "stalled"
      patch stallCount = add(stallCount, 1)
      patch lastStallReason = reason
      patch lastToolName = "markStalled"
    }
  }

  action retry()
    dispatchable when canRetry
  {
    onceIntent {
      patch phase = "drafting"
      patch retryCount = add(retryCount, 1)
      patch lastToolName = "retry"
      patch lastStallReason = null
    }
  }

  action giveUp(reason: string)
    dispatchable when not(canRetry)
  {
    onceIntent {
      patch phase = "failed"
      patch lastStallReason = reason
      patch lastToolName = "giveUp"
    }
  }

  action recordToolError(toolName: string) {
    onceIntent {
      patch phase = "failed"
      patch toolErrorCount = add(toolErrorCount, 1)
      patch lastToolName = toolName
    }
  }

  action finalize(proposalId: string)
    dispatchable when canFinalize
  {
    onceIntent {
      patch phase = "finalized"
      patch finalProposalId = proposalId
      patch lastToolName = "finalize"
    }
  }
}`;
