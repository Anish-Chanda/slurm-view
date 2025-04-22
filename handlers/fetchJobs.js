const { DEFAULT_PAGE_SIZE } = require("../constants.js");
const { executeCommand } = require("../helpers/executeCmd.js");
const { formatTimeLimit } = require("../helpers/formatTimeLimit.js");

function parseJobsData(data) {
  try {
    const parsedData = JSON.parse(data);
    return parsedData.jobs;
  } catch (e) {
    throw new Error(`Failed to parse job data: ${e.message}`);
  }
}

function formatJobsData(jobs) {
  return jobs.map(job => {
    return {
      job_id: job.job_id || 'N/A',
      partition: job.partition || 'N/A',
      name: job.name || 'N/A',
      user_name: job.user_name || 'N/A',
      job_state: job.job_state || 'N/A',
      time_limit: formatTimeLimit(job.time_limit?.number),
      nodes: job.node_count?.number || 'N/A'
    }
  })
}

function matchesFilter(job, field, filterVal) {
  let value;
  if (field === "jobid") {
    value = job.job_id;
  } else if (field === "partition") {
    value = job.partition;
  } else if (field === "name") {
    value = job.name;
  } else if (field === "user") {
    value = job.user_name;
  } else if (field === "state") {
    const state = job.job_state;
    if (Array.isArray(state)) {
      return state.join(",").toLowerCase().includes(filterVal.toLowerCase());
    }
    value = state;
  }
  return value && String(value).toLowerCase().includes(filterVal.toLowerCase());
}

function getSlurmJobs(filters = {}, pagination = {}) {
  try {
    const output = executeCommand("squeue --json --states=R,PD");
    let jobs = parseJobsData(output);
    console.log(`Showing ${jobs.length} jobs`)

    //Apply filters
    for (const key in filters) {
      console.log("key:", key, "val:", filters[key]);
      const filterVal = filters[key];
      if (filterVal) {
        jobs = jobs.filter((job) => matchesFilter(job, key, filterVal));
      }
    }

    // Pagination
    const page = pagination.page || 1;
    const pageSize = pagination.pageSize || DEFAULT_PAGE_SIZE;
    const totalItems = jobs.length;
    const totalPages = Math.ceil(totalItems / pageSize);

    //calculate start and end
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;

    //format the jobs to remove unnecessary fields
    jobs = formatJobsData(jobs);

    return {
      success: true,
      jobs: jobs.slice(startIdx, endIdx),
      pagination: { page, pageSize, totalItems, totalPages },
    };
  } catch (err) {
    console.error("Error in getSlurmJobs:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  parseJobsData,
  matchesFilter,
  getSlurmJobs,
};
