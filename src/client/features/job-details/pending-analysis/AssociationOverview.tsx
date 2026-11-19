import type { JobDto } from "../../../../shared/api/v1/jobs.ts";
import type {
  AssociationLimitConstraintDto,
  AssociationLimitStatus,
  AssociationOverviewDto,
  LimitAnalysisDto,
  ResourceKind,
} from "../../../../shared/api/v1/pending-analysis.ts";
import { formatMemoryMiB } from "../../jobs/formatting.ts";
import { AssociationHierarchyTable } from "./AssociationHierarchyTable.tsx";
import { formatInteger } from "./analysis-formatting.ts";
import { metricQuantity, resourceLabel } from "./limit-formatting.ts";

type OverviewLevel = AssociationOverviewDto["hierarchy"][number];

const OVERVIEW_RESOURCES: readonly ResourceKind[] = [
  "cpus",
  "memoryMiB",
  "gpus",
];

interface JobRequest {
  cpus: number | null;
  memoryMiB: number | null;
  gpus: number;
}

interface LocatedConstraint {
  constraint: AssociationLimitConstraintDto;
  level: OverviewLevel;
}

function resourceForMetric(
  metric: LimitAnalysisDto["metric"],
): ResourceKind | null {
  return metric === "cpus" || metric === "memoryMiB" || metric === "gpus"
    ? metric
    : null;
}

function associationLabel(level: {
  account: string;
  user?: string;
  partition?: string;
}): string {
  return level.user ? `${level.user} @ ${level.account}` : level.account;
}

function requestFromJob(job: JobDto | undefined): JobRequest | null {
  if (job === undefined) return null;
  return {
    cpus: job.requested.cpus,
    memoryMiB: job.requested.memoryMiB,
    gpus: job.requested.gpus.total,
  };
}

function requestedFromJob(
  resource: ResourceKind,
  request: JobRequest | null,
): number | null {
  if (request === null) return null;
  if (resource === "cpus") return request.cpus;
  if (resource === "memoryMiB") return request.memoryMiB;
  return request.gpus;
}

function constraintsForResource(
  overview: AssociationOverviewDto,
  resource: ResourceKind,
): LocatedConstraint[] {
  const located: LocatedConstraint[] = [];
  for (const level of overview.hierarchy) {
    for (const constraint of level.constraints) {
      if (constraint.resource === resource) {
        located.push({ constraint, level });
      }
    }
  }
  return located;
}

function matchesMetric(
  constraint: AssociationLimitConstraintDto,
  analysis: LimitAnalysisDto,
  resource: ResourceKind,
): boolean {
  if (constraint.resource !== resource) return false;
  if (resource !== "gpus") return true;
  return analysis.gpuType === undefined
    ? constraint.gpuType === undefined
    : constraint.gpuType === analysis.gpuType;
}

// Prefer the reported constraint when choosing the summary.
function primaryConstraint(
  overview: AssociationOverviewDto,
  analysis: LimitAnalysisDto,
  resource: ResourceKind,
): LocatedConstraint | null {
  const limitingIndex =
    analysis.hierarchy?.findIndex((level) => level.limiting) ?? -1;
  const candidateIndexes =
    limitingIndex >= 0
      ? [limitingIndex]
      : overview.hierarchy.map((_, index) => index);
  for (const index of candidateIndexes) {
    const level = overview.hierarchy[index];
    if (level === undefined) continue;
    for (const constraint of level.constraints) {
      if (
        matchesMetric(constraint, analysis, resource) &&
        constraint.limit === analysis.limit &&
        constraint.used === analysis.used &&
        constraint.requested === analysis.requested
      ) {
        return { constraint, level };
      }
    }
  }
  for (const index of candidateIndexes) {
    const level = overview.hierarchy[index];
    if (level === undefined) continue;
    for (const constraint of level.constraints) {
      if (
        matchesMetric(constraint, analysis, resource) &&
        constraint.limit === analysis.limit
      ) {
        return { constraint, level };
      }
    }
  }
  return null;
}

