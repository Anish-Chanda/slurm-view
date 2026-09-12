import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { DetailList, DetailRow } from './DetailList.tsx';

function TechnicalDetails({ job }: { job: JobDto }) {
  const [open, setOpen] = useState(false);
  const hasTechnical =
    job.arrayJobId !== null ||
    job.arrayTaskId !== null ||
    job.stateFlags.length > 0 ||
    job.flags.length > 0 ||
    job.wckey !== null ||
    job.batchHost !== null;
  if (!hasTechnical) {
    return null;
  }
  return (
    <section id="technical-details" aria-label="Technical details" className="border-t border-gray-200 py-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="technical-details-body"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 text-lg font-semibold tracking-tight text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        Technical details
        <ChevronDown
          className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div id="technical-details-body" className="mt-3">
          <DetailList>
            {job.arrayJobId !== null ? (
              <DetailRow label="Array job ID">{job.arrayJobId}</DetailRow>
            ) : null}
            {job.arrayTaskId !== null ? (
              <DetailRow label="Array task ID">{job.arrayTaskId}</DetailRow>
            ) : null}
            {job.stateFlags.length > 0 ? (
              <DetailRow label="State flags">{job.stateFlags.join(', ')}</DetailRow>
            ) : null}
            {job.flags.length > 0 ? <DetailRow label="Flags">{job.flags.join(', ')}</DetailRow> : null}
            {job.wckey !== null ? <DetailRow label="WCKey">{job.wckey}</DetailRow> : null}
            {job.batchHost !== null ? (
              <DetailRow label="Batch host" mono>
                {job.batchHost}
              </DetailRow>
            ) : null}
          </DetailList>
        </div>
      ) : null}
    </section>
  );
}

export { TechnicalDetails };
