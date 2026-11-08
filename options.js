// WhatsApp Web Improver - Options Page Script

const {
  DEFAULT_SHORTCUTS: defaultSettings,
  DEFAULT_PERFORMANCE_SETTINGS: defaultPerformanceSettings,
  DEFAULT_NAVIGATION_SETTINGS: defaultNavigationSettings,
  withDefaults
} = window.WAImproverDefaults;

const LAST_ACTIVE_KEY = 'waImproverLastSeen';

let isPopupView = false;
let lastSeenTimestamp = null;
let isLoading = false;
let autoSaveTimer = null;

const AUTO_SAVE_DEBOUNCE_MS = 400;

// Load saved settings
function loadSettings() {
  isLoading = true;
  chrome.storage.sync.get(['shortcuts', 'performance', 'navigation'], (data) => {
    const settings = withDefaults(data.shortcuts, defaultSettings);
    const perfSettings = withDefaults(data.performance, defaultPerformanceSettings);
    const navSettings = withDefaults(data.navigation, defaultNavigationSettings);

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
    const showReloadNotification = document.getElementById('show-reload-notification');
    
    if (autoReloadEnabled) {
      autoReloadEnabled.checked = perfSettings.autoReload?.enabled || false;
      reloadTime.value = perfSettings.autoReload?.time || '04:00';
      reloadTime.disabled = !autoReloadEnabled.checked;
    }
    
    const uptimeReloadEnabled = document.getElementById('uptime-reload-enabled');
    const uptimeReloadHours = document.getElementById('uptime-reload-hours');
    if (uptimeReloadEnabled && uptimeReloadHours) {
      uptimeReloadEnabled.checked = perfSettings.uptimeReload?.enabled === true;
      uptimeReloadHours.value = String(perfSettings.uptimeReload?.hours || defaultPerformanceSettings.uptimeReload.hours);
      uptimeReloadHours.disabled = !uptimeReloadEnabled.checked;
    }

    const navigationEnabled = document.getElementById('navigation-enabled');
    if (navigationEnabled) {
      navigationEnabled.checked = navSettings.enabled !== false;
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
    uptimeReload: {
      enabled: document.getElementById('uptime-reload-enabled')?.checked === true,
      hours: parseInt(document.getElementById('uptime-reload-hours')?.value, 10)
        || defaultPerformanceSettings.uptimeReload.hours
    },
    showReloadNotification: document.getElementById('show-reload-notification').checked
  };

  const navigationSettings = {
    enabled: document.getElementById('navigation-enabled')?.checked !== false
  };

  chrome.storage.sync.set({
    shortcuts: settings,
    performance: performanceSettings,
    navigation: navigationSettings
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
    performance: defaultPerformanceSettings,
    navigation: defaultNavigationSettings
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
  
  if (autoReloadEnabled && reloadTime) {
    autoReloadEnabled.addEventListener('change', () => {
      reloadTime.disabled = !autoReloadEnabled.checked;
    });
  }

  const uptimeReloadEnabled = document.getElementById('uptime-reload-enabled');
  const uptimeReloadHours = document.getElementById('uptime-reload-hours');
  if (uptimeReloadEnabled && uptimeReloadHours) {
    uptimeReloadEnabled.addEventListener('change', () => {
      uptimeReloadHours.disabled = !uptimeReloadEnabled.checked;
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

function loadConnectionStatus() {
  chrome.storage.local.get([LAST_ACTIVE_KEY], (data) => {
    lastSeenTimestamp = data[LAST_ACTIVE_KEY] || null;
    updateConnectionStatus();
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  isPopupView = document.body?.dataset?.view === 'popup';
  const theme = new URLSearchParams(location.search).get('theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  const isEmbedded = window.self !== window.top;
  document.body.classList.toggle('embedded-view', isEmbedded);
  document.documentElement.classList.toggle('embedded-view', isEmbedded);
  
  loadSettings();
  setupToggleListeners();
  setupKeyInputListeners();
  setupPerformanceListeners();
  setupAutoSave();
  
  loadConnectionStatus();
  const refreshInterval = isPopupView ? 5000 : 10000;
  setInterval(updateConnectionStatus, refreshInterval);
  
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    if (changes[LAST_ACTIVE_KEY]) {
      lastSeenTimestamp = changes[LAST_ACTIVE_KEY].newValue || null;
      updateConnectionStatus();
    }
  });
  
  const saveBtn = document.getElementById('save-btn');
  const resetBtn = document.getElementById('reset-btn');

  if (saveBtn) {
    if (isPopupView) {
      saveBtn.style.display = 'none';
    } else {
      saveBtn.addEventListener('click', () => saveSettings());
    }
  }
  if (resetBtn) resetBtn.addEventListener('click', resetSettings);
});
