import { formatTimeLeft } from "../../helpers/formatTimeLeft.js";

describe("formatTimeLeft", () => {
  beforeAll(() => {
    // Mock Date.now() to return a fixed timestamp for consistent testing
    jest.spyOn(Date, 'now').mockReturnValue(1640995200000); // 2022-01-01 00:00:00 UTC
  });

  afterAll(() => {
    // Restore original Date.now()
    jest.restoreAllMocks();
  });

  it("should return 'N/A' when timeLimit is null", () => {
    const result = formatTimeLeft(null, 1640995200, "RUNNING");
    expect(result).toBe("N/A");
  });

  it("should return 'N/A' when startTime is null", () => {
    const result = formatTimeLeft(120, null, "RUNNING");
    expect(result).toBe("N/A");
  });

  it("should return 'N/A' when both timeLimit and startTime are null", () => {
    const result = formatTimeLeft(null, null, "RUNNING");
    expect(result).toBe("N/A");
  });

  it("should return 'Not started' for pending jobs", () => {
    const result = formatTimeLeft(120, 1640995200, "PENDING");
    expect(result).toBe("Not started");
  });

  it("should return 'Not started' for pending jobs with uppercase state", () => {
    const result = formatTimeLeft(120, 1640995200, "PD");
    expect(result).toBe("Not started");
  });

  it("should return 'Not started' for job state array with non-running state", () => {
    const result = formatTimeLeft(120, 1640995200, ["PENDING"]);
    expect(result).toBe("Not started");
  });

  it("should calculate time left correctly for running jobs", () => {
    // Job started 1 hour ago (3600 seconds) with 2 hour time limit (120 minutes)
    // Time left should be 1 hour (3600 seconds)
    const startTime = 1640991600; // 1 hour before "now" (1640995200)
    const timeLimit = 120; // 2 hours in minutes
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    expect(result).toBe("1h"); // Should show exactly 1 hour remaining
  });

  it("should handle time limit in minutes correctly (key bug fix)", () => {
    // This test specifically validates the bug fix where timeLimit is in minutes, not seconds
    // Job started exactly "now", with 60 minute time limit
    const startTime = 1640995200; // Exactly "now"
    const timeLimit = 60; // 60 minutes = 3600 seconds
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    expect(result).toBe("1h"); // Should show 60 minutes (3600 seconds)
  });

  it("should return 'Exceeded' when time limit has passed", () => {
    // Job started 3 hours ago with 1 hour time limit
    const startTime = 1640984400; // 3 hours before "now"
    const timeLimit = 60; // 1 hour in minutes
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    expect(result).toBe("Exceeded");
  });

  it("should return 'Exceeded' when remaining time is exactly 0", () => {
    // Job started exactly timeLimit minutes ago
    const startTime = 1640991600; // 1 hour (60 minutes) before "now"
    const timeLimit = 60; // 1 hour in minutes
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    expect(result).toBe("Exceeded");
  });

  it("should handle 'R' state abbreviation for running jobs", () => {
    const startTime = 1640991600; // 1 hour before "now"
    const timeLimit = 120; // 2 hours
    
    const result = formatTimeLeft(timeLimit, startTime, "R");
    expect(result).toBe("1h");
  });

  it("should handle job state as array with running state", () => {
    const startTime = 1640991600;
    const timeLimit = 120;
    
    const result = formatTimeLeft(timeLimit, startTime, ["RUNNING"]);
    expect(result).toBe("1h");
  });

  it("should handle very large time limits", () => {
    // Job just started with 30 day time limit
    const startTime = 1640995200; // Exactly "now"
    const timeLimit = 43200; // 30 days in minutes (30 * 24 * 60)
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    // Should show 30 days
    expect(result).toBe("30d");
  });

  it("should handle jobs with very short time remaining", () => {
    // Job started with 1 minute time limit, 59 seconds ago
    const startTime = 1640995141; // 59 seconds before "now"
    const timeLimit = 1; // 1 minute
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    expect(result).toBe("1s");
  });

  it("should correctly convert minutes to seconds (regression test)", () => {
    // This is the core bug that was found - timeLimit is in MINUTES from Slurm
    // If we add minutes directly to startTime (in seconds), calculations will be wrong
    
    // Job started "now", time limit 1920 minutes (like in the real slurm output)
    const startTime = 1640995200; // Exactly "now"  
    const timeLimit = 1920; // 1920 minutes = 32 hours
    
    const result = formatTimeLeft(timeLimit, startTime, "RUNNING");
    
    // Should show ~32 hours remaining, not "Exceeded"
    expect(result).not.toBe("Exceeded");
    expect(result).toBe("1d 8h");
  });

  it("should handle lowercase job states", () => {
    const startTime = 1640991600;
    const timeLimit = 120;
    
    const result = formatTimeLeft(timeLimit, startTime, "running");
    expect(result).toBe("1h");
  });

  it("should handle mixed case job states", () => {
    const startTime = 1640991600;
    const timeLimit = 120;
    
    const result = formatTimeLeft(timeLimit, startTime, "Running");
    expect(result).toBe("1h");
  });
});
