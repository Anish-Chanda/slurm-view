import { parseJobsData, getSlurmJobs, matchesFilter } from "../../handlers/fetchJobs.js"
import { executeCommand } from "../../helpers/executeCmd.js";


// Mock the executeCommand function
jest.mock("../../helpers/executeCmd.js", () => ({
    executeCommand: jest.fn(),
}));

// Jest tests for fetchJobs handler: parseJobsData, matchesFilter, and getSlurmJobs
describe("parseJobsData", () => {
    it("parses valid JSON and returns jobs", () => {
        const inputData = JSON.stringify({ jobs: [{ job_id: "456" }] });
        const jobs = parseJobsData(inputData);
        expect(jobs).toEqual([{ job_id: "456" }]);
    });

    it("throws an error when given invalid JSON", () => {
        expect(() => parseJobsData("invalid json")).toThrow();
    });
});

describe("matchesFilter", () => {
    const testJob = {
        job_id: "123",
        partition: "debug",
        name: "test Job",
        user_name: "testuser",
        job_state: "pending"
    };

    it("should match for jobid", () => {
        expect(matchesFilter(testJob, "jobid", "123")).toBe(true);
        expect(matchesFilter(testJob, "jobid", "999")).toBe(false);
    });

    it("should match for partition", () => {
        expect(matchesFilter(testJob, "partition", "debug")).toBe(true);
        expect(matchesFilter(testJob, "partition", "prod")).toBe(false);
    });

    it("should match for name", () => {
        expect(matchesFilter(testJob, "name", "test Job")).toBe(true);
        expect(matchesFilter(testJob, "name", "idk")).toBe(false);
    });

    it("should match for user", () => {
        expect(matchesFilter(testJob, "user", "testuser")).toBe(true);
        expect(matchesFilter(testJob, "user", "admin")).toBe(false);
    });

    it("should match for state", () => {
        expect(matchesFilter(testJob, "state", "pending")).toBe(true);
        expect(matchesFilter(testJob, "state", "running")).toBe(false);
    });
});


describe("getSlurmJobs", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("returns a success object with jobs array when executeCommand returns valid JSON", () => {
        const validOutput = JSON.stringify({
            jobs: [
                {
                    job_id: "1",
                    partition: "debug",
                    name: "Test Job",
                    user_name: "user2",
                    job_state: "R",
                    time_limit: { number: "2-00:00:00" },
                    node_count: { number: "1" },
                },
            ],
        });
        executeCommand.mockImplementation(() => validOutput);

        const result = getSlurmJobs();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.jobs)).toBe(true);
        expect(result.jobs.length).toBe(1);
        expect(result.jobs[0].job_id).toBe("1");
        expect(result.jobs[0].name).toBe("Test Job");
    });

    it("returns a filtered jobs array when filters are provided", () => {
        const validOutput = JSON.stringify({
            jobs: [
                {
                    job_id: "1",
                    partition: "debug",
                    name: "Test Job 1",
                    user_name: "user1",
                    job_state: "R"
                },
                {
                    job_id: "2",
                    partition: "prod",
                    name: "Test Job 2",
                    user_name: "user2",
                    job_state: "PD"
                }
            ],
        });
        executeCommand.mockImplementation(() => validOutput);

        const result = getSlurmJobs({ user: "user2" });
        expect(result.success).toBe(true);
        expect(result.jobs.length).toBe(1);
        expect(result.jobs[0].job_id).toBe("2");
    });

    it("returns an error object when executeCommand returns invalid JSON", () => {
        executeCommand.mockImplementation(() => "invalid json");
        const result = getSlurmJobs();
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    it("returns an error object when executeCommand throws an error", () => {
        executeCommand.mockImplementation(() => {
            throw new Error("command failed");
        });
        const result = getSlurmJobs();
        expect(result.success).toBe(false);
        expect(result.error).toBe("command failed");
    });
});