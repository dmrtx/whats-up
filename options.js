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

const defaultPerformanceSettings = {
  autoReload: {
    enabled: false,
    time: '04:00'
  },
  memoryMonitor: {
    enabled: false,
    threshold: 1000  // MB
  },
  showReloadNotification: true
};

// Load saved settings
function loadSettings() {
  chrome.storage.sync.get(['shortcuts', 'performance'], (data) => {
    const settings = data.shortcuts || defaultSettings;
    const perfSettings = data.performance || defaultPerformanceSettings;
    
    // Load shortcuts
    Object.keys(settings).forEach(action => {
      const keyInput = document.getElementById(`${action}-key`);
      const enabledCheckbox = document.getElementById(`${action}-enabled`);
      
      if (keyInput && enabledCheckbox) {
        keyInput.value = settings[action].key;
        enabledCheckbox.checked = settings[action].enabled;
        keyInput.disabled = !settings[action].enabled;
      }
    });
    
    // Load performance settings
    const autoReloadEnabled = document.getElementById('auto-reload-enabled');
    const reloadTime = document.getElementById('reload-time');
    const memoryMonitorEnabled = document.getElementById('memory-monitor-enabled');
    const memoryThreshold = document.getElementById('memory-threshold');
    const showReloadNotification = document.getElementById('show-reload-notification');
    
    if (autoReloadEnabled) {
      autoReloadEnabled.checked = perfSettings.autoReload?.enabled || false;
      reloadTime.value = perfSettings.autoReload?.time || '04:00';
      reloadTime.disabled = !autoReloadEnabled.checked;
    }
    
    if (memoryMonitorEnabled) {
      memoryMonitorEnabled.checked = perfSettings.memoryMonitor?.enabled || false;
      memoryThreshold.value = perfSettings.memoryMonitor?.threshold || 1000;
      memoryThreshold.disabled = !memoryMonitorEnabled.checked;
      
      // Show memory status if enabled
      if (memoryMonitorEnabled.checked) {
        document.getElementById('memory-status').style.display = 'flex';
      }
    }
    
    if (showReloadNotification) {
      showReloadNotification.checked = perfSettings.showReloadNotification !== false;
    }
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

  // Performance settings
  const performanceSettings = {
    autoReload: {
      enabled: document.getElementById('auto-reload-enabled').checked,
      time: document.getElementById('reload-time').value
    },
    memoryMonitor: {
      enabled: document.getElementById('memory-monitor-enabled').checked,
      threshold: parseInt(document.getElementById('memory-threshold').value)
    },
    showReloadNotification: document.getElementById('show-reload-notification').checked
  };

  chrome.storage.sync.set({ 
    shortcuts: settings,
    performance: performanceSettings
  }, () => {
    showStatus('success', 'Settings saved successfully! ✓');
  });
}

// Reset to defaults
function resetSettings() {
  chrome.storage.sync.set({ 
    shortcuts: defaultSettings,
    performance: defaultPerformanceSettings
  }, () => {
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

// Setup performance toggle listeners
function setupPerformanceListeners() {
  const autoReloadEnabled = document.getElementById('auto-reload-enabled');
  const reloadTime = document.getElementById('reload-time');
  const memoryMonitorEnabled = document.getElementById('memory-monitor-enabled');
  const memoryThreshold = document.getElementById('memory-threshold');
  const memoryStatus = document.getElementById('memory-status');
  
  if (autoReloadEnabled && reloadTime) {
    autoReloadEnabled.addEventListener('change', () => {
      reloadTime.disabled = !autoReloadEnabled.checked;
    });
  }
  
  if (memoryMonitorEnabled && memoryThreshold) {
    memoryMonitorEnabled.addEventListener('change', () => {
      memoryThreshold.disabled = !memoryMonitorEnabled.checked;
      memoryStatus.style.display = memoryMonitorEnabled.checked ? 'flex' : 'none';
    });
  }
}

// Check current memory (from WhatsApp tab if possible)
function checkMemoryStatus() {
  // Note: This shows estimated memory from the options page itself
  // The actual monitoring happens in the content script
  if (performance && performance.memory) {
    const usedMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
    const totalMB = Math.round(performance.memory.jsHeapSizeLimit / (1024 * 1024));
    const percentage = Math.round((usedMB / totalMB) * 100);
    
    const memoryValue = document.getElementById('memory-value');
    const memoryBarFill = document.getElementById('memory-bar-fill');
    
    if (memoryValue) {
      memoryValue.textContent = `${usedMB} MB used (options page)`;
    }
    
    if (memoryBarFill) {
      memoryBarFill.style.width = `${Math.min(percentage, 100)}%`;
      memoryBarFill.className = 'memory-bar-fill';
      if (percentage > 80) {
        memoryBarFill.classList.add('danger');
      } else if (percentage > 60) {
        memoryBarFill.classList.add('warning');
      }
    }
  } else {
    const memoryValue = document.getElementById('memory-value');
    if (memoryValue) {
      memoryValue.textContent = 'Memory API not available in this browser';
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupToggleListeners();
  setupKeyInputListeners();
  setupPerformanceListeners();
  
  // Check memory periodically
  checkMemoryStatus();
  setInterval(checkMemoryStatus, 5000);
  
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-btn').addEventListener('click', resetSettings);
});
