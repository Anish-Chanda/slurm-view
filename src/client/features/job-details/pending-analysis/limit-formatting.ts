import type {
  LimitMetric,
  ResourceKind,
} from "../../../../shared/api/v1/pending-analysis.ts";
import { formatInteger, formatMetric } from "./analysis-formatting.ts";

function metricName(metric: LimitMetric, gpuType?: string): string {
  if (metric === "gpus") return gpuType ? `${gpuType} GPU` : "GPU";
  if (metric === "cpus") return "CPU";
  if (metric === "memoryMiB") return "Memory";
  if (metric === "nodes") return "Node";
  if (metric === "jobs") return "Job";
  if (metric === "cpuMinutes") return "CPU-minutes";
  if (metric === "memoryMiBMinutes") return "Memory GiB-minutes";
  return gpuType ? `${gpuType} GPU-minutes` : "GPU-minutes";
}

function metricQuantity(
  metric: LimitMetric,
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

function resourceLabel(resource: ResourceKind): string {
  return resource === "cpus"
    ? "CPU"
    : resource === "memoryMiB"
      ? "Memory"
      : "GPU";
}

export { metricName, metricQuantity, resourceLabel };