function tightestKnownConstraint(
  located: readonly LocatedConstraint[],
): LocatedConstraint | null {
  let tightest: LocatedConstraint | null = null;
  let tightestHeadroom = Number.POSITIVE_INFINITY;
  for (const item of located) {
    const { used, requested, limit } = item.constraint;
    if (used === null || requested === null) continue;
    const headroom = limit - (used + requested);
    if (headroom < tightestHeadroom) {
      tightestHeadroom = headroom;
      tightest = item;
    }
  }
  return tightest;
}

function selectSummaryConstraint(
  overview: AssociationOverviewDto,
  analysis: LimitAnalysisDto,
  resource: ResourceKind,
): LocatedConstraint | null {
  const reported = resourceForMetric(analysis.metric);
  if (reported === resource) {
    const primary = primaryConstraint(overview, analysis, resource);
    if (primary !== null) return primary;
  }

  const located = constraintsForResource(overview, resource);
  if (located.length === 0) return null;
  const exceeded =
    located.find((item) => item.constraint.status === "exceedsRequest") ??
    located.find((item) => item.constraint.status === "usageExceeded");
  if (exceeded !== undefined) return exceeded;
  const unknown = located.find(
    (item) => item.constraint.status === "unknown",
  );
  if (unknown !== undefined) return unknown;
  return tightestKnownConstraint(located) ?? located[0]!;
}

function ratioUnit(
  constraint: AssociationLimitConstraintDto,
): string {
  if (constraint.resource === "cpus") {
    return constraint.limit === 1 ? "CPU" : "CPUs";
  }
  if (constraint.resource === "gpus") {
    const type = constraint.gpuType ? `${constraint.gpuType} ` : "";
    return `${type}GPU${constraint.limit === 1 ? "" : "s"}`;
  }
  return "";
}

function usageRatio(constraint: AssociationLimitConstraintDto): string {
  if (constraint.resource === "memoryMiB") {
    return constraint.used === null
      ? `Unknown / ${formatMemoryMiB(constraint.limit)}`
      : `${formatMemoryMiB(constraint.used)} / ${formatMemoryMiB(constraint.limit)}`;
  }
  const used =
    constraint.used === null ? "Unknown" : formatInteger(constraint.used);
  return `${used} / ${formatInteger(constraint.limit)} ${ratioUnit(constraint)}`;
}

function quantity(
  constraint: AssociationLimitConstraintDto,
  value: number,
): string {
  return metricQuantity(constraint.resource, value, constraint.gpuType);
}

function overLimit(
  constraint: AssociationLimitConstraintDto,
): number | null {
  const { used, requested, limit, status } = constraint;
  if (status === "exceedsRequest" && requested !== null) {
    return requested - limit;
  }
  if (status === "usageExceeded" && used !== null && requested !== null) {
    return used + requested - limit;
  }
  return null;
}

interface StatusTone {
  border: string;
  statusText: string;
  requestText: string;
  requestedBar: string;
}

function statusTone(status: AssociationLimitStatus): StatusTone {
  if (status === "exceedsRequest") {
    return {
      border: "border-red-500",
      statusText: "text-red-700",
      requestText: "text-red-700",
      requestedBar: "bg-red-500",
    };
  }
  if (status === "usageExceeded") {
    return {
      border: "border-amber-400",
      statusText: "text-amber-700",
      requestText: "text-amber-700",
      requestedBar: "bg-amber-400",
    };
  }
  return {
    border: status === "unknown" ? "border-gray-300" : "border-transparent",
    statusText: "text-gray-500",
    requestText: "text-gray-600",
    requestedBar: "bg-gray-300",
  };
}

function statusSentence(
  constraint: AssociationLimitConstraintDto,
): string | null {
  if (constraint.status === "exceedsRequest") {
    return "Request exceeds limit";
  }
  if (constraint.status === "usageExceeded") {
    return constraint.used === null
      ? "Known usage plus request exceeds the limit"
      : null;
  }
  if (constraint.status === "unknown") {
    if (constraint.requested === null && constraint.used === null) {
      return "Usage and request unavailable";
    }
    return constraint.requested === null
      ? "Request unavailable"
      : "Usage unavailable";
  }
  return null;
}

