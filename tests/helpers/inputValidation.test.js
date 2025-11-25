const { 
    validateJobId, 
    validatePartitionName, 
    validatePageNumber, 
    validatePageSize, 
    validateFilterValue, 
    createSafeCommand 
} = require('../../helpers/inputValidation');

describe('Input Validation Tests', () => {
    
    describe('validateJobId', () => {
        test('should accept valid job IDs', () => {
            expect(validateJobId('12345')).toBe('12345');
            expect(validateJobId('12345_1')).toBe('12345_1');
            expect(validateJobId('12345.0')).toBe('12345.0');
            expect(validateJobId('12345.batch')).toBe('12345.batch');
            expect(validateJobId('12345.extern')).toBe('12345.extern');
            expect(validateJobId('12345_1.0')).toBe('12345_1.0');
            expect(validateJobId('999999_999')).toBe('999999_999');
        });

        test('should reject invalid job IDs', () => {
            expect(() => validateJobId('12345; rm -rf /')).toThrow('Invalid Job ID format');
            expect(() => validateJobId('12345`whoami`')).toThrow('Invalid Job ID format');
            expect(() => validateJobId('12345$(id)')).toThrow('Invalid Job ID format');
            expect(() => validateJobId('12345|ls')).toThrow('Invalid Job ID format');
            expect(() => validateJobId('abc123')).toThrow('Invalid Job ID format');
            expect(() => validateJobId('')).toThrow('Invalid Job ID format');
            expect(() => validateJobId(123)).toThrow('Job ID must be a string');
        });

        test('should accept long job IDs (no length limit)', () => {
            const longJobId = '1'.repeat(100);
            expect(validateJobId(longJobId)).toBe(longJobId);
        });
    });

    describe('validatePartitionName', () => {
        test('should accept valid partition names', () => {
            expect(validatePartitionName('compute')).toBe('compute');
            expect(validatePartitionName('gpu-partition')).toBe('gpu-partition');
            expect(validatePartitionName('debug_queue')).toBe('debug_queue');
            expect(validatePartitionName('A1B2C3')).toBe('A1B2C3');
        });

        test('should reject invalid partition names', () => {
            expect(() => validatePartitionName('compute; rm -rf /')).toThrow('Invalid partition name');
            expect(() => validatePartitionName('compute`whoami`')).toThrow('Invalid partition name');
            expect(() => validatePartitionName('compute$(id)')).toThrow('Invalid partition name');
            expect(() => validatePartitionName('compute|ls')).toThrow('Invalid partition name');
            expect(() => validatePartitionName('compute partition')).toThrow('Invalid partition name');
            expect(() => validatePartitionName('')).toThrow('Invalid partition name');
            expect(() => validatePartitionName(123)).toThrow('Partition name must be a string');
        });

        test('should reject overly long partition names', () => {
            const longPartition = 'a'.repeat(65);
            expect(() => validatePartitionName(longPartition)).toThrow('Partition name exceeds Slurm MAX_SLURM_NAME limit');
        });
    });

    describe('validatePageNumber', () => {
        test('should accept valid page numbers', () => {
            expect(validatePageNumber('1')).toBe(1);
            expect(validatePageNumber('100')).toBe(100);
            expect(validatePageNumber(5)).toBe(5);
        });

        test('should reject invalid page numbers', () => {
            expect(() => validatePageNumber('0')).toThrow('Page number must be a positive integer');
            expect(() => validatePageNumber('-1')).toThrow('Page number must be a positive integer');
            expect(() => validatePageNumber('abc')).toThrow('Page number must be a positive integer');
        });
    });

    describe('validatePageSize', () => {
        test('should accept valid page sizes', () => {
            expect(validatePageSize('10')).toBe(10);
            expect(validatePageSize('100')).toBe(100);
            expect(validatePageSize(50)).toBe(50);
        });

        test('should reject invalid page sizes', () => {
            expect(() => validatePageSize('0')).toThrow('Page size must be a positive integer');
            expect(() => validatePageSize('-1')).toThrow('Page size must be a positive integer');
            expect(() => validatePageSize('abc')).toThrow('Page size must be a positive integer');
            expect(() => validatePageSize('1001')).toThrow('Page size is too large');
        });
    });

    describe('validateFilterValue', () => {
        test('should accept safe filter values', () => {
            expect(validateFilterValue('running')).toBe('running');
            expect(validateFilterValue('user123')).toBe('user123');
            expect(validateFilterValue('job-name')).toBe('job-name');
        });

        test('should reject dangerous filter values', () => {
            expect(() => validateFilterValue('value; rm -rf /')).toThrow('Filter value contains invalid characters');
            expect(() => validateFilterValue('value`whoami`')).toThrow('Filter value contains invalid characters');
            expect(() => validateFilterValue('value$(id)')).toThrow('Filter value contains invalid characters');
            expect(() => validateFilterValue('value|ls')).toThrow('Filter value contains invalid characters');
            expect(() => validateFilterValue(123)).toThrow('Filter value must be a string');
        });

        test('should reject overly long filter values', () => {
            const longFilter = 'a'.repeat(201);
            expect(() => validateFilterValue(longFilter)).toThrow('Filter value is too long');
        });

        test('should accept all valid Slurm job states', () => {
            const validStates = [
                'PENDING', 'RUNNING', 'SUSPENDED', 'COMPLETED', 'CANCELLED', 'FAILED',
                'TIMEOUT', 'NODE_FAIL', 'PREEMPTED', 'BOOT_FAIL', 'DEADLINE', 'OUT_OF_MEMORY',
                'COMPLETING', 'CONFIGURING', 'RESIZING', 'RESV_DEL_HOLD', 'REQUEUED',
                'REQUEUE_FED', 'REQUEUE_HOLD', 'REVOKED', 'SIGNALING', 'SPECIAL_EXIT',
                'STAGE_OUT', 'STOPPED'
            ];
            
            validStates.forEach(state => {
                expect(validateFilterValue(state)).toBe(state);
                expect(validateFilterValue(state.toLowerCase())).toBe(state.toLowerCase());
            });
        });
    });

    describe('createSafeCommand', () => {
        test('should create safe commands with valid SLURM commands', () => {
            expect(createSafeCommand('sinfo', ['-p', 'compute'])).toBe("sinfo '-p' 'compute'");
            expect(createSafeCommand('seff', ['12345'])).toBe("seff '12345'");
            expect(createSafeCommand('scontrol', ['show', 'node', '-o'])).toBe("scontrol 'show' 'node' '-o'");
        });

        test('should reject invalid commands', () => {
            expect(() => createSafeCommand('rm', ['-rf', '/'])).toThrow("Command 'rm' is not allowed");
            expect(() => createSafeCommand('cat', ['/etc/passwd'])).toThrow("Command 'cat' is not allowed");
            expect(() => createSafeCommand('sacct', ['--help'])).toThrow("Command 'sacct' is not allowed");
        });

        test('should properly escape arguments with quotes', () => {
            expect(createSafeCommand('sinfo', ["-o", "'%C'"])).toBe("sinfo '-o' ''\"'\"'%C'\"'\"''");
        });

        test('should handle arguments that are not strings', () => {
            expect(() => createSafeCommand('sinfo', [123])).toThrow('All command arguments must be strings');
        });
    });

    describe('Command Injection Prevention', () => {
        test('should prevent common injection patterns in job IDs', () => {
            const maliciousJobIds = [
                '12345; cat /etc/passwd',
                '12345`whoami`',
                '12345$(id)',
                '12345|ls',
                '12345 && rm -rf /',
                '12345\nrm -rf /',
                '12345\r\nwhoami'
            ];

            maliciousJobIds.forEach(jobId => {
                expect(() => validateJobId(jobId)).toThrow();
            });
        });

        test('should prevent common injection patterns in partition names', () => {
            const maliciousPartitions = [
                'compute; cat /etc/passwd',
                'compute`whoami`', 
                'compute$(id)',
                'compute|ls',
                'compute && rm -rf /',
                'compute\nrm -rf /',
                'compute\r\nwhoami'
            ];

            maliciousPartitions.forEach(partition => {
                expect(() => validatePartitionName(partition)).toThrow();
            });
        });
    });
});