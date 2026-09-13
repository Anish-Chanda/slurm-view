import type { QueryClient } from "@tanstack/react-query";
import type {
  PendingAnalysisDto,
  PendingAnalysisResponse,
} from "../../shared/api/v1/pending-analysis.ts";
import { JOB_STATES } from "../../shared/api/v1/jobs.ts";
import { apiUrl } from "./base.ts";
import { ApiError, fetchJson } from "./client.ts";
import { pendingAnalysisKeys } from "./query-keys.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isNumber(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isNumber(value);
}

function isArrayOf(value: unknown, guard: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(guard);
}

function isOneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

function isResourceShortage(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(value.resource, ["cpus", "memoryMiB", "gpus"]) &&
    isOptionalString(value.gpuType) &&
    isNumber(value.requested) &&
    isNumber(value.currentlyUnallocated)
  );
}

function isResourceNode(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isNullableString(value.state) &&
    isOneOf(value.status, ["sufficient", "insufficient", "unknown"]) &&
    isArrayOf(value.shortages, isResourceShortage)
  );
}

function isResourcesAnalysis(value: Record<string, unknown>): boolean {
  return (
    isOneOf(value.scope, ["partition", "scheduledNodes", "requestedNodes"]) &&
    isNumber(value.analyzedNodes) &&
    isNumber(value.sufficientNodes) &&
    isNumber(value.insufficientNodes) &&
    isNumber(value.unknownNodes) &&
    isArrayOf(
      value.bottlenecks,
      (item) =>
        isRecord(item) &&
        isOneOf(item.resource, ["cpus", "memoryMiB", "gpus"]) &&
        isOptionalString(item.gpuType) &&
        isNumber(item.nodes),
    ) &&
    isArrayOf(value.nodes, isResourceNode)
  );
}

function isPriorityAnalysis(value: Record<string, unknown>): boolean {
  return (
    typeof value.partition === "string" &&
    isNumber(value.priority) &&
    isNumber(value.pendingJobs) &&
    isNumber(value.higherPriorityJobs) &&
    isNumber(value.runningJobs) &&
    isArrayOf(
      value.factors,
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        isNullableNumber(item.weighted) &&
        isNullableNumber(item.normalized) &&
        isNullableNumber(item.weight),
    ) &&
    isArrayOf(
      value.competitors,
      (item) =>
        isRecord(item) &&
        typeof item.jobId === "string" &&
        isNullableString(item.user) &&
        isNumber(item.priority),
    )
  );
}

function isDependencyAnalysis(value: Record<string, unknown>): boolean {
  return (
    typeof value.expression === "string" &&
    isOneOf(value.operator, ["and", "or", "single"]) &&
    isOneOf(value.status, ["satisfied", "unsatisfied", "unknown"]) &&
    isArrayOf(
      value.dependencies,
      (clause) =>
        isRecord(clause) &&
        typeof clause.type === "string" &&
        isOneOf(clause.status, ["satisfied", "unsatisfied", "unknown"]) &&
        isArrayOf(
          clause.jobs,
          (job) =>
            isRecord(job) &&
            typeof job.jobId === "string" &&
            (job.state === null || isOneOf(job.state, JOB_STATES)) &&
            isNullableString(job.exitCode) &&
            isOneOf(job.status, ["satisfied", "unsatisfied", "unknown"]) &&
            isOptionalNumber(job.delayMinutes) &&
            (job.arrayWildcard === undefined ||
              typeof job.arrayWildcard === "boolean"),
        ),
    )
  );
}

function isLimitAnalysis(value: Record<string, unknown>): boolean {
  return (
    isOneOf(value.domain, ["association", "qos"]) &&
    isOneOf(value.metric, [
      "cpus",
      "memoryMiB",
      "nodes",
      "jobs",
      "gpus",
      "cpuMinutes",
      "memoryMiBMinutes",
    ]) &&
    isNumber(value.limit) &&
    isNullableNumber(value.used) &&
    isNullableNumber(value.requested) &&
    isOptionalString(value.gpuType) &&
    isOptionalString(value.account) &&
    isOptionalString(value.limitingAccount) &&
    isOptionalString(value.qos) &&
    isOptionalString(value.user) &&
    isOptionalNumber(value.runningJobs) &&
    (value.hierarchy === undefined ||
      isArrayOf(
        value.hierarchy,
        (item) =>
          isRecord(item) &&
          typeof item.account === "string" &&
          isOptionalString(item.user) &&
          isOptionalString(item.partition) &&
          isNullableString(item.parent) &&
          isNullableNumber(item.limit) &&
          isNullableNumber(item.used) &&
          typeof item.limiting === "boolean",
      )) &&
    (value.topConsumers === undefined ||
      isArrayOf(
        value.topConsumers,
        (item) =>
          isRecord(item) &&
          typeof item.jobId === "string" &&
          isNullableString(item.user) &&
          isNullableString(item.account) &&
          isNumber(item.value),
      ))
  );
}

