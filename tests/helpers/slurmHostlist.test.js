const { expandSlurmHostlist } = require('../../helpers/slurmHostlist');

describe('expandSlurmHostlist', () => {
    it('expands a simple Slurm node range', () => {
        expect(expandSlurmHostlist('node[01-03]')).toEqual(['node01', 'node02', 'node03']);
    });

    it('expands comma-separated ranges and plain hosts', () => {
        expect(expandSlurmHostlist('node[01-02,05],gpu09')).toEqual(['node01', 'node02', 'node05', 'gpu09']);
    });

    it('expands multiple bracket groups', () => {
        expect(expandSlurmHostlist('rack[1-2]n[01-02]')).toEqual([
            'rack1n01',
            'rack1n02',
            'rack2n01',
            'rack2n02'
        ]);
    });
});
