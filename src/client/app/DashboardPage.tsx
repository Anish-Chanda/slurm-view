import { JobsSection } from '../features/jobs/JobsSection.tsx';
import { StatsDashboard } from '../features/stats/StatsDashboard.tsx';

function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      <nav className="border-b border-black/10 bg-[#e7000b] text-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between px-5 py-4">
          <span className="text-lg font-semibold tracking-tight">Slurm View</span>
          <div className="flex items-center gap-5 text-sm">
            <a href="#resource-utilization" className="transition hover:opacity-80">
              Resources
            </a>
            <a href="#job-queue" className="transition hover:opacity-80">
              Queue
            </a>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-[1800px] px-5 py-5">
        <StatsDashboard />
        <JobsSection />
      </main>
    </div>
  );
}

export { DashboardPage };
