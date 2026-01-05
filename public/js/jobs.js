// Job fetching and pagination functionality

function fetchJobs(params) {
  const queryString = new URLSearchParams(params).toString();
  console.log("Fetching jobs table with query string: ", queryString);
  const baseUrl = window.SLURM_CONFIG.baseUri;
  const container = document.getElementById('jobs-table');

  fetch(`${baseUrl}/partials/jobs-table?${queryString}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text();
    })
    .then(html => {
      container.outerHTML = html;

      // Re-attach event listeners
      const newContainer = document.getElementById('jobs-table');
      if (newContainer) {
        attachClientSidePagination(newContainer);
        attachPageSizeSelector(newContainer);
      }
    })
    .catch(err => {
      console.error('Error fetching jobs table:', err);
      container.innerHTML = `<p class="text-red-500">Error fetching job data: ${err.message}</p>`;
    });
}

function attachClientSidePagination(container) {
  container.querySelectorAll('a.pagination-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const url = new URL(this.href);
      const page = url.searchParams.get('page');
      if (page) {
        window.activeFilters.page = parseInt(page);
        updateURL(window.activeFilters);
        fetchJobs(window.activeFilters);
      }
    });
  });
}

function attachPageSizeSelector(container) {
  const pageSizeSelector = container.querySelector('#page-size-select');
  if (pageSizeSelector) {
    pageSizeSelector.addEventListener('change', function() {
      const newPageSize = parseInt(this.value);
      window.activeFilters.pageSize = newPageSize;
      window.activeFilters.page = 1;
      updateURL(window.activeFilters);
      fetchJobs(window.activeFilters);
    });
  }
}

function initializeJobsTable() {
  const initialJobsTable = document.getElementById('jobs-table');
  if(initialJobsTable) {
    attachClientSidePagination(initialJobsTable);
    attachPageSizeSelector(initialJobsTable);
  }
}
