/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { CpuChart } from '../../src/client/features/stats/CpuChart';
import { GpuChart } from '../../src/client/features/stats/GpuChart';
import { MemoryChart } from '../../src/client/features/stats/MemoryChart';

const cpu = {
  configuredCpus: 108,
  effectiveCpus: 100,
  allocatedCpus: 16,
  availableCpus: 80,
  unavailableCpus: 12,
  loadGroups: { low: 4, medium: 6, high: 5, unclassified: 1 },
};

const memory = {
  totalMiB: 768000,
  allocatedMiB: 64000,
  allocatedUsedMiB: 48000,
  unallocatedMiB: 688000,
  unavailableMiB: 16000,
  freeMiB: 700000,
};

const gpu = {
  total: 8,
  allocated: 2,
  available: 6,
  unavailable: 0,
  byType: { a100: { total: 8, allocated: 2, available: 6, unavailable: 0 } },
};

describe('chart sizing context', () => {
  test('CPU, Memory, and GPU charts share the same outer w-full wrapper', () => {
    for (const element of [
      <CpuChart cpu={cpu} showSecondaryLayer />,
      <MemoryChart memory={memory} showSecondaryLayer />,
      <GpuChart gpu={gpu} showSecondaryLayer />,
    ]) {
      const { container, unmount } = render(element);
      const outer = container.firstElementChild;
      expect(outer?.tagName).toBe('DIV');
      expect(outer?.className).toContain('w-full');
      unmount();
    }
  });
});