function UtilizationBar({
  used,
  requested,
  limit,
  status,
}: {
  used: number | null;
  requested: number | null;
  limit: number;
  status: AssociationLimitStatus;
}) {
  if (used === null || limit <= 0) return null;
  const tone = statusTone(status);
  const usedPercent = Math.min(100, (used / limit) * 100);
  const requestedPercent =
    requested !== null && requested > 0
      ? Math.max(0, Math.min(100 - usedPercent, (requested / limit) * 100))
      : 0;
  return (
    <div
      aria-hidden="true"
      className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-gray-100"
    >
      <div className="h-full bg-blue-600" style={{ width: `${usedPercent}%` }} />
      <div
        className={`h-full ${tone.requestedBar}`}
        style={{ width: `${requestedPercent}%` }}
      />
    </div>
  );
}

function ConstraintSummary({
  constraint,
  level,
}: {
  constraint: AssociationLimitConstraintDto;
  level: OverviewLevel;
}) {
  const tone = statusTone(constraint.status);
  const over = overLimit(constraint);
  const knownUsageViolation =
    constraint.status === "usageExceeded" && constraint.used === null;

  return (
    <div>
      <p className="mt-1 text-base font-semibold tabular-nums text-gray-900">
        {usageRatio(constraint)}
      </p>
      <p
        className="mt-0.5 truncate text-xs text-gray-500"
        title={associationLabel(level)}
      >
        {associationLabel(level)}
      </p>
      <UtilizationBar
        used={constraint.used}
        requested={constraint.requested}
        limit={constraint.limit}
        status={constraint.status}
      />
      {constraint.requested === null ? (
        <p className="mt-2 text-xs text-gray-500">Request unavailable</p>
      ) : constraint.requested > 0 ? (
        <p className="mt-2 text-xs tabular-nums">
          <span className={tone.requestText}>
            +{quantity(constraint, constraint.requested)} requested
          </span>
          {over !== null ? (
            <span className={tone.requestText}>
              {" "}
              · {quantity(constraint, over)} over limit
            </span>
          ) : null}
        </p>
      ) : null}
      {knownUsageViolation ? (
        <p className={`mt-1 text-xs font-medium ${tone.statusText}`}>
          Known usage plus request exceeds the limit
        </p>
      ) : null}
    </div>
  );
}

function EmptyResourceCard({
  resource,
  request,
}: {
  resource: ResourceKind;
  request: JobRequest | null;
}) {
  const requested = requestedFromJob(resource, request);
  if (resource === "gpus" && requested === 0) {
    return <p className="mt-1.5 text-sm text-gray-500">Not requested</p>;
  }
  return (
    <>
      <p className="mt-1.5 text-sm text-gray-500">
        {resource === "gpus" ? "No applicable limit" : "No limit configured"}
      </p>
      {requested !== null && requested > 0 ? (
        <p className="mt-1 text-xs tabular-nums text-gray-700">
          {metricQuantity(resource, requested)} requested
        </p>
      ) : null}
    </>
  );
}

