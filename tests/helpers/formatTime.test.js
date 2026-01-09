import { formatTime, formatUnixTimestamp } from "../../helpers/formatTime.js";

describe("formatTime", () => {
  it("should format seconds only", () => {
    expect(formatTime(45)).toBe("45s");
    expect(formatTime(1)).toBe("1s");
    expect(formatTime(59)).toBe("59s");
  });

  it("should format minutes and seconds", () => {
    expect(formatTime(60)).toBe("1m");
    expect(formatTime(90)).toBe("1m 30s");
    expect(formatTime(3599)).toBe("59m 59s");
  });

  it("should format hours, minutes, and seconds", () => {
    expect(formatTime(3600)).toBe("1h");
    expect(formatTime(3661)).toBe("1h 1m 1s");
    expect(formatTime(7200)).toBe("2h");
    expect(formatTime(7325)).toBe("2h 2m 5s");
  });

  it("should format days, hours, minutes, and seconds", () => {
    expect(formatTime(86400)).toBe("1d");
    expect(formatTime(90061)).toBe("1d 1h 1m 1s");
    expect(formatTime(172800)).toBe("2d");
    expect(formatTime(259200)).toBe("3d");
  });

  it("should handle large time values", () => {
    // 30 days
    expect(formatTime(2592000)).toBe("30d");
    
    // 365 days
    expect(formatTime(31536000)).toBe("365d");
  });

  it("should return N/A for NaN input", () => {
    expect(formatTime("invalid")).toBe("N/A");
    expect(formatTime(NaN)).toBe("N/A");
    expect(formatTime(undefined)).toBe("N/A");
    expect(formatTime(null)).toBe("N/A");
  });

  it("should handle zero time", () => {
    expect(formatTime(0)).toBe("0s");
  });

  it("should handle string numbers", () => {
    expect(formatTime("60")).toBe("1m");
    expect(formatTime("3600")).toBe("1h");
  });

  it("should handle minutes converted to seconds (key for bug fix)", () => {
    // When time_limit comes from Slurm in minutes, we multiply by 60
    const timeLimitMinutes = 120; // 2 hours in minutes
    const timeLimitSeconds = timeLimitMinutes * 60; // Convert to seconds
    
    expect(formatTime(timeLimitSeconds)).toBe("2h");
  });

  it("should handle 1920 minutes converted to seconds (from real Slurm data)", () => {
    // Real example from the slurm output: time_limit: 1920 minutes
    const timeLimitMinutes = 1920;
    const timeLimitSeconds = timeLimitMinutes * 60;
    
    expect(formatTime(timeLimitSeconds)).toBe("1d 8h");
  });
});

describe("formatUnixTimestamp", () => {
  it("should return N/A for null or undefined", () => {
    expect(formatUnixTimestamp(null)).toBe("N/A");
    expect(formatUnixTimestamp(undefined)).toBe("N/A");
  });

  it("should return N/A for NaN", () => {
    expect(formatUnixTimestamp(NaN)).toBe("N/A");
  });

  it("should return N/A for zero", () => {
    expect(formatUnixTimestamp(0)).toBe("N/A");
  });

  it("should format valid Unix timestamps", () => {
    // Test with a known timestamp: 2022-01-01 00:00:00 UTC
    const timestamp = 1640995200;
    const result = formatUnixTimestamp(timestamp);
    
    // The exact format depends on the system locale, but it should be a valid date string
    expect(result).not.toBe("N/A");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("should handle recent timestamps", () => {
    // Test with a more recent timestamp
    const timestamp = 1704067200; // 2024-01-01 00:00:00 UTC
    const result = formatUnixTimestamp(timestamp);
    
    expect(result).not.toBe("N/A");
    expect(result).toBeTruthy();
  });

  it("should handle timestamps from Slurm output format", () => {
    // From real Slurm data: submit_time: { number: 1765157619 }
    const timestamp = 1765157619;
    const result = formatUnixTimestamp(timestamp);
    
    expect(result).not.toBe("N/A");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
