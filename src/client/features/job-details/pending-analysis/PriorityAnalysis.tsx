import type { PriorityAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import { AnalysisMetricList, JobLink } from "./AnalysisShell.tsx";
import {
  formatInteger,
  formatNormalizedFactor,
  formatPriorityContribution,
  formatPriorityWeight,
} from "./analysis-formatting.ts";
import { priorityColor } from "./palette.ts";

function PriorityAnalysis({ analysis }: { analysis: PriorityAnalysisDto }) {
  const positive = analysis.factors.filter(
    (factor) => (factor.weighted ?? 0) > 0,
  );
  const positiveTotal = positive.reduce(
    (sum, factor) => sum + (factor.weighted ?? 0),
    0,
  );
  const negative = analysis.factors.filter(
    (factor) => (factor.weighted ?? 0) < 0,
  );

  return (
    <div>
      <h3 className="font-semibold">Priority evidence</h3>
      <p className="mt-2 text-2xl font-semibold tabular-nums">
        {formatInteger(analysis.priority)}
      </p>
      <p className="text-sm text-gray-500">Current priority</p>
      {positive.length ? (
        <>
          <div aria-hidden="true" className="mt-3 flex h-4 overflow-hidden">
            {positive.map((factor) => (
              <span
                key={factor.name}
                title={`${factor.name}: ${formatPriorityContribution(factor.weighted)} points`}
                className={`${priorityColor(factor.name)} border-r border-white`}
                style={{
                  width: `${((factor.weighted ?? 0) / positiveTotal) * 100}%`,
                }}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Positive weighted priority contributions
          </p>
        </>
      ) : null}
      {negative.length ? (
        <div className="mt-3 text-sm">
          <p className="font-medium">Negative factor contributions</p>
          <ul className="mt-1">
            {negative.map((factor) => (
              <li key={factor.name}>
                {factor.name}: {formatPriorityContribution(factor.weighted)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th scope="col">Factor</th>
              <th scope="col">Contribution</th>
              <th scope="col">Normalized</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {analysis.factors.map((factor) => (
              <tr key={factor.name} className="border-b border-gray-100">
                <td className="py-2">{factor.name}</td>
                <td>{formatPriorityContribution(factor.weighted)}</td>
                <td>{formatNormalizedFactor(factor.normalized)}</td>
                <td>{formatPriorityWeight(factor.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <AnalysisMetricList
          items={[
            ["Current priority", formatInteger(analysis.priority)],
            ["Pending jobs in partition", formatInteger(analysis.pendingJobs)],
            [
              "Pending jobs with higher numeric priority",
              formatInteger(analysis.higherPriorityJobs),
            ],
            ["Running jobs in partition", formatInteger(analysis.runningJobs)],
          ]}
        />
      </div>
      {analysis.competitors.length ? (
        <div className="mt-4">
          <h4 className="font-medium">
            Examples of pending jobs with higher current priority
          </h4>
          <ul className="mt-2 text-sm">
            {analysis.competitors.map((competitor) => (
              <li key={competitor.jobId}>
                <JobLink id={competitor.jobId} />{" "}
                {competitor.user ? `${competitor.user} · ` : ""}
                {formatInteger(competitor.priority)}
              </li>
            ))}
          </ul>
          {analysis.higherPriorityJobs > analysis.competitors.length ? (
            <p className="mt-1 text-xs text-gray-500">
              {analysis.higherPriorityJobs - analysis.competitors.length}{" "}
              additional pending jobs have higher numeric priority.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { PriorityAnalysis };
