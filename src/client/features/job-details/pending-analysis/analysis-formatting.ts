import {
  MISSING,
  formatDateTime,
  formatDuration,
  formatMemoryMiB,
} from "../../jobs/formatting.ts";
import type {
  LimitMetric,
  ResourceShortageDto,
} from "../../../../shared/api/v1/pending-analysis.ts";

const integer = new Intl.NumberFormat();
function formatInteger(value: number | null | undefined): string {
  return value == null ? MISSING : integer.format(value);
}
function formatPriorityValue(value: number | null): string {
  if (value === null) return MISSING;
  if (Number.isInteger(value)) return integer.format(value);
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function formatPriorityContribution(value: number | null): string {
  return formatPriorityValue(value);
}

function formatNormalizedFactor(value: number | null): string {
  return formatPriorityValue(value);
}

function formatPriorityWeight(value: number | null): string {
  return formatPriorityValue(value);
}
function metricLabel(metric: LimitMetric, gpuType?: string): string {
  if (metric === "memoryMiB") return "memory";
  if (metric === "cpuMinutes") return "CPU-minutes";
  if (metric === "memoryMiBMinutes") return "memory MiB-minutes";
  if (metric === "gpus") return gpuType ? `${gpuType} GPU(s)` : "GPU(s)";
  return metric === "cpus" ? "CPU(s)" : `${metric.replace(/s$/, "")}(s)`;
}
function formatMetric(
  metric: LimitMetric,
  value: number | null,
  gpuType?: string,
): string {
  if (value === null) return "Unknown";
  if (metric === "memoryMiB") return formatMemoryMiB(value);
  if (metric === "cpuMinutes") return `${formatInteger(value)} CPU-minutes`;
  if (metric === "memoryMiBMinutes")
    return `${formatInteger(value)} MiB-minutes`;
  return `${formatInteger(value)}${metric === "gpus" && gpuType ? ` ${gpuType}` : ""}`;
}
function shortageText(item: ResourceShortageDto): string {
  const name =
    item.resource === "cpus"
      ? "CPU"
      : item.resource === "memoryMiB"
        ? "Memory"
        : item.gpuType
          ? `${item.gpuType} GPU`
          : "GPU";
  const value = (n: number) =>
    item.resource === "memoryMiB" ? formatMemoryMiB(n) : formatInteger(n);
  return `${name}: need ${value(item.requested)}, unallocated ${value(item.currentlyUnallocated)}`;
}
function statusText(
  status:
    "satisfied" | "unsatisfied" | "unknown" | "sufficient" | "insufficient",
): string {
  return status === "satisfied"
    ? "Satisfied"
    : status === "unsatisfied"
      ? "Waiting"
      : status === "sufficient"
        ? "No analyzed shortage"
        : status === "insufficient"
          ? "Shortage found"
          : "Unknown";
}
export {
  MISSING,
  formatDateTime,
  formatDuration,
  formatNormalizedFactor,
  formatInteger,
  formatMetric,
  formatPriorityContribution,
  formatPriorityWeight,
  metricLabel,
  shortageText,
  statusText,
};
