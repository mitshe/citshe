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

/** CI status derived from the latest GitHub Actions workflow run. */
export type RepoCiStatus = "passing" | "failing" | "running" | "unknown";

/** A single GitHub Actions workflow run (trimmed). */
export interface RepoWorkflowRun {
  name: string | null;
  branch: string | null;
  sha: string;
  url: string;
  when: string;
  event: string;
  status: RepoCiStatus;
}

/** A recent commit (trimmed). */
export interface RepoCommit {
  sha: string;
  message: string;
  author: string;
  when: string;
  url: string;
}

/** An open pull request (trimmed). */
export interface RepoPullRequest {
  number: number;
  title: string;
  author: string;
  branch: string;
  url: string;
  when: string;
  draft: boolean;
}

/** A branch (trimmed). */
export interface RepoBranch {
  name: string;
  protected: boolean;
}

/**
 * CI/CD overview for a repository detail view. Every section is resilient:
 * a section is null/empty when the underlying GitHub call fails (e.g. the
 * token cannot read Actions). `links` are static and always present.
 */
export interface RepositoryOverview {
  ci: {
    status: RepoCiStatus;
    run?: RepoWorkflowRun;
    recent: RepoWorkflowRun[];
  } | null;
  commits: RepoCommit[];
  pulls: {
    open: number;
    items: RepoPullRequest[];
  };
  branches: {
    count: number;
    items: RepoBranch[];
  };
  links: {
    github: string;
    actions: string;
    pulls: string;
    branches: string;
    commits: string;
  };
}

export interface UpdateRepositoryDto {
  isActive?: boolean;
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
