const { executeCommand } = require("../helpers/executeCmd.js");

function parseJobsData(data) {
  try {
    const parsedData = JSON.parse(data)
    return parsedData.jobs;
  } catch (e) {
    throw new Error(`Failed to parse job data: ${e.message}`);
  }
}

function matchesFilter(job, field, filterVal) {
  let value;
  if (field === 'jobid') {
    value = job.job_id;
  } else if (field === 'partition') {
    value = job.partition;
  } else if (field === 'name') {
    value = job.name;
  } else if (field === 'user') {
    value = job.user_name;
  } else if (field === 'state') {
    const state = job.job_state;
    if (Array.isArray(state)) {
      return state.join(',').toLowerCase().includes(filterVal.toLowerCase());
    }
    value = state;
  }
  return value && String(value).toLowerCase().includes(filterVal.toLowerCase());
}

function getSlurmJobs(filters = {}) {
  try {
    const output = executeCommand("squeue --json --states=R,PD");
    let jobs = parseJobsData(output);

    for (const key in filters) {
      console.log('key:', key, 'val:', filters[key])
      const filterVal = filters[key];
      if (filterVal) {
        jobs = jobs.filter(job => matchesFilter(job, key, filterVal));
      }
    }

    return { success: true, jobs: jobs }
  } catch (err) {
    console.error('Error in getSlurmJobs:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  parseJobsData,
  matchesFilter,
  getSlurmJobs,
};