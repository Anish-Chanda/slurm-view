import type { ReactNode } from 'react';

function DetailSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="border-t border-gray-200 py-6">
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DetailList({ children }: { children: ReactNode }) {
  return <dl>{children}</dl>;
}

function DetailRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1.5 text-sm sm:grid-cols-[170px_1fr]">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-gray-900' : 'break-words text-gray-900'}>
        {children}
      </dd>
    </div>
  );
}

export { DetailList, DetailRow, DetailSection };
