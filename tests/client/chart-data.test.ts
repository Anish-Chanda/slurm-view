import {
  buildCpuChartData,
  buildGpuChartData,
  buildMemoryChartData,
  formatMiB,
} from '../../src/client/features/stats/chart-data';
import { layoutSunburst } from '../../src/client/features/stats/Sunburst';

const cpu = {
  configuredCpus: 192,
  effectiveCpus: 156,
  allocatedCpus: 16,
  availableCpus: 80,
  unavailableCpus: 96,
  loadGroups: { low: 4, medium: 6, high: 5, unclassified: 1 },
};

describe('chart data transforms', () => {
  test('CPU keeps fixed Allocated/Available/Unavailable order with API availability', () => {
    const model = buildCpuChartData(cpu);
    expect(model.children.map((child) => child.name)).toEqual([
      'Allocated',
      'Available',
      'Unavailable',
    ]);
    expect(model.children[1]?.value).toBe(80);
    expect(model.children[0]?.children?.map((child) => child.name)).toEqual([
      'Low',
      'Medium',
      'High',
      'Unclassified',
    ]);
  });

  test('CPU availability comes straight from the API, never derived', () => {
    const model = buildCpuChartData({ ...cpu, effectiveCpus: 10, availableCpus: 80 });
    expect(model.children[1]?.value).toBe(80);
  });

  test('memory keeps fixed Allocated/Unallocated/Unavailable order', () => {
    const model = buildMemoryChartData({
      totalMiB: 1000,
      allocatedMiB: 400,
      allocatedUsedMiB: null,
      unallocatedMiB: 500,
      unavailableMiB: 100,
      freeMiB: null,
    });
    expect(model.children.map((child) => child.name)).toEqual([
      'Allocated',
      'Unallocated',
      'Unavailable',
    ]);
    expect(model.children.map((child) => child.value)).toEqual([400, 500, 100]);
  });

  test('memory secondary layer splits Allocated into Used/Unused', () => {
    const model = buildMemoryChartData(
      {
        totalMiB: 1000,
        allocatedMiB: 400,
        allocatedUsedMiB: 250,
        unallocatedMiB: 500,
        unavailableMiB: 100,
        freeMiB: 600,
      },
      { showSecondaryLayer: true }
    );
    expect(model.children[0]?.children?.map((child) => child.name)).toEqual(['Used', 'Unused']);
    expect(model.children[0]?.children?.map((child) => child.value)).toEqual([250, 150]);
  });

  test('memory stays flat when the policy is off or used data is missing', () => {
    const memory = {
      totalMiB: 1000,
      allocatedMiB: 400,
      allocatedUsedMiB: 250,
      unallocatedMiB: 500,
      unavailableMiB: 100,
      freeMiB: 600,
    };
    expect(
      buildMemoryChartData(memory, { showSecondaryLayer: false }).children[0]?.children
    ).toBeUndefined();
    expect(
      buildMemoryChartData({ ...memory, allocatedUsedMiB: null }, { showSecondaryLayer: true })
        .children[0]?.children
    ).toBeUndefined();
  });

  test('CPU secondary layer collapses to primary rings when the policy is off', () => {
    const model = buildCpuChartData(cpu, { showSecondaryLayer: false });
    expect(model.children.map((child) => child.name)).toEqual([
      'Allocated',
      'Available',
      'Unavailable',
    ]);
    expect(model.children[0]?.children).toBeUndefined();
    expect(model.children[0]?.value).toBe(16);
  });

  test('GPU secondary layer collapses to primary rings when the policy is off', () => {
    const model = buildGpuChartData(
      {
        total: 10,
        allocated: 2,
        available: 6,
        unavailable: 2,
        byType: {
          v100: { total: 4, allocated: 0, available: 2, unavailable: 2 },
          a100: { total: 6, allocated: 2, available: 4, unavailable: 0 },
        },
      },
      { showSecondaryLayer: false }
    );
    expect(model.children.map((child) => child.name)).toEqual([
      'Allocated',
      'Available',
      'Unavailable',
    ]);
    for (const child of model.children) {
      expect(child.children).toBeUndefined();
    }
  });

  test('GPU keeps fixed order with alphabetically ordered types', () => {
    const model = buildGpuChartData({
      total: 10,
      allocated: 2,
      available: 6,
      unavailable: 2,
      byType: {
        v100: { total: 4, allocated: 0, available: 2, unavailable: 2 },
        a100: { total: 6, allocated: 2, available: 4, unavailable: 0 },
      },
    });
    expect(model.children.map((child) => child.name)).toEqual([
      'Allocated',
      'Available',
      'Unavailable',
    ]);
    expect(model.children[0]?.children?.map((child) => child.name)).toEqual(['a100', 'v100']);
    expect(model.children[0]?.children?.map((child) => child.value)).toEqual([2, 0]);
  });

  test('transforms never sort by value: order is stable regardless of magnitudes', () => {
    const model = buildCpuChartData({
      ...cpu,
      allocatedCpus: 1,
      unavailableCpus: 120,
      loadGroups: { low: 0, medium: 0, high: 1, unclassified: 0 },
    });
    expect(model.children.map((child) => child.name)).toEqual([
      'Allocated',
      'Available',
      'Unavailable',
    ]);
  });

  test('formatMiB uses MiB/GiB/TiB with nullable freeMiB left to the caller', () => {
    expect(formatMiB(512)).toBe('512 MiB');
    expect(formatMiB(32768)).toBe('32 GiB');
    expect(formatMiB(2560000)).toBe('2.4 TiB');
  });
});

