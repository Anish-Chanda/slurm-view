import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

const SYSTEM_CONFIG_DIR_PATH = path.resolve(__dirname, '..', '..', '..', 'config.d');
const USER_CONFIG_DIR_PATH = path.join(os.homedir(), '.local', 'slurm-view', 'config.d');
const hexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a valid hex color like #123abc');

const cpuLoadThresholdsSchema = z.object({
    lowMax: z.number().gt(0).lt(1),
    mediumMax: z.number().gt(0).lt(1)
}).strict();

type CpuLoadThresholds = z.infer<typeof cpuLoadThresholdsSchema>;

const chartDisplaySchema = z.object({
    showSecondaryLayer: z.boolean()
}).strict();

const navbarSchema = z.object({
    enabled: z.boolean(),
    title: z.string().min(1),
    color: hexColorSchema
}).strict();

const runtimeConfigSchema = z.object({
    stats: z.object({
        cpuLoad: z.object({
            thresholds: cpuLoadThresholdsSchema
        }).strict()
    }).strict(),
    ui: z.object({
        charts: z.object({
            cpu: chartDisplaySchema,
            memory: chartDisplaySchema,
            gpu: chartDisplaySchema
        }).strict(),
        navbar: navbarSchema
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

type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

const runtimeConfigPartialSchema = z.object({
    stats: z.object({
        cpuLoad: z.object({
            thresholds: z.object({
                lowMax: z.number().gt(0).lt(1).optional(),
                mediumMax: z.number().gt(0).lt(1).optional()
            }).strict().optional()
        }).strict().optional()
    }).strict().optional(),
    ui: z.object({
        charts: z.object({
            cpu: z.object({
                showSecondaryLayer: z.boolean().optional()
            }).strict().optional(),
            memory: z.object({
                showSecondaryLayer: z.boolean().optional()
            }).strict().optional(),
            gpu: z.object({
                showSecondaryLayer: z.boolean().optional()
            }).strict().optional()
        }).strict().optional(),
        navbar: z.object({
            enabled: z.boolean().optional(),
            title: z.string().min(1).optional(),
            color: hexColorSchema.optional()
        }).strict().optional()
    }).strict().optional()
}).strict();

let loadedConfig: RuntimeConfig | null = null;

function normalizeComparableValue(value: unknown): unknown {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number(value.toFixed(12));
    }

    return value;
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
    if (typeof left === 'number' && typeof right === 'number') {
        return Math.abs(left - right) < 1e-12;
    }

    return JSON.stringify(left) === JSON.stringify(right);
}

function flattenLeafValues(value: unknown, prefix = '', target: Record<string, unknown> = {}): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!prefix) {
            return target;
        }

        target[prefix] = normalizeComparableValue(value);
        return target;
    }

    Object.keys(value as Record<string, unknown>).sort().forEach((key) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        flattenLeafValues((value as Record<string, unknown>)[key], nextPrefix, target);
    });

    return target;
}

function mergeObjectsWithFirstValue(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const output: Record<string, unknown> = { ...base };

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
            output[key] = mergeObjectsWithFirstValue(
                baseValue as Record<string, unknown>,
                overrideValue as Record<string, unknown>
            );
            return;
        }

        if (Object.prototype.hasOwnProperty.call(output, key)) {
            return;
        }

        output[key] = overrideValue;
    });

    return output;
}

function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const issuePath = issue.path.length ? issue.path.join('.') : 'root';
            return `${issuePath}: ${issue.message}`;
        })
        .join('; ');
}

interface LoadOptionsObject {
    systemConfigDir?: string | null | undefined;
    userConfigDir?: string | null | undefined;
}

type LoadOptions = string | LoadOptionsObject | undefined;

interface NormalizedLoadOptions {
    systemConfigDir: string | null | undefined;
    userConfigDir: string | null | undefined;
}

