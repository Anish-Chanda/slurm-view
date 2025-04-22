const { formatTimeLimit } = require('../../helpers/formatTimeLimit');

describe('formatTimeLimit helper', () => {
  test('should return "N/A" for null or undefined input', () => {
    expect(formatTimeLimit(null)).toBe('N/A');
    expect(formatTimeLimit(undefined)).toBe('N/A');
  });

  test('should format seconds correctly', () => {
    expect(formatTimeLimit(30)).toBe('30s');
  });

  test('should format minutes and seconds correctly', () => {
    expect(formatTimeLimit(90)).toBe('1m 30s');
    expect(formatTimeLimit(120)).toBe('2m 0s');
  });

  test('should format hours, minutes and seconds correctly', () => {
    expect(formatTimeLimit(3600)).toBe('1h 0m 0s');
    expect(formatTimeLimit(3725)).toBe('1h 2m 5s');
  });

  test('should format days, hours, minutes and seconds correctly', () => {
    expect(formatTimeLimit(86400)).toBe('1d 0h 0m 0s');
    expect(formatTimeLimit(90061)).toBe('1d 1h 1m 1s');
    expect(formatTimeLimit(172800)).toBe('2d 0h 0m 0s');
  });

  test('should handle large values', () => {
    expect(formatTimeLimit(604800)).toBe('7d 0h 0m 0s'); // 1 week
    expect(formatTimeLimit(2592000)).toBe('30d 0h 0m 0s'); // ~1 month
  });

  test('should handle string inputs by parsing them as integers', () => {
    expect(formatTimeLimit('3600')).toBe('1h 0m 0s');
  });

  test('should handle edge cases', () => {
    expect(formatTimeLimit(0)).toBe('0s');
    expect(formatTimeLimit('not a number')).toBe('N/A'); // Assuming your function returns N/A for NaN
  });
});