function ResourceSummaryCard({
  resource,
  analysis,
  overview,
  request,
  divided,
}: {
  resource: ResourceKind;
  analysis: LimitAnalysisDto;
  overview: AssociationOverviewDto;
  request: JobRequest | null;
  divided: boolean;
}) {
  const reported = resourceForMetric(analysis.metric) === resource;
  const located = selectSummaryConstraint(overview, analysis, resource);
  return (
    <article
      aria-label={`${resourceLabel(resource)} association limits`}
      className={`min-w-0 px-3 py-3 sm:px-4 ${
        divided
          ? "border-t border-gray-200 sm:border-l sm:border-t-0"
          : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <h4 className="text-sm font-semibold text-gray-900">
          {resourceLabel(resource)}
        </h4>
        {reported ? (
          <span className="whitespace-nowrap rounded-sm bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
            Reported by Slurm
          </span>
        ) : null}
      </div>
      {located === null ? (
        <EmptyResourceCard resource={resource} request={request} />
      ) : (
        <div className="mt-2">
          <ConstraintSummary
            constraint={located.constraint}
            level={located.level}
          />
        </div>
      )}
    </article>
  );
}

function AssociationResourceSummary({
  analysis,
  overview,
  request,
}: {
  analysis: LimitAnalysisDto;
  overview: AssociationOverviewDto;
  request: JobRequest | null;
}) {
  const exceededCount = overview.hierarchy.reduce(
    (total, level) =>
      total +
      level.constraints.filter(
        ({ status }) => status === "exceedsRequest" || status === "usageExceeded",
      ).length,
    0,
  );

  return (
    <section aria-labelledby="association-resource-summary">
      <h3
        id="association-resource-summary"
        className="text-sm font-semibold text-gray-900"
      >
        Association resource limits
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Additional resource limits are evaluated from current allocations.
      </p>
      <div className="mt-3 grid overflow-hidden rounded-sm border border-gray-200 bg-white sm:grid-cols-3">
        {OVERVIEW_RESOURCES.map((resource, index) => (
          <ResourceSummaryCard
            key={resource}
            resource={resource}
            analysis={analysis}
            overview={overview}
            request={request}
            divided={index > 0}
          />
        ))}
      </div>
      {exceededCount > 1 ? (
        <p className="mt-3 text-xs text-gray-600">
          <span className="font-medium text-amber-700">
            {exceededCount} limits exceeded
          </span>{" "}
          across the association hierarchy.{" "}
          <a
            href="#association-hierarchy"
            className="font-medium text-blue-700 underline underline-offset-2"
          >
            View hierarchy
          </a>
        </p>
      ) : null}
    </section>
  );
}

function ConstraintCell({
  constraints,
}: {
  constraints: AssociationLimitConstraintDto[];
}) {
  if (constraints.length === 0) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  return (
    <div className="space-y-1.5">
      {constraints.map((constraint) => {
        const tone = statusTone(constraint.status);
        const status = statusSentence(constraint);
        const over = overLimit(constraint);
        return (
          <div
            key={`${constraint.resource}:${constraint.gpuType ?? "generic"}`}
            className={`min-w-0 border-l-2 pl-2 ${tone.border}`}
          >
            <p className="text-xs tabular-nums text-gray-800">
              {usageRatio(constraint)}
            </p>
            {over !== null ? (
              <p className={`mt-0.5 text-[11px] ${tone.statusText}`}>
                {constraint.status === "exceedsRequest"
                  ? "Request exceeds limit"
                  : `+${quantity(constraint, constraint.requested ?? 0)} requested · ${quantity(constraint, over)} over limit`}
              </p>
            ) : status !== null ? (
              <p className={`mt-0.5 text-[11px] ${tone.statusText}`}>
                {status}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AssociationResourceHierarchy({
  analysis,
  overview,
}: {
  analysis: LimitAnalysisDto;
  overview: AssociationOverviewDto;
}) {
  const reported = resourceForMetric(analysis.metric);
  return (
    <AssociationHierarchyTable
      levels={overview.hierarchy}
      columns={OVERVIEW_RESOURCES.map((resource) => ({
        key: resource,
        label: resourceLabel(resource),
        selectorLabel: resourceLabel(resource),
      }))}
      initialColumnKey={reported ?? "cpus"}
      caption="Association hierarchy from root to user association with CPU, memory, and GPU limits"
      renderIdentity={(level) => (
        <>
          <div className="text-sm font-medium text-gray-800">
            {level.user ? (
              <>
                {level.user}{" "}
                <span className="font-normal text-gray-400">@</span>{" "}
                {level.account}
              </>
            ) : (
              level.account
            )}
          </div>
          {level.partition ? (
            <div className="mt-0.5 text-[11px] text-gray-500">
              Partition {level.partition}
            </div>
          ) : null}
        </>
      )}
      renderCell={(level, resource) => (
        <ConstraintCell
          constraints={level.constraints.filter(
            (constraint) => constraint.resource === resource,
          )}
        />
      )}
      rowKey={(level, index) =>
        `${level.account}:${level.user ?? ""}:${level.partition ?? ""}:${index}`
      }
    />
  );
}

function AssociationOverview({
  analysis,
  overview,
  job,
}: {
  analysis: LimitAnalysisDto;
  overview: AssociationOverviewDto;
  job?: JobDto;
}) {
  const request = requestFromJob(job);
  return (
    <>
      <AssociationResourceSummary
        analysis={analysis}
        overview={overview}
        request={request}
      />
      <AssociationResourceHierarchy
        analysis={analysis}
        overview={overview}
      />
    </>
  );
}

export {
  AssociationOverview,
  associationLabel,
  statusTone,
  UtilizationBar,
};
