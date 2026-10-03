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
    // A speculative preload leaves the current page's diagnostic intact.
    // The actual visit creates a fresh auxiliary snapshot.
    preparePendingAnalysisRouteLoad(context.queryClient, params.jobId, preload);
  },
  component: JobRouteComponent,
});

function JobRouteComponent() {
  const { jobId } = Route.useParams();
  return <JobPage jobId={jobId} />;
}
