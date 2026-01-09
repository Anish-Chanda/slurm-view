// Job details expansion, pending reasons, and seff reports

// Helper function to format numbers with commas
function formatNumberWithCommas(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function handleExpandClick(e) {
  const button = e.target.closest('.expand-btn');
  if (!button) return;

  const mainRow = button.closest('.job-row');
  const jobState = mainRow.dataset.jobState;
  const jobId = button.dataset.jobId;
  const detailsRow = document.getElementById(`details-row-${jobId}`);
  const icon = button.querySelector('svg');
  const isExpanded = button.getAttribute('aria-expanded') === 'true';

  button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') !== 'true');
  detailsRow.classList.toggle('hidden');
  icon.classList.toggle('rotate-90');

  if (jobState === 'COMPLETED' && !isExpanded) {
    const reportContainer = detailsRow.querySelector('.seff-report-container');
    if (reportContainer && !reportContainer.dataset.loaded) {
      reportContainer.dataset.loaded = 'true'; 
      fetchAndDisplaySeffReport(jobId, reportContainer);
    }
  }

  if (jobState === 'PENDING' && !isExpanded) {
    const pendingContainer = detailsRow.querySelector('.pending-reason-container');
    if (pendingContainer && !pendingContainer.dataset.loaded) {
      pendingContainer.dataset.loaded = 'true';
      fetchAndDisplayPendingReason(jobId, pendingContainer);
    }
  }
}

function fetchAndDisplayPendingReason(jobId, container) {
  container.innerHTML = `
      <hr class="my-4 border-slate-200">
      <div class="p-4 flex items-center justify-center text-sm text-slate-500">
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Analyzing Pending Reason...
      </div>
  `;

  const baseUrl = window.SLURM_CONFIG.baseUri;
  fetch(`${baseUrl}/api/jobs/${jobId}/pending-reason`)
      .then(res => res.json())
      .then(response => {
          if (response.success) {
              renderPendingReason(response.data, container);
          } else {
              throw new Error(response.error || 'Unknown error from server');
          }
      })
      .catch(err => {
          console.error('Failed to fetch pending reason:', err);
          container.innerHTML = `
              <hr class="my-4 border-slate-200">
              <div class="p-4 text-red-600">
                  Error analyzing pending reason.
              </div>
          `;
      });
}

function renderPendingReason(data, container) {
  let html = '<hr class="my-4 border-slate-200"><div class="p-6 bg-white rounded-lg shadow-sm border border-slate-200 mx-6 mb-6">';
  
  if (data.type === 'Resources') {
      html += renderResourcesPendingReason(data);
  } else if (data.type === 'Priority') {
      html += renderPriorityPendingReason(data);
  } else if (data.type === 'Dependency') {
      html += renderDependencyPendingReason(data);
  } else if (data.type === 'DependencyNeverSatisfied') {
      html += renderDependencyNeverSatisfiedReason(data);
  } else if (data.type === 'Status') {
      html += `
          <div class="flex items-center text-green-600">
              <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
              <span class="font-semibold">${data.message}</span>
          </div>
      `;
  } else if (data.type === 'Other') {
      html += `
          <div class="flex items-center text-blue-600 mb-2">
              <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <div>
                  <h3 class="font-semibold">Pending Reason</h3>
                  <p>${data.message}</p>
              </div>
          </div>
          <div class="text-sm text-slate-500 italic ml-8">
              Detailed analysis for this pending reason is coming soon.
          </div>
      `;
  } else {
      html += `
          <div class="text-red-600">
              <p class="font-semibold">Error</p>
              <p>${data.message || 'Unknown error'}</p>
          </div>
      `;
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderResourcesPendingReason(data) {
  let html = `
      <div class="flex items-center mb-4">
          <div class="bg-yellow-100 text-yellow-800 p-2 rounded-full mr-3">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </div>
          <div>
              <h3 class="text-lg font-semibold text-slate-800">Pending Reason: Resources</h3>
              <p class="text-sm text-slate-600">Scope: ${data.scope}</p>
          </div>
      </div>
  `;

  if (data.summary) {
      html += `
          <div class="grid grid-cols-3 gap-4 mb-6 text-center">
              <div class="bg-slate-50 p-3 rounded border border-slate-200">
                  <div class="text-2xl font-bold text-slate-700">${data.summary.totalNodesAnalyzed}</div>
                  <div class="text-xs text-slate-500 uppercase tracking-wide">Total Nodes</div>
              </div>
              <div class="bg-red-50 p-3 rounded border border-red-100">
                  <div class="text-2xl font-bold text-red-600">${data.summary.blockedNodes}</div>
                  <div class="text-xs text-red-500 uppercase tracking-wide">Blocked Nodes</div>
              </div>
              <div class="bg-green-50 p-3 rounded border border-green-100">
                  <div class="text-2xl font-bold text-green-600">${data.summary.freeNodes}</div>
                  <div class="text-xs text-green-500 uppercase tracking-wide">Free Nodes</div>
              </div>
          </div>
      `;
  }

  if (data.details && data.details.length > 0) {
      html += '<h4 class="font-medium text-slate-700 mb-3">Node Analysis</h4>';
      html += '<div class="space-y-3 max-h-96 overflow-y-auto pr-2">';
      
      data.details.forEach(node => {
          if (node.isBlocked) {
              html += `
                  <div class="border border-red-200 rounded-md p-3 bg-red-50">
                      <div class="flex justify-between items-start mb-2">
                          <span class="font-mono font-semibold text-red-700">${node.name}</span>
                          <span class="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded">Blocked</span>
                      </div>
                      <div class="space-y-1">
                          ${node.bottlenecks.map(b => `
                              <div class="text-sm flex justify-between items-center">
                                  <span class="font-medium text-slate-700">${b.resource}</span>
                                  <span class="text-slate-600">
                                      Req: <span class="font-mono">${b.required}</span> / 
                                      Avail: <span class="font-mono">${b.available}</span>
                                  </span>
                              </div>
                              <div class="w-full bg-red-200 rounded-full h-1.5">
                                  <div class="bg-red-500 h-1.5 rounded-full" style="width: ${Math.min((b.available / b.required) * 100, 100)}%"></div>
                              </div>
                          `).join('')}
                      </div>
                  </div>
              `;
          } else {
               html += `
                  <div class="border border-green-200 rounded-md p-3 bg-green-50 opacity-75">
                      <div class="flex justify-between items-center">
                          <span class="font-mono font-semibold text-green-700">${node.name}</span>
                          <span class="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded">Available</span>
                      </div>
                  </div>
              `;
          }
      });
      html += '</div>';
  }

  return html;
}

function renderPriorityPendingReason(data) {
  const priority = data.priority;
  const competition = data.competition;
  
  let html = `
      <div class="flex items-center mb-4">
          <div class="bg-purple-100 text-purple-800 p-2 rounded-full mr-3">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"></path>
              </svg>
          </div>
          <div>
              <h3 class="text-lg font-semibold text-slate-800">Pending Reason: Priority</h3>
              <p class="text-sm text-slate-600">Partition: ${data.partition}</p>
          </div>
      </div>
  `;

  // Summary Cards
  html += `
      <div class="grid grid-cols-4 gap-3 mb-6 text-center">
          <div class="bg-purple-50 p-3 rounded border border-purple-100">
              <div class="text-2xl font-bold text-purple-700">${formatNumberWithCommas(priority.total)}</div>
              <div class="text-xs text-purple-600 uppercase tracking-wide">Total Priority</div>
          </div>
          <div class="bg-blue-50 p-3 rounded border border-blue-100">
              <div class="text-2xl font-bold text-blue-700">#${formatNumberWithCommas(data.queuePosition)}</div>
              <div class="text-xs text-blue-600 uppercase tracking-wide">Queue Position</div>
          </div>
          <div class="bg-orange-50 p-3 rounded border border-orange-100">
              <div class="text-2xl font-bold text-orange-700">${formatNumberWithCommas(competition.higherPriorityCount)}</div>
              <div class="text-xs text-orange-600 uppercase tracking-wide">Jobs Ahead</div>
          </div>
          <div class="bg-green-50 p-3 rounded border border-green-100">
              <div class="text-2xl font-bold text-green-700">${formatNumberWithCommas(competition.runningJobs)}</div>
              <div class="text-xs text-green-600 uppercase tracking-wide">Running Jobs</div>
          </div>
      </div>
  `;

  // Priority Breakdown
  html += '<h4 class="font-medium text-slate-700 mb-3">Priority Breakdown</h4>';
  html += '<div class="bg-slate-50 rounded-lg p-4 mb-6">';
  
  const componentLabels = {
      age: 'Age',
      fairshare: 'Fair-share',
      jobsize: 'Job Size',
      partition: 'Partition',
      qos: 'QOS',
      site: 'Site'
  };

  const componentColors = {
      age: '#60a5fa',
      fairshare: '#34d399',
      jobsize: '#fbbf24',
      partition: '#a78bfa',
      qos: '#f472b6',
      site: '#fb923c'
  };

  // Priority components table
  html += '<div class="space-y-2">';
  Object.keys(componentLabels).forEach(key => {
      if (priority.weights[key] > 0 || priority.components[key] > 0) {
          const value = priority.components[key];
          const weight = priority.weights[key];
          const contribution = priority.contributions[key];
          const percentage = parseFloat(contribution) || 0;
          
          const multipliedValue = (value * weight).toFixed(2);
          const formattedValue = formatNumberWithCommas(value);
          const formattedWeight = formatNumberWithCommas(weight);
          const formattedMultiplied = formatNumberWithCommas(multipliedValue);
          
          html += `
              <div>
                  <div class="flex justify-between items-center text-sm mb-1">
                      <span class="font-medium text-slate-700">${componentLabels[key]}</span>
                      <span class="text-slate-600">
                          <span class="font-mono">${formattedValue}</span> × <span class="font-mono">${formattedWeight}</span> = 
                          <span class="font-mono text-slate-700">${formattedMultiplied}</span>
                          <span class="mx-2 text-slate-400">•</span>
                          <span class="font-bold text-slate-800">${contribution}%</span>
                      </span>
                  </div>
                  <div class="w-full bg-slate-200 rounded-full h-2">
                      <div class="h-2 rounded-full transition-all" 
                           style="width: ${percentage}%; background-color: ${componentColors[key]}"></div>
                  </div>
              </div>
          `;
      }
  });
  html += '</div>';
  html += '</div>';

  // Competing Jobs
  if (competition.topCompetitors && competition.topCompetitors.length > 0) {
      html += '<h4 class="font-medium text-slate-700 mb-3">Higher Priority Jobs (Top 5)</h4>';
      html += '<div class="space-y-2 max-h-64 overflow-y-auto">';
      
      competition.topCompetitors.forEach(job => {
          const priorityDiff = job.priority - priority.total;
          html += `
              <div class="border border-slate-200 rounded-md p-3 bg-white hover:bg-slate-50 transition-colors">
                  <div class="flex justify-between items-center">
                      <div class="flex items-center gap-3">
                          <span class="font-mono text-sm font-semibold text-slate-700">${job.jobId}</span>
                          <span class="text-sm text-slate-600">${job.user}</span>
                      </div>
                      <div class="flex items-center gap-2">
                          <span class="text-sm font-mono text-slate-700">${job.priority}</span>
                          <span class="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded">+${priorityDiff}</span>
                      </div>
                  </div>
              </div>
          `;
      });
      
      html += '</div>';
      
      if (competition.higherPriorityCount > 5) {
          html += `
              <div class="mt-2 text-sm text-slate-500 text-center">
                  ... and ${competition.higherPriorityCount - 5} more jobs with higher priority
              </div>
          `;
      }
  } else {
      html += `
          <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <p class="text-green-700 font-medium">No jobs ahead in queue!</p>
              <p class="text-green-600 text-sm mt-1">Your job should start soon when resources become available.</p>
          </div>
      `;
  }

  return html;
}

function renderDependencyPendingReason(data) {
  let html = `
      <div class="flex items-center mb-4">
          <div class="bg-blue-100 text-blue-800 p-2 rounded-full mr-3">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
              </svg>
          </div>
          <div>
              <h3 class="text-lg font-semibold text-slate-800">Pending Reason: Dependency</h3>
              <p class="text-sm text-slate-600 font-mono">${data.rawDependency || 'Job dependencies'}</p>
          </div>
      </div>
  `;

  // If simple message, show it and return
  if (data.message) {
      html += `
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p class="text-blue-700">${data.message}</p>
          </div>
      `;
      return html;
  }

  // Status summary
  if (data.dependencies && data.dependencies.length > 0) {
      const satisfiedCount = data.dependencies.filter(d => d.satisfied).length;
      const totalCount = data.dependencies.length;
      
      html += `
          <div class="grid grid-cols-3 gap-3 mb-6 text-center">
              <div class="bg-blue-50 p-3 rounded border border-blue-100">
                  <div class="text-2xl font-bold text-blue-700">${totalCount}</div>
                  <div class="text-xs text-blue-600 uppercase tracking-wide">Total Dependencies</div>
              </div>
              <div class="bg-green-50 p-3 rounded border border-green-100">
                  <div class="text-2xl font-bold text-green-700">${satisfiedCount}</div>
                  <div class="text-xs text-green-600 uppercase tracking-wide">Satisfied</div>
              </div>
              <div class="bg-orange-50 p-3 rounded border border-orange-100">
                  <div class="text-2xl font-bold text-orange-700">${totalCount - satisfiedCount}</div>
                  <div class="text-xs text-orange-600 uppercase tracking-wide">Waiting</div>
              </div>
          </div>
      `;

      // Dependency details
      html += '<h4 class="font-medium text-slate-700 mb-3">Dependency Details</h4>';
      html += '<div class="space-y-4">';
      
      data.dependencies.forEach(dep => {
          const isSatisfied = dep.satisfied;
          const bgColor = isSatisfied ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200';
          const statusColor = isSatisfied ? 'bg-green-200 text-green-800' : 'bg-orange-200 text-orange-800';
          const iconColor = isSatisfied ? 'text-green-600' : 'text-orange-600';
          
          html += `
              <div class="border ${bgColor} rounded-lg p-4">
                  <div class="flex items-start justify-between mb-3">
                      <div class="flex items-center gap-2">
                          ${isSatisfied ? 
                              `<svg class="w-5 h-5 ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>` :
                              `<svg class="w-5 h-5 ${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
                          }
                          <span class="font-semibold text-slate-800 capitalize">${dep.type}</span>
                      </div>
                      <span class="text-xs ${statusColor} px-2 py-1 rounded font-medium">
                          ${isSatisfied ? 'Satisfied' : 'Waiting'}
                      </span>
                  </div>
                  
                  <p class="text-sm text-slate-600 mb-3">${dep.description}</p>
          `;
          
          // Show job details if available
          if (dep.jobs && dep.jobs.length > 0) {
              html += '<div class="space-y-2">';
              dep.jobs.forEach(job => {
                  const stateColor = getJobStateColor(job.state);
                  const jobSatisfied = job.satisfied;
                  
                  html += `
                      <div class="bg-white border border-slate-200 rounded p-3">
                          <div class="flex justify-between items-center mb-2">
                              <div class="flex items-center gap-2">
                                  <span class="font-mono text-sm font-semibold text-slate-700">Job ${job.jobId}</span>
                                  <span class="text-xs ${stateColor} px-2 py-0.5 rounded">${job.state}</span>
                                  ${job.statusMarker ? `<span class="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">(${job.statusMarker})</span>` : ''}
                              </div>
                              ${jobSatisfied ? 
                                  '<svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' :
                                  '<svg class="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
                              }
                          </div>
                          ${job.exitCode !== 'N/A' ? `<div class="text-xs text-slate-600">Exit Code: <span class="font-mono">${job.exitCode}</span></div>` : ''}
                          ${job.endTime !== 'Running' && job.endTime !== 'Unknown' ? `<div class="text-xs text-slate-600">End Time: ${job.endTime}</div>` : ''}
                          ${job.error ? `<div class="text-xs text-slate-500 italic mt-1">${job.error}</div>` : ''}
                      </div>
                  `;
              });
              html += '</div>';
          }
          
          html += '</div>';
      });
      
      html += '</div>';
      
      // Overall status message
      if (data.allSatisfied) {
          html += `
              <div class="mt-4 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <p class="text-green-700 font-medium">All dependencies satisfied!</p>
                  <p class="text-green-600 text-sm mt-1">This job should start soon.</p>
              </div>
          `;
      } else {
          const operatorText = data.operator === 'OR' ? 'At least one dependency must be satisfied' : 'All dependencies must be satisfied';
          html += `
              <div class="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4 text-center">
                  <p class="text-orange-700 font-medium">Waiting for dependencies...</p>
                  <p class="text-orange-600 text-sm mt-1">${operatorText} (${data.operator}).</p>
              </div>
          `;
      }
  }

  return html;
}

function renderDependencyNeverSatisfiedReason(data) {
  let html = `
      <div class="flex items-center mb-4">
          <div class="bg-red-100 text-red-800 p-2 rounded-full mr-3">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
          </div>
          <div>
              <h3 class="text-lg font-semibold text-red-800">Dependency Will Never Be Satisfied</h3>
              <p class="text-sm text-slate-600 font-mono">${data.rawDependency || 'Job dependencies'}</p>
          </div>
      </div>
  `;

  // Critical alert box
  html += `
      <div class="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-6">
          <div class="flex items-start gap-3">
              <svg class="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
              <div>
                  <h4 class="font-bold text-red-800 mb-1">Critical: This Job Will Never Run</h4>
                  <p class="text-red-700 text-sm mb-2">One or more job dependencies have failed or cannot be satisfied. This job is stuck and will not start automatically.</p>
                  ${data.recommendation ? `<p class="text-red-600 text-sm font-medium">Recommendation: ${data.recommendation}</p>` : ''}
              </div>
          </div>
      </div>
  `;

  // If simple message, show it and return
  if (data.message) {
      html += `
          <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <p class="text-slate-700">${data.message}</p>
          </div>
      `;
      return html;
  }

  // Dependency details
  if (data.dependencies && data.dependencies.length > 0) {
      html += '<h4 class="font-medium text-slate-700 mb-3">Failed Dependencies</h4>';
      html += '<div class="space-y-4">';
      
      data.dependencies.forEach(dep => {
          html += `
              <div class="border border-red-200 bg-red-50 rounded-lg p-4">
                  <div class="flex items-start justify-between mb-3">
                      <div class="flex items-center gap-2">
                          <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                          <span class="font-semibold text-red-800 capitalize">${dep.type}</span>
                      </div>
                      <span class="text-xs bg-red-200 text-red-800 px-2 py-1 rounded font-medium">
                          Failed
                      </span>
                  </div>
                  
                  <p class="text-sm text-slate-600 mb-3">${dep.description}</p>
          `;
          
          // Show job details if available
          if (dep.jobs && dep.jobs.length > 0) {
              html += '<div class="space-y-2">';
              dep.jobs.forEach(job => {
                  const stateColor = getJobStateColor(job.state);
                  
                  html += `
                      <div class="bg-white border border-red-200 rounded p-3">
                          <div class="flex justify-between items-center mb-2">
                              <div class="flex items-center gap-2">
                                  <span class="font-mono text-sm font-semibold text-slate-700">Job ${job.jobId}</span>
                                  <span class="text-xs ${stateColor} px-2 py-0.5 rounded">${job.state}</span>
                                  ${job.statusMarker ? `<span class="text-xs bg-red-200 text-red-800 px-2 py-0.5 rounded font-mono">(${job.statusMarker})</span>` : ''}
                              </div>
                              <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                          </div>
                          ${job.reason ? `<div class="text-xs text-red-700 font-medium mb-1">Reason: ${job.reason}</div>` : ''}
                          ${job.exitCode !== 'N/A' ? `<div class="text-xs text-slate-600">Exit Code: <span class="font-mono">${job.exitCode}</span></div>` : ''}
                          ${job.endTime !== 'Running' && job.endTime !== 'Unknown' && job.endTime !== 'N/A' ? `<div class="text-xs text-slate-600">End Time: ${job.endTime}</div>` : ''}
                          ${job.error ? `<div class="text-xs text-slate-500 italic mt-1">${job.error}</div>` : ''}
                      </div>
                  `;
              });
              html += '</div>';
          }
          
          html += '</div>';
      });
      
      html += '</div>';
      
      // Action recommendation
      html += `
          <div class="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 class="font-medium text-amber-900 mb-2">Recommended Actions</h4>
              <ul class="list-disc list-inside text-sm text-amber-800 space-y-1">
                  <li>Cancel this job using: <code class="bg-amber-100 px-1 py-0.5 rounded">scancel ${data.jobId}</code></li>
                  <li>Review and fix the dependencies in your job submission script</li>
                  <li>Check why the dependent job(s) failed</li>
                  <li>Resubmit the job chain with corrected dependencies</li>
              </ul>
          </div>
      `;
  }

  return html;
}

// Helper function to get color classes for job states
function getJobStateColor(state) {
  const colors = {
      'COMPLETED': 'bg-green-100 text-green-700',
      'RUNNING': 'bg-blue-100 text-blue-700',
      'PENDING': 'bg-yellow-100 text-yellow-700',
      'FAILED': 'bg-red-100 text-red-700',
      'CANCELLED': 'bg-gray-100 text-gray-700',
      'TIMEOUT': 'bg-red-100 text-red-700',
      'UNKNOWN': 'bg-slate-100 text-slate-700',
      'NOT_FOUND': 'bg-gray-100 text-gray-700'
  };
  return colors[state] || 'bg-slate-100 text-slate-700';
}

function fetchAndDisplaySeffReport(jobId, container) {
  container.innerHTML = `
      <hr class="my-4 border-slate-200">
      <div class="p-4 flex items-center justify-center text-sm text-slate-500">
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading Efficiency Report...
      </div>
  `;

  const baseUrl = window.SLURM_CONFIG.baseUri;
  fetch(`${baseUrl}/partials/seff-report/${jobId}`)
      .then(response => response.text())
      .then(html => {
          container.innerHTML = html;
      })
      .catch(err => {
          console.error('Failed to fetch seff report:', err);
          container.innerHTML = `
              <hr class="my-4 border-slate-200">
              <div class="p-4 text-red-600">
                  A network error occurred while fetching the report. Please check your connection.
              </div>
          `;
      });
}

function initializeJobDetails() {
  document.addEventListener('click', handleExpandClick);
}
