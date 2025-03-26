import { execSync } from 'child_process';

export function getSlurmJobs() {
  let squeueOutput;
  try {
    squeueOutput = execSync('squeue --json --states=R,PD', { maxBuffer: 1024 * 1024 * 10 });
  } catch (err) {
    console.error('Error retrieving squeue data:', err.message);
    return `<p>Error retrieving job data: ${err.message}</p>`;
  }

  let squeueData;
  try {
    squeueData = JSON.parse(squeueOutput);
  } catch (err) {
    console.error('Invalid JSON from squeue:', err.message);
    return `<p>Error parsing job data: ${err.message}</p>`;
  }

  const jobs = squeueData.jobs;

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

  html += `
      </tbody>
    </table>
  `;

  return html;
}
