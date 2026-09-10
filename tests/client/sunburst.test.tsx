/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Sunburst } from '../../src/client/features/stats/Sunburst';
import {
  CENTER_TOTAL_BASE_FONT_SIZE,
  CENTER_TOTAL_MIN_FONT_SIZE,
  centerTotalFontSize,
  shouldShowLabel,
} from '../../src/client/features/stats/Sunburst';
import type { ChartModel } from '../../src/client/features/stats/chart-data';

// NOTE: these tests pin the label-fit decision algorithm and the two-line
// center structure only. JSDOM has no font metrics or layout engine, so it
// cannot prove visual non-overflow. A manual/browser pass with hostile
// cases (long GPU names, tiny slices, zero-value groups, large center
// totals) is required for visual confidence.

function renderSunburst(model: ChartModel) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Sunburst
        model={model}
        center={{ title: 'GPU', total: '239 TiB' }}
        ariaLabel="test chart"
        colorFor={() => '#e63946'}
      />
    </QueryClientProvider>
  );
}

describe('shouldShowLabel', () => {
  // Labels run radially, so text width must fit the band thickness while
  // text height must fit the angular space. Values below use RADIUS=200
  // geometry: a two-ring chart has ~66.7-unit bands.
  const BAND = 200 / 3;
  test('short names fit an ample band and arc', () => {
    expect(
      shouldShowLabel('Used', { arcSpanRadians: Math.PI / 2, midRadius: 150, radialThickness: BAND })
    ).toBe(true);
  });

  test('primary labels render when their ring geometry permits', () => {
    for (const name of ['Allocated', 'Available', 'Unavailable', 'Used', 'Unused']) {
      expect(
        shouldShowLabel(name, { arcSpanRadians: Math.PI, midRadius: 100, radialThickness: BAND })
      ).toBe(true);
    }
  });

  test('long names are rejected on very wide slices when the band is narrow', () => {
    expect(
      shouldShowLabel('super-long-gpu-type-name-h100-80gb', {
        arcSpanRadians: Math.PI,
        midRadius: 150,
        radialThickness: BAND,
      })
    ).toBe(false);
  });

  test('long GPU names on narrow sectors are omitted', () => {
    expect(
      shouldShowLabel('super-long-gpu-type-name-h100-80gb', {
        arcSpanRadians: 0.05,
        midRadius: 150,
        radialThickness: BAND,
      })
    ).toBe(false);
  });

  test('tiny angular space omits even short names', () => {
    expect(
      shouldShowLabel('a100', { arcSpanRadians: 0.01, midRadius: 150, radialThickness: 100 })
    ).toBe(false);
  });

  test('empty names never render', () => {
    expect(
      shouldShowLabel('', { arcSpanRadians: Math.PI, midRadius: 150, radialThickness: 100 })
    ).toBe(false);
  });
});

describe('centerTotalFontSize', () => {
  test('short totals keep the base size', () => {
    expect(centerTotalFontSize('108', 60)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
  });

  test('long totals shrink deterministically to fit the hole', () => {
    const size = centerTotalFontSize('12345678', 40);
    expect(size).toBeLessThan(CENTER_TOTAL_BASE_FONT_SIZE);
    expect(size).toBeGreaterThanOrEqual(CENTER_TOTAL_MIN_FONT_SIZE);
    // (40 / (8 * 11 * 0.6)) * 11 = 8.3 (rounded to one decimal).
    expect(size).toBe(8.3);
  });

  test('extremely long totals clamp at the minimum', () => {
    expect(centerTotalFontSize('12345678901234567890', 60)).toBe(CENTER_TOTAL_MIN_FONT_SIZE);
  });

  test('empty totals and degenerate holes keep the base size', () => {
    expect(centerTotalFontSize('', 60)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
    expect(centerTotalFontSize('108', 0)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
  });
});

describe('Sunburst center', () => {
  test('renders a two-line title + total structure', () => {
    renderSunburst({
      name: 'GPU Utilization',
      children: [{ name: 'Allocated', value: 8 }],
    });
    expect(screen.getByText('GPU')).toBeTruthy();
    expect(screen.getByText('239 TiB')).toBeTruthy();
    // The old single-string format must be gone.
    expect(screen.queryByText('GPU Total: 239 TiB')).toBeNull();
  });
});

describe('Sunburst inline labels', () => {
  test('primary labels render while narrow bands omit inline labels', () => {
    const { container } = renderSunburst({
      name: 'GPU Utilization',
      children: [
        { name: 'Allocated', value: 99 },
        {
          name: 'Available',
          value: 1,
          children: [{ name: 'an-extremely-long-gpu-type-name-that-cannot-fit', value: 1 }],
        },
      ],
    });
    // 'Allocated' fits its radial band at the new scale and renders.
    expect(screen.getByText('Allocated')).toBeTruthy();
    // The narrow sector and the over-long radial label are omitted.
    expect(screen.queryByText('Available')).toBeNull();
    expect(
      screen.queryByText('an-extremely-long-gpu-type-name-that-cannot-fit')
    ).toBeNull();
    // Every sector still exists with a tooltip for hover/screen readers.
    const titles = Array.from(container.querySelectorAll('title')).map(
      (title) => title.textContent
    );
    expect(titles.some((text) => text?.includes('Available'))).toBe(true);
    expect(titles.some((text) => text?.includes('an-extremely-long-gpu-type-name'))).toBe(true);
  });

  test('short labels that fit the band still render inline', () => {
    renderSunburst({
      name: 'GPU Utilization',
      children: [
        { name: 'Used', value: 99.5 },
        { name: 'Free', value: 0.5 },
      ],
    });
    expect(screen.getByText('Used')).toBeTruthy();
    expect(screen.queryByText('Free')).toBeNull();
  });

  test('zero-value groups render no segment path', () => {
    const { container } = renderSunburst({
      name: 'GPU Utilization',
      children: [
        { name: 'Allocated', value: 8 },
        { name: 'Unavailable', value: 0 },
      ],
    });
    const titles = Array.from(container.querySelectorAll('title')).map(
      (title) => title.textContent
    );
    expect(titles.some((text) => text?.includes('Unavailable'))).toBe(false);
    expect(titles.some((text) => text?.includes('Allocated'))).toBe(true);
  });
});
