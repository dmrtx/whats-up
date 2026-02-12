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

const MEMORY_STATUS_KEY = 'waImproverMemoryStatus';
const LAST_ACTIVE_KEY = 'waImproverLastSeen';

let isPopupView = false;
let lastMemorySnapshot = null;
let lastSeenTimestamp = null;
let isLoading = false;
let autoSaveTimer = null;

const AUTO_SAVE_DEBOUNCE_MS = 400;

// Load saved settings
function loadSettings() {
  isLoading = true;
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
    }
    
    const memoryStatus = document.getElementById('memory-status');
    if (memoryStatus) {
      const shouldShowMemory = isPopupView || (memoryMonitorEnabled && memoryMonitorEnabled.checked);
      memoryStatus.style.display = shouldShowMemory ? 'flex' : 'none';
    }
    
    if (showReloadNotification) {
      showReloadNotification.checked = perfSettings.showReloadNotification !== false;
    }
    
    isLoading = false;
  });
}

// Save settings
function saveSettings(options = {}) {
  const { silent = false } = options;
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
    if (!silent) {
      showStatus('success', 'Settings saved successfully! ✓');
    }
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
      if (memoryStatus) {
        const shouldShowMemory = isPopupView || memoryMonitorEnabled.checked;
        memoryStatus.style.display = shouldShowMemory ? 'flex' : 'none';
      }
    });
  }
}

function scheduleAutoSave() {
  if (!isPopupView || isLoading) return;
  
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  autoSaveTimer = setTimeout(() => {
    saveSettings({ silent: true });
  }, AUTO_SAVE_DEBOUNCE_MS);
}

function setupAutoSave() {
  if (!isPopupView) return;
  
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach((input) => {
    input.addEventListener('input', scheduleAutoSave);
    input.addEventListener('change', scheduleAutoSave);
  });
}

function getLocalMemorySnapshot() {
  if (performance && performance.memory) {
    const usedMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
    const totalMB = Math.round(performance.memory.jsHeapSizeLimit / (1024 * 1024));
    const percentage = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0;
    return {
      available: true,
      usedMB,
      totalMB,
      percentage,
      timestamp: Date.now(),
      source: 'local'
    };
  }
  
  return {
    available: false,
    reason: 'Memory API not available',
    timestamp: Date.now(),
    source: 'local'
  };
}

function formatAge(timestamp) {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const seconds = Math.max(0, Math.round(diffMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

function updateConnectionStatus() {
  const statusEl = document.getElementById('connection-status');
  const detailEl = document.getElementById('connection-detail');
  if (!statusEl || !detailEl) return;
  
  if (!lastSeenTimestamp) {
    statusEl.textContent = 'Not connected';
    statusEl.dataset.state = 'offline';
    detailEl.textContent = 'Open WhatsApp Web to activate the extension.';
    return;
  }
  
  const ageMs = Date.now() - lastSeenTimestamp;
  const isFresh = ageMs < 90000;
  statusEl.textContent = isFresh ? 'Connected' : 'Waiting';
  statusEl.dataset.state = isFresh ? 'online' : 'idle';
  detailEl.textContent = isFresh ? `Active ${formatAge(lastSeenTimestamp)}` : `Last seen ${formatAge(lastSeenTimestamp)}`;
}

function updateMemoryUI(snapshot) {
  const memoryValue = document.getElementById('memory-value');
  const memoryBarFill = document.getElementById('memory-bar-fill');
  
  if (!memoryValue || !memoryBarFill) return;
  
  if (!snapshot) {
    memoryValue.textContent = 'Waiting for WhatsApp Web...';
    memoryBarFill.style.width = '0%';
    memoryBarFill.className = 'memory-bar-fill';
    return;
  }
  
  if (!snapshot.available) {
    memoryValue.textContent = snapshot.reason || 'Memory info unavailable';
    memoryBarFill.style.width = '0%';
    memoryBarFill.className = 'memory-bar-fill';
    return;
  }
  
  const sourceLabel = snapshot.source === 'content' ? 'WhatsApp' : 'This page';
  const ageLabel = snapshot.timestamp ? ` • ${formatAge(snapshot.timestamp)}` : '';
  memoryValue.textContent = `${snapshot.usedMB} MB used (${sourceLabel})${ageLabel}`;
  
  const percentage = Math.min(snapshot.percentage || 0, 100);
  memoryBarFill.style.width = `${percentage}%`;
  memoryBarFill.className = 'memory-bar-fill';
  
  if (percentage > 80) {
    memoryBarFill.classList.add('danger');
  } else if (percentage > 60) {
    memoryBarFill.classList.add('warning');
  }
}

function refreshMemoryStatus() {
  updateConnectionStatus();
  updateMemoryUI(lastMemorySnapshot);
}

function loadMemoryStatus() {
  chrome.storage.local.get([MEMORY_STATUS_KEY, LAST_ACTIVE_KEY], (data) => {
    lastMemorySnapshot = data[MEMORY_STATUS_KEY] || null;
    lastSeenTimestamp = data[LAST_ACTIVE_KEY] || null;
    
    if (!lastMemorySnapshot && !isPopupView) {
      lastMemorySnapshot = getLocalMemorySnapshot();
    }
    
    refreshMemoryStatus();
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  isPopupView = document.body?.dataset?.view === 'popup';
  
  loadSettings();
  setupToggleListeners();
  setupKeyInputListeners();
  setupPerformanceListeners();
  setupAutoSave();
  
  // Memory + connection status
  loadMemoryStatus();
  const refreshInterval = isPopupView ? 5000 : 10000;
  setInterval(refreshMemoryStatus, refreshInterval);
  
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    if (changes[MEMORY_STATUS_KEY]) {
      lastMemorySnapshot = changes[MEMORY_STATUS_KEY].newValue || null;
    }
    
    if (changes[LAST_ACTIVE_KEY]) {
      lastSeenTimestamp = changes[LAST_ACTIVE_KEY].newValue || null;
    }
    
    refreshMemoryStatus();
  });
  
  const saveBtn = document.getElementById('save-btn');
  const resetBtn = document.getElementById('reset-btn');
  const openOptionsBtn = document.getElementById('open-options-btn');
  
  if (saveBtn) {
    if (isPopupView) {
      saveBtn.style.display = 'none';
    } else {
      saveBtn.addEventListener('click', () => saveSettings());
    }
  }
  if (resetBtn) resetBtn.addEventListener('click', resetSettings);
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  }
});