function normalizeLoadOptions(options: LoadOptions = undefined): NormalizedLoadOptions {
    if (typeof options === 'string') {
        return {
            systemConfigDir: options,
            userConfigDir: null
        };
    }

    return {
        systemConfigDir: options && Object.prototype.hasOwnProperty.call(options, 'systemConfigDir')
            ? (options as LoadOptionsObject).systemConfigDir
            : SYSTEM_CONFIG_DIR_PATH,
        userConfigDir: options && Object.prototype.hasOwnProperty.call(options, 'userConfigDir')
            ? (options as LoadOptionsObject).userConfigDir
            : USER_CONFIG_DIR_PATH
    };
}

interface ConfigFileRef {
    fileName: string;
    filePath: string;
}

function getConfigFilesForDirectory(configDir: string | null | undefined, isOptional: boolean): ConfigFileRef[] {
    if (!configDir || !fs.existsSync(configDir)) {
        if (isOptional) {
            return [];
        }

        throw new Error(`Configuration directory not found: ${configDir}`);
    }

    return fs.readdirSync(configDir)
        .filter((fileName) => fileName.endsWith('.yaml') || fileName.endsWith('.yml'))
        .sort((left, right) => left.localeCompare(right))
        .map((fileName) => ({
            fileName,
            filePath: path.join(configDir, fileName)
        }));
}

function loadRuntimeConfig(options: LoadOptions = undefined): RuntimeConfig {
    const { systemConfigDir, userConfigDir } = normalizeLoadOptions(options);
    const configFiles = [
        ...getConfigFilesForDirectory(userConfigDir, true),
        ...getConfigFilesForDirectory(systemConfigDir, false)
    ];

    if (configFiles.length === 0) {
        throw new Error(`No YAML configuration files found in: ${systemConfigDir}`);
    }

    const seenValuesByPath = new Map<string, { value: unknown; filePath: string }>();
    let mergedConfig: Record<string, unknown> = {};

    configFiles.forEach(({ fileName, filePath }) => {
        const fileContent = fs.readFileSync(filePath, 'utf8');

        let parsedConfig: unknown;
        try {
            parsedConfig = YAML.parse(fileContent);
        } catch (error) {
            throw new Error(`Invalid YAML in ${fileName}: ${(error as Error).message}`);
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
                seenValuesByPath.set(keyPath, { value, filePath });
                return;
            }

            const previous = seenValuesByPath.get(keyPath)!;
            const isSameValue = valuesAreEqual(previous.value, value);
            const duplicateReason = isSameValue ? 'Duplicate key' : 'Conflicting duplicate key';
            console.warn(
                `[Config] WARN ${duplicateReason} '${keyPath}' in ${filePath}; using first occurrence from ${previous.filePath}`
            );
        });

        mergedConfig = mergeObjectsWithFirstValue(mergedConfig, partialValidation.data as Record<string, unknown>);
    });

    const finalValidation = runtimeConfigSchema.safeParse(mergedConfig);
    if (!finalValidation.success) {
        throw new Error(`Final configuration validation failed: ${formatZodError(finalValidation.error)}`);
    }

    loadedConfig = finalValidation.data;
    return loadedConfig;
}

function initializeRuntimeConfig(options: LoadOptions = undefined): RuntimeConfig {
    return loadRuntimeConfig(options);
}

function getRuntimeConfig(): RuntimeConfig {
    if (!loadedConfig) {
        return loadRuntimeConfig();
    }

    return loadedConfig;
}

function resetRuntimeConfigForTests(): void {
    loadedConfig = null;
}

export {
    SYSTEM_CONFIG_DIR_PATH,
    USER_CONFIG_DIR_PATH,
    initializeRuntimeConfig,
    getRuntimeConfig,
    loadRuntimeConfig,
    resetRuntimeConfigForTests,
    runtimeConfigSchema,
    runtimeConfigPartialSchema
};
export type { RuntimeConfig, CpuLoadThresholds };
