const { getPartitions } = require('../../handlers/fetchPartitions');
const { executeCommand } = require('../../helpers/executeCmd');

jest.mock('../../helpers/executeCmd');

describe('getPartitions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should return formatted partitions when command succeeds', () => {
        const mockOutput = 'compute*\ngpu\ndebug\nhighpri\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(executeCommand).toHaveBeenCalledWith('sinfo --noheader --format="%P"');
        expect(result).toEqual([
            { id: 'all', name: 'All Partitions' },
            { id: 'compute', name: 'Compute' },
            { id: 'gpu', name: 'Gpu' },
            { id: 'debug', name: 'Debug' },
            { id: 'highpri', name: 'Highpri' }
        ]);
    });

    test('should handle empty output', () => {
        executeCommand.mockReturnValue('');
        const result = getPartitions();
        expect(result).toEqual([{ id: 'all', name: 'All Partitions' }]);
    });

    test('should handle partitions without default marker', () => {
        const mockOutput = 'gpu\ndebug\ncompute\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(result).toEqual([
            { id: 'all', name: 'All Partitions' },
            { id: 'gpu', name: 'Gpu' },
            { id: 'debug', name: 'Debug' },
            { id: 'compute', name: 'Compute' }
        ]);
    });

    test('should remove asterisk from default partition', () => {
        const mockOutput = 'compute*\ngpu\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(result[1]).toEqual({ id: 'compute', name: 'Compute' });
    });

    test('should capitalize partition names correctly', () => {
        const mockOutput = 'lowercasename\nUPPERCASE\nmIxEdCaSe\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(result).toEqual([
            { id: 'all', name: 'All Partitions' },
            { id: 'lowercasename', name: 'Lowercasename' },
            { id: 'UPPERCASE', name: 'UPPERCASE' },
            { id: 'mIxEdCaSe', name: 'MIxEdCaSe' }
        ]);
    });

    test('should handle whitespace in partition names', () => {
        const mockOutput = '  compute*  \n  gpu  \n  debug  \n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(result).toEqual([
            { id: 'all', name: 'All Partitions' },
            { id: 'compute', name: 'Compute' },
            { id: 'gpu', name: 'Gpu' },
            { id: 'debug', name: 'Debug' }
        ]);
    });

    test('should handle command error', () => {
        executeCommand.mockImplementation(() => {
            throw new Error('sinfo command failed');
        });
        
        expect(() => getPartitions()).toThrow('sinfo command failed');
    });

    test('should handle single partition', () => {
        const mockOutput = 'compute*\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(result).toEqual([
            { id: 'all', name: 'All Partitions' },
            { id: 'compute', name: 'Compute' }
        ]);
    });

    test('should handle multiple default partitions (edge case)', () => {
        // This shouldn't happen in practice, but testing edge case
        const mockOutput = 'compute*\ngpu*\n';
        executeCommand.mockReturnValue(mockOutput);

        const result = getPartitions();

        expect(result).toEqual([
            { id: 'all', name: 'All Partitions' },
            { id: 'compute', name: 'Compute' },
            { id: 'gpu', name: 'Gpu' }
        ]);
    });
});