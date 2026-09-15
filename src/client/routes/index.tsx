import { createFileRoute } from '@tanstack/react-router';
import { parseDashboardSearch } from '../features/jobs/jobs-search.ts';
import { DashboardPage } from '../app/DashboardPage.tsx';

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => parseDashboardSearch(search),
  component: DashboardPage,
});
