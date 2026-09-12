import { createFileRoute, notFound } from '@tanstack/react-router';
import { CANONICAL_JOB_ID_PATTERN } from '../../shared/api/v1/jobs.ts';
import { jobDetailQueryOptions } from '../api/job-details.ts';
import { JobPage } from '../features/job-details/JobPage.tsx';

export const Route = createFileRoute('/jobs/$jobId')({
  loader: ({ context, params }) => {
    if (!CANONICAL_JOB_ID_PATTERN.test(params.jobId)) {
      throw notFound();
    }
    void context.queryClient.prefetchQuery(jobDetailQueryOptions(params.jobId));
  },
  component: JobRouteComponent,
});

function JobRouteComponent() {
  const { jobId } = Route.useParams();
  return <JobPage jobId={jobId} />;
}
