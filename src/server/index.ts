import type { Express } from 'express';
import type { Server } from 'http';
import { createApp } from './app.js';
import { negotiateDataParser, SlurmCompatibilityError } from './adapters/slurm/parser-version.js';
import type { SupportedDataParser } from './adapters/slurm/parser-version.js';
import { JobsCache, JOBS_POLL_INTERVAL_MS } from './cache/jobs-cache.js';
import { NodesCache } from './cache/nodes-cache.js';
import { PartitionsCache } from './cache/partitions-cache.js';
import { PollingService } from './services/polling-service.js';

// Legacy CommonJS boundaries (not migrated in this chunk).
const backgroundPolling = require('../../service/backgroundPolling.js');
const dataCache = require('../../modules/dataCache.js');
const {
  initializeRuntimeConfig,
  SYSTEM_CONFIG_DIR_PATH,
  USER_CONFIG_DIR_PATH
} = require('../../modules/runtimeConfig.js');

const port: number = 3000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ServerRuntime {
  app: Express;
  server: Server;
  jobsCache: JobsCache;
  nodesCache: NodesCache;
  partitionsCache: PartitionsCache;
  jobsPoller: PollingService;
}

async function initializeSlurm(): Promise<SupportedDataParser> {
  const parser = await negotiateDataParser();
  console.log(`[Slurm] Using data_parser ${parser}`);
  return parser;
}

async function startServer(): Promise<ServerRuntime> {
  // Load runtime configuration on startup, fail if config is invalid or cannot be loaded
  try {
    initializeRuntimeConfig();
    console.log(`[Config] Runtime configuration loaded from ${SYSTEM_CONFIG_DIR_PATH} with optional user overrides from ${USER_CONFIG_DIR_PATH}`);
  } catch (error) {
    console.error(`[Config] Failed to load runtime configuration: ${getErrorMessage(error)}`);
    process.exit(1);
  }

  // Startup exits non-zero below on permanent Slurm incompatibility.
  // Later transient controller failures surface as 503s, never exits.
  const parser = await initializeSlurm().catch((error: unknown): SupportedDataParser => {
    const detail = error instanceof SlurmCompatibilityError
      ? error.message
      : getErrorMessage(error);
    console.error(`[Slurm] ${detail}`);
    process.exit(1);
  });

  const jobsCache = new JobsCache({ parser });
  const nodesCache = new NodesCache({ parser });
  const partitionsCache = new PartitionsCache({ parser });

  // The legacy poller keeps running for pending-reason, which still
  // reads the legacy per-job cache.
  const jobsPoller = new PollingService(
    (signal) => jobsCache.refresh({ signal }),
    JOBS_POLL_INTERVAL_MS
  );
  console.log('[Main Worker] Starting v1 jobs snapshot poller...');
  jobsPoller.start();

  //start the legacy background polling service
  console.log('[Main Worker] Starting background worker service...');
  backgroundPolling.start();

  const app = createApp({ jobsCache, nodesCache, partitionsCache });

  const server: Server = app.listen(port, () => {
    console.log(`[Main Worker] App listening on port ${port}`);

    // Initialize account limits on startup
    initializeAccountLimits();

    // Initialize QOS limits on startup
    initializeQOSLimits();
  });

  // Graceful shutdown
  function gracefulShutdown(): void {
    console.log('[Main Worker] Graceful shutdown initiated...');

    // First stop the background polling
    jobsPoller.stop();
    backgroundPolling.stop();

    // Then close the server
    server.close(() => {
      console.log('Express server closed.');
      process.exit(0);
    });

    // If server hasn't closed in 10 seconds, force shutdown
    setTimeout(() => {
      console.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  return { app, server, jobsCache, nodesCache, partitionsCache, jobsPoller };
}

/**
 * Initialize account limits cache on startup
 */
async function initializeAccountLimits(): Promise<void> {
  try {
    const { fetchAccountLimits } = require('../../helpers/accountLimits.js');
    const limitsData = fetchAccountLimits();
    dataCache.setAccountLimits(limitsData);
    console.log('[Startup] Account limits initialized');

    // Refresh hourly
    setInterval(() => {
      try {
        if (dataCache.isAccountLimitsStale()) {
          const updatedLimits = fetchAccountLimits();
          dataCache.setAccountLimits(updatedLimits);
          console.log('[Background] Account limits refreshed');
        }
      } catch (error) {
        console.error('[Background] Failed to refresh account limits:', getErrorMessage(error));
      }
    }, 3600000); // 1 hour

  } catch (error) {
    console.error('[Startup] Failed to initialize account limits:', getErrorMessage(error));
  }
}

/**
 * Initialize QOS limits cache on startup
 */
async function initializeQOSLimits(): Promise<void> {
  try {
    const { fetchQOSLimits } = require('../../helpers/accountLimits.js');
    const qosData = fetchQOSLimits();
    dataCache.setQOSLimits(qosData);
    console.log('[Startup] QOS limits initialized');

    // Refresh hourly
    setInterval(() => {
      try {
        if (dataCache.isQOSLimitsStale()) {
          const updatedQOS = fetchQOSLimits();
          dataCache.setQOSLimits(updatedQOS);
          console.log('[Background] QOS limits refreshed');
        }
      } catch (error) {
        console.error('[Background] Failed to refresh QOS limits:', getErrorMessage(error));
      }
    }, 3600000); // 1 hour

  } catch (error) {
    console.error('[Startup] Failed to initialize QOS limits:', getErrorMessage(error));
  }
}

export { startServer };
export type { ServerRuntime };

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`[Startup] Failed to start server: ${getErrorMessage(error)}`);
    process.exit(1);
  });
}
