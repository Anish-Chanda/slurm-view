const express = require('express');
const { engine } = require('express-handlebars');
const { getCPUsByState, getMemByState, getGPUByState } = require('./handlers/fetchStats.js');
const { DEFAULT_PAGE_SIZE, JOB_STATE_REASONS } = require('./constants.js');
const backgroundPolling = require('./service/backgroundPolling.js');
const dataCache = require('./modules/dataCache.js');
const jobsService = require('./service/jobsService.js');
const { getPartitions } = require('./handlers/fetchPartitions.js');
const { getJobStates } = require('./handlers/fetchJobStates.js');
const { getPendingReason } = require('./handlers/fetchPendingReason.js');
const { validatePartitionName, validatePageNumber, validatePageSize, validateFilterValue } = require('./helpers/inputValidation');


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
      return JSON.stringify(data || []);
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

// Serve static files from public directory
app.use(express.static('public'));

const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/partials/jobs-table', async (req, res) => {
  try {
    const { page, pageSize, ...filters } = req.query;

    // Validate pagination parameters
    const pagination = {
      page: page ? validatePageNumber(page) : 1,
      pageSize: pageSize ? validatePageSize(pageSize) : DEFAULT_PAGE_SIZE
    };

    // Validate filter values
    const validatedFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        validatedFilters[key] = validateFilterValue(value.toString());
      }
    }

    const jobsData = await jobsService.getJobs(validatedFilters, pagination, true);

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
      activeFilters: validatedFilters, // Pass validated filters for pagination links
      defaultPageSize: DEFAULT_PAGE_SIZE
    });
  } catch (error) {
    console.error('[App] Error in /partials/jobs-table:', error.message);
    res.status(400).render('partials/jobsTable', {
      layout: false,
      hasError: true,
      errorMessage: 'Invalid request parameters.',
      jobs: [],
      pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalItems: 0, totalPages: 0 },
      lastUpdated: { jobs: 'N/A' },
      activeFilters: {},
      defaultPageSize: DEFAULT_PAGE_SIZE
    });
  }
});

router.get("/partials/seff-report/:jobid", (req, res) => {
  const { jobid } = req.params;
  
  try {
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
  } catch (error) {
    // Handle validation errors or other exceptions
    console.error(`[App] Error in seff-report for job ${jobid}:`, error.message);
    return res.status(400).render('partials/seffError', {
      layout: false,
      message: error.message || 'Invalid job ID format.'
    });
  }
})

router.get('/api/jobs', async (req, res) => {
  try {
    const { page, pageSize, ...filters } = req.query;

    // Validate pagination parameters
    const pagination = {
      page: page ? validatePageNumber(page) : 1,
      pageSize: pageSize ? validatePageSize(pageSize) : DEFAULT_PAGE_SIZE
    };

    // Validate filter values
    const validatedFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        validatedFilters[key] = validateFilterValue(value.toString());
      }
    }

    const result = await jobsService.getJobs(validatedFilters, pagination, true);
    res.json(result);
  } catch (error) {
    console.error('[App] Error in /api/jobs:', error.message);
    res.status(400).json({
      success: false,
      error: error.message || 'Invalid request parameters'
    });
  }
});

router.get('/api/jobs/:id/pending-reason', async (req, res) => {
  try {
    const reason = await getPendingReason(req.params.id);
    res.json({ success: true, data: reason });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/stats/', async (req, res) => {
  try {
    const partition = req.query.partition;

    // treat 'all' as null and validate partition name if provided
    let partitionParam = null;
    if (partition && partition !== 'all') {
      try {
        partitionParam = validatePartitionName(partition);
      } catch (validationError) {
        return res.status(400).json({
          success: false,
          error: `Invalid partition name: ${validationError.message}`
        });
      }
    }
    
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
  try {
    const { page, pageSize, ...filters } = req.query;

    // Validate pagination parameters
    const pagination = {
      page: page ? validatePageNumber(page) : 1,
      pageSize: pageSize ? validatePageSize(pageSize) : DEFAULT_PAGE_SIZE
    };

    // Validate filter values
    const validatedFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        validatedFilters[key] = validateFilterValue(value.toString());
      }
    }

    // Use the service with caching for the homepage
    const jobs = await jobsService.getJobs(validatedFilters, pagination, true);

  // Get stats
  const cpuStats = getCPUsByState();
  const memStats = getMemByState();
  const gpuStats = await getGPUByState();
  // Get partitions and job states
  let partitions = [];
  let jobStates = [];
  
  try {
    partitions = getPartitions();
  } catch (error) {
    console.error('[App] Failed to fetch partitions:', error.message);
    partitions = [{ id: 'all', name: 'All Partitions' }];
  }
  
  try {
    jobStates = getJobStates();
  } catch (error) {
    console.error('[App] Failed to fetch job states:', error.message);
    jobStates = [];
  }


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
      jobStates,
      jobStateReasons: JOB_STATE_REASONS,
      passengerBaseUri: process.env.PASSENGER_BASE_URI,
      defaultPageSize: DEFAULT_PAGE_SIZE
    });
  } catch (error) {
    console.error('[App] Error in home route:', error.message);
    res.status(500).render('home', {
      title: "Slurm View",
      hasError: true,
      errorMessage: 'An error occurred while processing your request.',
      jobs: [],
      pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalItems: 0, totalPages: 0 },
      cpuStats: { allocated: 0, idle: 0, other: 0, total: 0 },
      memStats: { allocated: 0, idle: 0, down: 0, other: 0, total: 0 },
      gpuStats: { name: "GPU Utilization", children: [], totalGPUs: 0 },
      lastUpdated: { jobs: 'N/A' },
      partitions: [{ id: 'all', name: 'All Partitions' }],
      jobStates: [],
      jobStateReasons: [],
      passengerBaseUri: process.env.PASSENGER_BASE_URI,
      defaultPageSize: DEFAULT_PAGE_SIZE
    });
  }
});

const server = app.listen(port, () => {
  console.log(`[Main Worker] App listening on port ${port}`);
  
  // Initialize account limits on startup
  initializeAccountLimits();
});

/**
 * Initialize account limits cache on startup
 */
async function initializeAccountLimits() {
  try {
    const { fetchAccountLimits } = require('./helpers/accountLimits.js');
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