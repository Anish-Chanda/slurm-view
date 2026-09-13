import type { ResourcesAnalysisDto } from "../../../../shared/api/v1/pending-analysis.ts";
import {
  AnalysisMetricList,
  EvidenceDisclosure,
  EVIDENCE_TABLE,
  EVIDENCE_TABLE_HEAD,
  EVIDENCE_TABLE_ROW,
  EVIDENCE_TABLE_WRAPPER,
} from "./AnalysisShell.tsx";
import { formatInteger, shortageText } from "./analysis-formatting.ts";

function resourceLabel(
  resource: ResourcesAnalysisDto["bottlenecks"][number],
): string {
  if (resource.gpuType) return `${resource.gpuType} GPU`;
  if (resource.resource === "memoryMiB") return "Memory";
  return resource.resource === "cpus" ? "CPU" : "GPU";
}

function resultLabel(status: ResourcesAnalysisDto["nodes"][number]["status"]) {
  if (status === "insufficient")
    return (
      <span className="text-amber-800">
        <span aria-hidden="true">● </span>Shortage
      </span>
    );
  if (status === "sufficient")
    return (
      <span className="text-slate-600">
        <span aria-hidden="true">○ </span>No analyzed shortage
      </span>
    );
  return (
    <span className="text-gray-600">
      <span aria-hidden="true">? </span>Unknown
    </span>
  );
}

function NodeRows({ nodes }: Pick<ResourcesAnalysisDto, "nodes">) {
  return (
    <>
      {nodes.map((node) => (
        <tr key={node.name} className={EVIDENCE_TABLE_ROW}>
          <td className="break-all px-3 py-2.5 font-mono font-medium text-gray-900">
            {node.name}
          </td>
          <td className="px-3 py-2.5 text-gray-600">
            {node.state ?? "Unknown"}
          </td>
          <td className="px-3 py-2.5 font-medium">
            {resultLabel(node.status)}
          </td>
          <td className="px-3 py-2.5 text-gray-700">
            {node.shortages.map(shortageText).join("; ") || "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

function NodeTable({ nodes }: Pick<ResourcesAnalysisDto, "nodes">) {
  return (
    <div className={EVIDENCE_TABLE_WRAPPER}>
      <table className={`${EVIDENCE_TABLE} min-w-[680px]`}>
        <thead className={EVIDENCE_TABLE_HEAD}>
          <tr>
            <th scope="col" className="px-3 py-2.5">
              Node
            </th>
            <th scope="col" className="px-3 py-2.5">
              State
            </th>
            <th scope="col" className="px-3 py-2.5">
              Result
            </th>
            <th scope="col" className="px-3 py-2.5">
              Shortage
            </th>
          </tr>
        </thead>
        <tbody>
          <NodeRows nodes={nodes} />
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
  const scope =
    analysis.scope === "partition" && partition
      ? `${formatInteger(analysis.analyzedNodes)} nodes analyzed in ${partition}`
      : `${formatInteger(analysis.analyzedNodes)} ${analysis.scope === "scheduledNodes" ? "scheduled" : "requested"} nodes analyzed`;
  const visibleNodes = analysis.nodes.slice(0, 8);
  const remainingNodes = analysis.nodes.length - visibleNodes.length;
  return (
    <div>
      <p className="text-sm text-gray-600">{scope}</p>
      <div className="mt-4 border-y border-gray-200 py-4">
        <AnalysisMetricList
          prominent
          items={[
            ["Shortage found", formatInteger(analysis.insufficientNodes)],
            ["No analyzed shortage", formatInteger(analysis.sufficientNodes)],
            ["Unknown", formatInteger(analysis.unknownNodes)],
          ]}
        />
      </div>
      {analysis.bottlenecks.length ? (
        <section className="mt-5" aria-labelledby="common-shortages">
          <h3
            id="common-shortages"
            className="text-sm font-semibold text-gray-900"
          >
            Most common shortages
          </h3>
          <div className="mt-3 space-y-3">
            {analysis.bottlenecks.map((bottleneck) => (
              <div
                key={`${bottleneck.resource}-${bottleneck.gpuType}`}
                className="text-sm"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium text-gray-800">
                    {resourceLabel(bottleneck)}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-600">
                    {bottleneck.nodes} of {analysis.analyzedNodes}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-amber-100">
                  <div
                    className="h-2 rounded-full bg-amber-500"
                    style={{
                      width: `${analysis.analyzedNodes ? (bottleneck.nodes / analysis.analyzedNodes) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A node may have more than one shortage; these counts can overlap.
          </p>
        </section>
      ) : null}
      <section className="mt-6" aria-labelledby="node-evidence">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3
            id="node-evidence"
            className="text-sm font-semibold text-gray-900"
          >
            Node evidence
          </h3>
          {analysis.nodes.length ? (
            <p className="text-xs text-gray-500">
              Showing {visibleNodes.length} of {analysis.nodes.length} detailed
              nodes
              {analysis.analyzedNodes > analysis.nodes.length
                ? ` · ${analysis.analyzedNodes} nodes were included in the summary`
                : ""}
            </p>
          ) : null}
        </div>
        {analysis.nodes.length ? (
          <>
            <div className="mt-3">
              <NodeTable nodes={visibleNodes} />
            </div>
            {remainingNodes ? (
              <EvidenceDisclosure
                label={`Show ${remainingNodes} more detailed nodes`}
              >
                <NodeTable nodes={analysis.nodes.slice(8)} />
              </EvidenceDisclosure>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            No per-node evidence was returned for this snapshot.
          </p>
        )}
      </section>
    </div>
  );
}

export { ResourcesAnalysis };
