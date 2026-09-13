import type {
  PartitionAnalysisDto,
  RequiredNodesAnalysisDto,
  ReservationAnalysisDto,
} from "../../../../shared/api/v1/pending-analysis.ts";
import type { JobDto } from "../../../../shared/api/v1/jobs.ts";
import { CopyButton } from "../CopyButton.tsx";
import {
  formatDateTime,
  formatDuration,
  formatInteger,
} from "./analysis-formatting.ts";
function RequiredNodesAnalysis({
  analysis,
}: {
  analysis: RequiredNodesAnalysisDto;
}) {
  if (analysis.expression === null)
    return (
      <p className="text-sm text-gray-600">
        No requested-node expression was provided for this snapshot.
      </p>
    );
  return (
    <div>
      <h3 className="font-semibold">Requested nodes</h3>
      <p className="mt-2 break-all font-mono text-sm">
        {analysis.expression}
        <CopyButton value={analysis.expression} label="Copy requested nodes" />
      </p>
      {analysis.nodes.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Node</th>
                <th>State</th>
                <th>Slurm node reason</th>
              </tr>
            </thead>
            <tbody>
              {analysis.nodes.map((n) => (
                <tr key={n.name}>
                  <td className="break-all font-mono">{n.name}</td>
                  <td>{n.state ?? "Unknown"}</td>
                  <td>{n.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-600">
          No required-node details were returned.
        </p>
      )}
    </div>
  );
}
function PartitionAnalysis({
  analysis,
  job,
}: {
  analysis: PartitionAnalysisDto;
  job: JobDto;
}) {
  const requestedNodes = job.requested.nodes ?? job.nodeCount;
  const finiteLimit = job.timeLimit?.kind === "finite" ? job.timeLimit : null;
  const timeExceeded =
    finiteLimit !== null &&
    analysis.maxTimeSeconds !== null &&
    finiteLimit.seconds > analysis.maxTimeSeconds;
  const nodeExceeded =
    requestedNodes !== null &&
    analysis.maxNodes !== null &&
    requestedNodes > analysis.maxNodes;
  return (
    <div>
      <h3 className="font-semibold">Partition: {analysis.partition}</h3>
      <p className="mt-2 text-sm">State: {analysis.state ?? "Unknown"}</p>
      {timeExceeded && finiteLimit !== null ? (
        <p className="mt-2 text-sm text-red-700">
          Requested time exceeds partition maximum (
          {formatDuration(finiteLimit.seconds)} /{" "}
          {formatDuration(analysis.maxTimeSeconds!)})
        </p>
      ) : null}
      {nodeExceeded ? (
        <p className="mt-2 text-sm text-red-700">
          Requested nodes exceed partition maximum (
          {formatInteger(requestedNodes)} / {formatInteger(analysis.maxNodes)})
        </p>
      ) : null}
      <p className="mt-2 text-sm text-gray-600">
        Maximum time:{" "}
        {analysis.maxTimeSeconds === null
          ? "Unknown"
          : formatDuration(analysis.maxTimeSeconds)}{" "}
        · Maximum nodes: {formatInteger(analysis.maxNodes)} · Total nodes:{" "}
        {formatInteger(analysis.totalNodes)}
      </p>
    </div>
  );
}
function ReservationAnalysis({
  analysis,
  updatedAt,
}: {
  analysis: ReservationAnalysisDto;
  updatedAt: string;
}) {
  const start =
    analysis.startTime === null ? NaN : Date.parse(analysis.startTime);
  const end = analysis.endTime === null ? NaN : Date.parse(analysis.endTime);
  const at = Date.parse(updatedAt);
  const phase =
    !Number.isNaN(start) && !Number.isNaN(end) && !Number.isNaN(at)
      ? at < start
        ? "Future"
        : at > end
          ? "Expired"
          : "Current"
      : null;
  return (
    <div>
      <h3 className="font-semibold">
        Reservation: {analysis.name ?? "Unknown"}
      </h3>
      <p className="mt-2 text-sm">
        State: {analysis.state ?? "Unknown"} · Start:{" "}
        {formatDateTime(analysis.startTime)} · End:{" "}
        {formatDateTime(analysis.endTime)}
      </p>
      {phase ? (
        <p className="mt-3 text-sm font-medium">{phase} reservation window</p>
      ) : null}
    </div>
  );
}
export { PartitionAnalysis, RequiredNodesAnalysis, ReservationAnalysis };
