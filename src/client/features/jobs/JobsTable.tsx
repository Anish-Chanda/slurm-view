import type { JobsTableInstance } from './columns.tsx';
import type { JobsColumnMeta } from './columns.tsx';

function responsiveClass(table: JobsTableInstance, columnId: string): string {
  const column = table.getAllColumns().find((candidate) => candidate.id === columnId);
  const meta = column?.columnDef.meta as JobsColumnMeta | undefined;
  return meta?.responsiveClass ?? '';
}

function JobsTable({ table }: { table: JobsTableInstance }) {
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
            <tr key={row.id} className="even:bg-gray-50 hover:bg-gray-100">
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
