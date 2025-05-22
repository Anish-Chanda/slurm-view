import { parseJobsData, getSlurmJobs, matchesFilter } from "../../handlers/fetchJobs.js"
import { executeCommand, executeCommandStreaming } from "../../helpers/executeCmd.js";


// Mock the executeCommand function
jest.mock("../../helpers/executeCmd.js", () => ({
    executeCommand: jest.fn(),
    executeCommandStreaming: jest.fn(),
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

    it("returns a success object with jobs array when executeCommand returns valid JSON", async () => {
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
        executeCommandStreaming.mockResolvedValue(validOutput);

        const result = await getSlurmJobs();
        expect(result.success).toBe(true);
        expect(Array.isArray(result.jobs)).toBe(true);
        expect(result.jobs.length).toBe(1);
        expect(result.jobs[0].job_id).toBe("1");
        expect(result.jobs[0].name).toBe("Test Job");
    });

    it("returns a filtered jobs array when filters are provided", async () => {
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
        executeCommandStreaming.mockResolvedValue(validOutput);

        const result = await getSlurmJobs({ user: "user2" });
        expect(result.success).toBe(true);
        expect(result.jobs.length).toBe(1);
        expect(result.jobs[0].job_id).toBe("2");
    });

    it("returns an error object when executeCommand returns invalid JSON", async () => {
        executeCommandStreaming.mockImplementation(() => "invalid json");
        const result = await getSlurmJobs();
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });

    it("returns an error object when executeCommand throws an error", async () => {
        executeCommandStreaming.mockImplementation(() => {
            throw new Error("command failed");
        });
        const result = await getSlurmJobs();
        expect(result.success).toBe(false);
        expect(result.error).toBe("command failed");
    });
});

describe("getSlurmJobs with pagination", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should paginate results correctly", async () => {
        // Create test data with multiple jobs
        const jobs = Array(25).fill().map((_, i) => ({
            job_id: `job-${i + 1}`,
            partition: "debug",
            name: `Test Job ${i + 1}`,
            user_name: "user1",
            job_state: "R"
        }));

        const validOutput = JSON.stringify({ jobs });
        executeCommandStreaming.mockResolvedValue(validOutput);

        // Test first page (default page size of 20)
        const result1 = await getSlurmJobs({}, { page: 1 });
        expect(result1.success).toBe(true);
        expect(result1.jobs.length).toBe(20);
        expect(result1.jobs[0].job_id).toBe("job-1");
        expect(result1.pagination).toEqual({
            page: 1,
            pageSize: 20,
            totalItems: 25,
            totalPages: 2
        });

        // Test second page
        const result2 = await getSlurmJobs({}, { page: 2 });
        expect(result2.success).toBe(true);
        expect(result2.jobs.length).toBe(5); // Only 5 jobs on second page
        expect(result2.jobs[0].job_id).toBe("job-21");
        expect(result2.pagination.page).toBe(2);
    });

    it("should handle custom page size", async () => {
        const jobs = Array(25).fill().map((_, i) => ({
            job_id: `job-${i + 1}`,
            name: `Test Job ${i + 1}`
        }));

        const validOutput = JSON.stringify({ jobs });
        executeCommandStreaming.mockResolvedValue(validOutput);

        const result = await getSlurmJobs({}, { page: 2, pageSize: 10 });
        expect(result.success).toBe(true);
        expect(result.jobs.length).toBe(10);
        expect(result.jobs[0].job_id).toBe("job-11");
        expect(result.pagination).toEqual({
            page: 2,
            pageSize: 10,
            totalItems: 25,
            totalPages: 3
        });
    });

    it("should apply filters before pagination", async () => {
        const jobs = [
            { job_id: "1", user_name: "user1" },
            { job_id: "2", user_name: "user2" },
            { job_id: "3", user_name: "user1" },
            { job_id: "4", user_name: "user2" },
            { job_id: "5", user_name: "user1" }
        ];

        const validOutput = JSON.stringify({ jobs });
        executeCommandStreaming.mockResolvedValue(validOutput);

        const result = await getSlurmJobs({ user: "user1" }, { page: 1, pageSize: 2 });
        expect(result.success).toBe(true);
        expect(result.jobs.length).toBe(2);
        expect(result.pagination.totalItems).toBe(3); // Only 3 jobs match the filter
        expect(result.pagination.totalPages).toBe(2);
    });

    it("should return empty array for out of range pages", async () => {
        const jobs = Array(5).fill().map((_, i) => ({
            job_id: `job-${i + 1}`
        }));

        const validOutput = JSON.stringify({ jobs });
        executeCommandStreaming.mockResolvedValue(validOutput);

        const result = await getSlurmJobs({}, { page: 10, pageSize: 10 });
        expect(result.success).toBe(true);
        expect(result.jobs.length).toBe(0); // No jobs on this page
        expect(result.pagination.totalItems).toBe(5);
        expect(result.pagination.totalPages).toBe(1);
    });
});