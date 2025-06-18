const dataCache = require('../modules/dataCache');
const { getSlurmJobs, matchesFilter } = require('../handlers/fetchJobs');
const { DEFAULT_PAGE_SIZE } = require('../constants');
const { getSeffDetails } = require('../handlers/fetchSeffDetails');

/**
 * JobsService - Provides methods for fetching and filtering jobs data
 * with caching support
 */
class JobsService {
  /**
   * Get jobs with filtering and pagination, using cache when available
   * @param {Object} filters - Filter criteria
   * @param {Object} pagination - Pagination options
   * @param {boolean} useCache - Whether to use cached data if available
   * @returns {Object} Jobs result with pagination metadata
   */
  async getJobs(filters = {}, pagination = {}, useCache = true) {
    // Set default pagination values
    const page = pagination.page || 1;
    const pageSize = pagination.pageSize || DEFAULT_PAGE_SIZE;

    // Try to use cached data if allowed
    const cachedJobs = useCache ? dataCache.getData('jobs') : null;

    if (cachedJobs && !dataCache.isStale('jobs')) {
      console.log('[Jobs Service] Using cached jobs data');

      // Apply filters to cached data
      let filteredJobs = [...cachedJobs.jobs]; // Clone to avoid modifying cache

      for (const key in filters) {
        const filterVal = filters[key];
        if (filterVal) {
          filteredJobs = filteredJobs.filter(job =>
            matchesFilter(job, key, filterVal)
          );
        }
      }

      // Apply pagination
      const startIdx = (page - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      const totalItems = filteredJobs.length;

      return {
        success: true,
        jobs: filteredJobs.slice(startIdx, endIdx),
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize)
        },
        lastUpdated: dataCache.getLastUpdated('jobs'),
        fromCache: true
      };
    }

    // No cache or stale cache, fetch directly
    console.log('Fetching fresh jobs data');
    const result = await getSlurmJobs(filters, { page, pageSize });
    result.fromCache = false;

    return result;
  }


  completedJobDetails(jobId) {
    const cachedDetails = dataCache.getSeffData(jobId);
    if (cachedDetails) {
      console.log(`[Jobs Service] Serving seff for ${jobId} from cache.`);
      return {
        success: true,
        details: cachedDetails,
        fromCache: true,
      }
    }

    // if not found in cache, then get data form seff handler and add to cache
    try {
      console.log(`[Jobs Service] No seff cache for ${jobId}. Fetching new details...`);

      const seffDetails = getSeffDetails(jobId);
      dataCache.setSeffData(jobId, seffDetails);
      return {
        success: true,
        details: seffDetails,
        fromCache: false,
      };
    } catch (error) {
      console.error(`[Jobs Service] Error fetching seff details for ${jobId}:`, error.message);
      return {
        success: false,
        error: true,
        message: `Could not get efficiency report for Job ${jobId}.`
      };
    }
  }
}

module.exports = new JobsService(); // Export as singleton