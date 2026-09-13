import type { PriorityAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import {
  AnalysisMetricList,
  EVIDENCE_TABLE,
  EVIDENCE_TABLE_HEAD,
  EVIDENCE_TABLE_ROW,
  EVIDENCE_TABLE_WRAPPER,
  JobLink,
} from "./AnalysisShell.tsx";
import {
  formatInteger,
  formatNormalizedFactor,
  formatPriorityContribution,
  formatPriorityWeight,
} from "./analysis-formatting.ts";
import { priorityColor } from "./palette.ts";

const FACTOR_NAMES: Record<string, string> = {
  age: "Age",
  fairshare: "Fair-share",
  jobsize: "Job size",
  partition: "Partition",
  qos: "QOS",
  site: "Site",
};

function factorName(name: string): string {
  return (
    FACTOR_NAMES[name.toLowerCase()] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}

function FactorMarker({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mr-2 inline-block h-2.5 w-2.5 rounded-sm ${active ? priorityColor(name) : "bg-gray-300"}`}
    />
  );
}

function Competitors({ analysis }: { analysis: PriorityAnalysisDto }) {
  if (!analysis.competitors.length) return null;
  return (
    <section className="mt-6" aria-labelledby="priority-competitors">
      <h3
        id="priority-competitors"
        className="text-sm font-semibold text-gray-900"
      >
        Examples with higher current priority
      </h3>
      <div className={`mt-3 ${EVIDENCE_TABLE_WRAPPER}`}>
        <table className={`${EVIDENCE_TABLE} min-w-[380px]`}>
          <thead className={EVIDENCE_TABLE_HEAD}>
            <tr>
              <th scope="col" className="px-3 py-2.5">
                Job
              </th>
              <th scope="col" className="px-3 py-2.5">
                User
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                Priority
              </th>
            </tr>
          </thead>
          <tbody>
            {analysis.competitors.map((competitor) => (
              <tr key={competitor.jobId} className={EVIDENCE_TABLE_ROW}>
                <td className="px-3 py-2.5">
                  <JobLink id={competitor.jobId} />
                </td>
                <td className="px-3 py-2.5 text-gray-700">
                  {competitor.user ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatInteger(competitor.priority)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {analysis.higherPriorityJobs > analysis.competitors.length ? (
        <p className="mt-2 text-xs text-gray-500">
          {analysis.higherPriorityJobs - analysis.competitors.length} more
          pending jobs have higher numeric priority.
        </p>
      ) : null}
    </section>
  );
}

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
    <div className="xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)] xl:gap-8">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">
              {formatInteger(analysis.priority)}
            </p>
            <p className="text-sm text-gray-500">Current priority</p>
          </div>
        </div>
        {positive.length ? (
          <>
            <div
              aria-hidden="true"
              className="mt-4 flex h-3 overflow-hidden rounded-full bg-gray-100"
            >
              {positive.map((factor) => (
                <span
                  key={factor.name}
                  title={`${factorName(factor.name)}: ${formatPriorityContribution(factor.weighted)} points`}
                  className={`${priorityColor(factor.name)} border-r border-white`}
                  style={{
                    width: `${((factor.weighted ?? 0) / positiveTotal) * 100}%`,
                  }}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              Positive weighted priority contributions
            </p>
          </>
        ) : null}
        {negative.length ? (
          <div className="mt-4 text-sm">
            <p className="font-medium text-gray-800">
              Negative factor contributions
            </p>
            <ul className="mt-1 text-gray-600">
              {negative.map((factor) => (
                <li key={factor.name}>
                  {factorName(factor.name)}:{" "}
                  {formatPriorityContribution(factor.weighted)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={`mt-5 ${EVIDENCE_TABLE_WRAPPER}`}>
          <table className={`${EVIDENCE_TABLE} min-w-[550px]`}>
            <thead className={EVIDENCE_TABLE_HEAD}>
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  Factor
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  Contribution
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  Normalized
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  Weight
                </th>
              </tr>
            </thead>
            <tbody>
              {analysis.factors.map((factor) => (
                <tr key={factor.name} className={EVIDENCE_TABLE_ROW}>
                  <td className="px-3 py-2.5">
                    <FactorMarker
                      name={factor.name}
                      active={(factor.weighted ?? 0) > 0}
                    />
                    {factorName(factor.name)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatPriorityContribution(factor.weighted)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatNormalizedFactor(factor.normalized)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatPriorityWeight(factor.weight)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="mt-6 border-t border-gray-200 pt-5 xl:mt-0 xl:border-t-0 xl:border-l xl:pl-8 xl:pt-0">
        <AnalysisMetricList
          prominent
          layout="priority-context"
          items={[
            ["Pending in partition", formatInteger(analysis.pendingJobs)],
            [
              "Higher numeric priority",
              formatInteger(analysis.higherPriorityJobs),
            ],
            ["Running in partition", formatInteger(analysis.runningJobs)],
          ]}
        />
        <Competitors analysis={analysis} />
      </aside>
    </div>
  );
}

export { PriorityAnalysis };
