import { createColumnHelper, rowPaginationFeature, tableFeatures } from '@tanstack/react-table';
import type { ReactTable } from '@tanstack/react-table';
import type { JobDto } from '../../../shared/api/v1/jobs.ts';
import { StateBadge } from '../../components/StateBadge.tsx';
import { MISSING, formatDateTime, formatTimeLeft, formatTimeLimit } from './formatting.ts';

const jobsTableFeatures = tableFeatures({
  rowPaginationFeature,
});

const columnHelper = createColumnHelper<typeof jobsTableFeatures, JobDto>();

// No sorting: the jobs API owns filtering and pagination server-side, and it
// offers no global sort. Page-local sorting would misrepresent the full set.
const columns = columnHelper.columns([
  columnHelper.accessor('id', {
    id: 'id',
    header: 'Job ID',
    cell: (info) => (
      <span className="font-mono" title={info.row.original.jobId}>
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('name', {
    id: 'name',
    header: 'Name',
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('user', {
    id: 'user',
    header: 'User',
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('partition', {
    id: 'partition',
    header: 'Partition',
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('state', {
    id: 'state',
    header: 'State',
    cell: (info) => <StateBadge state={info.getValue()} />,
  }),
  columnHelper.accessor('nodeCount', {
    id: 'nodes',
    header: 'Nodes',
    cell: (info) => (
      <span title={info.row.original.nodeExpression ?? undefined}>
        {info.getValue() ?? MISSING}
      </span>
    ),
  }),
  columnHelper.accessor('timeLimit', {
    id: 'timeLimit',
    header: 'Time limit',
    cell: (info) => formatTimeLimit(info.getValue()),
  }),
  columnHelper.display({
    id: 'timeLeft',
    header: 'Time left',
    cell: ({ row }) => formatTimeLeft(row.original),
  }),
  columnHelper.accessor('submitTime', {
    id: 'submitted',
    header: 'Submitted',
    cell: (info) => formatDateTime(info.getValue()),
  }),
  columnHelper.accessor('account', {
    id: 'account',
    header: 'Account',
    cell: (info) => info.getValue() ?? MISSING,
  }),
  columnHelper.accessor('stateReason', {
    id: 'stateReason',
    header: 'State reason',
    cell: (info) => info.getValue() ?? MISSING,
  }),
]);

type JobsTableInstance = ReactTable<typeof jobsTableFeatures, JobDto>;

export { columns, jobsTableFeatures };
export type { JobsTableInstance };
