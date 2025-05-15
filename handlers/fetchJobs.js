const { DEFAULT_PAGE_SIZE } = require("../constants.js");
const { executeCommand } = require("../helpers/executeCmd.js");
const { formatTimeLeft } = require("../helpers/formatTimeLeft.js");
const { formatTime } = require("../helpers/formatTime.js");

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

    //extract job state
    const jobState = Array.isArray(job.job_state) ? job.job_state[0] : job.job_state;

    return {
      job_id: job.job_id || 'N/A',
      partition: job.partition || 'N/A',
      name: job.name || 'N/A',
      user_name: job.user_name || 'N/A',
      job_state: jobState || 'N/A',
      time_limit: formatTime(job.time_limit?.number),
      time_left: formatTimeLeft(job.time_limit?.number, job.start_time?.number, jobState),
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
    const output = executeCommand("squeue --json --states=R,PD"); //TODO: if jobs are being fetched directly we would only be able to filter in running and pending jobs now
    let jobs = parseJobsData(output);
    console.log(`[Jobs Handler] Fetched ${jobs.length} jobs from Slurm`);

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
