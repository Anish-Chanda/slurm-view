import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { CopyButton } from './CopyButton.tsx';
import { isTerminalState } from './lifecycle.ts';

function CodeField({
  id,
  label,
  value,
  copyLabel,
}: {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div id={id}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-500">{label}</h3>
        <CopyButton value={value} label={copyLabel} />
      </div>
      <p className="mt-1 overflow-x-auto whitespace-pre-wrap break-all border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[13px] leading-relaxed text-gray-900">
        {value}
      </p>
    </div>
  );
}

function Execution({ job }: { job: JobDto }) {
  // Exit results are only meaningful once the scheduler is done with the
  // job; active jobs can carry a raw "0" that must never read as an outcome.
  const showExit = isTerminalState(job.state);
  const exitCode = showExit ? job.exitCode : null;
  const derivedExitCode = showExit ? job.derivedExitCode : null;
  const hasExecution =
    job.command !== null ||
    job.workdir !== null ||
    job.stdoutPath !== null ||
    job.stderrPath !== null ||
    job.batchHost !== null ||
    exitCode !== null ||
    (derivedExitCode !== null && derivedExitCode !== exitCode);
  if (!hasExecution) {
    return null;
  }
  return (
    <section id="execution" aria-label="Execution">
      <h2 className="text-base font-semibold tracking-tight text-gray-900">Execution</h2>
      <div className="mt-3 space-y-4">
        {job.command !== null ? (
          <CodeField id="execution-command" label="Command" value={job.command} copyLabel="Copy command" />
        ) : null}
        {job.workdir !== null ? (
          <CodeField
            id="execution-workdir"
            label="Working directory"
            value={job.workdir}
            copyLabel="Copy working directory"
          />
        ) : null}
        {/* Stdout/stderr keep their plain labels for every value: they name
            Slurm's configured values, which may still carry substitution
            syntax (xtb_6_%A_%a.out) or literal percent characters. A bare
            '%' never proves a pattern, so no pattern labeling is attempted. */}
        {job.stdoutPath !== null ? (
          <CodeField
            id="execution-stdout"
            label="Stdout"
            value={job.stdoutPath}
            copyLabel="Copy stdout path"
          />
        ) : null}
        {job.stderrPath !== null ? (
          <CodeField
            id="execution-stderr"
            label="Stderr"
            value={job.stderrPath}
            copyLabel="Copy stderr path"
          />
        ) : null}
        <dl className="grid gap-x-10 gap-y-1 text-sm sm:grid-cols-2">
          {job.batchHost !== null ? (
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-gray-500">Batch host</dt>
              <dd className="break-all font-mono text-gray-900">{job.batchHost}</dd>
            </div>
          ) : null}
          {exitCode !== null ? (
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-gray-500">Exit code</dt>
              <dd className="font-mono text-gray-900">{exitCode}</dd>
            </div>
          ) : null}
          {derivedExitCode !== null && derivedExitCode !== exitCode ? (
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-gray-500">Derived exit code</dt>
              <dd className="font-mono text-gray-900">{derivedExitCode}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}

export { Execution };
