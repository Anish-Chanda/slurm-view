import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { engine } from 'express-handlebars';

// Legacy CommonJS boundaries (not migrated in this commit).
const { getCPUsByState, getMemByState, getGPUByState } = require('../../handlers/fetchStats.js');
const { DEFAULT_PAGE_SIZE, JOB_STATE_REASONS } = require('../../constants.js');
const jobsService = require('../../service/jobsService.js');
const { getRuntimeConfig } = require('../../modules/runtimeConfig.js');
const { getPartitions } = require('../../handlers/fetchPartitions.js');
const { getJobStates } = require('../../handlers/fetchJobStates.js');
const { getPendingReason } = require('../../handlers/fetchPendingReason.js');
const { validatePartitionName, validatePageNumber, validatePageSize, validateFilterValue } = require('../../helpers/inputValidation');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getContrastingTextColor(hexColor: unknown): string {
  if (typeof hexColor !== 'string') {
    return '#ffffff';
  }

  let normalized = hexColor.replace('#', '');
  if (normalized.length === 3) {
    normalized = normalized.split('').map((char: string) => `${char}${char}`).join('');
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const brightness = ((red * 299) + (green * 587) + (blue * 114)) / 1000;

  return brightness >= 140 ? '#0f172a' : '#ffffff';
}

function createApp(): Express {
  const app = express();

  // Create handlebars instance with helpers
  const hbs = engine({
    helpers: {
      // Math helpers
      add: (a: number, b: number) => a + b,
      subtract: (a: number, b: number) => a - b,
      multiply: (a: number, b: number) => a * b,
      divide: (a: number, b: number) => a / b,
      min: (a: number, b: number) => Math.min(a, b),
      max: (a: number, b: number) => Math.max(a, b),

      // Comparison helpers
      eq: (a: unknown, b: unknown) => a === b,
      ne: (a: unknown, b: unknown) => a !== b,
      lt: (a: number, b: number) => a < b,
      gt: (a: number, b: number) => a > b,
      lte: (a: number, b: number) => a <= b,
      gte: (a: number, b: number) => a >= b,

      // Generate array of page numbers for pagination
      paginationRange: (currentPage: number, totalPages: number) => {
        const delta = 2; // Number of pages before and after current page
        const range: number[] = [];
        const startPage = Math.max(1, currentPage - delta);
        const endPage = Math.min(totalPages, currentPage + delta);

        for (let i = startPage; i <= endPage; i++) {
          range.push(i);
        }

        return range;
      },

      json: function (data: unknown) {
        return JSON.stringify(data || []);
      },

      split: function (value: unknown, separator: string, index: number) {
        if (typeof value !== 'string') {
          return '';
        }
        const parts = value.split(separator);
        // Return the part at the index, or an empty string if it doesn't exist
        return parts[index] || '';
      },

      efficiencyColor: function (percentageString: unknown, prefix = 'text') {
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

      contrastingTextColor: getContrastingTextColor
    }
  })

  //handlebars config
  app.engine('handlebars', hbs);
  app.set('view engine', 'handlebars');
  app.set('views', path.join(PROJECT_ROOT, 'views'));

  // Serve static files from public directory
  app.use(express.static(path.join(PROJECT_ROOT, 'public')));

  const passengerBaseUri: string = process.env.PASSENGER_BASE_URI || '';

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.passengerBaseUri = passengerBaseUri;
    res.locals.runtimeConfig = getRuntimeConfig();
    next();
  });

  const router = express.Router();
  app.use(passengerBaseUri || '/', router);

  router.get('/partials/jobs-table', async (req: Request, res: Response) => {
    try {
      const { page, pageSize, ...filters } = req.query;

      // Validate pagination parameters
      const pagination = {
        page: page ? validatePageNumber(page) : 1,
        pageSize: pageSize ? validatePageSize(pageSize) : DEFAULT_PAGE_SIZE
      };

      // Validate filter values
      const validatedFilters: Record<string, string> = {};
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
      console.error('[App] Error in /partials/jobs-table:', getErrorMessage(error));
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

  router.get("/partials/seff-report/:jobid", (req: Request, res: Response) => {
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
      console.error(`[App] Error in seff-report for job ${jobid}:`, getErrorMessage(error));
      return res.status(400).render('partials/seffError', {
        layout: false,
        message: getErrorMessage(error) || 'Invalid job ID format.'
      });
    }
  })

  router.get('/api/jobs', async (req: Request, res: Response) => {
    try {
      const { page, pageSize, ...filters } = req.query;

      // Validate pagination parameters
      const pagination = {
        page: page ? validatePageNumber(page) : 1,
        pageSize: pageSize ? validatePageSize(pageSize) : DEFAULT_PAGE_SIZE
      };

      // Validate filter values
      const validatedFilters: Record<string, string> = {};
      for (const [key, value] of Object.entries(filters)) {
        if (value) {
          validatedFilters[key] = validateFilterValue(value.toString());
        }
      }

      const result = await jobsService.getJobs(validatedFilters, pagination, true);
      res.json(result);
    } catch (error) {
      console.error('[App] Error in /api/jobs:', getErrorMessage(error));
      res.status(400).json({
        success: false,
        error: getErrorMessage(error) || 'Invalid request parameters'
      });
    }
  });

  router.get('/api/jobs/:id/pending-reason', async (req: Request, res: Response) => {
    try {
      const reason = await getPendingReason(req.params.id);
      res.json({ success: true, data: reason });
    } catch (err) {
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  router.get('/api/stats/', async (req: Request, res: Response) => {
    try {
      const partition = req.query.partition;

      // treat 'all' as null and validate partition name if provided
      let partitionParam: string | null = null;
      if (partition && partition !== 'all') {
        try {
          partitionParam = validatePartitionName(partition);
        } catch (validationError) {
          return res.status(400).json({
            success: false,
            error: `Invalid partition name: ${getErrorMessage(validationError)}`
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
        error: getErrorMessage(err)
      });
    }
  });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { page, pageSize, ...filters } = req.query;

      // Validate pagination parameters
      const pagination = {
        page: page ? validatePageNumber(page) : 1,
        pageSize: pageSize ? validatePageSize(pageSize) : DEFAULT_PAGE_SIZE
      };

      // Validate filter values
      const validatedFilters: Record<string, string> = {};
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
      console.error('[App] Failed to fetch partitions:', getErrorMessage(error));
      partitions = [{ id: 'all', name: 'All Partitions' }];
    }

    try {
      jobStates = getJobStates();
    } catch (error) {
      console.error('[App] Failed to fetch job states:', getErrorMessage(error));
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
        defaultPageSize: DEFAULT_PAGE_SIZE
      });
    } catch (error) {
      console.error('[App] Error in home route:', getErrorMessage(error));
      res.status(500).render('home', {
        title: "Slurm View",
        hasError: true,
        errorMessage: 'An error occurred while processing your request.',
        jobs: [],
        pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, totalItems: 0, totalPages: 0 },
        cpuStats: { allocated: 0, idle: 0, other: 0, total: 0, loadGroups: { low: 0, medium: 0, high: 0 } },
        memStats: { allocated: 0, allocatedUsed: 0, idle: 0, down: 0, other: 0, total: 0 },
        gpuStats: { name: "GPU Utilization", children: [], totalGPUs: 0 },
        lastUpdated: { jobs: 'N/A' },
        partitions: [{ id: 'all', name: 'All Partitions' }],
        jobStates: [],
        jobStateReasons: [],
        defaultPageSize: DEFAULT_PAGE_SIZE
      });
    }
  });

  // Temporary React verification route serving the Vite build output.
  // Scoped to <base>/react/ only; does not intercept /api/*, existing
  // Handlebars routes, public assets, or the OOD base URI itself.
  const reactDistPath = path.join(PROJECT_ROOT, 'dist', 'client');
  const reactRoute = `${passengerBaseUri}/react`;
  // Express matches routes non-strictly, so this also matches the trailing-
  // slash URL; only redirect the slash-less form and let the index route
  // below serve /react/ itself.
  app.get(reactRoute, (req: Request, res: Response, next: NextFunction) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(`${reactRoute}/`);
  });
  app.use(`${reactRoute}/`, express.static(reactDistPath, { index: false }));
  app.get(`${reactRoute}/`, (req: Request, res: Response) => {
    res.sendFile(path.join(reactDistPath, 'index.html'));
  });

  return app;
}

export { createApp };
