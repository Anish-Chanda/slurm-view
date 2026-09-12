import { createColumnHelper, rowPaginationFeature, tableFeatures } from '@tanstack/react-table';
import type { ReactTable } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { StateBadge } from '../../components/StateBadge.tsx';
import { MISSING, formatDateTime, formatTimeLeft, formatTimeLimit } from './formatting.ts';

const jobsTableFeatures = tableFeatures({
  rowPaginationFeature,
});

const columnHelper = createColumnHelper<typeof jobsTableFeatures, JobDto>();

// Responsive visibility per column. Core scanning hierarchy
// (Job ID | Partition | Name | State) is always visible; operationally
// important fields (User, Time Left, Nodes) survive down to `md`;
// Time Limit to `lg`; Account/Submitted (useful but secondary) to `xl`.
// State reason is intentionally not a default column: it belongs to the
// forthcoming job-details/pending-reason experience.
interface JobsColumnMeta {
  responsiveClass?: string;
}

// The job ID links to the job page. The Link carries a queue-origin marker
// so "Back to jobs" can restore filters/page/scroll via history back.

// No sorting: the jobs API owns filtering and pagination server-side, and it
// offers no global sort. Page-local sorting would misrepresent the full set.
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
        title={info.row.original.jobId}
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
    // The Name column is always visible, so bound long job names instead
    // of letting them force excessive table width. Truncation is visual
    // only: the full value stays in the DOM (screen readers) and in the
    // title (hover).
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
]);

type JobsTableInstance = ReactTable<typeof jobsTableFeatures, JobDto>;

export { columns, jobsTableFeatures };
export type { JobsColumnMeta, JobsTableInstance };
