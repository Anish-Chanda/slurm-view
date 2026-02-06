const {
    parseTimeLimit,
    getRemainingMinutes,
    calculateJobRunMinutes,
    formatRunMinutes
} = require('../../helpers/runMinutesUtils');

describe('runMinutesUtils', () => {
    describe('parseTimeLimit', () => {
        it('should parse days-hours:minutes:seconds format', () => {
            expect(parseTimeLimit('1-00:00:00')).toBe(1440); // 1 day
            expect(parseTimeLimit('2-12:30:00')).toBe(3630); // 2 days + 12.5 hours
            expect(parseTimeLimit('0-01:00:00')).toBe(60); // 1 hour
        });

        it('should parse hours:minutes:seconds format', () => {
            expect(parseTimeLimit('2:30:00')).toBe(150); // 2.5 hours
            expect(parseTimeLimit('1:00:00')).toBe(60); // 1 hour
            expect(parseTimeLimit('0:45:30')).toBe(45); // 45.5 minutes (rounded down)
        });

        it('should parse minutes:seconds format', () => {
            expect(parseTimeLimit('30:00')).toBe(30); // 30 minutes
            expect(parseTimeLimit('45:30')).toBe(45); // 45.5 minutes (rounded down)
        });

        it('should parse minutes only', () => {
            expect(parseTimeLimit('60')).toBe(60);
            expect(parseTimeLimit('120')).toBe(120);
        });

        it('should handle UNLIMITED', () => {
            expect(parseTimeLimit('UNLIMITED')).toBeNull();
            expect(parseTimeLimit('Partition_Limit')).toBeNull();
        });

        it('should handle number input', () => {
            expect(parseTimeLimit(120)).toBe(120);
            expect(parseTimeLimit(1440)).toBe(1440);
        });

        it('should handle invalid input', () => {
            expect(parseTimeLimit('')).toBe(0);
            expect(parseTimeLimit(null)).toBe(0);
            expect(parseTimeLimit(undefined)).toBe(0);
        });
    });

    describe('getRemainingMinutes', () => {
        beforeEach(() => {
            // Mock Date.now() to return a consistent timestamp
            jest.spyOn(Date, 'now').mockReturnValue(1640000000000); // Arbitrary timestamp
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should return full time limit for job not started', () => {
            const job = {
                time_limit: '2:00:00',
                start_time: null
            };
            expect(getRemainingMinutes(job)).toBe(120);
        });

        it('should calculate remaining minutes for running job', () => {
            const currentTime = 1640000000; // seconds
            const startTime = currentTime - (30 * 60); // 30 minutes ago
            
            const job = {
                time_limit: '2:00:00', // 120 minutes
                start_time: { number: startTime }
            };
            
            expect(getRemainingMinutes(job)).toBe(90); // 120 - 30 = 90
        });

        it('should handle UNLIMITED time limit', () => {
            const job = {
                time_limit: 'UNLIMITED',
                start_time: { number: 1640000000 }
            };
            expect(getRemainingMinutes(job)).toBeNull();
        });

        it('should return 0 for jobs past their limit', () => {
            const currentTime = 1640000000;
            const startTime = currentTime - (150 * 60); // 150 minutes ago
            
            const job = {
                time_limit: '2:00:00', // 120 minutes
                start_time: { number: startTime }
            };
            
            expect(getRemainingMinutes(job)).toBe(0); // Past limit, should return 0
        });

        it('should handle start_time as plain number', () => {
            const currentTime = 1640000000;
            const startTime = currentTime - (30 * 60);
            
            const job = {
                time_limit: 120,
                start_time: startTime
            };
            
            expect(getRemainingMinutes(job)).toBe(90);
        });
    });

    describe('calculateJobRunMinutes', () => {
        beforeEach(() => {
            jest.spyOn(Date, 'now').mockReturnValue(1640000000000);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should calculate CPU run-minutes', () => {
            const job = {
                alloc_cpus: 10,
                time_limit: 120,
                start_time: null
            };
            
            expect(calculateJobRunMinutes(job, 'cpu')).toBe(1200); // 10 * 120
        });

        it('should calculate memory run-minutes (MB-minutes)', () => {
            const job = {
                alloc_memory: '10G',
                time_limit: 120,
                start_time: null
            };
            
            // 10G = 10240 MB, 10240 * 120 = 1,228,800 MB-minutes
            expect(calculateJobRunMinutes(job, 'mem')).toBe(1228800);
        });

        it('should calculate node run-minutes', () => {
            const job = {
                alloc_nodes: 5,
                nodes: 5,
                time_limit: 120,
                start_time: null
            };
            
            expect(calculateJobRunMinutes(job, 'node')).toBe(600); // 5 * 120
        });

        it('should handle UNLIMITED time limit', () => {
            const job = {
                alloc_cpus: 10,
                time_limit: 'UNLIMITED',
                start_time: null
            };
            
            expect(calculateJobRunMinutes(job, 'cpu')).toBeNull();
        });

        it('should use remaining time for running jobs', () => {
            const currentTime = 1640000000;
            const startTime = currentTime - (30 * 60);
            
            const job = {
                alloc_cpus: 10,
                time_limit: 120,
                start_time: { number: startTime }
            };
            
            // 90 minutes remaining, 10 CPUs
            expect(calculateJobRunMinutes(job, 'cpu')).toBe(900);
        });

        it('should fallback to total_* if alloc_* not available', () => {
            const job = {
                total_cpus: 8,
                total_memory: '5G',
                time_limit: 60,
                start_time: null
            };
            
            expect(calculateJobRunMinutes(job, 'cpu')).toBe(480); // 8 * 60
            expect(calculateJobRunMinutes(job, 'mem')).toBe(307200); // 5120 MB * 60
        });
    });

    describe('formatRunMinutes', () => {
        it('should format memory as GB-days', () => {
            // 1 GB-day = 1024 MB * 1440 min = 1,474,560 MB-minutes
            const result = formatRunMinutes(1474560, 'mem');
            expect(result.display).toBe('1.0 GB-days');
            expect(result.tooltip).toBe('1,474,560 MB-minutes');
            expect(result.rawValue).toBe(1474560);
        });

        it('should format large memory values', () => {
            const result = formatRunMinutes(147456000, 'mem'); // 100 GB-days
            expect(result.display).toBe('100.0 GB-days');
        });

        it('should format CPU as CPU-days', () => {
            const result = formatRunMinutes(1440, 'cpu'); // 1 day
            expect(result.display).toBe('1.0 CPU-days');
            expect(result.tooltip).toBe('1,440 CPU-minutes');
        });

        it('should format large CPU values', () => {
            const result = formatRunMinutes(144000, 'cpu'); // 100 days
            expect(result.display).toBe('100.0 CPU-days');
        });

        it('should format nodes as Node-days', () => {
            const result = formatRunMinutes(2880, 'node'); // 2 days
            expect(result.display).toBe('2.0 Node-days');
            expect(result.tooltip).toBe('2,880 Node-minutes');
        });

        it('should handle zero values', () => {
            const result = formatRunMinutes(0, 'mem');
            expect(result.display).toBe('0 GB-days');
            expect(result.rawValue).toBe(0);
        });

        it('should handle small fractional values', () => {
            const result = formatRunMinutes(737280, 'mem'); // 0.5 GB-days
            expect(result.display).toBe('0.5 GB-days');
        });

        it('should handle unknown resource type', () => {
            const result = formatRunMinutes(1000, 'unknown');
            expect(result.display).toBe('1,000');
            expect(result.tooltip).toBe('1,000 minutes');
        });
    });
});
