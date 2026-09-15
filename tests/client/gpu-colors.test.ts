import {
  ALLOCATED_SHADES,
  AVAILABLE_SHADES,
  UNAVAILABLE_SHADES,
  gpuColorFor,
} from '../../src/client/features/stats/GpuChart';

// A type keeps one stable index from the globally sorted type list; the
// same relative shade is used inside every semantic parent family.
function nodeAt(depth: number, name: string, parentName?: string): never {
  return {
    depth,
    data: { name },
    parent: parentName === undefined ? null : { data: { name: parentName } },
  } as never;
}

describe('gpuColorFor', () => {
  const typeIndex = new Map([
    ['a100', 0],
    ['h100', 1],
  ]);

  test('depth-1 segments use the parent state color', () => {
    expect(gpuColorFor(nodeAt(1, 'Allocated'), typeIndex)).toBe('#e63946');
    expect(gpuColorFor(nodeAt(1, 'Available'), typeIndex)).toBe('#2a9d8f');
    expect(gpuColorFor(nodeAt(1, 'Unavailable'), typeIndex)).toBe('#f4a261');
  });

  test('the same type uses the same relative shade in every family', () => {
    expect(gpuColorFor(nodeAt(2, 'h100', 'Allocated'), typeIndex)).toBe(ALLOCATED_SHADES[1]);
    expect(gpuColorFor(nodeAt(2, 'h100', 'Available'), typeIndex)).toBe(AVAILABLE_SHADES[1]);
    expect(gpuColorFor(nodeAt(2, 'h100', 'Unavailable'), typeIndex)).toBe(
      UNAVAILABLE_SHADES[1]
    );
  });

  test('the Unknown remainder stays inside the parent family', () => {
    expect(gpuColorFor(nodeAt(2, 'Unknown', 'Allocated'), typeIndex)).toBe(
      ALLOCATED_SHADES[2 % ALLOCATED_SHADES.length]
    );
  });

  test('unknown names fall back to gray', () => {
    expect(gpuColorFor(nodeAt(2, 'a100', 'Bogus'), typeIndex)).toBe('#888888');
  });
});
