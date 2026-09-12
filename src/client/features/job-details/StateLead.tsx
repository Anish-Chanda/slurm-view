import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { PENDING_REASON_SCOPE_NOTE, describePendingReason } from './pending-reasons.ts';

// State-specific lead directly under the overview. PENDING owns the Slurm
// reason here (Scheduling does not repeat it); the overview already states
// how long the job has waited, so the lead focuses on the reason itself.
// Active jobs surface the COMPLETING distinction; terminal states need no
// lead beyond the outcome already stated in the overview.
function PendingLead({ job }: { job: JobDto }) {
  const label = job.stateReason !== null ? describePendingReason(job.stateReason) : null;
  return (
    <section id="why-waiting" aria-label="Why it is waiting" className="border border-gray-200 border-l-4 border-l-amber-400 bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-gray-900">
        {label ?? 'Waiting'}
      </h2>
      {job.stateReason !== null ? (
        <p className="mt-1 text-sm text-gray-600">
          Slurm reason: <span className="font-mono text-gray-900">{job.stateReason}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-gray-600">Slurm has not provided a reason for this wait yet.</p>
      )}
      <p className="mt-1 text-xs text-gray-500">{PENDING_REASON_SCOPE_NOTE}</p>
    </section>
  );
}

function StateLead({ job }: { job: JobDto }) {
  switch (job.state) {
    case 'PENDING':
      return (
        <div className="mt-4">
          <PendingLead job={job} />
        </div>
      );
    case 'RUNNING':
    case 'SUSPENDED':
      return job.stateFlags.includes('COMPLETING') ? (
        <p className="mt-4 border border-gray-200 border-l-4 border-l-blue-400 bg-white px-4 py-3 text-sm text-gray-700" role="note">
          Completing — Slurm reports this job is in the process of completing.
        </p>
      ) : null;
    default:
      return null;
  }
}

export { StateLead };
