// Autocomplete functionality for filter inputs

function showAutocomplete(matches, wordStartIndex, prefix) {
  const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
  autocompleteDropdown.innerHTML = '';
  autocompleteDropdown.classList.remove('hidden');
  window.autocompleteFocus = -1;

  matches.forEach(match => {
    const div = document.createElement('div');
    div.className = 'p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0';
    div.innerHTML = `<span class="font-medium">${match.name}</span> <span class="text-gray-500 text-xs ml-1">(${match.id})</span>`;
    div.addEventListener('click', function() {
      insertValue(match.id, wordStartIndex, prefix);
    });
    autocompleteDropdown.appendChild(div);
  });
}

function insertValue(value, wordStartIndex, prefix) {
  const filterInput = document.getElementById('filter-value');
  const originalText = filterInput.value;
  const textBeforeWord = originalText.substring(0, wordStartIndex);
  
  // Find where the current word ends
  let wordEndIndex = originalText.indexOf(' ', wordStartIndex);
  if (wordEndIndex === -1) wordEndIndex = originalText.length;
  
  const textAfterWord = originalText.substring(wordEndIndex);
  const newText = textBeforeWord + prefix + value + textAfterWord;
  filterInput.value = newText;
  
  closeAutocomplete();
  filterInput.focus();
  
  // Move cursor to end of inserted value
  const newCursorPos = textBeforeWord.length + prefix.length + value.length; 
  filterInput.setSelectionRange(newCursorPos, newCursorPos);
  
  // Trigger input event to update buttons
  filterInput.dispatchEvent(new Event('input'));
}

function closeAutocomplete() {
  const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
  autocompleteDropdown.innerHTML = '';
  autocompleteDropdown.classList.add('hidden');
  window.autocompleteFocus = -1;
}

function addActive(items) {
  if (!items) return;
  removeActive(items);
  if (window.autocompleteFocus >= items.length) window.autocompleteFocus = 0;
  if (window.autocompleteFocus < 0) window.autocompleteFocus = items.length - 1;
  items[window.autocompleteFocus].classList.add('bg-blue-100');
  items[window.autocompleteFocus].scrollIntoView({ block: 'nearest' });
}

function removeActive(items) {
  for (let i = 0; i < items.length; i++) {
    items[i].classList.remove('bg-blue-100');
  }
}

function initializeAutocomplete() {
  const filterInput = document.getElementById('filter-value');
  const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
  window.autocompleteFocus = -1;

  filterInput.addEventListener('input', function(e) {
    const val = this.value;
    const cursorPosition = this.selectionStart;
    
    // Find the word at the cursor
    const textBeforeCursor = val.substring(0, cursorPosition);
    const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
    const currentWordStart = lastSpaceIndex + 1;
    const currentWord = val.substring(currentWordStart, cursorPosition);
    
    let matches = [];
    let prefix = '';

    // Check if we are typing a partition filter
    if (currentWord.toLowerCase().startsWith('partition:')) {
      prefix = 'partition:';
      const filterVal = currentWord.substring(10).toLowerCase();
      matches = window.SLURM_CONFIG.partitions.filter(p => 
        p.id !== 'all' && 
        p.id.toLowerCase().includes(filterVal)
      );
    } else if (currentWord.toLowerCase().startsWith('state:')) {
      prefix = 'state:';
      const filterVal = currentWord.substring(6).toLowerCase();
      matches = window.SLURM_CONFIG.jobStates.filter(s => 
        s.id.toLowerCase().includes(filterVal) || 
        s.name.toLowerCase().includes(filterVal)
      );
    } else if (currentWord.toLowerCase().startsWith('statereason:')) {
      prefix = 'statereason:';
      const filterVal = currentWord.substring(12).toLowerCase();
      matches = window.SLURM_CONFIG.jobStateReasons.filter(r => 
        r.toLowerCase().includes(filterVal)
      ).map(r => ({ id: r, name: r }));
    } else {
      // Check if the currently selected dropdown field supports autocomplete
      const selectedField = document.getElementById('filter-field').value;
      
      if (selectedField === 'partition') {
        matches = window.SLURM_CONFIG.partitions.filter(p => 
          p.id !== 'all' && 
          p.id.toLowerCase().includes(currentWord.toLowerCase())
        );
      } else if (selectedField === 'state') {
        matches = window.SLURM_CONFIG.jobStates.filter(s => 
          s.id.toLowerCase().includes(currentWord.toLowerCase()) || 
          s.name.toLowerCase().includes(currentWord.toLowerCase())
        );
      } else if (selectedField === 'statereason') {
        matches = window.SLURM_CONFIG.jobStateReasons.filter(r => 
          r.toLowerCase().includes(currentWord.toLowerCase())
        ).map(r => ({ id: r, name: r }));
      }
    }
      
    if (matches.length > 0) {
      showAutocomplete(matches, currentWordStart, prefix);
    } else {
      closeAutocomplete();
    }
  });

  filterInput.addEventListener('keydown', function(e) {
    const items = autocompleteDropdown.getElementsByTagName('div');
    if (autocompleteDropdown.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      window.autocompleteFocus++;
      addActive(items);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      window.autocompleteFocus--;
      addActive(items);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (window.autocompleteFocus > -1) {
        e.preventDefault();
        if (items[window.autocompleteFocus]) items[window.autocompleteFocus].click();
      }
    } else if (e.key === 'Escape') {
      closeAutocomplete();
      e.preventDefault();
    }
  });

  document.addEventListener('click', function(e) {
    if (e.target !== filterInput && e.target !== autocompleteDropdown && !autocompleteDropdown.contains(e.target)) {
      closeAutocomplete();
    }
  });
}
