export const MEL_AUTHOR_AGENT_MEL = `domain MelAuthorAgent {
  type AuthorPhase = "idle" | "drafting" | "building" | "simulating" | "finalized" | "failed"
  type BuildStatus = "unknown" | "ok" | "fail"

  state {
    phase: AuthorPhase = "idle"
    requestText: string | null = null
    workspaceId: string | null = null
    draftVersion: number = 0
    buildStatus: BuildStatus = "unknown"
    diagnosticCount: number = 0
    simulationCount: number = 0
    retryCount: number = 0
    finalProposalId: string | null = null
  }

  computed hasWorkspace = isNotNull(workspaceId)
  computed hasDiagnostics = gt(diagnosticCount, 0)
  computed canFinalize = and(eq(buildStatus, "ok"), gt(draftVersion, 0))

  action start(nextRequest: string, nextWorkspaceId: string) {
    onceIntent {
      patch phase = "drafting"
      patch requestText = nextRequest
      patch workspaceId = nextWorkspaceId
      patch draftVersion = 0
      patch buildStatus = "unknown"
      patch diagnosticCount = 0
      patch simulationCount = 0
      patch retryCount = 0
      patch finalProposalId = null
    }
  }

  action recordDraft() {
    onceIntent {
      patch phase = "drafting"
      patch draftVersion = add(draftVersion, 1)
      patch buildStatus = "unknown"
    }
  }

  action recordBuild(status: BuildStatus, diagnostics: number) {
    onceIntent {
      patch phase = cond(eq(status, "ok"), "building", "failed")
      patch buildStatus = status
      patch diagnosticCount = diagnostics
    }
  }

  action recordSimulation() {
    onceIntent {
      patch phase = "simulating"
      patch simulationCount = add(simulationCount, 1)
    }
  }

  action retry() {
    onceIntent {
      patch phase = "drafting"
      patch retryCount = add(retryCount, 1)
    }
  }

  action finalize(proposalId: string)
    dispatchable when canFinalize
  {
    onceIntent {
      patch phase = "finalized"
      patch finalProposalId = proposalId
    }
  }
}`;
