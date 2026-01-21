// WhatsApp Web Improver - Options Page Script

const defaultSettings = {
  edit: { key: 'e', enabled: true },
  delete: { key: 'd', enabled: true },
  reply: { key: 'r', enabled: true },
  forward: { key: 'f', enabled: true },
  star: { key: 's', enabled: true },
  info: { key: 'i', enabled: true },
  copy: { key: 'c', enabled: true },
  pin: { key: 'p', enabled: true }
};

// Load saved settings
function loadSettings() {
  chrome.storage.sync.get('shortcuts', (data) => {
    const settings = data.shortcuts || defaultSettings;
    
    Object.keys(settings).forEach(action => {
      const keyInput = document.getElementById(`${action}-key`);
      const enabledCheckbox = document.getElementById(`${action}-enabled`);
      
      if (keyInput && enabledCheckbox) {
        keyInput.value = settings[action].key;
        enabledCheckbox.checked = settings[action].enabled;
        keyInput.disabled = !settings[action].enabled;
      }
    });
  });
}

// Save settings
function saveSettings() {
  const settings = {};
  
  Object.keys(defaultSettings).forEach(action => {
    const keyInput = document.getElementById(`${action}-key`);
    const enabledCheckbox = document.getElementById(`${action}-enabled`);
    
    if (keyInput && enabledCheckbox) {
      settings[action] = {
        key: keyInput.value.toLowerCase() || defaultSettings[action].key,
        enabled: enabledCheckbox.checked
      };
    }
  });

  // Validate for duplicate keys
  const enabledKeys = Object.values(settings)
    .filter(s => s.enabled)
    .map(s => s.key);
  
  const duplicates = enabledKeys.filter((key, index) => enabledKeys.indexOf(key) !== index);
  
  if (duplicates.length > 0) {
    showStatus('error', `Duplicate keys detected: ${duplicates.join(', ')}. Each shortcut must have a unique key.`);
    return;
  }

  chrome.storage.sync.set({ shortcuts: settings }, () => {
    showStatus('success', 'Settings saved successfully! ✓');
  });
}

// Reset to defaults
function resetSettings() {
  chrome.storage.sync.set({ shortcuts: defaultSettings }, () => {
    loadSettings();
    showStatus('success', 'Settings reset to defaults! ✓');
  });
}

// Show status message
function showStatus(type, message) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status-message ${type} show`;
  
  setTimeout(() => {
    statusEl.classList.remove('show');
  }, 3000);
}

// Enable/disable input based on checkbox
function setupToggleListeners() {
  Object.keys(defaultSettings).forEach(action => {
    const enabledCheckbox = document.getElementById(`${action}-enabled`);
    const keyInput = document.getElementById(`${action}-key`);
    
    if (enabledCheckbox && keyInput) {
      enabledCheckbox.addEventListener('change', () => {
        keyInput.disabled = !enabledCheckbox.checked;
      });
    }
  });
}

// Ensure only single character input
function setupKeyInputListeners() {
  Object.keys(defaultSettings).forEach(action => {
    const keyInput = document.getElementById(`${action}-key`);
    
    if (keyInput) {
      keyInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toLowerCase().slice(0, 1);
      });
      
      keyInput.addEventListener('keydown', (e) => {
        // Allow backspace, delete, tab
        if (['Backspace', 'Delete', 'Tab'].includes(e.key)) {
          return;
        }
        
        // Allow only letters and numbers
        if (!/^[a-z0-9]$/i.test(e.key)) {
          e.preventDefault();
        }
      });
    }
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupToggleListeners();
  setupKeyInputListeners();
  
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-btn').addEventListener('click', resetSettings);
});
