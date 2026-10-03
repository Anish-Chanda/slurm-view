import { createColumnHelper, rowPaginationFeature, tableFeatures } from '@tanstack/react-table';
import type { ReactTable } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { JobSummaryDto } from '../../../shared/api/v1/jobs.ts';
import { StateBadge } from '../../components/StateBadge.tsx';
import { MISSING, formatDateTime, formatTimeLeft, formatTimeLimit } from './formatting.ts';

const jobsTableFeatures = tableFeatures({
  rowPaginationFeature,
});

const columnHelper = createColumnHelper<typeof jobsTableFeatures, JobSummaryDto>();

// Keep core fields visible at every width; progressively hide less critical
// fields below md, lg, and xl. State reasons belong on job details.
interface JobsColumnMeta {
  responsiveClass?: string;
}

// Job links mark queue navigation so browser Back restores queue state.

// Do not sort locally: the API paginates the full set.
// TODO: add api sort query param.
const columns = columnHelper.columns([
  columnHelper.accessor('id', {
    id: 'id',
    header: 'Job ID',
    cell: (info) => (
      <Link
        to="/jobs/$jobId"
        params={{ jobId: info.row.original.id }}
        state={{ fromJobsQueue: true }}
        className="font-mono text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor('partition', {
    id: 'partition',
    header: 'Partition',
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('name', {
    id: 'name',
    header: 'Name',
    // Bound long names to protect table width; keep the full value in the DOM
    // and title for assistive technology and hover.
    cell: (info) => {
      const value = info.getValue();
      if (value === null) return MISSING;
      return (
        <span className="block max-w-48 truncate" title={value}>
          {value}
        </span>
      );
    },
  }),
  columnHelper.accessor('user', {
    id: 'user',
    header: 'User',
    meta: { responsiveClass: 'hidden md:table-cell' } satisfies JobsColumnMeta,
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('state', {
    id: 'state',
    header: 'State',
    cell: (info) => <StateBadge state={info.getValue()} />,
  }),
  columnHelper.accessor('timeLimit', {
    id: 'timeLimit',
    header: 'Time limit',
    meta: { responsiveClass: 'hidden lg:table-cell' } satisfies JobsColumnMeta,
    cell: (info) => formatTimeLimit(info.getValue()),
  }),
  columnHelper.display({
    id: 'timeLeft',
    header: 'Time left',
    meta: { responsiveClass: 'hidden md:table-cell' } satisfies JobsColumnMeta,
    cell: ({ row }) => formatTimeLeft(row.original),
  }),
  columnHelper.accessor('nodeCount', {
    id: 'nodes',
    header: 'Nodes',
    meta: { responsiveClass: 'hidden md:table-cell' } satisfies JobsColumnMeta,
    cell: (info) => (
      <span title={info.row.original.nodeExpression ?? undefined}>
        {info.getValue() ?? MISSING}
      </span>
    ),
  }),
  columnHelper.accessor('account', {
    id: 'account',
    header: 'Account',
    meta: { responsiveClass: 'hidden xl:table-cell' } satisfies JobsColumnMeta,
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('submitTime', {
    id: 'submitted',
    header: 'Submitted',
    meta: { responsiveClass: 'hidden xl:table-cell' } satisfies JobsColumnMeta,
    cell: (info) => formatDateTime(info.getValue()),
  }),
  // The chevron advertises row navigation. Keep it a real link for keyboard
  // and modifier/new-tab behavior.
  columnHelper.display({
    id: 'open',
    header: () => <span className="sr-only">Open</span>,
    cell: ({ row }) => (
      <Link
        to="/jobs/$jobId"
        params={{ jobId: row.original.id }}
        state={{ fromJobsQueue: true }}
        aria-label={`Open job ${row.original.id} details`}
        className="inline-flex rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    ),
  }),
]);

type JobsTableInstance = ReactTable<typeof jobsTableFeatures, JobSummaryDto>;

export { columns, jobsTableFeatures };
export type { JobsColumnMeta, JobsTableInstance };
