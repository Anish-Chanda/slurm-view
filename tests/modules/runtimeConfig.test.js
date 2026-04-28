const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRuntimeConfig, resetRuntimeConfigForTests } = require('../../modules/runtimeConfig');

function createTempConfigDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'slurm-view-config-'));
}

function writeConfigFile(configDir, fileName, content) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, fileName), content, 'utf8');
}

function createBaseConfigLines(overrides = {}) {
    const cpuSecondaryLayer = overrides.cpuSecondaryLayer ?? true;
    const memorySecondaryLayer = overrides.memorySecondaryLayer ?? true;
    const gpuSecondaryLayer = overrides.gpuSecondaryLayer ?? true;
    const navbarEnabled = overrides.navbarEnabled ?? true;
    const navbarTitle = overrides.navbarTitle ?? 'Slurm View';
    const navbarColor = overrides.navbarColor ?? '#0f766e';

    return [
        'stats:',
        '  cpuLoad:',
        '    thresholds:',
        '      lowMax: 0.33',
        '      mediumMax: 0.66',
        'ui:',
        '  charts:',
        '    cpu:',
        `      showSecondaryLayer: ${cpuSecondaryLayer}`,
        '    memory:',
        `      showSecondaryLayer: ${memorySecondaryLayer}`,
        '    gpu:',
        `      showSecondaryLayer: ${gpuSecondaryLayer}`,
        '  navbar:',
        `    enabled: ${navbarEnabled}`,
        `    title: ${navbarTitle}`,
        `    color: "${navbarColor}"`
    ];
}

describe('runtime config loader', () => {
    let tempConfigDir;

    afterEach(() => {
        jest.restoreAllMocks();
        resetRuntimeConfigForTests();

        if (tempConfigDir && fs.existsSync(tempConfigDir)) {
            fs.rmSync(tempConfigDir, { recursive: true, force: true });
        }

        tempConfigDir = null;
    });

    test('loads a valid single YAML config file', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', createBaseConfigLines().join('\n'));

        const config = loadRuntimeConfig(tempConfigDir);

        expect(config).toEqual({
            stats: {
                cpuLoad: {
                    thresholds: {
                        lowMax: 0.33,
                        mediumMax: 0.66
                    }
                }
            },
            ui: {
                charts: {
                    cpu: {
                        showSecondaryLayer: true
                    },
                    memory: {
                        showSecondaryLayer: true
                    },
                    gpu: {
                        showSecondaryLayer: true
                    }
                },
                navbar: {
                    enabled: true,
                    title: 'Slurm View',
                    color: '#0f766e'
                }
            }
        });
    });

    test('allows same value definitions across multiple files and warns about duplicates', () => {
        tempConfigDir = createTempConfigDir();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        writeConfigFile(tempConfigDir, 'default.yaml', createBaseConfigLines().join('\n'));

        writeConfigFile(tempConfigDir, 'extra.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.33'
        ].join('\n'));

        const config = loadRuntimeConfig(tempConfigDir);

        expect(config.stats.cpuLoad.thresholds.lowMax).toBe(0.33);
        expect(config.stats.cpuLoad.thresholds.mediumMax).toBe(0.66);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate key 'stats.cpuLoad.thresholds.lowMax'"));
        warnSpy.mockRestore();
    });

    test('uses the first occurrence when the same option differs across files and warns', () => {
        tempConfigDir = createTempConfigDir();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        writeConfigFile(tempConfigDir, '00-first.yaml', createBaseConfigLines({
            cpuSecondaryLayer: false
        }).join('\n'));

        writeConfigFile(tempConfigDir, '10-second.yaml', [
            'ui:',
            '  charts:',
            '    cpu:',
            '      showSecondaryLayer: true'
        ].join('\n'));

        const config = loadRuntimeConfig(tempConfigDir);

        expect(config.ui.charts.cpu.showSecondaryLayer).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Conflicting duplicate key 'ui.charts.cpu.showSecondaryLayer'"));
    });

    test('applies user config before system config so user values override lower-priority defaults', () => {
        tempConfigDir = createTempConfigDir();
        const systemConfigDir = path.join(tempConfigDir, 'system');
        const userConfigDir = path.join(tempConfigDir, 'user');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        writeConfigFile(systemConfigDir, 'default.yaml', createBaseConfigLines().join('\n'));
        writeConfigFile(userConfigDir, 'override.yaml', [
            'ui:',
            '  navbar:',
            '    enabled: false',
            '    title: Custom Slurm View',
            '    color: "#1d4ed8"'
        ].join('\n'));

        const config = loadRuntimeConfig({ systemConfigDir, userConfigDir });

        expect(config.ui.navbar.enabled).toBe(false);
        expect(config.ui.navbar.title).toBe('Custom Slurm View');
        expect(config.ui.navbar.color).toBe('#1d4ed8');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Conflicting duplicate key 'ui.navbar.enabled'"));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Conflicting duplicate key 'ui.navbar.title'"));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Conflicting duplicate key 'ui.navbar.color'"));
    });

    test('fails when config violates schema constraints', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.8',
            '      mediumMax: 0.6',
            'ui:',
            '  charts:',
            '    cpu:',
            '      showSecondaryLayer: true',
            '    memory:',
            '      showSecondaryLayer: true',
            '    gpu:',
            '      showSecondaryLayer: true',
            '  navbar:',
            '    enabled: true',
            '    title: Slurm View',
            '    color: "#0f766e"'
        ].join('\n'));

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/lowMax must be smaller/);
    });

    test('fails when YAML is invalid', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'broken.yaml', 'stats: [unclosed');

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/Invalid YAML in broken.yaml/);
    });

    test('fails when the root YAML structure is not an object', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'broken.yaml', '- just\n- a\n- list\n');

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/Invalid root structure in broken.yaml/);
    });

    test('fails when a config file contains unknown keys', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', [
            ...createBaseConfigLines(),
            'unexpectedOption: true'
        ].join('\n'));

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/Configuration validation failed for default.yaml: root: Unrecognized key/);
    });

    test('fails when navbar color is not a valid hex string', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'default.yaml', createBaseConfigLines({
            navbarColor: 'teal'
        }).join('\n'));

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/ui.navbar.color: must be a valid hex color/);
    });

    test('fails when required values are missing from the final merged config', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'partial.yaml', [
            'stats:',
            '  cpuLoad:',
            '    thresholds:',
            '      lowMax: 0.33'
        ].join('\n'));

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/Final configuration validation failed/);
    });

    test('fails when the required system config directory is missing', () => {
        tempConfigDir = createTempConfigDir();

        expect(() => loadRuntimeConfig(path.join(tempConfigDir, 'missing'))).toThrow(/Configuration directory not found/);
    });

    test('fails when the system config directory has no YAML files', () => {
        tempConfigDir = createTempConfigDir();

        writeConfigFile(tempConfigDir, 'README.txt', 'not yaml');

        expect(() => loadRuntimeConfig(tempConfigDir)).toThrow(/No YAML configuration files found/);
    });
});
