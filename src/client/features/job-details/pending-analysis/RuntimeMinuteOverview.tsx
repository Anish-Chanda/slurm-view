import type { JobDto } from "../../../../shared/api/v1/jobs.ts";
import type {
  LimitAnalysisDto,
  LimitMetric,
  RuntimeMinuteConstraintDto,
  RuntimeMinuteMetric,
  RuntimeMinuteOverviewDto,
} from "../../../../shared/api/v1/pending-analysis.ts";
import { AssociationHierarchyTable } from "./AssociationHierarchyTable.tsx";
import {
  associationLabel,
  statusTone,
  UtilizationBar,
} from "./AssociationOverview.tsx";
import { metricQuantity } from "./limit-formatting.ts";

type RuntimeLevel = RuntimeMinuteOverviewDto["hierarchy"][number];

const RUNTIME_METRICS: readonly RuntimeMinuteMetric[] = [
  "cpuMinutes",
  "memoryMiBMinutes",
  "gpuMinutes",
];

interface LocatedRuntimeConstraint {
  constraint: RuntimeMinuteConstraintDto;
  level: RuntimeLevel;
}

function isRuntimeMetric(metric: LimitMetric): metric is RuntimeMinuteMetric {
  return RUNTIME_METRICS.includes(metric as RuntimeMinuteMetric);
}

function runtimeMetricName(metric: RuntimeMinuteMetric): string {
  return metric === "cpuMinutes"
    ? "CPU-minutes"
    : metric === "memoryMiBMinutes"
      ? "Memory-minutes"
      : "GPU-minutes";
}

function runtimeMetricAriaName(metric: RuntimeMinuteMetric): string {
  return metric === "cpuMinutes"
    ? "CPU-minute"
    : metric === "memoryMiBMinutes"
      ? "Memory-minute"
      : "GPU-minute";
}

function runtimeSelectorName(metric: RuntimeMinuteMetric): string {
  return metric === "cpuMinutes"
    ? "CPU"
    : metric === "memoryMiBMinutes"
      ? "Memory"
      : "GPU";
}

function quantity(
  constraint: RuntimeMinuteConstraintDto,
  value: number,
): string {
  return metricQuantity(constraint.metric, value, constraint.gpuType);
}

function usageRatio(constraint: RuntimeMinuteConstraintDto): string {
  const limit = quantity(constraint, constraint.limit);
  return constraint.committed === null
    ? `Unknown / ${limit}`
    : `${quantity(constraint, constraint.committed)} / ${limit}`;
}

function overLimit(constraint: RuntimeMinuteConstraintDto): number | null {
  const { committed, projected, limit, status } = constraint;
  if (status === "exceedsRequest" && projected !== null) {
    return projected - limit;
  }
  if (status === "usageExceeded" && committed !== null && projected !== null) {
    return committed + projected - limit;
  }
  return null;
}

function statusSentence(
  constraint: RuntimeMinuteConstraintDto,
): string | null {
  if (constraint.status === "exceedsRequest") {
    return "Projected commitment exceeds limit";
  }
  if (constraint.status === "usageExceeded") {
    return constraint.committed === null
      ? "Known commitment plus projection exceeds the limit"
      : null;
  }
  if (constraint.status === "unknown") {
    if (constraint.committed === null && constraint.projected === null) {
      return "Committed and projected estimates unavailable";
    }
    if (constraint.projected === null) {
      return "Projection unavailable";
    }
    return constraint.committed === null
      ? "Committed estimate unavailable"
      : null;
  }
  return null;
}

function constraintsForMetric(
  overview: RuntimeMinuteOverviewDto,
  metric: RuntimeMinuteMetric,
): LocatedRuntimeConstraint[] {
  const located: LocatedRuntimeConstraint[] = [];
  for (const level of overview.hierarchy) {
    for (const constraint of level.constraints) {
      if (constraint.metric === metric) {
        located.push({ constraint, level });
      }
    }
  }
  return located;
}

