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
  } else if (data.type === 'AssocGrpMemLimit') {
      html += renderAssocGrpMemLimitReason(data);
  } else if (data.type === 'AssocGrpCpuLimit') {
      html += renderAssocGrpCPULimitReason(data);
  } else if (data.type === 'AssocGrpGRES') {
      html += renderAssocGrpGRESReason(data);
  } else if (data.type === 'AssocMaxJobsLimit') {
      html += renderAssocMaxJobsLimitReason(data);
  } else if (data.type === 'AssocGrpMemRunMinutes') {
      html += renderAssocGrpMemRunMinutesReason(data);
  } else if (data.type === 'AssocGrpCPURunMinutes') {
      html += renderAssocGrpCPURunMinutesReason(data);
  } else if (data.type === 'BeginTime') {
      html += renderBeginTimeReason(data);
  } else if (data.type === 'JobHeldUser') {
      html += renderJobHeldUserReason(data);
  } else if (data.type === 'JobHeldAdmin') {
      html += renderJobHeldAdminReason(data);
  } else if (data.type === 'ReqNodeNotAvail') {
      html += renderReqNodeNotAvailReason(data);
  } else if (data.type === 'PartitionDown') {
      html += renderPartitionDownReason(data);
  } else if (data.type === 'PartitionInactive') {
      html += renderPartitionInactiveReason(data);
  } else if (data.type === 'PartitionTimeLimit') {
      html += renderPartitionTimeLimitReason(data);
  } else if (data.type === 'PartitionNodeLimit') {
      html += renderPartitionNodeLimitReason(data);
  } else if (data.type === 'Reservation') {
      html += renderReservationReason(data);
  } else if (data.type === 'InvalidQOS') {
      html += renderInvalidQOSReason(data);
  } else if (data.type === 'JobArrayTaskLimit') {
      html += renderJobArrayTaskLimitReason(data);
  } else if (data.type === 'QOSGrpCpuLimit') {
      html += renderQOSGrpCpuLimitReason(data);
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

function renderAssocGrpMemLimitReason(data) {
  const { analysis, hierarchy, job } = data;
  
  let html = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-slate-800 mb-2">Memory Limit Reached</h3>
      <p class="text-sm text-slate-600">Account "${analysis.limitingAccount}" has reached its memory limit</p>
    </div>
    
    <div class="space-y-4">
      <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-slate-600 font-medium">Account Limit:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.limitFormatted}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Current Usage:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.currentUsageFormatted} (${analysis.percentUsed}%)</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Available:</span>
            <span class="ml-2 ${parseFloat(analysis.percentUsed) > 95 ? 'text-red-600' : 'text-green-600'} font-semibold">${analysis.availableFormatted}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Running Jobs:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.runningJobs}</span>
          </div>
        </div>
      </div>
      
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="text-sm">
          <span class="text-blue-800 font-medium">Your Job Needs:</span>
          <span class="ml-2 text-blue-900 font-semibold">${job.requested.formatted}</span>
        </div>
        ${analysis.shortfall < 0 ? `
          <div class="mt-2 text-sm text-red-700">
            This would exceed the limit by <span class="font-semibold">${analysis.shortfallFormatted}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="border-t border-slate-200 pt-4">
        <button 
          onclick="document.getElementById('hierarchy-${data.jobId}').classList.toggle('hidden')"
          class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
          View Account Hierarchy
        </button>
        <div id="hierarchy-${data.jobId}" class="hidden mt-3 ml-2 font-mono text-sm text-slate-700 bg-slate-50 p-3 rounded border border-slate-200">
          ${renderHierarchyTree(hierarchy)}
        </div>
      </div>
    </div>
  `;
  
  return html;
}

function renderAssocGrpCPULimitReason(data) {
  const { analysis, hierarchy, job } = data;
  
  let html = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-slate-800 mb-2">CPU Limit Reached</h3>
      <p class="text-sm text-slate-600">Account "${analysis.limitingAccount}" has reached its CPU limit</p>
    </div>
    
    <div class="space-y-4">
      <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-slate-600 font-medium">Account Limit:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.limitFormatted} CPUs</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Current Usage:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.currentUsageFormatted} CPUs (${analysis.percentUsed}%)</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Available:</span>
            <span class="ml-2 ${parseFloat(analysis.percentUsed) > 95 ? 'text-red-600' : 'text-green-600'} font-semibold">${analysis.availableFormatted} CPUs</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Running Jobs:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.runningJobs}</span>
          </div>
        </div>
      </div>
      
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="text-sm">
          <span class="text-blue-800 font-medium">Your Job Needs:</span>
          <span class="ml-2 text-blue-900 font-semibold">${job.requested.formatted} CPUs</span>
        </div>
        ${analysis.shortfall < 0 ? `
          <div class="mt-2 text-sm text-red-700">
            This would exceed the limit by <span class="font-semibold">${analysis.shortfallFormatted} CPUs</span>
          </div>
        ` : ''}
      </div>
      
      <div class="border-t border-slate-200 pt-4">
        <button 
          onclick="document.getElementById('hierarchy-${data.jobId}').classList.toggle('hidden')"
          class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
          View Account Hierarchy
        </button>
        <div id="hierarchy-${data.jobId}" class="hidden mt-3 ml-2 font-mono text-sm text-slate-700 bg-slate-50 p-3 rounded border border-slate-200">
          ${renderHierarchyTree(hierarchy)}
        </div>
      </div>
    </div>
  `;
  
  return html;
}

function renderAssocGrpGRESReason(data) {
  const { analysis, hierarchy, job } = data;
  
  // Format GRES type display name
  const gresDisplayName = analysis.gresType === 'gpu' ? 'GPUs' : `GPU (${analysis.gresType})`;
  
  let html = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-slate-800 mb-2">GRES Limit Reached</h3>
      <p class="text-sm text-slate-600">Account "${analysis.limitingAccount}" has reached its ${gresDisplayName} limit</p>
    </div>
    
    <div class="space-y-4">
      <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-slate-600 font-medium">Account Limit:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.limitFormatted} ${gresDisplayName}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Current Usage:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.currentUsageFormatted} ${gresDisplayName} (${analysis.percentUsed}%)</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Available:</span>
            <span class="ml-2 ${parseFloat(analysis.percentUsed) > 95 ? 'text-red-600' : 'text-green-600'} font-semibold">${analysis.availableFormatted} ${gresDisplayName}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Running Jobs:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.runningJobs}</span>
          </div>
        </div>
      </div>
      
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="text-sm">
          <span class="text-blue-800 font-medium">Your Job Needs:</span>
          <span class="ml-2 text-blue-900 font-semibold">${job.requested.formatted}</span>
        </div>
        ${analysis.shortfall < 0 ? `
          <div class="mt-2 text-sm text-red-700">
            This would exceed the limit by <span class="font-semibold">${analysis.shortfallFormatted} ${gresDisplayName}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="border-t border-slate-200 pt-4">
        <button 
          onclick="document.getElementById('hierarchy-${data.jobId}').classList.toggle('hidden')"
          class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
          View Account Hierarchy
        </button>
        <div id="hierarchy-${data.jobId}" class="hidden mt-3 ml-2 font-mono text-sm text-slate-700 bg-slate-50 p-3 rounded border border-slate-200">
          ${renderHierarchyTree(hierarchy)}
        </div>
      </div>
    </div>
  `;
  
  return html;
}

function renderAssocMaxJobsLimitReason(data) {
  const { analysis, hierarchy, job, userJobs } = data;
  
  let html = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-slate-800 mb-2">Per-User Job Limit Reached</h3>
      <p class="text-sm text-slate-600">User "${job.user}" has reached the per-user running job limit</p>
    </div>
    
    <div class="space-y-4">
      <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-slate-600 font-medium">Per-User Job Limit:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.limitFormatted} jobs</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Currently Running:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.currentJobsFormatted} jobs (${analysis.percentUsed}%)</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Available:</span>
            <span class="ml-2 ${parseFloat(analysis.percentUsed) >= 100 ? 'text-red-600' : 'text-green-600'} font-semibold">${analysis.availableFormatted} jobs</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">User:</span>
            <span class="ml-2 text-slate-900 font-semibold">${job.user}</span>
          </div>
        </div>
      </div>
      
      ${userJobs && userJobs.length > 0 ? `
        <div class="border-t border-slate-200 pt-4">
          <button 
            onclick="document.getElementById('user-jobs-${data.jobId}').classList.toggle('hidden')"
            class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
            View Your Running Jobs (${userJobs.length > 10 ? 'Top 10' : userJobs.length})
          </button>
          <div id="user-jobs-${data.jobId}" class="hidden mt-3">
            <div class="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
              <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th class="px-3 py-2 text-left font-medium text-slate-700">Job ID</th>
                      <th class="px-3 py-2 text-left font-medium text-slate-700">Name</th>
                      <th class="px-3 py-2 text-left font-medium text-slate-700">Account</th>
                      <th class="px-3 py-2 text-left font-medium text-slate-700">Partition</th>
                      <th class="px-3 py-2 text-left font-medium text-slate-700">Start Time</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200">
                    ${userJobs.map(j => `
                      <tr class="hover:bg-slate-100">
                        <td class="px-3 py-2 font-mono text-slate-900">${j.jobId}</td>
                        <td class="px-3 py-2 text-slate-700">${j.name}</td>
                        <td class="px-3 py-2 text-slate-700">${j.account}</td>
                        <td class="px-3 py-2 text-slate-700">${j.partition}</td>
                        <td class="px-3 py-2 text-slate-600">${j.startTime}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ${userJobs.length === 10 && analysis.currentJobs > 10 ? `
                <div class="px-3 py-2 bg-slate-100 border-t border-slate-200 text-sm text-slate-600 text-center">
                  ... ${analysis.currentJobs - 10} more jobs
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
  
  return html;
}

function renderAssocGrpMemRunMinutesReason(data) {
  const { analysis, hierarchy, job } = data;
  
  let html = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-slate-800 mb-2">Memory Run-Minutes Limit Reached</h3>
      <p class="text-sm text-slate-600">Account "${analysis.limitingAccount}" has reached its memory run-minutes limit</p>
    </div>
    
    <div class="space-y-4">
      <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-slate-600 font-medium">Account Limit:</span>
            <span class="ml-2 text-slate-900 font-semibold" title="${analysis.limitTooltip}">${analysis.limitFormatted}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Current Usage:</span>
            <span class="ml-2 text-slate-900 font-semibold" title="${analysis.currentUsageTooltip}">${analysis.currentUsageFormatted} (${analysis.percentUsed}%)</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Available:</span>
            <span class="ml-2 ${parseFloat(analysis.percentUsed) > 95 ? 'text-red-600' : 'text-green-600'} font-semibold" title="${analysis.availableTooltip}">${analysis.availableFormatted}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Running Jobs:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.runningJobs}</span>
          </div>
        </div>
      </div>
      
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="text-sm">
          <span class="text-blue-800 font-medium">Your Job's Contribution:</span>
          <span class="ml-2 text-blue-900 font-semibold" title="${job.requested.contribution.toLocaleString()} MB-minutes">${job.requested.contributionFormatted}</span>
        </div>
        <div class="mt-2 text-xs text-blue-700">
          Memory: ${job.requested.memoryFormatted} × Time Limit: ${job.requested.timeLimit}
        </div>
        ${analysis.shortfall < 0 ? `
          <div class="mt-2 text-sm text-red-700">
            This would exceed the limit by <span class="font-semibold" title="${Math.abs(analysis.shortfall).toLocaleString()} MB-minutes">${analysis.shortfallFormatted}</span>
          </div>
        ` : ''}
      </div>
      
      ${analysis.topConsumers && analysis.topConsumers.length > 0 ? `
        <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
          <h4 class="text-sm font-semibold text-slate-700 mb-2">Top Memory Consumers</h4>
          <div class="space-y-1 text-xs">
            ${analysis.topConsumers.map(consumer => `
              <div class="flex justify-between text-slate-600">
                <span>Job ${consumer.jobId}</span>
                <span class="font-mono" title="${consumer.contribution.toLocaleString()} MB-minutes">${consumer.formatted}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="border-t border-slate-200 pt-4">
        <button 
          onclick="document.getElementById('hierarchy-${data.jobId}').classList.toggle('hidden')"
          class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
          View Account Hierarchy
        </button>
        <div id="hierarchy-${data.jobId}" class="hidden mt-3 ml-2 font-mono text-sm text-slate-700 bg-slate-50 p-3 rounded border border-slate-200">
          ${renderHierarchyTree(hierarchy)}
        </div>
      </div>
    </div>
  `;
  
  return html;
}

function renderAssocGrpCPURunMinutesReason(data) {
  const { analysis, hierarchy, job } = data;
  
  let html = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-slate-800 mb-2">CPU Run-Minutes Limit Reached</h3>
      <p class="text-sm text-slate-600">Account "${analysis.limitingAccount}" has reached its CPU run-minutes limit</p>
    </div>
    
    <div class="space-y-4">
      <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-slate-600 font-medium">Account Limit:</span>
            <span class="ml-2 text-slate-900 font-semibold" title="${analysis.limitTooltip}">${analysis.limitFormatted}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Current Usage:</span>
            <span class="ml-2 text-slate-900 font-semibold" title="${analysis.currentUsageTooltip}">${analysis.currentUsageFormatted} (${analysis.percentUsed}%)</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Available:</span>
            <span class="ml-2 ${parseFloat(analysis.percentUsed) > 95 ? 'text-red-600' : 'text-green-600'} font-semibold" title="${analysis.availableTooltip}">${analysis.availableFormatted}</span>
          </div>
          <div>
            <span class="text-slate-600 font-medium">Running Jobs:</span>
            <span class="ml-2 text-slate-900 font-semibold">${analysis.runningJobs}</span>
          </div>
        </div>
      </div>
      
      <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <div class="text-sm">
          <span class="text-blue-800 font-medium">Your Job's Contribution:</span>
          <span class="ml-2 text-blue-900 font-semibold" title="${job.requested.contribution.toLocaleString()} CPU-minutes">${job.requested.contributionFormatted}</span>
        </div>
        <div class="mt-2 text-xs text-blue-700">
          CPUs: ${job.requested.cpus} × Time Limit: ${job.requested.timeLimit}
        </div>
        ${analysis.shortfall < 0 ? `
          <div class="mt-2 text-sm text-red-700">
            This would exceed the limit by <span class="font-semibold" title="${Math.abs(analysis.shortfall).toLocaleString()} CPU-minutes">${analysis.shortfallFormatted}</span>
          </div>
        ` : ''}
      </div>
      
      ${analysis.topConsumers && analysis.topConsumers.length > 0 ? `
        <div class="bg-slate-50 p-4 rounded-lg border border-slate-200">
          <h4 class="text-sm font-semibold text-slate-700 mb-2">Top CPU Consumers</h4>
          <div class="space-y-1 text-xs">
            ${analysis.topConsumers.map(consumer => `
              <div class="flex justify-between text-slate-600">
                <span>Job ${consumer.jobId}</span>
                <span class="font-mono" title="${consumer.contribution.toLocaleString()} CPU-minutes">${consumer.formatted}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="border-t border-slate-200 pt-4">
        <button 
          onclick="document.getElementById('hierarchy-${data.jobId}').classList.toggle('hidden')"
          class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
          <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
          View Account Hierarchy
        </button>
        <div id="hierarchy-${data.jobId}" class="hidden mt-3 ml-2 font-mono text-sm text-slate-700 bg-slate-50 p-3 rounded border border-slate-200">
          ${renderHierarchyTree(hierarchy)}
        </div>
      </div>
    </div>
  `;
  
  return html;
}

function renderBeginTimeReason(data) {
  const currentTime = new Date();
  const scheduledTime = new Date(data.scheduledStartTimestamp * 1000);
  const hoursWait = (data.waitTimeSeconds / 3600).toFixed(1);
  
  return `
    <div class="space-y-3">
      <div class="flex items-center text-blue-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span class="font-semibold">Job Scheduled for Future Start</span>
      </div>
      
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Scheduled Start:</span>
          <span class="font-semibold text-slate-900">${data.scheduledStartTime}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Time Until Start:</span>
          <span class="font-semibold text-blue-600">${hoursWait} hours</span>
        </div>
      </div>
      
      <div class="text-sm text-slate-600">
        <p>This job has been scheduled to start at a specific time using the <code class="bg-slate-100 px-1 rounded">--begin</code> option.</p>
      </div>
    </div>
  `;
}

function renderJobHeldUserReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-amber-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
        </svg>
        <span class="font-semibold">Job Held by User</span>
      </div>
      
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p class="text-slate-700">This job is on hold and will not run until released.</p>
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div class="text-sm font-medium text-slate-700 mb-2">To release this job:</div>
        <code class="block bg-slate-800 text-green-400 px-3 py-2 rounded font-mono text-sm">${data.action}</code>
      </div>
    </div>
  `;
}

function renderJobHeldAdminReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
        </svg>
        <span class="font-semibold">Job Held by Administrator</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4">
        <p class="text-slate-700">This job has been held by a system administrator and cannot run until they release it.</p>
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p class="text-sm text-slate-700">${data.action}</p>
      </div>
    </div>
  `;
}

function renderReqNodeNotAvailReason(data) {
  let nodesHtml = '';
  if (data.nodeStates && data.nodeStates.length > 0) {
    nodesHtml = `
      <div class="mt-4 space-y-2">
        <div class="text-sm font-medium text-slate-700">Node Status:</div>
        <div class="space-y-1">
          ${data.nodeStates.map(node => `
            <div class="bg-slate-50 border border-slate-200 rounded px-3 py-2 flex justify-between items-center">
              <span class="font-mono text-sm">${node.name}</span>
              <div class="text-right">
                <span class="text-xs font-semibold text-red-600">${node.state}</span>
                ${node.reason !== 'none' ? `<div class="text-xs text-slate-500">${node.reason}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else if (data.requestedNodes !== 'Unknown') {
    nodesHtml = `
      <div class="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div class="text-sm text-slate-600">Requested nodes: <span class="font-mono font-semibold text-slate-900">${data.requestedNodes}</span></div>
      </div>
    `;
  }
  
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        <span class="font-semibold">Required Node Not Available</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4">
        <p class="text-slate-700">${data.message}</p>
      </div>
      ${nodesHtml}
      
      <div class="text-sm text-slate-600">
        <p>The node(s) you specifically requested are currently DOWN, DRAINED, or not responding. Contact your system administrator if this persists.</p>
      </div>
    </div>
  `;
}

function renderPartitionDownReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
        </svg>
        <span class="font-semibold">Partition Down</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Partition:</span>
          <span class="font-semibold text-slate-900">${data.partition}</span>
        </div>
        ${data.partitionState ? `
          <div class="flex justify-between items-center">
            <span class="text-slate-600">State:</span>
            <span class="font-semibold text-red-600">${data.partitionState}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p class="text-sm text-slate-700">${data.action}</p>
      </div>
    </div>
  `;
}

function renderPartitionInactiveReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-amber-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
        </svg>
        <span class="font-semibold">Partition Inactive</span>
      </div>
      
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p class="text-slate-700">${data.message}</p>
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p class="text-sm text-slate-700">${data.action}</p>
      </div>
    </div>
  `;
}

function renderPartitionTimeLimitReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span class="font-semibold">Partition Time Limit Exceeded</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Partition:</span>
          <span class="font-semibold text-slate-900">${data.partition}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Your Time Limit:</span>
          <span class="font-semibold text-red-600">${data.jobTimeLimit}</span>
        </div>
        ${data.partitionMaxTime ? `
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Partition Max:</span>
            <span class="font-semibold text-green-600">${data.partitionMaxTime}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div class="text-sm font-medium text-slate-700 mb-2">To fix this:</div>
        <p class="text-sm text-slate-700">${data.action}</p>
      </div>
    </div>
  `;
}

function renderPartitionNodeLimitReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"></path>
        </svg>
        <span class="font-semibold">Partition Node Limit Exceeded</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Partition:</span>
          <span class="font-semibold text-slate-900">${data.partition}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Requested Nodes:</span>
          <span class="font-semibold text-red-600">${data.requestedNodes}</span>
        </div>
        ${data.partitionMaxNodes ? `
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Partition Max:</span>
            <span class="font-semibold text-green-600">${data.partitionMaxNodes}</span>
          </div>
        ` : ''}
        ${data.partitionTotalNodes ? `
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Total Nodes Available:</span>
            <span class="font-semibold text-slate-600">${data.partitionTotalNodes}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div class="text-sm font-medium text-slate-700 mb-2">To fix this:</div>
        <p class="text-sm text-slate-700">${data.action}</p>
      </div>
    </div>
  `;
}

function renderReservationReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-blue-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
        </svg>
        <span class="font-semibold">Waiting for Reservation</span>
      </div>
      
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Reservation:</span>
          <span class="font-semibold text-slate-900">${data.reservationName}</span>
        </div>
        ${data.reservationDetails ? `
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Start Time:</span>
            <span class="font-semibold text-slate-900">${data.reservationDetails.startTime}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-600">End Time:</span>
            <span class="font-semibold text-slate-900">${data.reservationDetails.endTime}</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-600">State:</span>
            <span class="font-semibold text-blue-600">${data.reservationDetails.state}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="text-sm text-slate-600">
        <p>${data.message}</p>
      </div>
    </div>
  `;
}

function renderInvalidQOSReason(data) {
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span class="font-semibold">Invalid QOS</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Requested QOS:</span>
          <span class="font-semibold text-red-600">${data.requestedQOS}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Account:</span>
          <span class="font-semibold text-slate-900">${data.account}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Partition:</span>
          <span class="font-semibold text-slate-900">${data.partition}</span>
        </div>
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div class="text-sm font-medium text-slate-700 mb-2">To check available QOS:</div>
        <code class="block bg-slate-800 text-green-400 px-3 py-2 rounded font-mono text-sm">${data.action}</code>
      </div>
      
      <div class="text-sm text-slate-600">
        <p>The QOS you specified is not available for your account or partition. Resubmit the job with a valid QOS or omit the QOS option.</p>
      </div>
    </div>
  `;
}

function renderJobArrayTaskLimitReason(data) {
  // Parse the task range (e.g., "15-22%4" -> "8 tasks (IDs 15-22)")
  let taskDisplay = data.pendingTasks;
  const taskMatch = data.pendingTasks.match(/^(\d+)-(\d+)(%\d+)?$/);
  if (taskMatch) {
    const startTask = parseInt(taskMatch[1]);
    const endTask = parseInt(taskMatch[2]);
    const taskCount = endTask - startTask + 1;
    taskDisplay = `${taskCount} tasks (IDs ${startTask}-${endTask})`;
  }
  
  return `
    <div class="space-y-3">
      <div class="flex items-center text-blue-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
        </svg>
        <span class="font-semibold">Job Array Task Limit</span>
      </div>
      
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Pending Tasks:</span>
          <span class="font-semibold text-slate-900">${taskDisplay}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">Max Simultaneous:</span>
          <span class="font-semibold text-blue-600">${data.maxSimultaneous}</span>
        </div>
      </div>
      
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <p class="text-sm text-slate-700">${data.explanation}</p>
      </div>
    </div>
  `;
}

function renderQOSGrpCpuLimitReason(data) {
  const analysis = data.analysis;
  const isNearLimit = parseFloat(analysis.percentUsed) > 95;
  const wouldExceed = analysis.shortfall < 0;
  
  return `
    <div class="space-y-3">
      <div class="flex items-center text-red-600">
        <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
        </svg>
        <span class="font-semibold">QOS CPU Limit Reached</span>
      </div>
      
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
        <div class="text-sm font-medium text-slate-700 mb-2">QOS: <span class="font-semibold text-slate-900">${analysis.qosName}</span></div>
        
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Limit:</span>
            <span class="font-semibold text-slate-900">${analysis.limitFormatted} CPUs</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Current Usage:</span>
            <span class="font-semibold ${isNearLimit ? 'text-red-600' : 'text-slate-900'}">${analysis.currentUsageFormatted} CPUs (${analysis.percentUsed}%)</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Available:</span>
            <span class="font-semibold ${analysis.available === 0 ? 'text-red-600' : 'text-green-600'}">${analysis.availableFormatted} CPUs</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-600">Running Jobs:</span>
            <span class="font-semibold text-slate-900">${analysis.runningJobs}</span>
          </div>
        </div>
      </div>
      
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div class="text-sm font-medium text-slate-700 mb-2">Your Job Request:</div>
        <div class="flex justify-between items-center">
          <span class="text-slate-600">CPUs Requested:</span>
          <span class="font-semibold text-slate-900">${data.job.requested.formatted} CPUs</span>
        </div>
      </div>
      
      ${wouldExceed ? `
        <div class="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <div class="flex items-start">
            <svg class="w-5 h-5 text-amber-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div class="flex-1">
              <div class="text-sm font-medium text-amber-900">Job Would Exceed Limit</div>
              <p class="text-xs text-amber-700 mt-1">Your job needs ${analysis.shortfallFormatted} more CPUs than the QOS has available.</p>
            </div>
          </div>
        </div>
      ` : ''}
      
      ${analysis.topConsumers && analysis.topConsumers.length > 0 ? `
        <div class="border-t border-slate-200 pt-4">
          <button 
            onclick="document.getElementById('consumers-${data.jobId}').classList.toggle('hidden')"
            class="text-slate-600 hover:text-slate-900 text-sm font-medium flex items-center">
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
            Top CPU Consumers in ${analysis.qosName} QOS
          </button>
          <div id="consumers-${data.jobId}" class="hidden mt-3 space-y-1">
            ${analysis.topConsumers.map(consumer => `
              <div class="flex justify-between text-sm bg-slate-50 px-3 py-2 rounded">
                <span class="text-slate-600">Job ${consumer.jobId} (${consumer.user})</span>
                <span class="font-mono font-semibold text-slate-900">${consumer.formatted} CPUs</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderHierarchyTree(hierarchy) {
  let html = '';
  
  // Reverse to show root first
  const reversed = [...hierarchy].reverse();
  
  reversed.forEach((node, index) => {
    // Use index for proper indentation (root=0, children increase)
    const indent = '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(index);
    const connector = index === 0 ? '' : (index === reversed.length - 1 ? '└─ ' : '├─ ');
    const status = node.isLimiting ? '<span class="text-red-600 font-semibold">[LIMITING]</span>' : 
                   node.hasLimit ? '' : 
                   '<span class="text-slate-400">[NO LIMIT]</span>';
    
    html += `<div class="leading-relaxed">${indent}${connector}<span class="font-semibold">${node.account}</span> ${status}</div>`;
    
    if (node.hasLimit) {
      html += `<div class="leading-relaxed text-slate-600">${indent}&nbsp;&nbsp;&nbsp;&nbsp;├─ Limit: ${node.limit.formatted}</div>`;
      html += `<div class="leading-relaxed text-slate-600">${indent}&nbsp;&nbsp;&nbsp;&nbsp;├─ Usage: ${node.usage.formatted} (${node.usage.percent}%)</div>`;
      html += `<div class="leading-relaxed text-slate-600">${indent}&nbsp;&nbsp;&nbsp;&nbsp;└─ Available: ${node.available.formatted}</div>`;
    }
  });
  
  return html;
}

function initializeJobDetails() {
  document.addEventListener('click', handleExpandClick);
}
