// Job filtering and URL management functionality

function getQueryParams() {
  const params = {};
  const searchParams = new URLSearchParams(window.location.search);
  for (const [key, value] of searchParams.entries()) {
    // Convert page and pageSize to numbers
    if (key === 'page' || key === 'pageSize') {
      params[key] = parseInt(value);
    } else {
      params[key] = value;
    }
  }
  return params;
}

function updateURL(params) {
  const url = new URL(window.location);
  url.search = new URLSearchParams(params).toString();
  window.history.pushState({}, '', url);
}

function renderFilters(params) {
  const container = document.getElementById('active-filters');
  container.innerHTML = '';

  const reservedParams = ['page', 'pageSize'];

  for (const key in params) {
    if(reservedParams.includes(key)) continue;

    const badge = document.createElement('span');
    badge.className = "bg-gray-300 text-gray-700 rounded-full px-3 py-1 text-sm flex items-center";
    badge.innerHTML = `${key}: ${params[key]} <button data-key="${key}" class="ml-2 text-red-500 font-bold">x</button>`;
    container.appendChild(badge);
  }
}

function parseQuickFilters(filterString) {
  const filters = {};
  const validFilterTypes = ['jobid', 'partition', 'name', 'user', 'account', 'state', 'statereason'];
  
  // Split by spaces but handle quoted values
  const pairs = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < filterString.length; i++) {
    const char = filterString[i];
    
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ' ' && !inQuotes) {
      if (current.trim()) {
        pairs.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    pairs.push(current.trim());
  }
  
  // Parse each key:value pair
  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex > 0 && colonIndex < pair.length - 1) {
      const key = pair.substring(0, colonIndex).trim().toLowerCase();
      let value = pair.substring(colonIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      if (validFilterTypes.includes(key) && value) {
        filters[key] = value;
      }
    }
  }
  
  return filters;
}

function isQuickFilterFormat(filterString) {
  const quickFilterRegex = /\b(jobid|partition|name|user|account|state|statereason)\s*:\s*\S+/i;
  return quickFilterRegex.test(filterString);
}

function updateAddButton(filterValue) {
  const addButton = document.getElementById('add-filter-btn');
  const fieldSelect = document.getElementById('filter-field');
  
  if (isQuickFilterFormat(filterValue)) {
    addButton.textContent = 'Add Filters';
    addButton.className = 'bg-purple-500 hover:bg-purple-600 text-white rounded p-2 transition-colors';
    fieldSelect.disabled = true;
    fieldSelect.style.opacity = '0.5';
  } else {
    addButton.textContent = 'Add Filter';
    addButton.className = 'bg-blue-500 hover:bg-blue-600 text-white rounded p-2 transition-colors';
    fieldSelect.disabled = false;
    fieldSelect.style.opacity = '1';
  }
}

function initializeFilters() {
  // Initialize active filters from the URL
  window.activeFilters = getQueryParams();
  renderFilters(window.activeFilters);

  // Filter form submission
  document.getElementById('filter-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const fieldSelect = document.getElementById('filter-field');
    const filterField = fieldSelect.value;
    const filterValue = document.getElementById('filter-value').value.trim();
    
    if (filterValue) {
      if (isQuickFilterFormat(filterValue)) {
        // Handle multiple filters
        const quickFilters = parseQuickFilters(filterValue);
        const filterCount = Object.keys(quickFilters).length;
        
        if (filterCount > 0) {
          Object.assign(window.activeFilters, quickFilters);
          
          // Show feedback message
          const filterValueInput = document.getElementById('filter-value');
          const originalPlaceholder = filterValueInput.placeholder;
          filterValueInput.placeholder = `Added ${filterCount} filter${filterCount > 1 ? 's' : ''}!`;
          filterValueInput.style.backgroundColor = '#f0f9ff';
          
          setTimeout(() => {
            filterValueInput.placeholder = originalPlaceholder;
            filterValueInput.style.backgroundColor = '';
          }, 2000);
        } else {
          // Show error for invalid format
          const filterValueInput = document.getElementById('filter-value');
          const originalPlaceholder = filterValueInput.placeholder;
          filterValueInput.placeholder = 'Invalid format! Use: key1:value1 key2:value2';
          filterValueInput.style.backgroundColor = '#fef2f2';
          
          setTimeout(() => {
            filterValueInput.placeholder = originalPlaceholder;
            filterValueInput.style.backgroundColor = '';
          }, 3000);
          return;
        }
      } else {
        // Handle single filter
        window.activeFilters[filterField] = filterValue;
      }
      
      // Reset to page 1 for new filters
      window.activeFilters.page = 1;
      renderFilters(window.activeFilters);
      updateURL(window.activeFilters);
    }
    document.getElementById('filter-value').value = '';
    updateAddButton('');
  });

  // Filter removal
  document.getElementById('active-filters').addEventListener('click', function (e) {
    if (e.target.tagName.toLowerCase() === 'button') {
      const key = e.target.getAttribute('data-key');
      delete window.activeFilters[key];
      window.activeFilters.page = 1;
      renderFilters(window.activeFilters);
      updateURL(window.activeFilters);
      fetchJobs(window.activeFilters);
    }
  });

  // Apply filters button
  document.getElementById('save-filter-btn').addEventListener('click', function () {
    console.log("Clicked save, fetching with filters:", window.activeFilters);
    fetchJobs(window.activeFilters);
  });

  // Quick filter format detection
  document.getElementById('filter-value').addEventListener('input', function (e) {
    updateAddButton(e.target.value);
  });
}
