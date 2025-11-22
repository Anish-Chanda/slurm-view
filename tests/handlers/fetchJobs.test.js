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
        account: "testaccount",
        job_state: "pending",
        state_reason: "Resources"
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

    it("should match for account", () => {
        expect(matchesFilter(testJob, "account", "testaccount")).toBe(true);
        expect(matchesFilter(testJob, "account", "testaccount")).toBe(true);
        expect(matchesFilter(testJob, "account", "differentaccount")).toBe(false);
    });

    it("should match for state", () => {
        expect(matchesFilter(testJob, "state", "pending")).toBe(true);
        expect(matchesFilter(testJob, "state", "running")).toBe(false);
    });

    it("should match for state reason", () => {
        expect(matchesFilter(testJob, "statereason", "Resources")).toBe(true);
        expect(matchesFilter(testJob, "statereason", "resources")).toBe(true); // case insensitive
        expect(matchesFilter(testJob, "statereason", "Priority")).toBe(false);
        expect(matchesFilter(testJob, "statereason", "None")).toBe(false);
    });

    it("should handle partial matches for state reason", () => {
        const jobWithDetailedReason = {
            ...testJob,
            state_reason: "Resources not available"
        };
        expect(matchesFilter(jobWithDetailedReason, "statereason", "Resources")).toBe(true);
        expect(matchesFilter(jobWithDetailedReason, "statereason", "available")).toBe(true);
        expect(matchesFilter(jobWithDetailedReason, "statereason", "Priority")).toBe(false);
    });

    it("should handle jobs with None state reason", () => {
        const runningJob = {
            ...testJob,
            job_state: "running",
            state_reason: "None"
        };
        expect(matchesFilter(runningJob, "statereason", "None")).toBe(true);
        expect(matchesFilter(runningJob, "statereason", "none")).toBe(true); // case insensitive
        expect(matchesFilter(runningJob, "statereason", "Resources")).toBe(false);
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
                    job_state: "R",
                    state_reason: "None"
                },
                {
                    job_id: "2",
                    partition: "prod",
                    name: "Test Job 2",
                    user_name: "user2",
                    job_state: "PD",
                    state_reason: "Resources"
                }
            ],
        });
        executeCommandStreaming.mockResolvedValue(validOutput);

        const result = await getSlurmJobs({ user: "user2" });
        expect(result.success).toBe(true);
        expect(result.jobs.length).toBe(1);
        expect(result.jobs[0].job_id).toBe("2");
    });

    it("should filter jobs by state reason correctly", async () => {
        const validOutput = JSON.stringify({
            jobs: [
                {
                    job_id: "1",
                    partition: "debug",
                    name: "Running Job",
                    user_name: "user1",
                    account: "default",
                    job_state: "RUNNING",
                    time_limit: { number: 3600 },
                    node_count: { number: 1 },
                    current_working_directory: "/home/user1",
                    command: "echo hello",
                    standard_output: "/home/user1/output.log",
                    submit_time: { number: 1640995200 },
                    start_time: { number: 1640995300 },
                    tres_req_str: "cpu=4,mem=8G,gres/gpu=1",
                    state_reason: "None",
                    account: "default"
                },
                {
                    job_id: "2", 
                    partition: "gpu",
                    name: "Pending Job 1",
                    user_name: "user2",
                    account: "research",
                    job_state: "PENDING",
                    time_limit: { number: 7200 },
                    node_count: { number: 2 },
                    current_working_directory: "/home/user2",
                    command: "python train.py",
                    standard_output: "/home/user2/train.log",
                    submit_time: { number: 1640995400 },
                    tres_req_str: "cpu=8,mem=16G,gres/gpu=2", 
                    state_reason: "Resources",
                    account: "research"
                },
                {
                    job_id: "3",
                    partition: "cpu",
                    name: "Pending Job 2", 
                    user_name: "user3",
                    account: "teaching",
                    job_state: "PENDING",
                    time_limit: { number: 1800 },
                    node_count: { number: 1 },
                    current_working_directory: "/home/user3",
                    command: "matlab script.m",
                    standard_output: "/home/user3/matlab.log",
                    submit_time: { number: 1640995500 },
                    tres_req_str: "cpu=2,mem=4G",
                    state_reason: "Priority", 
                    account: "teaching"
                }
            ],
        });
        executeCommandStreaming.mockResolvedValue(validOutput);

        // Test filtering by state reason "Resources"
        const resourcesResult = await getSlurmJobs({ statereason: "Resources" });
        expect(resourcesResult.success).toBe(true);
        expect(resourcesResult.jobs.length).toBe(1);
        expect(resourcesResult.jobs[0].job_id).toBe("2");
        expect(resourcesResult.jobs[0].state_reason).toBe("Resources");

        // Test filtering by state reason "Priority"  
        const priorityResult = await getSlurmJobs({ statereason: "Priority" });
        expect(priorityResult.success).toBe(true);
        expect(priorityResult.jobs.length).toBe(1);
        expect(priorityResult.jobs[0].job_id).toBe("3");
        expect(priorityResult.jobs[0].state_reason).toBe("Priority");

        // Test filtering by state reason "None" (running jobs)
        const noneResult = await getSlurmJobs({ statereason: "None" });
        expect(noneResult.success).toBe(true); 
        expect(noneResult.jobs.length).toBe(1);
        expect(noneResult.jobs[0].job_id).toBe("1");
        expect(noneResult.jobs[0].state_reason).toBe("None");

        // Test case insensitive filtering
        const caseInsensitiveResult = await getSlurmJobs({ statereason: "resources" });
        expect(caseInsensitiveResult.success).toBe(true);
        expect(caseInsensitiveResult.jobs.length).toBe(1);
        expect(caseInsensitiveResult.jobs[0].job_id).toBe("2");

        // Test partial match filtering
        const partialResult = await getSlurmJobs({ statereason: "Res" });
        expect(partialResult.success).toBe(true);
        expect(partialResult.jobs.length).toBe(1);
        expect(partialResult.jobs[0].job_id).toBe("2");
    });

    it("should filter jobs by account correctly", async () => {
        const validOutput = JSON.stringify({
            jobs: [
                {
                    job_id: "1",
                    partition: "debug",
                    name: "Running Job",
                    user_name: "user1",
                    account: "default",
                    job_state: "RUNNING",
                    time_limit: { number: 3600 },
                    node_count: { number: 1 },
                    current_working_directory: "/home/user1",
                    command: "echo hello",
                    standard_output: "/home/user1/output.log",
                    submit_time: { number: 1640995200 },
                    start_time: { number: 1640995300 },
                    tres_req_str: "cpu=4,mem=8G,gres/gpu=1",
                    state_reason: "None"
                },
                {
                    job_id: "2", 
                    partition: "gpu",
                    name: "Pending Job 1",
                    user_name: "user2",
                    account: "research",
                    job_state: "PENDING",
                    time_limit: { number: 7200 },
                    node_count: { number: 2 },
                    current_working_directory: "/home/user2",
                    command: "python train.py",
                    standard_output: "/home/user2/train.log",
                    submit_time: { number: 1640995400 },
                    tres_req_str: "cpu=8,mem=16G,gres/gpu=2", 
                    state_reason: "Resources"
                },
                {
                    job_id: "3",
                    partition: "cpu",
                    name: "Pending Job 2", 
                    user_name: "user3",
                    account: "teaching",
                    job_state: "PENDING",
                    time_limit: { number: 1800 },
                    node_count: { number: 1 },
                    current_working_directory: "/home/user3",
                    command: "matlab script.m",
                    standard_output: "/home/user3/matlab.log",
                    submit_time: { number: 1640995500 },
                    tres_req_str: "cpu=2,mem=4G",
                    state_reason: "Priority"
                }
            ],
        });
        executeCommandStreaming.mockResolvedValue(validOutput);

        // Test filtering by account "research"
        const researchResult = await getSlurmJobs({ account: "research" });
        expect(researchResult.success).toBe(true);
        expect(researchResult.jobs.length).toBe(1);
        expect(researchResult.jobs[0].job_id).toBe("2");
        expect(researchResult.jobs[0].account).toBe("research");

        // Test filtering by account "teaching"  
        const teachingResult = await getSlurmJobs({ account: "teaching" });
        expect(teachingResult.success).toBe(true);
        expect(teachingResult.jobs.length).toBe(1);
        expect(teachingResult.jobs[0].job_id).toBe("3");
        expect(teachingResult.jobs[0].account).toBe("teaching");

        // Test filtering by account "default"
        const defaultResult = await getSlurmJobs({ account: "default" });
        expect(defaultResult.success).toBe(true); 
        expect(defaultResult.jobs.length).toBe(1);
        expect(defaultResult.jobs[0].job_id).toBe("1");
        expect(defaultResult.jobs[0].account).toBe("default");

        // Test case insensitive filtering
        const caseInsensitiveResult = await getSlurmJobs({ account: "RESEARCH" });
        expect(caseInsensitiveResult.success).toBe(true);
        expect(caseInsensitiveResult.jobs.length).toBe(1);
        expect(caseInsensitiveResult.jobs[0].job_id).toBe("2");

        // Test partial match filtering
        const partialResult = await getSlurmJobs({ account: "teach" });
        expect(partialResult.success).toBe(true);
        expect(partialResult.jobs.length).toBe(1);
        expect(partialResult.jobs[0].job_id).toBe("3");

        // Test non-existent account
        const nonExistentResult = await getSlurmJobs({ account: "nonexistent" });
        expect(nonExistentResult.success).toBe(true);
        expect(nonExistentResult.jobs.length).toBe(0);
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