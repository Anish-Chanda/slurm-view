import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  PENDING_REASON_SCOPE_NOTE,
  describePendingReason,
} from "../pending-reasons.ts";
import { formatDateTime } from "./analysis-formatting.ts";

function JobLink({ id }: { id: string }) {
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: id }}
      className="font-mono text-blue-700 underline hover:text-blue-900"
    >
      {id}
    </Link>
  );
}

const EVIDENCE_TABLE_WRAPPER =
  "overflow-x-auto rounded-sm border border-gray-200";
const EVIDENCE_TABLE = "w-full text-left text-sm";
const EVIDENCE_TABLE_HEAD =
  "bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500";
const EVIDENCE_TABLE_ROW =
  "border-t border-gray-100 transition-colors hover:bg-gray-50/70";

function AnalysisMetricList({
  items,
  prominent = false,
  layout = "three-column",
}: {
  items: Array<[string, ReactNode]>;
  prominent?: boolean;
  layout?: "three-column" | "stacked";
}) {
  return (
    <dl
      className={
        layout === "stacked"
          ? "grid gap-y-4 text-sm"
          : "grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3"
      }
    >
      {items.map(([label, value]) => (
        <div key={label} className={prominent ? "flex flex-col" : undefined}>
          <dt className="text-gray-500">{label}</dt>
          <dd
            className={
              prominent
                ? "order-first text-xl font-semibold tabular-nums text-gray-900"
                : "font-medium tabular-nums text-gray-900"
            }
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EvidenceDisclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-blue-700">
        {label}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function AnalysisShell({
  reason,
  updatedAt,
  children,
  footerNote,
}: {
  reason: string | null;
  updatedAt: string;
  children: ReactNode;
  footerNote?: string;
}) {
  const description = reason === null ? null : describePendingReason(reason);
  return (
    <section
      id="why-waiting"
      aria-labelledby="why-waiting-title"
      className="mt-6 border border-gray-200 border-l-4 border-l-amber-400 bg-white px-4 py-4 sm:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-amber-700">
            WHY THIS JOB IS WAITING
          </p>
          <h2
            id="why-waiting-title"
            className="mt-1 text-lg font-semibold text-gray-900"
          >
            {description ?? "Waiting"}
          </h2>
        </div>
        <p className="font-mono text-xs text-gray-600">
          Slurm: {reason ?? "—"}
        </p>
      </div>
      <div className="mt-5 border-t border-gray-200 pt-5">{children}</div>
      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
        <span>
          Analyzed {formatDateTime(updatedAt)} · Based on current scheduler
          state
        </span>
        {footerNote ? <span>· {footerNote}</span> : null}
        <span
          title={PENDING_REASON_SCOPE_NOTE}
          aria-label={PENDING_REASON_SCOPE_NOTE}
          className="cursor-help text-gray-400"
        >
          ⓘ
        </span>
      </div>
    </section>
  );
}

function AnalysisSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading pending analysis"
      className="mt-6 min-h-48 border border-gray-200 border-l-4 border-l-amber-300 bg-white p-5"
    >
      <div className="h-3 w-40 animate-pulse bg-gray-200 motion-reduce:animate-none" />
      <div className="mt-3 h-6 w-72 animate-pulse bg-gray-200 motion-reduce:animate-none" />
      <div className="mt-6 h-16 animate-pulse bg-gray-100 motion-reduce:animate-none" />
    </section>
  );
}

function SimpleReasonAnalysis() {
  return (
    <p className="text-sm text-gray-600">
      No additional analysis was available for this snapshot.
    </p>
  );
}

export {
  AnalysisMetricList,
  AnalysisShell,
  AnalysisSkeleton,
  EvidenceDisclosure,
  EVIDENCE_TABLE,
  EVIDENCE_TABLE_HEAD,
  EVIDENCE_TABLE_ROW,
  EVIDENCE_TABLE_WRAPPER,
  JobLink,
  SimpleReasonAnalysis,
};
