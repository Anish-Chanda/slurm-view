const { formatTime, formatUnixTimestamp } = require('../../helpers/formatTime.js');
const { formatTimeLeft } = require('../../helpers/formatTimeLeft.js');
const { getTresvalue } = require('../../helpers/getTresValue.js');


describe('formatTime helper', () => {
  test('should return "N/A" for null or undefined input', () => {
    expect(formatTime(null)).toBe('N/A');
    expect(formatTime(undefined)).toBe('N/A');
  });

  test('should format seconds correctly', () => {
    expect(formatTime(30)).toBe('30s');
  });

  test('should format minutes and seconds correctly', () => {
    expect(formatTime(90)).toBe('1m 30s');
    expect(formatTime(120)).toBe('2m 0s');
  });

  test('should format hours, minutes and seconds correctly', () => {
    expect(formatTime(3600)).toBe('1h 0m 0s');
    expect(formatTime(3725)).toBe('1h 2m 5s');
  });

  test('should format days, hours, minutes and seconds correctly', () => {
    expect(formatTime(86400)).toBe('1d 0h 0m 0s');
    expect(formatTime(90061)).toBe('1d 1h 1m 1s');
    expect(formatTime(172800)).toBe('2d 0h 0m 0s');
  });

  test('should handle large values', () => {
    expect(formatTime(604800)).toBe('7d 0h 0m 0s'); // 1 week
    expect(formatTime(2592000)).toBe('30d 0h 0m 0s'); // ~1 month
  });

  test('should handle string inputs by parsing them as integers', () => {
    expect(formatTime('3600')).toBe('1h 0m 0s');
  });

  test('should handle edge cases', () => {
    expect(formatTime(0)).toBe('0s');
    expect(formatTime('not a number')).toBe('N/A'); // Assuming your function returns N/A for NaN
  });
});

describe('formatTimeLeft helper', () => {
  // Mock Date.now() to return a fixed timestamp for consistent testing
  const originalDateNow = Date.now;
  const mockNow = 1743000000; // Fixed timestamp for testing

  beforeEach(() => {
    Date.now = jest.fn(() => mockNow * 1000); // Convert to milliseconds
  });

  afterEach(() => {
    Date.now = originalDateNow; // Restore original Date.now
  });

  test('should return "N/A" for null or undefined inputs', () => {
    expect(formatTimeLeft(null, 1742900000, 'RUNNING')).toBe('N/A');
    expect(formatTimeLeft(3600, null, 'RUNNING')).toBe('N/A');
    expect(formatTimeLeft(null, null, 'RUNNING')).toBe('N/A');
  });

  test('should return "Not started" for non-running jobs', () => {
    expect(formatTimeLeft(3600, 1742900000, 'PENDING')).toBe('Not started');
    expect(formatTimeLeft(3600, 1742900000, 'PD')).toBe('Not started');
    expect(formatTimeLeft(3600, 1742900000, 'COMPLETING')).toBe('Not started');
  });

  test('should handle case-insensitive job states and array job states', () => {
    expect(formatTimeLeft(3600, 1742996400, 'running')).not.toBe('Not started');
    expect(formatTimeLeft(3600, 1742996400, 'r')).not.toBe('Not started');
    expect(formatTimeLeft(3600, 1742996400, ['RUNNING'])).not.toBe('Not started');
    expect(formatTimeLeft(3600, 1742996400, ['R'])).not.toBe('Not started');
  });

  test('should calculate the remaining time correctly for running jobs', () => {
    // Given:
    // mockNow = 1743000000
    // startTime = 1742996400 (1 hour ago)
    // timeLimit = 7200 (2 hours)
    // endTime = startTime + timeLimit = 1742996400 + 7200 = 1743003600
    // remaining = endTime - mockNow = 1743003600 - 1743000000 = 3600 (1 hour)
    
    expect(formatTimeLeft(7200, 1742996400, 'RUNNING')).toBe('1h 0m 0s');
  });

  test('should return "Exceeded" for jobs that have exceeded their time limit', () => {
    // Job started 2 hours ago with 1 hour time limit
    const startTime = mockNow - 7200; // 2 hours ago
    const timeLimit = 3600; // 1 hour limit
    expect(formatTimeLeft(timeLimit, startTime, 'RUNNING')).toBe('Exceeded');
  });

  test('should handle jobs with just-started time', () => {
    // Job started now, full time limit remains
    expect(formatTimeLeft(3600, mockNow, 'RUNNING')).toBe('1h 0m 0s');
  });

  test('should format the time correctly when the job has remaining time', () => {
    // Job started 30 minutes ago with 2 hour limit
    // mockNow = 1743000000  
    // startTime = 1742998200 (30 minutes ago)
    // timeLimit = 7200 (2 hours)
    // endTime = 1742998200 + 7200 = 1743005400
    // remaining = 1743005400 - 1743000000 = 5400 (1.5 hours = 1h 30m 0s)
    
    expect(formatTimeLeft(7200, 1742998200, 'RUNNING')).toBe('1h 30m 0s');
  });
});


describe('getTresvalue helper', () => {
    const tresStr = "cpu=8,mem=30400M,node=1,billing=8,gres/gpu=8";

    test('should extract a value from the string', () => {
        expect(getTresvalue(tresStr, 'mem')).toBe('30400M');
    });

    test('should extract the first value', () => {
        expect(getTresvalue(tresStr, 'cpu')).toBe('8');
    });

    test('should extract a key containing special characters', () => {
        expect(getTresvalue(tresStr, 'gres/gpu')).toBe('8');
    });

    test('should return "N/A" if the key is not found', () => {
        expect(getTresvalue(tresStr, 'disk')).toBe('N/A');
    });

    test('should return "N/A" for null, undefined, or empty input string', () => {
        expect(getTresvalue(null, 'mem')).toBe('N/A');
        expect(getTresvalue(undefined, 'cpu')).toBe('N/A');
        expect(getTresvalue('', 'mem')).toBe('N/A');
    });
});

describe('formatUnixTimestamp', () => {
    test('should format a valid Unix timestamp to a locale string', () => {
        // Use a fixed timestamp for consistent test results
        const timestamp = 1723841981; // 2024-08-16 20:59:41 UTC
        const expectedDate = new Date(timestamp * 1000);
        
        // This test will use the locale of the machine running the test.
        // It's a pragmatic choice for many projects.
        expect(formatUnixTimestamp(timestamp)).toBe(expectedDate.toLocaleString());
    });
    
    // For more robust testing against different server timezones, you can do this:
    test('should format a valid Unix timestamp predictably in UTC', () => {
        const timestamp = 1723841981;
        // Mocking toLocaleString to ensure UTC output for the test
        const originalToLocaleString = Date.prototype.toLocaleString;
        Date.prototype.toLocaleString = function() {
            return this.toUTCString();
        };

        expect(formatUnixTimestamp(timestamp)).toBe('Fri, 16 Aug 2024 20:59:41 GMT');

        // Restore the original function
        Date.prototype.toLocaleString = originalToLocaleString;
    });

    test('should return "N/A" for a timestamp of 0', () => {
        expect(formatUnixTimestamp(0)).toBe('N/A');
    });

    test('should return "N/A" for null or undefined input', () => {
        expect(formatUnixTimestamp(null)).toBe('N/A');
        expect(formatUnixTimestamp(undefined)).toBe('N/A');
    });
    
    test('should return "N/A" for NaN input', () => {
        expect(formatUnixTimestamp(NaN)).toBe('N/A');
    });
});