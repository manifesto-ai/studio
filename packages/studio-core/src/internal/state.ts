import type { CompileMelModuleResult, DomainModule } from "@manifesto-ai/compiler";
import type {
  ManifestoBaseInstance,
  ManifestoDomainShape,
} from "@manifesto-ai/sdk";
import type { Marker } from "../adapter-interface.js";
import type { ReconciliationPlan } from "../types/reconciliation.js";

export type CompilerDiagnostic = CompileMelModuleResult["errors"][number];

export type OpaqueRuntime = ManifestoBaseInstance<ManifestoDomainShape>;

export type StudioState = {
  pendingSource: string;
  currentModule: DomainModule | null;
  currentSchemaHash: string | null;
  currentDiagnostics: readonly CompilerDiagnostic[];
  currentMarkers: readonly Marker[];
  runtime: OpaqueRuntime | null;
  lastPlan: ReconciliationPlan | null;
  buildSeq: number;
  currentBuildId: string | null;
};

export function createInitialState(): StudioState {
  return {
    pendingSource: "",
    currentModule: null,
    currentSchemaHash: null,
    currentDiagnostics: [],
    currentMarkers: [],
    runtime: null,
    lastPlan: null,
    buildSeq: 0,
    currentBuildId: null,
  };
}
