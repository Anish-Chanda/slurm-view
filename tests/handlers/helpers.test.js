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

  test('should handle case-insensitive job states', () => {
    expect(formatTimeLeft(3600, 1742900000, 'running')).not.toBe('Not started');
    expect(formatTimeLeft(3600, 1742900000, 'r')).not.toBe('Not started');
  });

  test('should calculate the remaining time correctly for running jobs', () => {
    // Given:
    // timeLimit = 10800 seconds (3 hours)
    // startTime = 30 minutes ago from our mock time
    // nowSec = 1743000000 (our mock time)
    // endtime = nowSec + timeLimit = 1743000000 + 10800 = 1743010800
    // startTime = 1743000000 - 1800 = 1742998200
    // remaining = endtime - startTime = 1743010800 - 1742998200 = 12600 (3.5 hours)
    
    expect(formatTimeLeft(10800, 1742998200, 'RUNNING')).toBe('3h 30m 0s');
  });

  test('should handle jobs with just-started time', () => {
    // Job started now, full time limit remains
    expect(formatTimeLeft(3600, mockNow, 'RUNNING')).toBe('1h 0m 0s');
  });

  test('should format the time correctly when the job has a remaining time', () => {
    // Calculations:
    // startTime = 1742900000 (earlier than mockNow)
    // timeLimit = 86400 (1 day)
    // nowSec = 1743000000
    // endtime = nowSec + timeLimit = 1743000000 + 86400 = 1743086400
    // remaining = endtime - startTime = 1743086400 - 1742900000 = 186400 seconds
    // (which is about 2 days, 3 hours, 46 minutes, 40 seconds)
    
    // Note: The exact formatted string depends on how formatTime works
    expect(formatTimeLeft(86400, 1742900000, 'RUNNING')).toBe('2d 3h 46m 40s');
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