function matchesReported(
  constraint: RuntimeMinuteConstraintDto,
  analysis: LimitAnalysisDto,
  metric: RuntimeMinuteMetric,
): boolean {
  return (
    constraint.metric === metric &&
    constraint.gpuType === analysis.gpuType &&
    constraint.limit === analysis.limit &&
    constraint.committed === analysis.used &&
    constraint.projected === analysis.requested
  );
}

function tightestKnown(
  located: readonly LocatedRuntimeConstraint[],
): LocatedRuntimeConstraint | null {
  let tightest: LocatedRuntimeConstraint | null = null;
  let tightestHeadroom = Number.POSITIVE_INFINITY;
  for (const item of located) {
    const { committed, projected, limit } = item.constraint;
    if (committed === null || projected === null) continue;
    const headroom = limit - (committed + projected);
    if (headroom < tightestHeadroom) {
      tightestHeadroom = headroom;
      tightest = item;
    }
  }
  return tightest;
}

function selectSummaryConstraint(
  overview: RuntimeMinuteOverviewDto,
  analysis: LimitAnalysisDto,
  metric: RuntimeMinuteMetric,
): LocatedRuntimeConstraint | null {
  const located = constraintsForMetric(overview, metric);
  if (located.length === 0) return null;
  if (analysis.metric === metric) {
    const reported = located.find((item) =>
      matchesReported(item.constraint, analysis, metric),
    );
    if (reported !== undefined) return reported;
  }
  const exceeded =
    located.find((item) => item.constraint.status === "exceedsRequest") ??
    located.find((item) => item.constraint.status === "usageExceeded");
  if (exceeded !== undefined) return exceeded;
  const unknown = located.find(
    (item) => item.constraint.status === "unknown",
  );
  if (unknown !== undefined) return unknown;
  return tightestKnown(located) ?? located[0]!;
}

function RuntimeConstraintSummary({
  constraint,
  level,
}: {
  constraint: RuntimeMinuteConstraintDto;
  level: RuntimeLevel;
}) {
  const tone = statusTone(constraint.status);
  const over = overLimit(constraint);
  const knownCommitmentViolation =
    constraint.status === "usageExceeded" && constraint.committed === null;

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
        used={constraint.committed}
        requested={constraint.projected}
        limit={constraint.limit}
        status={constraint.status}
      />
      {constraint.projected === null ? (
        <p className="mt-2 text-xs text-gray-500">Projection unavailable</p>
      ) : constraint.projected > 0 ? (
        <p className="mt-2 text-xs tabular-nums">
          <span className={tone.requestText}>
            +{quantity(constraint, constraint.projected)} projected
          </span>
          {over !== null ? (
            <span className={tone.requestText}>
              {" "}
              · {quantity(constraint, over)} over limit
            </span>
          ) : null}
        </p>
      ) : null}
      {knownCommitmentViolation ? (
        <p className={`mt-1 text-xs font-medium ${tone.statusText}`}>
          Known commitment plus projection exceeds the limit
        </p>
      ) : null}
    </div>
  );
}

