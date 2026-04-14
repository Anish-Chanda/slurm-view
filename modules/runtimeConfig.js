const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { z } = require('zod');

const CONFIG_DIR_PATH = path.resolve(__dirname, '..', 'config.d');

const cpuLoadThresholdsSchema = z.object({
    lowMax: z.number().gt(0).lt(1),
    mediumMax: z.number().gt(0).lt(1)
}).strict();

const runtimeConfigSchema = z.object({
    stats: z.object({
        cpuLoad: z.object({
            thresholds: cpuLoadThresholdsSchema
        }).strict()
    }).strict()
}).strict().superRefine((value, ctx) => {
    if (value.stats.cpuLoad.thresholds.lowMax >= value.stats.cpuLoad.thresholds.mediumMax) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stats', 'cpuLoad', 'thresholds', 'lowMax'],
            message: 'stats.cpuLoad.thresholds.lowMax must be smaller than stats.cpuLoad.thresholds.mediumMax'
        });
    }
});

const runtimeConfigPartialSchema = z.object({
    stats: z.object({
        cpuLoad: z.object({
            thresholds: z.object({
                lowMax: z.number().gt(0).lt(1).optional(),
                mediumMax: z.number().gt(0).lt(1).optional()
            }).strict().optional()
        }).strict().optional()
    }).strict().optional()
}).strict();

let loadedConfig = null;

function normalizeComparableValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number(value.toFixed(12));
    }

    return value;
}

function valuesAreEqual(left, right) {
    if (typeof left === 'number' && typeof right === 'number') {
        return Math.abs(left - right) < 1e-12;
    }

    return JSON.stringify(left) === JSON.stringify(right);
}

function flattenLeafValues(value, prefix = '', target = {}) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!prefix) {
            return target;
        }

        target[prefix] = normalizeComparableValue(value);
        return target;
    }

    Object.keys(value).sort().forEach((key) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        flattenLeafValues(value[key], nextPrefix, target);
    });

    return target;
}

function mergeObjects(base, override) {
    const output = { ...base };

    Object.keys(override).forEach((key) => {
        const baseValue = output[key];
        const overrideValue = override[key];

        if (
            baseValue &&
            overrideValue &&
            typeof baseValue === 'object' &&
            typeof overrideValue === 'object' &&
            !Array.isArray(baseValue) &&
            !Array.isArray(overrideValue)
        ) {
            output[key] = mergeObjects(baseValue, overrideValue);
            return;
        }

        output[key] = overrideValue;
    });

    return output;
}

function formatZodError(error) {
    return error.issues
        .map((issue) => {
            const issuePath = issue.path.length ? issue.path.join('.') : 'root';
            return `${issuePath}: ${issue.message}`;
        })
        .join('; ');
}

function loadRuntimeConfig(configDir = CONFIG_DIR_PATH) {
    if (!fs.existsSync(configDir)) {
        throw new Error(`Configuration directory not found: ${configDir}`);
    }

    const yamlFiles = fs.readdirSync(configDir)
        .filter((fileName) => fileName.endsWith('.yaml') || fileName.endsWith('.yml'))
        .sort((left, right) => left.localeCompare(right));

    if (yamlFiles.length === 0) {
        throw new Error(`No YAML configuration files found in: ${configDir}`);
    }

    const seenValuesByPath = new Map();
    let mergedConfig = {};

    yamlFiles.forEach((fileName) => {
        const filePath = path.join(configDir, fileName);
        const fileContent = fs.readFileSync(filePath, 'utf8');

        let parsedConfig;
        try {
            parsedConfig = YAML.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid YAML in ${fileName}: ${error.message}`);
        }

        const normalizedConfig = parsedConfig === null ? {} : parsedConfig;

        if (typeof normalizedConfig !== 'object' || Array.isArray(normalizedConfig)) {
            throw new Error(`Invalid root structure in ${fileName}: expected a YAML mapping/object`);
        }

        const partialValidation = runtimeConfigPartialSchema.safeParse(normalizedConfig);
        if (!partialValidation.success) {
            throw new Error(`Configuration validation failed for ${fileName}: ${formatZodError(partialValidation.error)}`);
        }

        const leafValues = flattenLeafValues(partialValidation.data);
        Object.entries(leafValues).forEach(([keyPath, value]) => {
            if (!seenValuesByPath.has(keyPath)) {
                seenValuesByPath.set(keyPath, { value, fileName });
                return;
            }

            const previous = seenValuesByPath.get(keyPath);
            if (!valuesAreEqual(previous.value, value)) {
                throw new Error(
                    `Conflicting configuration for '${keyPath}' between ${previous.fileName} (${previous.value}) and ${fileName} (${value})`
                );
            }
        });

        mergedConfig = mergeObjects(mergedConfig, partialValidation.data);
    });

    const finalValidation = runtimeConfigSchema.safeParse(mergedConfig);
    if (!finalValidation.success) {
        throw new Error(`Final configuration validation failed: ${formatZodError(finalValidation.error)}`);
    }

    loadedConfig = finalValidation.data;
    return loadedConfig;
}

function initializeRuntimeConfig(configDir = CONFIG_DIR_PATH) {
    return loadRuntimeConfig(configDir);
}

function getRuntimeConfig() {
    if (!loadedConfig) {
        return loadRuntimeConfig();
    }

    return loadedConfig;
}

function resetRuntimeConfigForTests() {
    loadedConfig = null;
}

module.exports = {
    CONFIG_DIR_PATH,
    initializeRuntimeConfig,
    getRuntimeConfig,
    loadRuntimeConfig,
    resetRuntimeConfigForTests
};
