import { useQuery } from '@tanstack/react-query';
import { fetchUiSettings } from '../api/ui-settings.ts';
import { uiSettingsKeys } from '../api/query-keys.ts';
import { JobsSection } from '../features/jobs/JobsSection.tsx';
import { StatsDashboard } from '../features/stats/StatsDashboard.tsx';

// YIQ brightness contrast, matching the server's navbar helper. Pure
// presentation logic; the color value itself always comes from ui-settings.
function contrastingTextColor(hexColor: string): string {
  let normalized = hexColor.replace('#', '');
  if (normalized.length === 3) {
    normalized = normalized
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  if (![red, green, blue].every((channel) => Number.isFinite(channel))) {
    return '#ffffff';
  }
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness >= 140 ? '#0f172a' : '#ffffff';
}

function DashboardPage() {
  const uiSettingsQuery = useQuery({
    queryKey: uiSettingsKeys.detail,
    queryFn: ({ signal }) => fetchUiSettings({ signal }),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  const navbar = uiSettingsQuery.data?.navbar;
  // While settings load (or if they fail), render a neutral product nav.
  // The configured title/color apply once loaded; nothing here encodes
  // administrator config values as policy.
  const navStyle =
    navbar === undefined
      ? undefined
      : { backgroundColor: navbar.color, color: contrastingTextColor(navbar.color) };

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900">
      {navbar?.enabled === false ? null : (
        <nav
          className={`border-b border-black/10 text-white ${navbar === undefined ? 'bg-neutral-800' : ''}`}
          style={navStyle}
        >
          <div className="mx-auto flex max-w-[1800px] items-center justify-between px-5 py-4">
            <span className="text-lg font-semibold tracking-tight">
              {navbar?.title ?? 'Slurm View'}
            </span>
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
      )}
      <main className="mx-auto max-w-[1800px] px-5 py-5">
        <StatsDashboard />
        <JobsSection />
      </main>
    </div>
  );
}

export { DashboardPage, contrastingTextColor };
