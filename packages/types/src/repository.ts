// Repository types

import type { IntegrationType } from "./integration";

export type GitProvider = "GITLAB" | "GITHUB" | "BITBUCKET";

/** Detected tech stack of a repo (populated by auto-analysis). */
export interface RepoStack {
  language?: string;
  framework?: string;
  packageManager?: string;
  runtime?: string;
}

/** Detected CI/CD (workflows/pipelines) of a repo. */
export interface RepoCiSummary {
  provider?: "github-actions" | "gitlab-ci" | "other" | "none";
  workflows?: string[];
  triggers?: string[];
}

export type RepoAnalysisStatus = "pending" | "analyzing" | "done" | "failed";

export interface Repository {
  id: string;
  organizationId: string;
  integrationId: string;
  provider: GitProvider;
  externalId: string;
  name: string;
  fullPath: string;
  description: string | null;
  defaultBranch: string;
  cloneUrl: string;
  webUrl: string;
  branchPattern: string | null;
  // Auto-analysis
  stack?: RepoStack | null;
  ciSummary?: RepoCiSummary | null;
  summary?: string | null;
  analyzedAt?: string | null;
  analysisStatus?: RepoAnalysisStatus | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  integration?: {
    id: string;
    type: IntegrationType;
    status: string;
  };
  _count?: {
    tasks: number;
  };
}

/** A related repo suggested after analysis (same name prefix, not yet connected). */
export interface RelatedRepoSuggestion {
  externalId: string;
  name: string;
  fullPath: string;
  integrationId: string;
  provider: GitProvider;
}

export interface RepoAnalysisResult {
  stack: RepoStack;
  ciSummary: RepoCiSummary;
  summary: string;
  related: RelatedRepoSuggestion[];
}

export interface UpdateRepositoryDto {
  isActive?: boolean;
  branchPattern?: string;
  defaultBranch?: string;
}

export interface BulkUpdateRepositoriesDto {
  ids: string[];
  isActive: boolean;
}

export interface RemoteRepository {
  externalId: string;
  name: string;
  fullPath: string;
  description: string | null;
  defaultBranch: string;
  webUrl: string;
  provider: GitProvider;
  integrationId: string;
  alreadyImported: boolean;
}

export interface SyncRepositoriesResult {
  synced: number;
  total: number;
}

export interface SyncAllRepositoriesResult {
  integrations: number;
  totalSynced: number;
  totalRepositories: number;
  errors: string[];
}
