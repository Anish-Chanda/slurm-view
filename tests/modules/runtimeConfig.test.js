const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRuntimeConfig, resetRuntimeConfigForTests } = require('../../modules/runtimeConfig');

function createTempConfigDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'slurm-view-config-'));
}

function writeConfigFile(configDir, fileName, content) {
    fs.writeFileSync(path.join(configDir, fileName), content, 'utf8');
}

describe('runtime config loader', () => {
    let tempConfigDir;

    afterEach(() => {
        resetRuntimeConfigForTests();

        if (tempConfigDir && fs.existsSync(tempConfigDir)) {
            fs.rmSync(tempConfigDir, { recursive: true, force: true });
        }

        tempConfigDir = null;
    });

    test('loads a valid single YAML config file', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.33',
            '      mediumMax: 0.66'
        ].join('\n'));

        const config = loadRuntimeConfig(tempConfigDir);

        expect(config).toEqual({
            stats: {
                cpuLoad: {
                    thresholds: {
                        lowMax: 0.33,
                        mediumMax: 0.66
                    }
                }
            }
        });
    });

    test('allows same value definitions across multiple files', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.33',
            '      mediumMax: 0.66'
        ].join('\n'));

        writeConfigFile(tempConfigDir, 'extra.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.33'
        ].join('\n'));

        const config = loadRuntimeConfig(tempConfigDir);

        expect(config.stats.cpuLoad.thresholds.lowMax).toBe(0.33);
        expect(config.stats.cpuLoad.thresholds.mediumMax).toBe(0.66);
    });

    test('fails when the same option differs across files', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.33',
            '      mediumMax: 0.66'
        ].join('\n'));

        writeConfigFile(tempConfigDir, 'override.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.4'
        ].join('\n'));

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/Conflicting configuration/);
    });

    test('fails when config violates schema constraints', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.8',
            '      mediumMax: 0.6'
        ].join('\n'));

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/lowMax must be smaller/);
    });
});
