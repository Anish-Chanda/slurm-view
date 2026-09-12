import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fetchUiSettings } from '../api/ui-settings.ts';
import { uiSettingsKeys } from '../api/query-keys.ts';
import { EMPTY_DASHBOARD_SEARCH } from '../features/jobs/jobs-search.ts';

// YIQ brightness contrast, matching the server's navbar helper.
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

function Navbar({ actions }: { actions?: ReactNode }) {
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
  // Neutral product nav until settings load; configured values apply after.
  const navStyle =
    navbar === undefined
      ? undefined
      : { backgroundColor: navbar.color, color: contrastingTextColor(navbar.color) };

  if (navbar?.enabled === false) {
    return null;
  }

  return (
    <nav
      className={`border-b border-black/10 text-white ${navbar === undefined ? 'bg-neutral-800' : ''}`}
      style={navStyle}
    >
      <div className="mx-auto flex max-w-[1800px] items-center justify-between px-5 py-4">
        <Link to="/" search={EMPTY_DASHBOARD_SEARCH} className="text-lg font-semibold tracking-tight">
          {navbar?.title ?? 'Slurm View'}
        </Link>
        {actions}
      </div>
    </nav>
  );
}

export { Navbar, contrastingTextColor };
