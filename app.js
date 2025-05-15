const express = require('express');
const { getSlurmJobs } = require('./handlers/fetchJobs.js');
const { engine } = require('express-handlebars');
const { getCPUsByState, getMemByState, getGPUByState } = require('./handlers/fetchStats.js');
const { DEFAULT_PAGE_SIZE } = require('./constants.js');
const backgroundPolling = require('./service/backgroundPolling.js');
const dataCache = require('./modules/dataCache.js');
const jobsService = require('./service/jobsService.js');


const app = express();
const port = 3000;

// Create handlebars instance with helpers
const hbs = engine({
  helpers: {
    // Math helpers
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => a / b,
    min: (a, b) => Math.min(a, b),
    max: (a, b) => Math.max(a, b),

    // Comparison helpers
    eq: (a, b) => a === b,
    ne: (a, b) => a !== b,
    lt: (a, b) => a < b,
    gt: (a, b) => a > b,
    lte: (a, b) => a <= b,
    gte: (a, b) => a >= b,

    // Generate array of page numbers for pagination
    paginationRange: (currentPage, totalPages) => {
      const delta = 2; // Number of pages before and after current page
      const range = [];
      const startPage = Math.max(1, currentPage - delta);
      const endPage = Math.min(totalPages, currentPage + delta);

      for (let i = startPage; i <= endPage; i++) {
        range.push(i);
      }

      return range;
    },

    json: function (data) {
      return JSON.stringify(data);
    },

  }
})

//start the background polling service
console.log("[Main Worker] Starting background worker service...");
backgroundPolling.start();

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

//handlebars config
app.engine('handlebars', hbs);
app.set('view engine', 'handlebars');
app.set('views', './views');

const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/api/jobs', async (req, res) => {
  const { page, pageSize, ...filters } = req.query;

  const pagination = {
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : DEFAULT_PAGE_SIZE
  }

  const result = getSlurmJobs(filters, pagination);
  res.json(result);
});

// router.get('/api/stats/cpu-s', (req, res) => {
//   try {
//     const stats = getCPUsByState();
//     res.json(stats);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

router.get('/', async (req, res) => {
  const { page, pageSize, ...filters } = req.query;
  
  const pagination = {
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : DEFAULT_PAGE_SIZE
  };
  
  // Use the service with caching for the homepage
  const jobs = jobsService.getJobs(filters, pagination, true);
  
  // Get stats
  const cpuStats = getCPUsByState();
  const memStats = getMemByState();
  const gpuStats = getGPUByState();
  
  res.render('home', {
    title: "Slurm View",
    hasError: !jobs.success,
    errorMessage: jobs.error,
    jobs: jobs.success ? jobs.jobs : [],
    pagination: jobs.pagination,
    cpuStats,
    memStats,
    gpuStats,
    lastUpdated: {
      jobs: jobs.lastUpdated ? new Date(jobs.lastUpdated).toLocaleTimeString() : 'N/A'
    },
    passengerBaseUri: process.env.PASSENGER_BASE_URI,
    defaultPageSize: DEFAULT_PAGE_SIZE
  });
});

const server = app.listen(port, () => {
  console.log(`[Main Worker] App listening on port ${port}`);
});