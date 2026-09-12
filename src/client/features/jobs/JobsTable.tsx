import { useNavigate } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import type { JobsTableInstance } from './columns.tsx';
import type { JobsColumnMeta } from './columns.tsx';

function responsiveClass(table: JobsTableInstance, columnId: string): string {
  const column = table.getAllColumns().find((candidate) => candidate.id === columnId);
  const meta = column?.columnDef.meta as JobsColumnMeta | undefined;
  return meta?.responsiveClass ?? '';
}

function JobsTable({ table }: { table: JobsTableInstance }) {
  const navigate = useNavigate();

  // The whole row opens the job. Links inside the row (ID, chevron) keep
  // their native behavior for keyboard, modifier, and new-tab use; clicks
  // that select text never navigate away from the queue.
  function onRowClick(event: MouseEvent<HTMLTableRowElement>, jobId: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if ((event.target as HTMLElement).closest('a,button')) {
      return;
    }
    try {
      if (window.getSelection()?.toString()) {
        return;
      }
    } catch {
      // Selection inspection is best-effort; navigate normally.
    }
    void navigate({ to: '/jobs/$jobId', params: { jobId }, state: { fromJobsQueue: true } });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="bg-gray-100">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className={`border border-gray-200 bg-red-600 px-4 py-3 text-left font-medium text-white ${responsiveClass(table, header.column.id)}`}
                >
                  <table.FlexRender header={header} />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={(event) => onRowClick(event, row.original.id)}
              className="cursor-pointer even:bg-gray-50 hover:bg-gray-100 focus-within:bg-gray-100"
            >
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`border border-gray-200 px-4 py-3 ${responsiveClass(table, cell.column.id)}`}
                >
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobsTableSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white" aria-busy="true" aria-label="Loading jobs">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100">
            {Array.from({ length: columnCount }).map((_, index) => (
              <th key={index} scope="col" className="border border-gray-200 bg-red-600 px-4 py-3">
                <span className="sr-only">Loading</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }).map((_, rowIndex) => (
            <tr key={rowIndex} className="even:bg-gray-50">
              {Array.from({ length: columnCount }).map((_, cellIndex) => (
                <td key={cellIndex} className="border border-gray-200 px-4 py-3">
                  <div className="h-4 animate-pulse rounded bg-gray-200" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { JobsTable, JobsTableSkeleton };
