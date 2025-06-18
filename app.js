const express = require('express');
const { engine } = require('express-handlebars');
const { getCPUsByState, getMemByState, getGPUByState } = require('./handlers/fetchStats.js');
const { DEFAULT_PAGE_SIZE } = require('./constants.js');
const backgroundPolling = require('./service/backgroundPolling.js');
const dataCache = require('./modules/dataCache.js');
const jobsService = require('./service/jobsService.js');
const { getPartitions } = require('./handlers/fetchPartitions.js');


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

    split: function (string, separator, index) {
      if (typeof string !== 'string') {
        return '';
      }
      const parts = string.split(separator);
      // Return the part at the index, or an empty string if it doesn't exist
      return parts[index] || '';
    },

    efficiencyColor: function (percentageString, prefix = 'text') {
      if (typeof percentageString !== 'string') return `${prefix}-slate-500`;

      const value = parseFloat(percentageString);
      if (isNaN(value)) return `${prefix}-slate-500`;

      if (prefix === 'bg-opacity') {
        if (value > 75) return 'bg-green-100';
        if (value > 40) return 'bg-yellow-100';
        return 'bg-red-100';
      }

      if (prefix === 'bg') {
        if (value > 75) return 'bg-green-500';
        if (value > 40) return 'bg-yellow-500';
        return 'bg-red-500';
      }

      // Default to 'text' prefix
      if (value > 75) return 'text-green-600';
      if (value > 40) return 'text-yellow-600';
      return 'text-red-600';
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

router.get('/partials/jobs-table', async (req, res) => {
  const { page, pageSize, ...filters } = req.query;

  const pagination = {
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : DEFAULT_PAGE_SIZE
  };

  const jobsData = await jobsService.getJobs(filters, pagination, true);

  // Note: We render the partial directly, not the full 'home' layout
  res.render('partials/jobsTable', {
    layout: false, // Important: prevent the main layout from being applied
    hasError: !jobsData.success,
    errorMessage: jobsData.error,
    jobs: jobsData.success ? jobsData.jobs : [],
    pagination: jobsData.pagination,
    lastUpdated: {
      jobs: jobsData.lastUpdated ? new Date(jobsData.lastUpdated).toLocaleTimeString() : 'N/A'
    },
    activeFilters: filters, // Pass filters for pagination links
    defaultPageSize: DEFAULT_PAGE_SIZE
  });
});

router.get("/partials/seff-report/:jobid", (req, res) => {
  const { jobid } = req.params;
  const result = jobsService.completedJobDetails(jobid);

  if (!result.success) {
    // Render an error partial if seff fails
    return res.status(404).render('partials/seffError', {
      layout: false,
      message: result.message || 'An unknown error occurred.'
    });
  }
  // Render the seff details partial
  res.render('partials/seffReport', {
    layout: false,
    details: result.details
  });
})

router.get('/api/jobs', async (req, res) => {
  const { page, pageSize, ...filters } = req.query;

  const pagination = {
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : DEFAULT_PAGE_SIZE
  }

  const result = await jobsService.getJobs(filters, pagination, true);
  res.json(result);
});

router.get('/api/stats/', async (req, res) => {
  try {
    const partition = req.query.partition;

    // treat 'all' as null
    const partitionParam = partition === 'all' || !partition ? null : partition;
    const cpuStats = getCPUsByState(partitionParam);
    const memStats = getMemByState(partitionParam);
    const gpuStats = await getGPUByState(partitionParam);

    res.json({
      success: true,
      cpuStats,
      memStats,
      gpuStats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/', async (req, res) => {
  const { page, pageSize, ...filters } = req.query;

  const pagination = {
    page: page ? parseInt(page) : 1,
    pageSize: pageSize ? parseInt(pageSize) : DEFAULT_PAGE_SIZE
  };

  // Use the service with caching for the homepage
  const jobs = await jobsService.getJobs(filters, pagination, true);

  // Get stats
  const cpuStats = getCPUsByState();
  const memStats = getMemByState();
  const gpuStats = await getGPUByState();
  //TODO: fetch partitions dynamically
  const partitions = getPartitions()


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
    partitions,
    passengerBaseUri: process.env.PASSENGER_BASE_URI,
    defaultPageSize: DEFAULT_PAGE_SIZE
  });
});

const server = app.listen(port, () => {
  console.log(`[Main Worker] App listening on port ${port}`);
});