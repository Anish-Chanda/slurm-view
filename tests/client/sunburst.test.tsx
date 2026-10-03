/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { Sunburst } from '../../src/client/features/stats/Sunburst';
import {
  CENTER_TOTAL_BASE_FONT_SIZE,
  CENTER_TOTAL_MIN_FONT_SIZE,
  PRIMARY_LABEL_DESIRED_SIZE,
  PRIMARY_LABEL_MIN_SIZE,
  SECONDARY_LABEL_DESIRED_SIZE,
  SECONDARY_LABEL_MIN_SIZE,
  centerTotalFontSize,
  labelDesiredSizeForDepth,
  labelMinSizeForDepth,
  resolveLabelFontSize,
} from '../../src/client/features/stats/Sunburst';
import type { ChartModel } from '../../src/client/features/stats/chart-data';

// JSDOM cannot verify label overlap; confirm long names, small slices, and
// large totals in a browser.

function renderSunburst(model: ChartModel) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Sunburst
        model={model}
        center={{ title: 'GPU', total: '256 TiB' }}
        ariaLabel="test chart"
        colorFor={() => '#e63946'}
      />
    </QueryClientProvider>
  );
}

describe('label sizes by depth', () => {
  test('inner ring is larger with its own floor, outer rings smaller', () => {
    expect(labelDesiredSizeForDepth(1)).toBe(PRIMARY_LABEL_DESIRED_SIZE);
    expect(labelMinSizeForDepth(1)).toBe(PRIMARY_LABEL_MIN_SIZE);
    expect(labelDesiredSizeForDepth(2)).toBe(SECONDARY_LABEL_DESIRED_SIZE);
    expect(labelMinSizeForDepth(2)).toBe(SECONDARY_LABEL_MIN_SIZE);
    expect(labelDesiredSizeForDepth(3)).toBe(SECONDARY_LABEL_DESIRED_SIZE);
    expect(SECONDARY_LABEL_MIN_SIZE).toBeGreaterThanOrEqual(8.5);
  });
});

describe('resolveLabelFontSize', () => {
  // At radius 200, two-ring bands are about 66.7 units. Null omits the label;
  // the tooltip still identifies the sector.
  const BAND = 200 / 3;
  const primary = {
    desiredSize: PRIMARY_LABEL_DESIRED_SIZE,
    minimumSize: PRIMARY_LABEL_MIN_SIZE,
  };
  const secondary = {
    desiredSize: SECONDARY_LABEL_DESIRED_SIZE,
    minimumSize: SECONDARY_LABEL_MIN_SIZE,
  };

  test('short labels stay at the desired size', () => {
    expect(
      resolveLabelFontSize('Used', {
        arcSpanRadians: Math.PI / 2,
        midRadius: 150,
        radialThickness: BAND,
        ...primary,
      })
    ).toBe(PRIMARY_LABEL_DESIRED_SIZE);
  });

  test('Allocated / Available on two-ring geometry shrink but remain visible', () => {
    for (const name of ['Allocated', 'Available']) {
      const size = resolveLabelFontSize(name, {
        arcSpanRadians: Math.PI,
        midRadius: 100,
        radialThickness: BAND,
        ...primary,
      });
      expect(size).not.toBeNull();
      expect(size!).toBeGreaterThanOrEqual(PRIMARY_LABEL_MIN_SIZE);
      expect(size!).toBeLessThan(PRIMARY_LABEL_DESIRED_SIZE);
    }
    // (66.67 - 6) / (9 * 0.6) = 11.23, rounded to 11.2.
    expect(
      resolveLabelFontSize('Allocated', {
        arcSpanRadians: Math.PI,
        midRadius: 100,
        radialThickness: BAND,
        ...primary,
      })
    ).toBe(11.2);
  });

  test('labels that would fall below the minimum are omitted', () => {
    // "Unavailable" shrinks to about 9.2, below the primary-label minimum.
    expect(
      resolveLabelFontSize('Unavailable', {
        arcSpanRadians: Math.PI,
        midRadius: 100,
        radialThickness: BAND,
        ...primary,
      })
    ).toBeNull();
    // Flat charts have enough room to render it.
    expect(
      resolveLabelFontSize('Unavailable', {
        arcSpanRadians: Math.PI,
        midRadius: 150,
        radialThickness: 100,
        ...primary,
      })
    ).toBe(PRIMARY_LABEL_DESIRED_SIZE);
  });

  test('secondary labels use their own desired/minimum sizes', () => {
    expect(
      resolveLabelFontSize('a100', {
        arcSpanRadians: Math.PI,
        midRadius: 100,
        radialThickness: BAND,
        ...secondary,
      })
    ).toBe(SECONDARY_LABEL_DESIRED_SIZE);
    expect(
      resolveLabelFontSize('super-long-gpu-type-name-h100-80gb', {
        arcSpanRadians: Math.PI,
        midRadius: 150,
        radialThickness: BAND,
        ...secondary,
      })
    ).toBeNull();
  });

  test('tiny angular sectors are omitted even when radial width fits', () => {
    expect(
      resolveLabelFontSize('a100', {
        arcSpanRadians: 0.01,
        midRadius: 150,
        radialThickness: 100,
        ...secondary,
      })
    ).toBeNull();
  });

  test('long GPU names on narrow sectors are omitted', () => {
    expect(
      resolveLabelFontSize('super-long-gpu-type-name-h100-80gb', {
        arcSpanRadians: 0.05,
        midRadius: 150,
        radialThickness: BAND,
        ...secondary,
      })
    ).toBeNull();
  });

  test('empty names never render', () => {
    expect(
      resolveLabelFontSize('', {
        arcSpanRadians: Math.PI,
        midRadius: 150,
        radialThickness: 100,
        ...primary,
      })
    ).toBeNull();
  });
});

