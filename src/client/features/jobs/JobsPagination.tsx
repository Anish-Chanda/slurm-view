import type { JobsPaginationDto } from '../../../shared/api/v1/jobs.ts';
import type { JobsTableInstance } from './columns.tsx';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function pageWindow(current: number, total: number): number[] {
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  const pages: number[] = [];
  for (let page = start; page <= end; page++) {
    pages.push(page);
  }
  return pages;
}

interface JobsPaginationProps {
  table: JobsTableInstance;
  // The rendered rows' own metadata, so placeholder rows are never
  // described with the newly requested page.
  pagination: JobsPaginationDto;
  disabled: boolean;
}

function JobsPagination({ table, pagination, disabled }: JobsPaginationProps) {
  const { page, pageSize, totalPages, totalItems } = pagination;
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div>
      <div className="mb-2 mt-4 flex items-center">
        <label htmlFor="page-size-select" className="mr-2 text-sm text-gray-600">
          Jobs per page:
        </label>
        <select
          id="page-size-select"
          className="rounded border p-1 text-sm"
          value={pageSize}
          disabled={disabled}
          onChange={(event) => table.setPageSize(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-600">
          Showing {from} to {to} of {totalItems} jobs
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-gray-200 px-4 py-2 font-medium text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            disabled={disabled || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </button>
          {pageWindow(page, totalPages).map((windowPage) =>
            windowPage === page ? (
              <button
                key={windowPage}
                type="button"
                className="rounded bg-blue-500 px-4 py-2 font-medium text-white"
                disabled
              >
                {windowPage}
              </button>
            ) : (
              <button
                key={windowPage}
                type="button"
                className="rounded bg-gray-200 px-4 py-2 font-medium text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onClick={() => table.setPageIndex(windowPage - 1)}
              >
                {windowPage}
              </button>
            ),
          )}
          <button
            type="button"
            className="rounded bg-gray-200 px-4 py-2 font-medium text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            disabled={disabled || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export { JobsPagination, PAGE_SIZE_OPTIONS, pageWindow };
