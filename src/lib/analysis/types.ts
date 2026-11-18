export type AnalysisStatus = "match" | "incompatible" | "unknown";

export interface AnalysisIssue {
  status: "incompatible" | "unknown";
  code: string;
  message: string;
  method: string;
  path: string;
  field?: string;
}

export interface VersionAnalysis {
  versionId: string;
  version: string;
  sourceFile?: string;
  status: AnalysisStatus;
  issues: AnalysisIssue[];
}

export interface GraphApi {
  id: string;
  name: string;
  owner: string;
  versions: { id: string; version: string; sourceFile?: string }[];
}
export interface GraphService {
  id: string;
  name: string;
  owner: string;
  definitionId?: string;
  sourceFile?: string;
}
export interface GraphConnection {
  serviceId: string;
  definitionId: string;
  provider: string;
  apiId?: string;
  useCount: number;
  versions: VersionAnalysis[];
}
export interface RegistryGraph {
  services: GraphService[];
  apis: GraphApi[];
  connections: GraphConnection[];
}