function RuntimeSummaryCard({
  metric,
  analysis,
  overview,
  job,
  divided,
}: {
  metric: RuntimeMinuteMetric;
  analysis: LimitAnalysisDto;
  overview: RuntimeMinuteOverviewDto;
  job?: JobDto;
  divided: boolean;
}) {
  const reported = isRuntimeMetric(analysis.metric) && analysis.metric === metric;
  const located = selectSummaryConstraint(overview, analysis, metric);
  const gpuNotRequested =
    metric === "gpuMinutes" &&
    job !== undefined &&
    job.requested.gpus.total === 0;

  return (
    <article
      aria-label={`${runtimeMetricAriaName(metric)} association limits`}
      className={`min-w-0 px-3 py-3 sm:px-4 ${
        divided
          ? "border-t border-gray-200 sm:border-l sm:border-t-0"
          : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <h4 className="text-sm font-semibold text-gray-900">
          {runtimeMetricName(metric)}
        </h4>
        {reported ? (
          <span className="whitespace-nowrap rounded-sm bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
            Reported by Slurm
          </span>
        ) : null}
      </div>
      {located === null ? (
        <p className="mt-1.5 text-sm text-gray-500">
          {gpuNotRequested
            ? "Not requested"
            : metric === "gpuMinutes"
              ? "No applicable limit"
              : "No limit configured"}
        </p>
      ) : (
        <div className="mt-2">
          <RuntimeConstraintSummary
            constraint={located.constraint}
            level={located.level}
          />
        </div>
      )}
    </article>
  );
}

function RuntimeMinuteResourceSummary({
  analysis,
  overview,
  job,
}: {
  analysis: LimitAnalysisDto;
  overview: RuntimeMinuteOverviewDto;
  job?: JobDto;
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
    <section aria-labelledby="runtime-minute-summary">
      <h3
        id="runtime-minute-summary"
        className="text-sm font-semibold text-gray-900"
      >
        Association runtime-minute limits
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Estimates use visible running jobs and current QOS settings. Actual scheduler accounting may differ.
      </p>
      <div className="mt-3 grid overflow-hidden rounded-sm border border-gray-200 bg-white sm:grid-cols-3">
        {RUNTIME_METRICS.map((metric, index) => (
          <RuntimeSummaryCard
            key={metric}
            metric={metric}
            analysis={analysis}
            overview={overview}
            job={job}
            divided={index > 0}
          />
        ))}
      </div>
      {exceededCount > 1 ? (
        <p className="mt-3 text-xs text-gray-600">
          <span className="font-medium text-amber-700">
            {exceededCount} runtime-minute limits show estimated overages
          </span>.{" "}
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

function RuntimeConstraintCell({
  constraints,
}: {
  constraints: RuntimeMinuteConstraintDto[];
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
            key={`${constraint.metric}:${constraint.gpuType ?? "generic"}`}
            className={`min-w-0 border-l-2 pl-2 ${tone.border}`}
          >
            <p className="text-xs tabular-nums text-gray-800">
              {usageRatio(constraint)}
            </p>
            {over !== null ? (
              <p className={`mt-0.5 text-[11px] ${tone.statusText}`}>
                {constraint.status === "exceedsRequest"
                  ? "Projected commitment exceeds limit"
                  : `+${quantity(constraint, constraint.projected ?? 0)} projected · ${quantity(constraint, over)} over limit`}
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

function RuntimeMinuteHierarchy({
  analysis,
  overview,
}: {
  analysis: LimitAnalysisDto;
  overview: RuntimeMinuteOverviewDto;
}) {
  const initial = isRuntimeMetric(analysis.metric)
    ? analysis.metric
    : "cpuMinutes";
  return (
    <AssociationHierarchyTable
      levels={overview.hierarchy}
      columns={RUNTIME_METRICS.map((metric) => ({
        key: metric,
        label: runtimeMetricName(metric),
        selectorLabel: runtimeSelectorName(metric),
      }))}
      initialColumnKey={initial}
      caption="Association hierarchy from root to user association with CPU-minute, memory-minute, and GPU-minute limits"
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
      renderCell={(level, metric) => (
        <RuntimeConstraintCell
          constraints={level.constraints.filter(
            (constraint) => constraint.metric === metric,
          )}
        />
      )}
      rowKey={(level, index) =>
        `${level.account}:${level.user ?? ""}:${level.partition ?? ""}:${index}`
      }
    />
  );
}

function RuntimeMinuteOverview({
  analysis,
  overview,
  job,
}: {
  analysis: LimitAnalysisDto;
  overview: RuntimeMinuteOverviewDto;
  job?: JobDto;
}) {
  return (
    <>
      <RuntimeMinuteResourceSummary
        analysis={analysis}
        overview={overview}
        job={job}
      />
      <RuntimeMinuteHierarchy analysis={analysis} overview={overview} />
    </>
  );
}

export { RuntimeMinuteOverview };
