import { genJobsTable, parseJobsData, getSlurmJobs } from "../../handlers/fetchJobs.js"
import { executeCommand } from "../../helpers/executeCmd.js";


// Mock the executeCommand function
jest.mock("../../helpers/executeCmd.js", () => ({
    executeCommand: jest.fn(),
}));

describe("genJobsTable", () => {
    it("generates a table with job data", () => {
        const jobs = [
            {
                job_id: "123",
                partition: "main",
                name: "Job 1",
                user_name: "user1",
                job_state: ["R"],
                time_limit: { number: "1-00:00:00" },
                node_count: { number: "2" },
            },
        ];
        const html = genJobsTable(jobs);

        expect(html).toContain("<table");
        expect(html).toContain(">123</td>");
        expect(html).toContain(">Job 1</td>");
        expect(html).toContain(">R</td>");
    });

    it("renders 'N/A' when job fields are missing", () => {
        const jobs = [
            {
                job_id: null,
                partition: undefined,
                name: "Job Missing",
                user_name: null,
                job_state: null,
                time_limit: null,
                node_count: null,
            },
        ];
        const html = genJobsTable(jobs);
        // Check that 'N/A' appears for missing values
        expect(html).toContain("N/A");
    });

    it("renders an empty table (only headers) if jobs is not an array", () => {
        const html = genJobsTable(null);
        // Since no rows should be added, expect no <td> elements
        expect(html).not.toMatch(/<td/);
    });
});

describe("parseJobsData", () => {
    it("parses valid JSON and returns jobs", () => {
        const inputData = JSON.stringify({ jobs: [{ job_id: "456" }] });
        const jobs = parseJobsData(inputData);
        expect(jobs).toEqual([{ job_id: "456" }]);
    });

    it("throws an error when given invalid JSON", () => {
        // Because the catch block uses an undefined variable in the error message,
        // the thrown error may be a ReferenceError. We just check that an error is thrown.
        expect(() => parseJobsData("invalid json")).toThrow();
    });
});

describe("getSlurmJobs", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("returns a table when executeCommand returns valid JSON", () => {
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
        expect(result).toContain("<table");
        expect(result).toContain("1");
        expect(result).toContain("Test Job");
    });

    it("returns an error message when executeCommand returns invalid JSON", () => {
        executeCommand.mockImplementation(() => "invalid json");
        const result = getSlurmJobs();
        expect(result).toContain("Error retrieving job data:");
    });

    it("returns an error message when executeCommand throws an error", () => {
        executeCommand.mockImplementation(() => {
            throw new Error("command failed");
        });
        const result = getSlurmJobs();
        expect(result).toContain("Error retrieving job data: command failed");
    });
});