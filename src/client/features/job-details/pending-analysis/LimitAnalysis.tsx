import type { LimitAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import { AnalysisMetricList, JobLink } from "./AnalysisShell.tsx";
import { formatMetric, metricLabel } from "./analysis-formatting.ts";

function Consumers({ analysis }: { analysis: LimitAnalysisDto }) {
  if (!analysis.topConsumers?.length) return null;
  const title =
    analysis.metric === "jobs"
      ? "Current jobs in this limit scope"
      : "Largest current consumers in this limit scope";
  return (
    <div className="mt-4 overflow-x-auto">
      <h4 className="font-medium">{title}</h4>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">User</th>
            <th scope="col">Account</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {analysis.topConsumers.map((consumer) => (
            <tr key={consumer.jobId}>
              <td>
                <JobLink id={consumer.jobId} />
              </td>
              <td>{consumer.user ?? "—"}</td>
              <td>{consumer.account ?? "—"}</td>
              <td>
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
  );
}

function LimitAnalysis({ analysis }: { analysis: LimitAnalysisDto }) {
  const requestedLabel =
    analysis.metric === "jobs" ? "This job would add" : "This job requests";
  const summary = [
    [
      analysis.metric === "jobs" ? "Running jobs" : "Current usage",
      formatMetric(analysis.metric, analysis.used, analysis.gpuType),
    ],
    ["Limit", formatMetric(analysis.metric, analysis.limit, analysis.gpuType)],
  ] as Array<[string, string]>;
  if (analysis.requested !== null)
    summary.push([
      requestedLabel,
      formatMetric(analysis.metric, analysis.requested, analysis.gpuType),
    ]);
  return (
    <div>
      <h3 className="font-semibold">
        {analysis.domain === "qos"
          ? `QOS limit: ${analysis.qos ?? "Unknown"} · ${metricLabel(analysis.metric, analysis.gpuType)}`
          : `Association limit: ${metricLabel(analysis.metric, analysis.gpuType)}`}
      </h3>
      <div className="mt-3">
        <AnalysisMetricList items={summary} />
      </div>
      {analysis.domain === "qos" ? (
        <p className="mt-3 text-sm text-gray-600">
          {[
            analysis.user && `User: ${analysis.user}`,
            analysis.account && `Account: ${analysis.account}`,
            analysis.gpuType && `GPU type: ${analysis.gpuType}`,
            analysis.runningJobs !== undefined &&
              `Running jobs: ${analysis.runningJobs}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : analysis.hierarchy?.length ? (
        <div className="mt-4">
          <h4 className="font-medium">Association hierarchy</h4>
          <ul className="mt-2 border-l border-gray-200 pl-4 text-sm">
            {[...analysis.hierarchy].reverse().map((level, index) => (
              <li key={`${level.account}-${index}`} className="py-1">
                <span className="font-medium">
                  {level.user
                    ? `${level.user} @ ${level.account}`
                    : level.account}
                </span>
                {level.partition ? ` · ${level.partition}` : ""}
                {level.limit === null ? (
                  " · No limit at this level"
                ) : (
                  <>
                    {" "}
                    ·{" "}
                    {level.used === null
                      ? "Unknown"
                      : formatMetric(
                          analysis.metric,
                          level.used,
                          analysis.gpuType,
                        )}{" "}
                    /{" "}
                    {formatMetric(
                      analysis.metric,
                      level.limit,
                      analysis.gpuType,
                    )}
                    {level.limiting ? (
                      <span className="ml-2 text-red-700">Limiting level</span>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Consumers analysis={analysis} />
    </div>
  );
}

export { LimitAnalysis };
