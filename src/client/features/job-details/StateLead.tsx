import type { JobDto } from '../../../shared/api/v1/jobs.ts';
function StateLead({ job }: { job: JobDto }) {
  switch (job.state) {
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
