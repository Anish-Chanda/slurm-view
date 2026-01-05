const {
    parseSprioOutput,
    parseSprioWeights,
    getJobPriority,
    parseCompetingJobs,
    getCompetingJobs,
    getRunningJobsCount,
    calculateContributions
} = require("../../helpers/priorityUtils");
const { executeCommand } = require("../../helpers/executeCmd");

jest.mock("../../helpers/executeCmd");

describe("priorityUtils", () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe("parseSprioOutput", () => {
        it("should parse sprio output correctly", () => {
            const output = `          JOBID PARTITION   PRIORITY       SITE        AGE  FAIRSHARE    JOBSIZE  PARTITION        QOS
        9156162 nova           35940          0       1000      24923         17      10000          0`;

            const result = parseSprioOutput(output);

            expect(result).toEqual({
                jobId: '9156162',
                partition: 'nova',
                priority: 35940,
                components: {
                    site: 0,
                    age: 1000,
                    fairshare: 24923,
                    jobsize: 17,
                    partition: 10000,
                    qos: 0
                }
            });
        });

        it("should handle missing data gracefully", () => {
            const output = `          JOBID PARTITION   PRIORITY       SITE        AGE  FAIRSHARE    JOBSIZE  PARTITION        QOS`;

            expect(() => parseSprioOutput(output)).toThrow('No priority data found in sprio output');
        });
    });

    describe("parseSprioWeights", () => {
        it("should parse sprio weights correctly", () => {
            const output = `          JOBID PARTITION   PRIORITY       SITE        AGE  FAIRSHARE    JOBSIZE  PARTITION        QOS
        Weights                               1       1000     100000      10000     100000          1`;

            const result = parseSprioWeights(output);

            expect(result).toEqual({
                site: 1,
                age: 1000,
                fairshare: 100000,
                jobsize: 10000,
                partition: 100000,
                qos: 1
            });
        });

        it("should throw error if no weights found", () => {
            const output = `          JOBID PARTITION   PRIORITY`;

            expect(() => parseSprioWeights(output)).toThrow('No weights data found in sprio output');
        });
    });

    describe("getJobPriority", () => {
        it("should fetch and combine priority data and weights", () => {
            executeCommand
                .mockReturnValueOnce(`          JOBID PARTITION   PRIORITY       SITE        AGE  FAIRSHARE    JOBSIZE  PARTITION        QOS
        9156162 nova           35940          0       1000      24923         17      10000          0`)
                .mockReturnValueOnce(`          JOBID PARTITION   PRIORITY       SITE        AGE  FAIRSHARE    JOBSIZE  PARTITION        QOS
        Weights                               1       1000     100000      10000     100000          1`);

            const result = getJobPriority('9156162');

            expect(result.jobId).toBe('9156162');
            expect(result.priority).toBe(35940);
            expect(result.weights).toBeDefined();
            expect(result.weights.fairshare).toBe(100000);
            expect(executeCommand).toHaveBeenCalledTimes(2);
        });

        it("should handle errors gracefully", () => {
            executeCommand.mockImplementation(() => {
                throw new Error("Command failed");
            });

            expect(() => getJobPriority('123')).toThrow("Command failed");
        });
    });

    describe("parseCompetingJobs", () => {
        it("should parse competing jobs output", () => {
            const output = `9234494|61682|isaakd|PENDING
9244468|60954|ecoppen|PENDING
9232085|59293|congye|PENDING`;

            const result = parseCompetingJobs(output);

            expect(result).toEqual([
                { jobId: '9234494', priority: 61682, user: 'isaakd', state: 'PENDING' },
                { jobId: '9244468', priority: 60954, user: 'ecoppen', state: 'PENDING' },
                { jobId: '9232085', priority: 59293, user: 'congye', state: 'PENDING' }
            ]);
        });

        it("should handle empty output", () => {
            const result = parseCompetingJobs('');
            expect(result).toEqual([]);
        });
    });

    describe("getCompetingJobs", () => {
        it("should return jobs with higher priority", () => {
            executeCommand.mockReturnValue(`9244468|60954|ecoppen|PENDING
9232085|59293|congye|PENDING
9156162|35940|saydas|PENDING
9198593|35308|fmp97|PENDING`);

            const result = getCompetingJobs('nova', 35940, 5);

            expect(result.higherPriorityCount).toBe(2);
            expect(result.totalPending).toBe(4);
            expect(result.competitors).toHaveLength(2);
            expect(result.competitors[0].jobId).toBe('9244468');
            expect(result.competitors[1].jobId).toBe('9232085');
        });

        it("should limit to specified number of competitors", () => {
            executeCommand.mockReturnValue(`9001|70000|user1|PENDING
9002|69000|user2|PENDING
9003|68000|user3|PENDING
9004|67000|user4|PENDING
9005|66000|user5|PENDING
9006|65000|user6|PENDING`);

            const result = getCompetingJobs('nova', 60000, 3);

            expect(result.higherPriorityCount).toBe(6);
            expect(result.competitors).toHaveLength(3);
            expect(result.competitors[0].priority).toBe(70000);
            expect(result.competitors[2].priority).toBe(68000);
        });

        it("should handle no pending jobs", () => {
            executeCommand.mockReturnValue('');

            const result = getCompetingJobs('nova', 50000);

            expect(result.higherPriorityCount).toBe(0);
            expect(result.competitors).toEqual([]);
            expect(result.totalPending).toBe(0);
        });

        it("should handle errors", () => {
            executeCommand.mockImplementation(() => {
                throw new Error("squeue failed");
            });

            const result = getCompetingJobs('nova', 50000);

            expect(result.higherPriorityCount).toBe(0);
            expect(result.error).toBe("squeue failed");
        });
    });

    describe("getRunningJobsCount", () => {
        it("should count running jobs correctly", () => {
            executeCommand.mockReturnValue(`9226771
9226770
9226769
9226768`);

            const result = getRunningJobsCount('nova');

            expect(result).toBe(4);
        });

        it("should return 0 for empty output", () => {
            executeCommand.mockReturnValue('');

            const result = getRunningJobsCount('nova');

            expect(result).toBe(0);
        });

        it("should handle errors gracefully", () => {
            executeCommand.mockImplementation(() => {
                throw new Error("squeue failed");
            });

            const result = getRunningJobsCount('nova');

            expect(result).toBe(0);
        });
    });

    describe("calculateContributions", () => {
        it("should calculate percentage contributions correctly", () => {
            const components = {
                age: 1000,
                fairshare: 24923,
                jobsize: 17,
                partition: 10000,
                qos: 0,
                site: 0
            };

            const weights = {
                age: 1000,
                fairshare: 100000,
                jobsize: 10000,
                partition: 100000,
                qos: 1,
                site: 1
            };

            const result = calculateContributions(components, weights);

            // Total = (1000*1000) + (24923*100000) + (17*10000) + (10000*100000) + 0 + 0
            //       = 1000000 + 2492300000 + 170000 + 1000000000 = 3493470000
            // age contribution = (1000000 / 3493470000) * 100 ≈ 0.03%
            // fairshare contribution = (2492300000 / 3493470000) * 100 ≈ 71.3%

            expect(parseFloat(result.age)).toBeCloseTo(0.0, 1);
            expect(parseFloat(result.fairshare)).toBeGreaterThan(70);
            expect(parseFloat(result.partition)).toBeGreaterThan(25);
            expect(parseFloat(result.jobsize)).toBeCloseTo(0.0, 1);
        });

        it("should handle zero total gracefully", () => {
            const components = {
                age: 0,
                fairshare: 0,
                jobsize: 0,
                partition: 0,
                qos: 0,
                site: 0
            };

            const weights = {
                age: 1000,
                fairshare: 100000,
                jobsize: 10000,
                partition: 100000,
                qos: 1,
                site: 1
            };

            const result = calculateContributions(components, weights);

            expect(result.age).toBe(0);
            expect(result.fairshare).toBe(0);
            expect(result.partition).toBe(0);
        });
    });
});