function isScopeAnalysis(value: Record<string, unknown>): boolean {
  if (value.kind === "requiredNodes")
    return (
      isNullableString(value.expression) &&
      isArrayOf(
        value.nodes,
        (item) =>
          isRecord(item) &&
          typeof item.name === "string" &&
          isNullableString(item.state) &&
          isNullableString(item.reason),
      )
    );
  if (value.kind === "partition")
    return (
      typeof value.partition === "string" &&
      isNullableString(value.state) &&
      isNullableNumber(value.maxTimeSeconds) &&
      isNullableNumber(value.maxNodes) &&
      isNullableNumber(value.totalNodes)
    );
  return (
    isNullableString(value.name) &&
    isNullableString(value.state) &&
    isNullableString(value.startTime) &&
    isNullableString(value.endTime)
  );
}

function isArrayThrottleAnalysis(value: Record<string, unknown>): boolean {
  return (
    isNullableNumber(value.maxRunningTasks) &&
    isNullableNumber(value.runningTasks)
  );
}

function isPendingAnalysis(value: unknown): value is PendingAnalysisDto {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "resources":
      return isResourcesAnalysis(value);
    case "priority":
      return isPriorityAnalysis(value);
    case "dependency":
      return isDependencyAnalysis(value);
    case "limit":
      return isLimitAnalysis(value);
    case "requiredNodes":
    case "partition":
    case "reservation":
      return isScopeAnalysis(value);
    case "arrayThrottle":
      return isArrayThrottleAnalysis(value);
    default:
      return false;
  }
}

function isPendingAnalysisResponse(
  value: unknown,
): value is PendingAnalysisResponse {
  if (!isRecord(value)) return false;
  return (
    isNullableString(value.stateReason) &&
    typeof value.updatedAt === "string" &&
    (value.analysis === null || isPendingAnalysis(value.analysis))
  );
}

async function fetchPendingAnalysis(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<PendingAnalysisResponse> {
  const response = await fetchJson<unknown>(
    apiUrl(`jobs/${encodeURIComponent(id)}/pending-analysis`),
    options,
  );
  if (!isPendingAnalysisResponse(response)) {
    throw new ApiError(
      "INVALID_PENDING_ANALYSIS_RESPONSE",
      502,
      "Pending analysis returned malformed data.",
    );
  }
  return response;
}

function pendingAnalysisQueryOptions(id: string) {
  return {
    queryKey: pendingAnalysisKeys.detail(id),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchPendingAnalysis(id, { signal }),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: (count: number, error: unknown) =>
      !(
        error instanceof ApiError &&
        (error.status === 404 ||
          error.status === 409 ||
          error.code === "JOB_NOT_PENDING")
      ) && count < 1,
  };
}

// Diagnostics are live evidence, unlike the job detail snapshot. Drop only a
// settled result on each visit; a request already in progress remains shareable.
function preparePendingAnalysisVisit(
  queryClient: QueryClient,
  id: string,
): void {
  const queryKey = pendingAnalysisKeys.detail(id);
  const cached = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (cached?.state.fetchStatus !== "fetching") {
    queryClient.removeQueries({ queryKey, exact: true });
  }
}

function preparePendingAnalysisRouteLoad(
  queryClient: QueryClient,
  id: string,
  preload: boolean,
): void {
  if (!preload) {
    preparePendingAnalysisVisit(queryClient, id);
  }
}

export {
  fetchPendingAnalysis,
  pendingAnalysisQueryOptions,
  preparePendingAnalysisRouteLoad,
  preparePendingAnalysisVisit,
};
