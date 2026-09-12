import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { CopyButton } from './CopyButton.tsx';
import { DetailList, DetailRow, DetailSection } from './DetailList.tsx';

function Execution({ job }: { job: JobDto }) {
  const hasExecution =
    job.nodeExpression !== null ||
    job.command !== null ||
    job.workdir !== null ||
    job.stdoutPath !== null ||
    job.stderrPath !== null ||
    job.exitCode !== null ||
    job.derivedExitCode !== null;
  if (!hasExecution) {
    return null;
  }
  return (
    <DetailSection id="execution" title="Execution">
      <DetailList>
        {job.nodeExpression !== null ? (
          <DetailRow label="Nodes" mono>
            {job.nodeExpression}
            <CopyButton value={job.nodeExpression} label="Copy node list" />
          </DetailRow>
        ) : null}
        {job.command !== null ? (
          <DetailRow label="Command" mono>
            {job.command}
            <CopyButton value={job.command} label="Copy command" />
          </DetailRow>
        ) : null}
        {job.workdir !== null ? (
          <DetailRow label="Working directory" mono>
            {job.workdir}
            <CopyButton value={job.workdir} label="Copy working directory" />
          </DetailRow>
        ) : null}
        {job.stdoutPath !== null ? (
          <DetailRow label="Stdout" mono>
            {job.stdoutPath}
            <CopyButton value={job.stdoutPath} label="Copy stdout path" />
          </DetailRow>
        ) : null}
        {job.stderrPath !== null ? (
          <DetailRow label="Stderr" mono>
            {job.stderrPath}
            <CopyButton value={job.stderrPath} label="Copy stderr path" />
          </DetailRow>
        ) : null}
        {job.exitCode !== null ? <DetailRow label="Exit code">{job.exitCode}</DetailRow> : null}
        {job.derivedExitCode !== null && job.derivedExitCode !== job.exitCode ? (
          <DetailRow label="Derived exit code">{job.derivedExitCode}</DetailRow>
        ) : null}
      </DetailList>
    </DetailSection>
  );
}

export { Execution };
