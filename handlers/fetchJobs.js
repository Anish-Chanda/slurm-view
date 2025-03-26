import { executeCommand } from "../helpers/executeCmd.js";

// This function is used to generate an HTML table from the job data.
export function genJobsTable(jobs) {
  //html table
  let html = `
    <table class="w-full border-collapse">
      <thead>
        <tr class="even:bg-gray-50 hover:bg-gray-100">
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">JobID</th>
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">Partition</th>
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">Name</th>
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">User</th>
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">State</th>
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">Time Limit</th>
          <th class="bg-red-600 text-white px-4 py-3 text-left border border-gray-200">Nodes</th>
        </tr>
      </thead>
      <tbody>
  `;

  // table rows
  if (jobs && Array.isArray(jobs)) {
    for (const job of jobs) {
      html += `
        <tr class="even:bg-gray-50 hover:bg-gray-100">
          <td class="px-4 py-3 text-left border border-gray-200">${job.job_id ?? 'N/A'}</td>
          <td class="px-4 py-3 text-left border border-gray-200">${job.partition ?? 'N/A'}</td>
          <td class="px-4 py-3 text-left border border-gray-200">${job.name ?? 'N/A'}</td>
          <td class="px-4 py-3 text-left border border-gray-200">${job.user_name ?? 'N/A'}</td>
          <td class="px-4 py-3 text-left border border-gray-200">${Array.isArray(job.job_state) ? job.job_state.join(', ') : job.job_state ?? 'N/A'}</td>
          <td class="px-4 py-3 text-left border border-gray-200">${job.time_limit?.number ?? 'N/A'}</td>
          <td class="px-4 py-3 text-left border border-gray-200">${job.node_count?.number ?? 'N/A'}</td>
        </tr>
      `;
    }
  }

  //closing tags
  html += `
      </tbody>
    </table>
  `;

  return html;
}

export function parseJobsData(data) {
  try {
    const parsedData = JSON.parse(data)
    return parsedData.jobs;
  } catch (e) {
    throw new Error(`Failed to parse job data: ${e.message}`);
  }
}

export function getSlurmJobs() {
  try {
    const output = executeCommand("squeue --json --states=R,PD");
    const jobs = parseJobsData(output);
    return genJobsTable(jobs);
  } catch (err) {
    console.error('Error in getSlurmJobs:', err.message);
    return `<p>Error retrieving job data: ${err.message}</p>`;
  }
}