describe('laid-out hierarchy totals', () => {
  test('CPU root equals configured CPUs with no internal double counting', () => {
    const laidOut = layoutSunburst(buildCpuChartData(cpu));
    expect(laidOut.value).toBe(192);
    expect(laidOut.children?.map((child) => [child.data.name, child.value])).toEqual([
      ['Allocated', 16],
      ['Available', 80],
      ['Unavailable', 96],
    ]);
    const allocated = laidOut.children?.[0];
    const leaves = allocated?.children?.map((child) => child.value ?? 0) ?? [];
    expect(leaves.reduce((sum, value) => sum + value, 0)).toBe(16);
  });

  test('unexplained allocated CPUs land in Unclassified instead of vanishing', () => {
    const laidOut = layoutSunburst(
      buildCpuChartData({ ...cpu, loadGroups: { low: 4, medium: 6, high: 0, unclassified: 0 } })
    );
    expect(laidOut.value).toBe(192);
    const unclassified = laidOut.children?.[0]?.children?.find(
      (child) => child.data.name === 'Unclassified'
    );
    expect(unclassified?.value).toBe(6);
  });

  test('GPU root equals the GPU total with each category preserving its API value', () => {
    const gpu = {
      total: 10,
      allocated: 2,
      available: 6,
      unavailable: 2,
      byType: {
        v100: { total: 4, allocated: 0, available: 2, unavailable: 2 },
        a100: { total: 6, allocated: 2, available: 4, unavailable: 0 },
      },
    };
    const laidOut = layoutSunburst(buildGpuChartData(gpu));
    expect(laidOut.value).toBe(10);
    expect(laidOut.children?.map((child) => [child.data.name, child.value])).toEqual([
      ['Allocated', 2],
      ['Available', 6],
      ['Unavailable', 2],
    ]);
  });

  test('incomplete GPU type info keeps the top-level total via a remainder slice', () => {
    const laidOut = layoutSunburst(
      buildGpuChartData({
        total: 10,
        allocated: 5,
        available: 5,
        unavailable: 0,
        byType: { a100: { total: 6, allocated: 2, available: 4, unavailable: 0 } },
      })
    );
    expect(laidOut.value).toBe(10);
    const allocated = laidOut.children?.[0];
    expect(allocated?.value).toBe(5);
    const remainder = allocated?.children?.find((child) => child.data.name === 'Unknown');
    expect(remainder?.value).toBe(3);
  });

  test('memory root equals the total with no internal double counting', () => {
    const laidOut = layoutSunburst(
      buildMemoryChartData(
        {
          totalMiB: 1000,
          allocatedMiB: 400,
          allocatedUsedMiB: 250,
          unallocatedMiB: 500,
          unavailableMiB: 100,
          freeMiB: 600,
        },
        { showSecondaryLayer: true }
      )
    );
    expect(laidOut.value).toBe(1000);
    expect(laidOut.children?.map((child) => [child.data.name, child.value])).toEqual([
      ['Allocated', 400],
      ['Unallocated', 500],
      ['Unavailable', 100],
    ]);
  });

  test('an inconsistent GPU breakdown is dropped rather than drawn falsely', () => {    const laidOut = layoutSunburst(
      buildGpuChartData({
        total: 4,
        allocated: 2,
        available: 2,
        unavailable: 0,
        byType: { a100: { total: 8, allocated: 5, available: 3, unavailable: 0 } },
      })
    );
    expect(laidOut.value).toBe(4);
    expect(laidOut.children?.[0]?.value).toBe(2);
    expect(laidOut.children?.[0]?.children).toBeUndefined();
  });
});
