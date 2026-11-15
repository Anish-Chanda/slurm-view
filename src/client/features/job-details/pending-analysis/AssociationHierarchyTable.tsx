import { useState, type ReactNode } from "react";
import {
  EVIDENCE_TABLE,
  EVIDENCE_TABLE_HEAD,
  EVIDENCE_TABLE_ROW,
  EVIDENCE_TABLE_WRAPPER,
} from "./AnalysisShell.tsx";

const TREE_INDENT_PX = 16;
const MAX_TREE_DEPTH = 5;

interface AssociationHierarchyColumn {
  key: string;
  label: string;
  selectorLabel?: string;
}

interface AssociationHierarchyTableProps<T> {
  levels: readonly T[];
  columns: readonly AssociationHierarchyColumn[];
  initialColumnKey: string;
  caption: string;
  renderIdentity: (level: T) => ReactNode;
  renderCell: (level: T, columnKey: string) => ReactNode;
  rowKey: (level: T, index: number) => string;
}

function AssociationHierarchyTable<T>({
  levels,
  columns,
  initialColumnKey,
  caption,
  renderIdentity,
  renderCell,
  rowKey,
}: AssociationHierarchyTableProps<T>) {
  const [selected, setSelected] = useState(initialColumnKey);
  const ordered = [...levels].reverse();
  if (ordered.length === 0) return null;
  const columnClass = (key: string) =>
    key === selected ? "w-[54%] sm:w-[22%]" : "hidden sm:table-cell sm:w-[22%]";

  return (
    <section
      className="mt-6 border-t border-gray-100 pt-6"
      aria-labelledby="association-hierarchy"
    >
      <h3
        id="association-hierarchy"
        className="text-sm font-semibold text-gray-900"
      >
        Association hierarchy
      </h3>
      <div
        className="mt-3 flex flex-wrap gap-1 sm:hidden"
        role="group"
        aria-label="Choose association resource"
      >
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            aria-pressed={selected === column.key}
            onClick={() => setSelected(column.key)}
            className={`rounded-sm border px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              selected === column.key
                ? "border-gray-300 bg-gray-100 text-gray-900"
                : "border-gray-200 bg-white text-gray-500"
            }`}
          >
            {column.selectorLabel ?? column.label}
          </button>
        ))}
      </div>
      <div className={`mt-3 ${EVIDENCE_TABLE_WRAPPER}`}>
        <table className={`${EVIDENCE_TABLE} table-fixed`}>
          <caption className="sr-only">{caption}</caption>
          <thead className={EVIDENCE_TABLE_HEAD}>
            <tr>
              <th
                scope="col"
                className="w-[46%] px-2 py-2 sm:w-[34%] sm:px-3"
              >
                Association
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-2 py-2 sm:px-3 ${columnClass(column.key)}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((level, index) => {
              const depth = Math.min(index, MAX_TREE_DEPTH);
              const nodeX = 12 + depth * TREE_INDENT_PX;
              const parentX =
                12 +
                Math.min(Math.max(index - 1, 0), MAX_TREE_DEPTH) *
                  TREE_INDENT_PX;
              const hasChild = index < ordered.length - 1;
              return (
                <tr
                  key={rowKey(level, index)}
                  className={`${EVIDENCE_TABLE_ROW} align-top`}
                >
                  <th
                    scope="row"
                    className="relative px-2 py-2 align-top font-normal sm:px-3"
                  >
                    {index > 0 ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="absolute top-0 bottom-1/2 border-l border-gray-300"
                          style={{ left: parentX }}
                        />
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 border-t border-gray-300"
                          style={{
                            left: parentX,
                            width: Math.max(0, nodeX - parentX),
                          }}
                        />
                      </>
                    ) : null}
                    {hasChild ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 bottom-0 border-l border-gray-300"
                        style={{ left: nodeX }}
                      />
                    ) : null}
                    <div
                      className="min-w-0 break-words"
                      style={{ paddingLeft: `${nodeX + 10}px` }}
                    >
                      {renderIdentity(level)}
                    </div>
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`break-words px-2 py-2 align-top ${columnClass(
                        column.key,
                      )}`}
                    >
                      {renderCell(level, column.key)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export { AssociationHierarchyTable };
export type { AssociationHierarchyColumn };
