export const STUDIO_CORE_SPEC_VERSION = "0.2.0";

export type VersionCompatibility = {
  studioCoreSpecVersion: string;
  runtimeContracts: {
    core: string;
    sdk?: string;
    compiler?: string;
    codegen?: string;
  };
};

export const DEFAULT_VERSION_COMPATIBILITY: VersionCompatibility = {
  studioCoreSpecVersion: STUDIO_CORE_SPEC_VERSION,
  runtimeContracts: {
    core: "^2.8.0",
    sdk: "^3.3.0",
    compiler: "^3.0.0",
    codegen: "^0.2.1"
  }
};

