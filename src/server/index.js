const { createApp } = require('./app.js');
const backgroundPolling = require('../../service/backgroundPolling.js');
const dataCache = require('../../modules/dataCache.js');
const {
  initializeRuntimeConfig,
  SYSTEM_CONFIG_DIR_PATH,
  USER_CONFIG_DIR_PATH
} = require('../../modules/runtimeConfig.js');

const port = 3000;

function startServer() {
  // Load runtime configuration on startup, fail if config is invalid or cannot be loaded
  try {
    initializeRuntimeConfig();
    console.log(`[Config] Runtime configuration loaded from ${SYSTEM_CONFIG_DIR_PATH} with optional user overrides from ${USER_CONFIG_DIR_PATH}`);
  } catch (error) {
    console.error(`[Config] Failed to load runtime configuration: ${error.message}`);
    process.exit(1);
  }
  //start the background polling service

  console.log("[Main Worker] Starting background worker service...");
  backgroundPolling.start();

  const app = createApp();

  const server = app.listen(port, () => {
    console.log(`[Main Worker] App listening on port ${port}`);

    // Initialize account limits on startup
    initializeAccountLimits();

    // Initialize QOS limits on startup
    initializeQOSLimits();
  });

  // Graceful shutdown
  function gracefulShutdown() {
    console.log('[Main Worker] Graceful shutdown initiated...');

    // First stop the background polling
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

  return { app, server };
}

/**
 * Initialize account limits cache on startup
 */
async function initializeAccountLimits() {
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
        console.error('[Background] Failed to refresh account limits:', error.message);
      }
    }, 3600000); // 1 hour

  } catch (error) {
    console.error('[Startup] Failed to initialize account limits:', error.message);
  }
}

/**
 * Initialize QOS limits cache on startup
 */
async function initializeQOSLimits() {
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
        console.error('[Background] Failed to refresh QOS limits:', error.message);
      }
    }, 3600000); // 1 hour

  } catch (error) {
    console.error('[Startup] Failed to initialize QOS limits:', error.message);
  }
}

module.exports = { startServer };
