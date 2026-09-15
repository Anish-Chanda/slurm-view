import type {
  DependencyAnalysisDto,
  DependencyTargetDto,
} from "../../../../shared/api/v1/pending-analysis.ts";
import { CopyButton } from "../CopyButton.tsx";
import { EvidenceDisclosure, JobLink } from "./AnalysisShell.tsx";
import { statusText } from "./analysis-formatting.ts";

const names: Record<string, string> = {
  after: "After",
  afterany: "After any",
  afterok: "After successful completion",
  afternotok: "After unsuccessful completion",
  aftercorr: "After corresponding array task",
  singleton: "Singleton",
};
const TARGETS_BEFORE_DISCLOSURE = 10;

function Target({ target }: { target: DependencyTargetDto }) {
  return (
    <li>
      <JobLink id={target.jobId} /> · {target.state ?? "Unknown"}
      {target.exitCode !== null ? ` · exit ${target.exitCode}` : ""}
      {target.delayMinutes !== undefined
        ? ` · delay ${target.delayMinutes}m`
        : ""}
      {target.arrayWildcard ? " · Entire array" : ""} ·{" "}
      {statusText(target.status)}
    </li>
  );
}

function Clause({
  clause,
}: {
  clause: DependencyAnalysisDto["dependencies"][number];
}) {
  const visible = clause.jobs.slice(0, TARGETS_BEFORE_DISCLOSURE);
  const remaining = clause.jobs.slice(TARGETS_BEFORE_DISCLOSURE);
  return (
    <li className="border-b border-gray-100 py-3">
      <p className="font-medium">
        {names[clause.type] ?? clause.type} · {statusText(clause.status)}
      </p>
      <ul className="mt-1 text-sm text-gray-600">
        {visible.map((target) => (
          <Target key={target.jobId} target={target} />
        ))}
      </ul>
      {remaining.length ? (
        <EvidenceDisclosure
          label={`Show ${remaining.length} more dependency targets`}
        >
          <ul className="text-sm text-gray-600">
            {remaining.map((target) => (
              <Target key={target.jobId} target={target} />
            ))}
          </ul>
        </EvidenceDisclosure>
      ) : null}
    </li>
  );
}

function DependencyAnalysis({
  analysis,
  neverSatisfied,
}: {
  analysis: DependencyAnalysisDto;
  neverSatisfied: boolean;
}) {
  const statement =
    analysis.operator === "and"
      ? "All dependency conditions must be satisfied."
      : analysis.operator === "or"
        ? "At least one dependency condition must be satisfied."
        : "This dependency condition must be satisfied.";
  const visible = analysis.dependencies.slice(0, 10);
  const remaining = analysis.dependencies.slice(10);
  return (
    <div>
      <h3 className="font-semibold">Dependency evidence</h3>
      {neverSatisfied ? (
        <p className="mt-2 text-sm text-red-700">
          Slurm reports that this dependency can never be satisfied.
        </p>
      ) : null}
      <p className="mt-2 text-sm text-gray-600">{statement}</p>
      <ul className="mt-2">
        {visible.map((clause, index) => (
          <Clause key={index} clause={clause} />
        ))}
      </ul>
      {remaining.length ? (
        <EvidenceDisclosure label="Show all dependency conditions">
          <ul>
            {remaining.map((clause, index) => (
              <Clause key={index} clause={clause} />
            ))}
          </ul>
        </EvidenceDisclosure>
      ) : null}
      <div className="mt-3">
        <p className="text-sm font-medium">
          Dependency expression{" "}
          <CopyButton
            value={analysis.expression}
            label="Copy dependency expression"
          />
        </p>
        <code className="mt-1 block break-all bg-gray-50 p-2 text-xs">
          {analysis.expression}
        </code>
      </div>
    </div>
  );
}

export { DependencyAnalysis };
