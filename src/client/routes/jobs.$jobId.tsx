import { createFileRoute, notFound } from '@tanstack/react-router';
import { CANONICAL_JOB_ID_PATTERN } from '../../shared/api/v1/jobs.ts';
import { prepareJobVisitSnapshot } from '../api/job-details.ts';
import { preparePendingAnalysisRouteLoad } from '../api/pending-analysis.ts';
import { JobPage } from '../features/job-details/JobPage.tsx';

export const Route = createFileRoute('/jobs/$jobId')({
  loader: ({ context, params, preload }) => {
    if (!CANONICAL_JOB_ID_PATTERN.test(params.jobId)) {
      throw notFound();
    }
    prepareJobVisitSnapshot(context.queryClient, params.jobId);
    // Intent preloads are speculative. They must not clear a diagnostic that
    // belongs to the page currently being read; a real route visit creates the
    // fresh auxiliary snapshot instead.
    preparePendingAnalysisRouteLoad(context.queryClient, params.jobId, preload);
  },
  component: JobRouteComponent,
});

function JobRouteComponent() {
  const { jobId } = Route.useParams();
  return <JobPage jobId={jobId} />;
}
