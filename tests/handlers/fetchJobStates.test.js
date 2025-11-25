const { getJobStates } = require('../../handlers/fetchJobStates');
const { executeCommand } = require('../../helpers/executeCmd');

jest.mock('../../helpers/executeCmd');

describe('getJobStates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should return formatted job states when command succeeds', () => {
        const mockOutput = 'pending\nrunning\ncompleted\nfailed';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(executeCommand).toHaveBeenCalledWith('squeue --helpstate');
        expect(result).toEqual([
            { id: 'PENDING', name: 'Pending' },
            { id: 'RUNNING', name: 'Running' },
            { id: 'COMPLETED', name: 'Completed' },
            { id: 'FAILED', name: 'Failed' }
        ]);
    });

    test('should handle realistic Slurm job states', () => {
        const mockOutput = 'PENDING\nRUNNING\nSUSPENDED\nCOMPLETED\nCANCELLED\nFAILED\nTIMEOUT\nNODE_FAIL\nPREEMPTED\nOUT_OF_MEMORY';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(result).toEqual([
            { id: 'PENDING', name: 'Pending' },
            { id: 'RUNNING', name: 'Running' },
            { id: 'SUSPENDED', name: 'Suspended' },
            { id: 'COMPLETED', name: 'Completed' },
            { id: 'CANCELLED', name: 'Cancelled' },
            { id: 'FAILED', name: 'Failed' },
            { id: 'TIMEOUT', name: 'Timeout' },
            { id: 'NODE_FAIL', name: 'Node_fail' },
            { id: 'PREEMPTED', name: 'Preempted' },
            { id: 'OUT_OF_MEMORY', name: 'Out_of_memory' }
        ]);
    });

    test('should handle mixed case job states', () => {
        const mockOutput = 'Pending\nRUNNING\ncompleted\nFaIlEd';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(result).toEqual([
            { id: 'PENDING', name: 'Pending' },
            { id: 'RUNNING', name: 'Running' },
            { id: 'COMPLETED', name: 'Completed' },
            { id: 'FAILED', name: 'Failed' }
        ]);
    });

    test('should handle job states with underscores', () => {
        const mockOutput = 'NODE_FAIL\nOUT_OF_MEMORY\nBOOT_FAIL';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(result).toEqual([
            { id: 'NODE_FAIL', name: 'Node_fail' },
            { id: 'OUT_OF_MEMORY', name: 'Out_of_memory' },
            { id: 'BOOT_FAIL', name: 'Boot_fail' }
        ]);
    });

    test('should handle whitespace around job states', () => {
        const mockOutput = '  pending  \n  running  \n  completed  \n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(result).toEqual([
            { id: 'PENDING', name: 'Pending' },
            { id: 'RUNNING', name: 'Running' },
            { id: 'COMPLETED', name: 'Completed' }
        ]);
    });

    test('should filter out empty lines', () => {
        const mockOutput = 'pending\n\nrunning\n\n\ncompleted\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(result).toEqual([
            { id: 'PENDING', name: 'Pending' },
            { id: 'RUNNING', name: 'Running' },
            { id: 'COMPLETED', name: 'Completed' }
        ]);
    });

    test('should handle single job state', () => {
        const mockOutput = 'running';
        executeCommand.mockReturnValue(mockOutput);

        const result = getJobStates();

        expect(result).toEqual([
            { id: 'RUNNING', name: 'Running' }
        ]);
    });

    test('should handle empty output', () => {
        executeCommand.mockReturnValue('');
        const result = getJobStates();
        expect(result).toEqual([]);
    });

    test('should handle command error', () => {
        executeCommand.mockImplementation(() => {
            throw new Error('Command failed');
        });
        
        expect(() => getJobStates()).toThrow('Command failed');
    });
});
