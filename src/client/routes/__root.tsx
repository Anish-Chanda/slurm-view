import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { EMPTY_DASHBOARD_SEARCH } from '../features/jobs/jobs-search.ts';

function RootComponent() {
  return <Outlet />;
}

function GlobalNotFound() {
  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <main className="mx-auto max-w-[1100px] px-4 py-16 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          This page does not exist in Slurm View.
        </p>
        <p className="mt-6">
          <Link
            to="/"
            search={EMPTY_DASHBOARD_SEARCH}
            className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Back to jobs
          </Link>
        </p>
      </main>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: GlobalNotFound,
});
