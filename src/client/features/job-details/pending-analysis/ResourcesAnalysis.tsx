import type { ResourcesAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import { EvidenceDisclosure, AnalysisMetricList } from "./AnalysisShell.tsx";
import {
  formatInteger,
  shortageText,
  statusText,
} from "./analysis-formatting.ts";
function Rows({ nodes }: Pick<ResourcesAnalysisDto, "nodes">) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 text-gray-500">
          <tr>
            <th scope="col">Node</th>
            <th scope="col">State</th>
            <th scope="col">Result</th>
            <th scope="col">Shortage</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.name} className="border-b border-gray-100">
              <td className="break-all py-2 font-mono">{n.name}</td>
              <td>{n.state ?? "Unknown"}</td>
              <td>{statusText(n.status)}</td>
              <td>{n.shortages.map(shortageText).join("; ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ResourcesAnalysis({
  analysis,
  partition,
}: {
  analysis: ResourcesAnalysisDto;
  partition?: string;
}) {
  const label =
    analysis.scope === "partition" && partition
      ? `${formatInteger(analysis.analyzedNodes)} nodes analyzed in ${partition}`
      : `${formatInteger(analysis.analyzedNodes)} ${analysis.scope === "scheduledNodes" ? "scheduled" : "requested"} nodes analyzed`;
  const first = analysis.nodes.slice(0, 8);
  const remaining = analysis.nodes.length - first.length;
  return (
    <div>
      <h3 className="font-semibold text-gray-900">Resource evidence</h3>
      <p className="mt-1 text-sm text-gray-600">{label}</p>
      <div className="mt-3 border-y border-gray-200 py-3">
        <AnalysisMetricList
          items={[
            ["Shortage found", formatInteger(analysis.insufficientNodes)],
            ["No analyzed shortage", formatInteger(analysis.sufficientNodes)],
            ["Unknown", formatInteger(analysis.unknownNodes)],
          ]}
        />
      </div>
      {analysis.bottlenecks.length ? (
        <div className="mt-4">
          <h4 className="font-medium">Most common shortages</h4>
          {analysis.bottlenecks.map((b) => (
            <div
              key={`${b.resource}-${b.gpuType}`}
              className="mt-2 grid grid-cols-[1fr_auto] gap-2 text-sm"
            >
              <span>
                {b.gpuType
                  ? `${b.gpuType} GPU`
                  : b.resource === "memoryMiB"
                    ? "Memory"
                    : b.resource === "cpus"
                      ? "CPU"
                      : "GPU"}
                <span className="ml-2 text-gray-500">
                  {b.nodes} of {analysis.analyzedNodes}
                </span>
              </span>
              <span>{b.nodes}</span>
              <div className="col-span-2 h-2 bg-gray-100">
                <div
                  className="h-2 bg-red-600"
                  style={{
                    width: `${analysis.analyzedNodes ? (b.nodes / analysis.analyzedNodes) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          <p className="mt-2 text-xs text-gray-500">
            A node may have more than one shortage; these counts can overlap.
          </p>
        </div>
      ) : null}
      <div className="mt-4">
        <h4 className="font-medium">Node evidence</h4>
        {analysis.nodes.length ? (
          <>
            <div className="mt-2">
              <Rows nodes={first} />
            </div>
            {remaining > 0 ? (
              <EvidenceDisclosure
                label={`Show ${remaining} more detailed nodes`}
              >
                <Rows nodes={analysis.nodes.slice(8)} />
              </EvidenceDisclosure>
            ) : null}
            {analysis.analyzedNodes > analysis.nodes.length ? (
              <p className="mt-2 text-xs text-gray-500">
                Showing {analysis.nodes.length} detailed nodes of{" "}
                {analysis.analyzedNodes} analyzed; the summary covers all
                analyzed nodes.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            No per-node evidence was returned for this snapshot.
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Current resource fit is evidence, not a scheduler eligibility decision.
      </p>
    </div>
  );
}
export { ResourcesAnalysis };
