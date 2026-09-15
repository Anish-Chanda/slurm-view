import type { LimitAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import {
  EVIDENCE_TABLE,
  EVIDENCE_TABLE_HEAD,
  EVIDENCE_TABLE_ROW,
  EVIDENCE_TABLE_WRAPPER,
  JobLink,
} from "./AnalysisShell.tsx";
import { formatInteger, formatMetric } from "./analysis-formatting.ts";

function metricName(
  metric: LimitAnalysisDto["metric"],
  gpuType?: string,
): string {
  if (metric === "gpus")
    return gpuType ? `${gpuType} GPU` : "GPU";
  if (metric === "cpus") return "CPU";
  if (metric === "memoryMiB") return "Memory";
  if (metric === "nodes") return "Node";
  if (metric === "jobs") return "Job";
  return metric === "cpuMinutes" ? "CPU-minutes" : "Memory MiB-minutes";
}

function metricQuantity(
  metric: LimitAnalysisDto["metric"],
  value: number,
  gpuType?: string,
): string {
  if (metric === "gpus")
    return `${formatInteger(value)} ${gpuType ? `${gpuType} GPU${value === 1 ? "" : "s"}` : `GPU${value === 1 ? "" : "s"}`}`;
  if (metric === "cpus")
    return `${formatInteger(value)} CPU${value === 1 ? "" : "s"}`;
  if (metric === "nodes")
    return `${formatInteger(value)} node${value === 1 ? "" : "s"}`;
  if (metric === "jobs")
    return `${formatInteger(value)} job${value === 1 ? "" : "s"}`;
  return formatMetric(metric, value, gpuType);
}

function LimitUsage({ analysis }: { analysis: LimitAnalysisDto }) {
  const title = `${metricName(analysis.metric, analysis.gpuType)} limit`;
  const usagePercent =
    analysis.used === null || analysis.limit <= 0
      ? null
      : (analysis.used / analysis.limit) * 100;
  const barPercent =
    usagePercent === null ? null : Math.min(100, usagePercent);
  const reached = analysis.used !== null && analysis.used >= analysis.limit;
  return (
    <section aria-labelledby="limit-usage">
      <h3 id="limit-usage" className="text-sm font-semibold text-gray-900">
        {title}
      </h3>
      {analysis.used === null ? (
        <p className="mt-3 text-sm text-gray-600">
          Current usage: Unknown · Limit:{" "}
          {metricQuantity(analysis.metric, analysis.limit, analysis.gpuType)}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-between gap-4">
            <p className="text-lg font-semibold tabular-nums text-gray-900">
              {metricQuantity(analysis.metric, analysis.used, analysis.gpuType)}{" "}
              currently in use
            </p>
            {usagePercent !== null ? (
              <span className="text-sm font-medium tabular-nums text-gray-600">
                {Math.round(usagePercent)}%
              </span>
            ) : null}
          </div>
          <div aria-hidden="true" className="mt-2 h-2 rounded-full bg-gray-200">
            <div
              className={
                reached
                  ? "h-2 rounded-full bg-red-600"
                  : "h-2 rounded-full bg-amber-500"
              }
              style={{ width: `${barPercent ?? 0}%` }}
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            of{" "}
            {metricQuantity(analysis.metric, analysis.limit, analysis.gpuType)}
          </p>
        </>
      )}
      {analysis.requested !== null ? (
        <p className="mt-5 text-sm text-gray-700">
          This job {analysis.metric === "jobs" ? "would add" : "requests"}{" "}
          <span className="font-semibold tabular-nums">
            {metricQuantity(
              analysis.metric,
              analysis.requested,
              analysis.gpuType,
            )}
          </span>
          .
        </p>
      ) : null}
    </section>
  );
}

type AssociationLevel = NonNullable<LimitAnalysisDto["hierarchy"]>[number];

function AssociationTreeLevel({
  levels,
  index,
  metric,
  gpuType,
}: {
  levels: AssociationLevel[];
  index: number;
  metric: LimitAnalysisDto["metric"];
  gpuType?: string;
}) {
  const level = levels[index];
  const limiting = level.limiting;
  const label = level.user ? `${level.user} @ ${level.account}` : level.account;
  const usage =
    level.limit === null
      ? "No limit"
      : `${level.used === null ? "Unknown" : metricQuantity(metric, level.used, gpuType)} / ${metricQuantity(metric, level.limit, gpuType)}`;
  const connectedToParent = index > 0 && index <= 5;
  const canIndentChild = index < 5;

  return (
    <li className="relative min-w-0">
      {connectedToParent ? (
        <span
          aria-hidden="true"
          className="absolute -left-5 top-3.5 w-5 border-t border-gray-300"
        />
      ) : null}
      <div
        className={`min-w-0 ${limiting ? "rounded-sm bg-red-50 px-2 py-1" : "py-1"}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span
            className={
              limiting
                ? "font-semibold text-gray-900"
                : "font-medium text-gray-800"
            }
          >
            {label}
            {level.user ? (
              <span className="ml-2 text-xs font-normal text-gray-500">
                User association
              </span>
            ) : null}
            {level.partition ? (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {level.partition}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500">
            {usage}
          </span>
        </div>
        {limiting ? (
          <p className="mt-0.5 text-xs font-medium text-red-700">
            Limiting level
          </p>
        ) : null}
      </div>
      {index < levels.length - 1 ? (
        <ol
          className={
            canIndentChild
              ? "relative mt-1.5 pl-5 before:absolute before:left-0 before:-top-1.5 before:h-6 before:border-l before:border-gray-300 before:content-['']"
              : "mt-1.5"
          }
        >
          <AssociationTreeLevel
            levels={levels}
            index={index + 1}
            metric={metric}
            gpuType={gpuType}
          />
        </ol>
      ) : null}
    </li>
  );
}

function AssociationTree({ analysis }: { analysis: LimitAnalysisDto }) {
  const levels = [...(analysis.hierarchy ?? [])].reverse();
  if (!levels.length) return null;
  return (
    <section aria-labelledby="association-hierarchy">
      <h3
        id="association-hierarchy"
        className="text-sm font-semibold text-gray-900"
      >
        Association hierarchy
      </h3>
      <ol
        className="mt-3"
        aria-label="Association hierarchy from root to user association"
      >
        <AssociationTreeLevel
          levels={levels}
          index={0}
          metric={analysis.metric}
          gpuType={analysis.gpuType}
        />
      </ol>
    </section>
  );
}

function Consumers({ analysis }: { analysis: LimitAnalysisDto }) {
  if (!analysis.topConsumers?.length) return null;
  const title =
    analysis.metric === "jobs"
      ? "Current jobs in this limit scope"
      : "Largest current consumers in this limit scope";
  return (
    <section className="mt-6" aria-labelledby="limit-consumers">
      <h3 id="limit-consumers" className="text-sm font-semibold text-gray-900">
        {title}
      </h3>
      <div className={`mt-3 ${EVIDENCE_TABLE_WRAPPER}`}>
        <table className={`${EVIDENCE_TABLE} min-w-[500px]`}>
          <thead className={EVIDENCE_TABLE_HEAD}>
            <tr>
              <th scope="col" className="px-3 py-2.5">
                Job
              </th>
              <th scope="col" className="px-3 py-2.5">
                User
              </th>
              <th scope="col" className="px-3 py-2.5">
                Account
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {analysis.topConsumers.map((consumer) => (
              <tr key={consumer.jobId} className={EVIDENCE_TABLE_ROW}>
                <td className="px-3 py-2.5">
                  <JobLink id={consumer.jobId} />
                </td>
                <td className="px-3 py-2.5">{consumer.user ?? "—"}</td>
                <td className="px-3 py-2.5">{consumer.account ?? "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatMetric(
                    analysis.metric,
                    consumer.value,
                    analysis.gpuType,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LimitAnalysis({ analysis }: { analysis: LimitAnalysisDto }) {
  const context =
    analysis.domain === "qos"
      ? [
          analysis.qos && `QOS ${analysis.qos}`,
          analysis.user && `User ${analysis.user}`,
          analysis.account && `Account ${analysis.account}`,
          analysis.runningJobs !== undefined &&
            `Running jobs ${analysis.runningJobs}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <div>
      {context ? <p className="mb-4 text-sm text-gray-600">{context}</p> : null}
      <LimitUsage analysis={analysis} />
      {analysis.domain === "association" && analysis.hierarchy?.length ? (
        <div className="mt-6 border-t border-gray-100 pt-6">
          <AssociationTree analysis={analysis} />
        </div>
      ) : null}
      <Consumers analysis={analysis} />
    </div>
  );
}

export { LimitAnalysis };
