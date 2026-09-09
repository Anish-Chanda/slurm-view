const { startServer } = require('./dist/server/index.js');

startServer().catch((error) => {
  console.error('[Startup] Failed to start server:', error && error.message ? error.message : error);
  process.exit(1);
});
