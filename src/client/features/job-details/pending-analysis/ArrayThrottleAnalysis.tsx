import type { ArrayThrottleAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import { formatInteger } from "./analysis-formatting.ts";
function ArrayThrottleAnalysis({
  analysis,
}: {
  analysis: ArrayThrottleAnalysisDto;
}) {
  if (analysis.maxRunningTasks === null)
    return (
      <p className="text-sm text-gray-600">
        The scheduler reported this reason; no concurrency limit was available.
      </p>
    );
  if (analysis.runningTasks === null)
    return (
      <div>
        <p className="text-sm">
          Concurrency limit: {formatInteger(analysis.maxRunningTasks)} tasks
        </p>
        <p className="text-sm text-gray-600">Currently running: Unknown</p>
      </div>
    );
  const pct = analysis.maxRunningTasks
    ? Math.min(100, (analysis.runningTasks / analysis.maxRunningTasks) * 100)
    : 0;
  return (
    <div>
      <p className="text-sm">
        {analysis.runningTasks} of {analysis.maxRunningTasks} concurrent task
        slots are currently running
      </p>
      <div aria-hidden="true" className="mt-3 h-3 bg-gray-100">
        <div className="h-3 bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {analysis.runningTasks} / {analysis.maxRunningTasks}
      </p>
    </div>
  );
}
export { ArrayThrottleAnalysis };
