import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { ApiError, errorMessage } from '../../api/client.ts';
import { jobDetailQueryOptions } from '../../api/job-details.ts';
import { ErrorPanel } from '../../components/ErrorPanel.tsx';
import { Navbar } from '../../components/Navbar.tsx';
import { RefreshWarning } from '../../components/RefreshWarning.tsx';
import { Execution } from './Execution.tsx';
import { BackToJobs, JobHeader } from './JobHeader.tsx';
import { Resources } from './Resources.tsx';
import { ResourceUsage } from './ResourceUsage.tsx';
import { StateLead } from './StateLead.tsx';
import { PendingAnalysis } from './PendingAnalysis.tsx';
import { TimingScheduling } from './TimingScheduling.tsx';

function JobPageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <Navbar />
      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}

function JobNotAvailable({ jobId }: { jobId: string }) {
  return (
    <JobPageLayout>
      <BackToJobs />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-gray-900">
        Job {jobId} is no longer available
      </h1>
      <p className="mt-2 max-w-prose text-sm text-gray-600">
        Slurm no longer has this job in the live scheduler data available to Slurm View.
        Historical accounting is not queried yet.
      </p>
    </JobPageLayout>
  );
}

function JobSkeleton() {
  return (
    <JobPageLayout>
      <div aria-busy="true" aria-label="Loading job details">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 h-8 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-gray-200" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="mt-6 border-t border-gray-200 pt-6">
            <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
            <div className="mt-3 h-4 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </JobPageLayout>
  );
}

function JobDetailsContent({ job, updatedAt }: { job: JobDto; updatedAt: string }) {
  // All lifecycle arithmetic describes the captured snapshot, never the
  // wall clock: a tab left open for hours must not invent newer job state
  // than the scheduler data actually represents.
  const parsed = Date.parse(updatedAt);
  const snapshotMs = Number.isNaN(parsed) ? Date.now() : parsed;
  const snapshotTaken = new Date(updatedAt).toLocaleString();
  return (
    <>
      <JobHeader job={job} snapshotMs={snapshotMs} snapshotTaken={snapshotTaken} />
      {job.state === 'PENDING' ? <PendingAnalysis job={job} /> : null}
      <StateLead job={job} />
      <div className="mt-8 grid grid-cols-12 gap-x-10 gap-y-10">
        <div className="col-span-12 space-y-10 xl:col-span-7">
          <Resources job={job} />
          {job.state === 'COMPLETED' ? <ResourceUsage jobId={job.id} /> : null}
        </div>
        <div className="col-span-12 xl:col-span-5">
          <TimingScheduling job={job} snapshotMs={snapshotMs} />
        </div>
        <div className="col-span-12">
          <Execution job={job} />
        </div>
      </div>
    </>
  );
}

function JobPage({ jobId }: { jobId: string }) {
  const detailQuery = useQuery(jobDetailQueryOptions(jobId));

  // No snapshot yet: loading, initial 404, or a hard failure.
  if (detailQuery.data === undefined) {
    if (detailQuery.isPending) {
      return <JobSkeleton />;
    }
    if (detailQuery.error instanceof ApiError && detailQuery.error.status === 404) {
      return <JobNotAvailable jobId={jobId} />;
    }
    return (
      <JobPageLayout>
        <BackToJobs />
        <div className="mt-4">
          <ErrorPanel message={errorMessage(detailQuery.error)} onRetry={() => void detailQuery.refetch()} />
        </div>
      </JobPageLayout>
    );
  }

  // A captured snapshot survives any later refresh failure — including a
  // 404 when the job leaves the live data. The failure surfaces as a
  // non-destructive warning, never by replacing the page.
  const { job, updatedAt } = detailQuery.data;
  return (
    <JobPageLayout>
      <JobDetailsContent job={job} updatedAt={updatedAt} />
      {detailQuery.isError ? (
        <div className="mt-6">
          <RefreshWarning
            message="Showing the captured snapshot because the latest request failed."
            onRetry={() => void detailQuery.refetch()}
          />
        </div>
      ) : null}
    </JobPageLayout>
  );
}

export { JobNotAvailable, JobPage, JobSkeleton };