describe('centerTotalFontSize', () => {
  test('short totals keep the base size', () => {
    expect(centerTotalFontSize('108', 60)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
  });

  test('long totals shrink deterministically to fit the hole', () => {
    const size = centerTotalFontSize('12345678', 60);
    expect(size).toBeLessThan(CENTER_TOTAL_BASE_FONT_SIZE);
    expect(size).toBeGreaterThanOrEqual(CENTER_TOTAL_MIN_FONT_SIZE);
    // (60 / (8 * 20 * 0.6)) * 20 = 12.5.
    expect(size).toBe(12.5);
  });

  test('extremely long totals clamp at the minimum', () => {
    expect(centerTotalFontSize('12345678901234567890', 60)).toBe(CENTER_TOTAL_MIN_FONT_SIZE);
  });

  test('empty totals and degenerate holes keep the base size', () => {
    expect(centerTotalFontSize('', 60)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
    expect(centerTotalFontSize('108', 0)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
  });

  test('common cluster totals render at full size without shrinking', () => {
    const twoRingHole = (2 * 200) / 3;
    for (const total of ['54321', '256 TiB', '256']) {
      expect(centerTotalFontSize(total, twoRingHole)).toBe(CENTER_TOTAL_BASE_FONT_SIZE);
    }
  });
});

describe('Sunburst center', () => {
  test('renders a two-line title + total structure', () => {
    renderSunburst({
      name: 'GPU Utilization',
      children: [{ name: 'Allocated', value: 8 }],
    });
    expect(screen.getByText('GPU')).toBeTruthy();
    expect(screen.getByText('256 TiB')).toBeTruthy();
    expect(screen.queryByText('GPU Total: 256 TiB')).toBeNull();
  });
});

describe('Sunburst inline labels', () => {
  test('shrunk labels render while unfittable ones keep tooltips', () => {
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
    const allocated = screen.getByText('Allocated');
    expect(allocated.getAttribute('font-size')).toBe('11.2');
    expect(screen.queryByText('Available')).toBeNull();
    expect(
      screen.queryByText('an-extremely-long-gpu-type-name-that-cannot-fit')
    ).toBeNull();
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
