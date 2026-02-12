// WhatsApp Web Improver - Content Script
// Adds configurable keyboard shortcuts to WhatsApp Web context menus

(function() {
  'use strict';

  if (window.__WA_IMPROVER_LOADED) return;
  window.__WA_IMPROVER_LOADED = true;

  console.log('WhatsApp Web Improver: Extension loaded');

  let contextMenuOpen = false;
  let currentContextMenu = null;
  let shortcuts = {};
  let performanceSettings = {};
  let lastReloadCheck = null;
  let reloadNotificationShown = false;
  let reloadNotificationCooldownUntil = 0;
  
  // Message navigation state
  let messageNavigationEnabled = false;
  let messageNavigationMode = false;
  let selectedMessageIndex = -1;
  let messageElements = [];
  let navigationModeEnteredAt = 0; // Timestamp to prevent immediate actions
  let navigationActionInProgress = false;
  let optionsButtonObserver = null;
  let optionsButtonDebounceTimer = null;
  const PANEL_MIN_WIDTH = 720;
  const PANEL_MAX_WIDTH = 980;
  const UI_SCALE_STORAGE_KEY = 'waImproverUiScale';
  const UI_SCALE_MIN = 85;
  const UI_SCALE_MAX = 130;
  const UI_SCALE_STEP = 5;
  
  // Status + memory reporting (shared with popup/options)
  const MEMORY_STATUS_KEY = 'waImproverMemoryStatus';
  const LAST_ACTIVE_KEY = 'waImproverLastSeen';
  const MEMORY_REPORT_INTERVAL_MS = 10000;
  let lastMemoryReportAt = 0;
  let currentUiScale = 100;
  let extensionContextInvalid = false;

  function clampUiScale(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 100;
    return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(numeric)));
  }

  function loadStoredUiScale() {
    try {
      const stored = localStorage.getItem(UI_SCALE_STORAGE_KEY);
      if (!stored) return 100;
      return clampUiScale(parseInt(stored, 10));
    } catch (error) {
      return 100;
    }
  }

  function saveStoredUiScale(value) {
    try {
      localStorage.setItem(UI_SCALE_STORAGE_KEY, String(clampUiScale(value)));
    } catch (error) {
      // ignore storage errors
    }
  }

  function applyWhatsAppScale(scale, persist = true) {
    const nextScale = clampUiScale(scale);
    currentUiScale = nextScale;

    const appRoot = document.getElementById('app');
    if (appRoot) {
      appRoot.style.zoom = `${nextScale}%`;
    }

    if (persist) {
      saveStoredUiScale(nextScale);
    }
  }

  function markContextInvalid(reason) {
    if (extensionContextInvalid) return;
    extensionContextInvalid = true;
    console.warn('WhatsApp Web Improver: Extension context became invalid', reason || 'unknown');
  }

  function isExtensionContextValid() {
    if (extensionContextInvalid) return false;

    try {
      return Boolean(chrome?.runtime?.id);
    } catch (error) {
      markContextInvalid(error?.message || error);
      return false;
    }
  }

  function getRuntimeLastErrorMessage() {
    try {
      return chrome?.runtime?.lastError?.message || '';
    } catch (error) {
      markContextInvalid(error?.message || error);
      return 'Extension context invalidated';
    }
  }

  function safeStorageLocalSet(payload) {
    if (!isExtensionContextValid()) return false;

    try {
      chrome.storage.local.set(payload, () => {
        const runtimeErrorMessage = getRuntimeLastErrorMessage();
        if (runtimeErrorMessage) {
          console.warn('WhatsApp Web Improver: storage.local.set runtime error', runtimeErrorMessage);
          if (runtimeErrorMessage.includes('Extension context invalidated')) {
            markContextInvalid(runtimeErrorMessage);
          }
        }
      });
      return true;
    } catch (error) {
      if (String(error?.message || '').includes('Extension context invalidated')) {
        markContextInvalid(error?.message || error);
      }
      console.warn('WhatsApp Web Improver: storage.local.set failed', error?.message || error);
      return false;
    }
  }

  function safeStorageSyncGet(keys, callback) {
    if (!isExtensionContextValid()) {
      callback({});
      return;
    }

    try {
      chrome.storage.sync.get(keys, (data) => {
        const runtimeErrorMessage = getRuntimeLastErrorMessage();
        if (runtimeErrorMessage) {
          console.warn('WhatsApp Web Improver: storage.sync.get runtime error', runtimeErrorMessage);
          if (runtimeErrorMessage.includes('Extension context invalidated')) {
            markContextInvalid(runtimeErrorMessage);
          }
          callback({});
          return;
        }

        callback(data || {});
      });
    } catch (error) {
      if (String(error?.message || '').includes('Extension context invalidated')) {
        markContextInvalid(error?.message || error);
      }
      console.warn('WhatsApp Web Improver: storage.sync.get failed', error?.message || error);
      callback({});
    }
  }

  // Default shortcuts
  const defaultShortcuts = {
    edit: { key: 'e', enabled: true },
    delete: { key: 'd', enabled: true },
    reply: { key: 'r', enabled: true },
    forward: { key: 'f', enabled: true },
    star: { key: 's', enabled: true },
    info: { key: 'i', enabled: true },
    copy: { key: 'c', enabled: true },
    pin: { key: 'p', enabled: true }
  };

  // Default performance settings
  const defaultPerformanceSettings = {
    autoReload: { enabled: false, time: '04:00' },
    memoryMonitor: { enabled: false, threshold: 1000 },
    showReloadNotification: true
  };

  // Action keywords in different languages
  const actionKeywords = {
    edit: ['edit', 'editar', 'modifier', 'bearbeiten', 'modifica'],
    delete: ['delete', 'eliminar', 'supprimer', 'löschen', 'cancella', 'borrar'],
    reply: ['reply', 'responder', 'répondre', 'antworten', 'rispondi'],
    forward: ['forward', 'reenviar', 'transférer', 'weiterleiten', 'inoltra'],
    star: ['star', 'destacar', 'ajouter aux favoris', 'markieren', 'aggiungi ai preferiti'],
    info: ['info', 'información', 'informations', 'nachrichteninfo', 'informazioni'],
    copy: ['copy', 'copiar', 'copier', 'kopieren', 'copia'],
    pin: ['pin', 'fijar', 'épingler', 'anheften', 'fissa']
  };

  // Load settings from storage
  function loadSettings() {
    safeStorageSyncGet(['shortcuts', 'performance'], (data) => {
      shortcuts = data.shortcuts || defaultShortcuts;
      performanceSettings = data.performance || defaultPerformanceSettings;
      applyWhatsAppScale(loadStoredUiScale(), false);
      console.log('WhatsApp Web Improver: Settings loaded', { shortcuts, performanceSettings });
      
      // Start performance monitoring
      startPerformanceMonitoring();
    });
  }

  // Listen for storage changes
  function registerStorageChangeListener() {
    if (!isExtensionContextValid()) return;

    try {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (!isExtensionContextValid()) return;

        if (namespace === 'sync') {
          if (changes.shortcuts) {
            shortcuts = changes.shortcuts.newValue;
            console.log('WhatsApp Web Improver: Shortcuts updated', shortcuts);
          }
          if (changes.performance) {
            performanceSettings = changes.performance.newValue;
            console.log('WhatsApp Web Improver: Performance settings updated', performanceSettings);
          }
        }
      });
    } catch (error) {
      if (String(error?.message || '').includes('Extension context invalidated')) {
        markContextInvalid(error?.message || error);
      }
      console.warn('WhatsApp Web Improver: Failed to register storage change listener', error?.message || error);
    }
  }

  registerStorageChangeListener();

  // Initialize settings
  loadSettings();

  // ===== PERFORMANCE MONITORING =====
  
  function markExtensionActive() {
    return safeStorageLocalSet({ [LAST_ACTIVE_KEY]: Date.now() });
  }
  
  function getMemorySnapshot() {
    const timestamp = Date.now();
    
    if (performance && performance.memory) {
      const usedMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
      const totalMB = Math.round(performance.memory.jsHeapSizeLimit / (1024 * 1024));
      const percentage = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0;
      
      return {
        available: true,
        usedMB,
        totalMB,
        percentage,
        timestamp,
        source: 'content'
      };
    }
    
    return {
      available: false,
      reason: 'Memory API not available',
      timestamp,
      source: 'content'
    };
  }
  
  function reportMemorySnapshot(force = false) {
    const now = Date.now();
    if (!force && now - lastMemoryReportAt < MEMORY_REPORT_INTERVAL_MS) return;
    
    lastMemoryReportAt = now;
    return safeStorageLocalSet({ [MEMORY_STATUS_KEY]: getMemorySnapshot() });
  }
  
  function startHeartbeat() {
    if (!markExtensionActive()) return;
    reportMemorySnapshot(true);
    
    const heartbeatTimer = setInterval(() => {
      if (!isExtensionContextValid()) {
        clearInterval(heartbeatTimer);
        return;
      }

      const activeUpdated = markExtensionActive();
      reportMemorySnapshot();

      if (!activeUpdated) {
        clearInterval(heartbeatTimer);
      }
    }, MEMORY_REPORT_INTERVAL_MS);
  }

  // Show reload notification banner
  function showReloadNotification(reason) {
    if (reloadNotificationShown) return;
    if (Date.now() < reloadNotificationCooldownUntil) return;
    reloadNotificationShown = true;

    const banner = document.createElement('div');
    banner.id = 'wa-improver-reload-banner';
    banner.innerHTML = `
      <style>
        #wa-improver-reload-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
          color: white;
          padding: 15px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }
        #wa-improver-reload-banner .message {
          flex: 1;
        }
        #wa-improver-reload-banner .message strong {
          display: block;
          margin-bottom: 3px;
        }
        #wa-improver-reload-banner .buttons {
          display: flex;
          gap: 10px;
        }
        #wa-improver-reload-banner button {
          padding: 8px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-weight: bold;
          transition: transform 0.2s;
        }
        #wa-improver-reload-banner button:hover {
          transform: scale(1.05);
        }
        #wa-improver-reload-banner .reload-btn {
          background: white;
          color: #128C7E;
        }
        #wa-improver-reload-banner .dismiss-btn {
          background: rgba(255,255,255,0.2);
          color: white;
        }
      </style>
      <div class="message">
        <strong>⚡ WhatsApp Web Improver</strong>
        <span>${reason}</span>
      </div>
      <div class="buttons">
        <button class="reload-btn" id="wa-reload-now">Reload Now</button>
        <button class="dismiss-btn" id="wa-reload-later">Later</button>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('wa-reload-now').addEventListener('click', () => {
      location.reload();
    });

    document.getElementById('wa-reload-later').addEventListener('click', () => {
      banner.remove();
      reloadNotificationCooldownUntil = Date.now() + (60 * 60 * 1000);
      reloadNotificationShown = false;
    });
  }

  // Check memory usage
  function checkMemoryUsage() {
    if (!performanceSettings.memoryMonitor?.enabled) return;
    
    if (performance && performance.memory) {
      const usedMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
      const threshold = performanceSettings.memoryMonitor.threshold || 1000;
      
      console.log(`📊 WhatsApp Web Improver: Memory usage: ${usedMB} MB (threshold: ${threshold} MB)`);
      
      if (usedMB > threshold) {
        console.log('⚠️ WhatsApp Web Improver: Memory threshold exceeded!');
        
        if (performanceSettings.showReloadNotification) {
          showReloadNotification(`High memory usage detected (${usedMB} MB). Reload recommended for better performance.`);
        } else {
          location.reload();
        }
      }
    }
  }

  // Check if it's time for scheduled reload
  function checkScheduledReload() {
    if (!performanceSettings.autoReload?.enabled) return;
    
    const now = new Date();
    const [hours, minutes] = (performanceSettings.autoReload.time || '04:00').split(':').map(Number);
    
    const targetTime = new Date();
    targetTime.setHours(hours, minutes, 0, 0);
    
    // Check if we're within 1 minute of the target time
    const diffMs = Math.abs(now - targetTime);
    const diffMins = diffMs / (1000 * 60);
    
    // Also check if we already reloaded today
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    
    if (diffMins < 1 && lastReloadCheck !== todayKey) {
      lastReloadCheck = todayKey;
      console.log('🕐 WhatsApp Web Improver: Scheduled reload time reached!');
      
      if (performanceSettings.showReloadNotification) {
        showReloadNotification('Scheduled daily reload to maintain performance.');
      } else {
        location.reload();
      }
    }
  }

  // Start performance monitoring
  function startPerformanceMonitoring() {
    // Heartbeat + memory snapshot (low frequency to keep overhead minimal)
    startHeartbeat();
    
    // Check memory every 5 minutes
    setInterval(checkMemoryUsage, 5 * 60 * 1000);
    
    // Check scheduled reload every minute
    setInterval(checkScheduledReload, 60 * 1000);
    
    // Initial check after 1 minute
    setTimeout(() => {
      checkMemoryUsage();
      checkScheduledReload();
    }, 60 * 1000);
    
    console.log('WhatsApp Web Improver: Performance monitoring started');
  }

  // ===== MESSAGE NAVIGATION =====
  
  // Inject styles for message selection
  function injectNavigationStyles() {
    if (document.getElementById('wa-improver-nav-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'wa-improver-nav-styles';
    styles.textContent = `
      .wa-improver-selected-message {
        position: relative;
        outline: 3px solid #25D366 !important;
        outline-offset: 4px;
        border-radius: 10px;
        background-color: rgba(37, 211, 102, 0.15) !important;
        box-shadow: 0 0 20px rgba(37, 211, 102, 0.4) !important;
        transition: all 0.15s ease;
        z-index: 100;
      }
      
      .wa-improver-selected-message::before {
        content: '▶';
        position: absolute;
        left: -30px;
        top: 50%;
        transform: translateY(-50%);
        color: #25D366;
        font-size: 18px;
        animation: wa-pulse 1s ease-in-out infinite;
      }
      
      @keyframes wa-pulse {
        0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
        50% { opacity: 0.7; transform: translateY(-50%) scale(1.2); }
      }
      
      .wa-improver-nav-indicator {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
        color: white;
        padding: 12px 24px;
        border-radius: 25px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        z-index: 999998;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 20px;
        animation: wa-slideUp 0.3s ease;
      }
      
      @keyframes wa-slideUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      
      .wa-improver-nav-indicator kbd {
        background: rgba(255,255,255,0.25);
        padding: 4px 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 13px;
        font-weight: bold;
        border: 1px solid rgba(255,255,255,0.3);
      }
      
      .wa-improver-nav-indicator .nav-section {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .wa-improver-nav-indicator .shortcuts {
        display: flex;
        gap: 12px;
        border-left: 2px solid rgba(255,255,255,0.3);
        padding-left: 20px;
        margin-left: 10px;
      }
      
      .wa-improver-nav-indicator .shortcut-hint {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
      }
      
      .wa-improver-nav-indicator .msg-counter {
        background: rgba(0,0,0,0.2);
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
      }
    `;
    document.head.appendChild(styles);
  }
  
  // Get all visible message elements
  function getMessageElements() {
    // WhatsApp message rows - look for message containers
    const messages = document.querySelectorAll('[data-id][class*="message"], div[class*="message-out"], div[class*="message-in"], [data-pre-plain-text]');
    
    // Filter to get actual message bubbles
    let msgElements = [];
    
    // Try different selectors for message bubbles
    const possibleSelectors = [
      '[data-pre-plain-text]',
      '[class*="focusable-list-item"]',
      'div[class*="_amk4"]',
      'div[tabindex="-1"][class*="message"]'
    ];
    
    for (const selector of possibleSelectors) {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) {
        msgElements = Array.from(found);
        break;
      }
    }
    
    // Fallback: find message rows in the chat
    if (msgElements.length === 0) {
      const chatContainer = document.querySelector('[data-tab="8"]') || 
                           document.querySelector('[role="application"]')?.closest('div[tabindex]')?.parentElement;
      if (chatContainer) {
        // Look for rows that contain message content
        const rows = chatContainer.querySelectorAll('[role="row"], div[class*="copyable-text"]');
        msgElements = Array.from(rows).filter(row => {
          return row.querySelector('[data-pre-plain-text]') || 
                 row.textContent.trim().length > 0;
        });
      }
    }
    
    return msgElements;
  }
  
  // Show navigation indicator
  function showNavigationIndicator() {
    let indicator = document.getElementById('wa-improver-nav-indicator');
    
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'wa-improver-nav-indicator';
      indicator.className = 'wa-improver-nav-indicator';
      document.body.appendChild(indicator);
    }
    
    updateNavigationIndicator();
  }
  
  // Update the indicator with current position
  function updateNavigationIndicator() {
    const indicator = document.getElementById('wa-improver-nav-indicator');
    if (!indicator) return;
    
    const current = selectedMessageIndex + 1;
    const total = messageElements.length;
    
    indicator.innerHTML = `
      <span class="nav-section">📍 <strong>Message ${current} of ${total}</strong></span>
      <span class="nav-section"><kbd>↑</kbd><kbd>↓</kbd> Move</span>
      <span class="shortcuts">
        <span class="shortcut-hint"><kbd>${shortcuts.edit?.key || 'e'}</kbd> Edit</span>
        <span class="shortcut-hint"><kbd>${shortcuts.reply?.key || 'r'}</kbd> Reply</span>
        <span class="shortcut-hint"><kbd>${shortcuts.delete?.key || 'd'}</kbd> Del</span>
        <span class="shortcut-hint"><kbd>${shortcuts.star?.key || 's'}</kbd> Star</span>
        <span class="shortcut-hint"><kbd>Esc</kbd> Exit</span>
      </span>
    `;
  }
  
  // Hide navigation indicator
  function hideNavigationIndicator() {
    const indicator = document.getElementById('wa-improver-nav-indicator');
    if (indicator) indicator.remove();
  }
  
  // Highlight selected message
  function highlightMessage(index) {
    // Remove previous highlight
    document.querySelectorAll('.wa-improver-selected-message').forEach(el => {
      el.classList.remove('wa-improver-selected-message');
    });
    
    if (index >= 0 && index < messageElements.length) {
      const msg = messageElements[index];
      msg.classList.add('wa-improver-selected-message');
      
      // Scroll into view
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Update the indicator counter
      updateNavigationIndicator();
      
      console.log(`📍 WhatsApp Web Improver: Selected message ${index + 1}/${messageElements.length}`);
    }
  }
  
  // Enter message navigation mode
  function enterNavigationMode() {
    messageElements = getMessageElements();
    
    if (messageElements.length === 0) {
      console.log('❌ WhatsApp Web Improver: No messages found');
      return false;
    }
    
    messageNavigationMode = true;
    navigationModeEnteredAt = Date.now(); // Record entry time
    selectedMessageIndex = messageElements.length - 1; // Start from last message
    
    injectNavigationStyles();
    showNavigationIndicator();
    highlightMessage(selectedMessageIndex);
    
    console.log(`🎯 WhatsApp Web Improver: Navigation mode ON (${messageElements.length} messages)`);
    return true;
  }
  
  // Exit message navigation mode
  function exitNavigationMode() {
    messageNavigationMode = false;
    navigationActionInProgress = false;
    selectedMessageIndex = -1;
    messageElements = [];
    
    // Remove highlight
    document.querySelectorAll('.wa-improver-selected-message').forEach(el => {
      el.classList.remove('wa-improver-selected-message');
    });
    
    hideNavigationIndicator();
    console.log('🎯 WhatsApp Web Improver: Navigation mode OFF');
  }
  
  // Trigger action on selected message
  function triggerActionOnSelectedMessage(action) {
    console.log(`🎯 triggerActionOnSelectedMessage called with action: "${action}"`);

    if (navigationActionInProgress) {
      console.log('⏳ Navigation action already in progress, ignoring key press');
      return false;
    }
    
    if (selectedMessageIndex < 0 || selectedMessageIndex >= messageElements.length) {
      console.log('❌ Invalid message index');
      return false;
    }

    navigationActionInProgress = true;
    
    const msg = messageElements[selectedMessageIndex];
    
    // Find the message bubble/container to right-click on
    const targetElement = msg.querySelector('[data-pre-plain-text]') || 
                msg.querySelector('[class*="copyable-text"]') ||
                msg;
    
    console.log(`🎯 WhatsApp Web Improver: Triggering "${action}" on selected message`, targetElement);

    const finishWithFailure = () => {
      console.log('❌ Failed to trigger action after retries');
      navigationActionInProgress = false;
      exitNavigationMode();
    };

    const finishWithSuccess = () => {
      navigationActionInProgress = false;
      exitNavigationMode();
    };

    let remainingOpenAttempts = 3;

    const tryOpenAndClick = () => {
      contextMenuOpen = false;
      currentContextMenu = null;
      openContextMenuForMessageElement(targetElement);

      waitForContextMenu((menu) => {
        const activeMenu = menu || findContextMenu();

        if (!activeMenu) {
          remainingOpenAttempts -= 1;
          if (remainingOpenAttempts <= 0) {
            finishWithFailure();
            return;
          }

          setTimeout(tryOpenAndClick, 160);
          return;
        }

        let remainingClickAttempts = 8;

        const attemptClick = (menuCandidate = null) => {
          if (clickMenuItemByAction(action, menuCandidate, false)) {
            finishWithSuccess();
            return;
          }

          remainingClickAttempts -= 1;
          if (remainingClickAttempts <= 0) {
            finishWithFailure();
            return;
          }

          setTimeout(() => {
            attemptClick(findContextMenu());
          }, 120);
        };

        attemptClick(activeMenu);
      }, 14, 110);
    };

    tryOpenAndClick();
    
    return true;
  }
  
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  
  function isMenuSizeReasonable(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    
    const viewportArea = (window.innerWidth || 1) * (window.innerHeight || 1);
    const area = rect.width * rect.height;
    
    // Ignore huge containers (like the full app shell)
    if (area > viewportArea * 0.35) return false;
    return true;
  }
  
  function getMenuItemsForNode(node) {
    return node.querySelectorAll('[role="button"], [role="menuitem"], li[tabindex], div[tabindex], li');
  }

  function hasMenuContainerRole(node) {
    if (!node || !node.getAttribute) return false;
    const role = node.getAttribute('role');
    return role === 'menu' || role === 'dialog' || role === 'listbox';
  }

  function hasMenuLikeDescendants(node) {
    if (!node?.querySelector) return false;
    return Boolean(
      node.querySelector('[role="menuitem"], [role="menu"], [aria-haspopup="menu"], [data-animate-dropdown]')
    );
  }
  
  function findContextMenu() {
    const selectors = [
      '[role="menu"]',
      'div[role="dialog"] [role="menu"]',
      'ul[role="menu"]',
      '[data-animate-dropdown]',
      'div[role="dialog"] ul'
    ];
    
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
      for (const menu of candidates) {
        if (!isElementVisible(menu) || !isMenuSizeReasonable(menu)) continue;
        const items = Array.from(getMenuItemsForNode(menu)).filter(isElementVisible);
        if (items.length >= 2 && items.length <= 16) {
          return menu;
        }
      }
    }
    
    return null;
  }
  
  function ensureContextMenuOpen() {
    if (currentContextMenu && isElementVisible(currentContextMenu)) {
      contextMenuOpen = true;
      return true;
    }
    
    const menu = findContextMenu();
    if (menu) {
      currentContextMenu = menu;
      contextMenuOpen = true;
      return true;
    }
    
    contextMenuOpen = false;
    currentContextMenu = null;
    return false;
  }
  
  function waitForContextMenu(callback, attempts = 6, delayMs = 100) {
    const menu = findContextMenu();
    if (menu) {
      currentContextMenu = menu;
      contextMenuOpen = true;
      callback(menu);
      return;
    }
    
    if (attempts <= 0) {
      callback(null);
      return;
    }
    
    setTimeout(() => waitForContextMenu(callback, attempts - 1, delayMs), delayMs);
  }

  function dispatchRightClickSequence(targetElement, x, y) {
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX: x,
      clientY: y
    };

    targetElement.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse' }));
    targetElement.dispatchEvent(new MouseEvent('mousedown', base));
    targetElement.dispatchEvent(new MouseEvent('mouseup', base));
    targetElement.dispatchEvent(new MouseEvent('contextmenu', base));
  }

  function resolveMessageActionTarget(messageElement) {
    if (!messageElement) return null;

    const preferredSelectors = [
      '[data-pre-plain-text]',
      '[data-testid="msg-container"]',
      '[data-testid="selectable-text"]',
      '[class*="copyable-text"]',
      'div[class*="message-in"]',
      'div[class*="message-out"]',
      'span[dir]'
    ];

    for (const selector of preferredSelectors) {
      const found = messageElement.closest(selector) || messageElement.querySelector(selector);
      if (found && isElementVisible(found)) {
        return found;
      }
    }

    const containers = [
      messageElement.closest('[data-id]'),
      messageElement.closest('[data-testid="msg-container"]'),
      messageElement.closest('div[class*="message-in"], div[class*="message-out"]'),
      messageElement.closest('[role="row"]'),
      messageElement
    ].filter(Boolean);

    const innerSelectors = [
      '[data-pre-plain-text]',
      '[data-testid="selectable-text"]',
      '[class*="copyable-text"]',
      'span[dir]'
    ];

    const candidates = [];
    for (const container of containers) {
      if (isElementVisible(container)) candidates.push(container);
      for (const selector of innerSelectors) {
        const found = container.querySelector(selector);
        if (found && isElementVisible(found)) candidates.push(found);
      }
    }

    if (candidates.length === 0) return messageElement;

    candidates.sort((left, right) => {
      const l = left.getBoundingClientRect();
      const r = right.getBoundingClientRect();
      return (l.width * l.height) - (r.width * r.height);
    });

    return candidates[0];
  }

  function openContextMenuForMessageElement(messageElement) {
    if (!messageElement) return;

    const actionTarget = resolveMessageActionTarget(messageElement) || messageElement;

    const row = actionTarget.closest('[data-id], [role="row"], [data-testid="msg-container"]') || actionTarget;
    const menuButtonSelectors = [
      'span[data-icon="down-context"]',
      'span[data-icon*="down"]',
      '[data-testid*="down-context"]',
      '[data-testid*="context"]'
    ];

    row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));

    const rowRect = row.getBoundingClientRect();
    const menuButtonCandidates = [];

    for (const selector of menuButtonSelectors) {
      const candidate = row.querySelector(selector) || actionTarget.querySelector(selector);
      if (!candidate) continue;

      const clickable = candidate.closest('[role="button"], button, [tabindex]') || candidate;
      const rect = clickable.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const sameVerticalBand = rect.bottom >= rowRect.top - 20 && rect.top <= rowRect.bottom + 20;
      if (!sameVerticalBand) continue;
      menuButtonCandidates.push(clickable);
    }

    for (const clickable of menuButtonCandidates) {
      try {
        clickElementReliably(clickable);
        return;
      } catch (error) {
        // Try next candidate
      }
    }

    actionTarget.scrollIntoView({ behavior: 'auto', block: 'center' });
    const rect = actionTarget.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const probePoints = [
      [Math.round(rect.left + rect.width * 0.8), Math.round(rect.top + rect.height * 0.25)],
      [Math.round(rect.left + rect.width * 0.9), Math.round(rect.top + rect.height * 0.5)],
      [Math.round(rect.left + rect.width * 0.8), Math.round(rect.top + rect.height * 0.75)],
      [Math.round(rect.left + rect.width * 0.5), Math.round(rect.top + rect.height * 0.5)]
    ];

    for (const [x, y] of probePoints) {
      const topMost = document.elementFromPoint(x, y) || actionTarget;
      dispatchRightClickSequence(topMost, x, y);
    }
  }
              
  // Detect when context menu opens
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Check if this is a context menu (span with role="application" containing menu items)
          let menu = null;
          
          if (node.getAttribute && hasMenuContainerRole(node) && isContextMenu(node)) {
            menu = node;
          } else if (node.querySelector) {
            const candidate = node.querySelector('[role="menu"], [data-animate-dropdown], [role="dialog"] ul');
            if (candidate && isContextMenu(candidate)) {
              menu = candidate;
            }
          }
          
          // Additional check: look for menu structure
          if (!menu && isContextMenu(node)) {
            menu = node;
          }
          
          if (menu) {
            contextMenuOpen = true;
            currentContextMenu = menu;
            console.log('WhatsApp Web Improver: ✓ Context menu detected!');
            console.log('Menu element:', menu);
            
            // Log available menu items for debugging
            const items = menu.querySelectorAll('[role="button"], li, div[tabindex]');
            console.log(`Found ${items.length} menu items:`, Array.from(items).map(i => i.textContent.trim()));
          }
        }
      });

      mutation.removedNodes.forEach((node) => {
        if (node === currentContextMenu || (node.nodeType === 1 && node.contains(currentContextMenu))) {
          contextMenuOpen = false;
          currentContextMenu = null;
          console.log('WhatsApp Web Improver: Context menu closed');
        }
      });
    });
  });

  // Helper function to check if node is a context menu
  function isContextMenu(node) {
    if (!node || !node.querySelector) return false;

    if (node.id === 'main') return false;
    if (node.getAttribute && node.getAttribute('role') === 'row') return false;
    if (!hasMenuContainerRole(node) && !hasMenuLikeDescendants(node)) return false;
    
    // Optimization: Check for menu items first (cheap DOM traversal)
    // before checking visibility/size (expensive layout thrashing)
    // Most added nodes (like messages) have < 2 items and fail here fast.
    const items = Array.from(getMenuItemsForNode(node)).filter(isElementVisible);
    if (items.length < 2 || items.length > 16) return false;

    // Only do expensive layout checks if it looks like a menu structure
    if (!isElementVisible(node) || !isMenuSizeReasonable(node)) return false;

    return true;
  }

  function normalizeText(value) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function getActiveContextMenu(menuOverride = null) {
    if (menuOverride && menuOverride.isConnected && isElementVisible(menuOverride) && isContextMenu(menuOverride)) {
      return menuOverride;
    }

    if (currentContextMenu && currentContextMenu.isConnected && isElementVisible(currentContextMenu) && isContextMenu(currentContextMenu)) {
      return currentContextMenu;
    }

    return findContextMenu();
  }

  function clickElementReliably(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const x = Math.round(rect.left + Math.max(8, Math.min(rect.width - 8, rect.width / 2)));
    const y = Math.round(rect.top + Math.max(8, Math.min(rect.height - 8, rect.height / 2)));

    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1
    };

    element.dispatchEvent(new MouseEvent('mousedown', base));
    element.dispatchEvent(new MouseEvent('mouseup', base));
    element.dispatchEvent(new MouseEvent('click', base));
    element.click();
    return true;
  }

  function findVisibleActionCandidate(action) {
    const keywords = (actionKeywords[action] || []).map(normalizeText);
    if (keywords.length === 0) return null;

    const selectors = [
      '[role="menuitem"]',
      '[role="button"]',
      'li[tabindex]',
      'div[tabindex]'
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(','))).filter(isElementVisible);
    const candidates = nodes.filter((node) => {
      const text = normalizeText(node.textContent);
      const ariaLabel = normalizeText(node.getAttribute('aria-label'));
      const title = normalizeText(node.getAttribute('title'));
      if (!text && !ariaLabel && !title) return false;

      return keywords.some((keyword) => text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword));
    });

    if (candidates.length === 0) return null;

    candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftArea = leftRect.width * leftRect.height;
      const rightArea = rightRect.width * rightRect.height;
      return leftArea - rightArea;
    });

    return candidates[0];
  }

  function getMenuContainerForItem(item) {
    if (!item) return null;

    let current = item;
    let depth = 0;
    while (current && depth < 8) {
      if (isElementVisible(current) && isMenuSizeReasonable(current)) {
        const visibleItems = Array.from(getMenuItemsForNode(current)).filter(isElementVisible);
        if (visibleItems.length >= 2 && visibleItems.length <= 20) {
          return current;
        }
      }

      current = current.parentElement;
      depth += 1;
    }

    return null;
  }

  function findMenuScopedActionCandidate(action) {
    const keywords = (actionKeywords[action] || []).map(normalizeText);
    if (keywords.length === 0) return null;

    const selectors = [
      '[role="menuitem"]',
      '[role="button"]',
      'li[tabindex]',
      'div[tabindex]',
      'li',
      'button'
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(','))).filter(isElementVisible);
    const candidates = nodes.filter((node) => {
      const container = getMenuContainerForItem(node);
      if (!container) return false;

      const text = normalizeText(node.textContent);
      const ariaLabel = normalizeText(node.getAttribute('aria-label'));
      const title = normalizeText(node.getAttribute('title'));
      if (!text && !ariaLabel && !title) return false;

      return keywords.some((keyword) => text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword));
    });

    if (candidates.length === 0) return null;

    candidates.sort((left, right) => {
      const leftContainer = getMenuContainerForItem(left);
      const rightContainer = getMenuContainerForItem(right);

      if (leftContainer && rightContainer && leftContainer !== rightContainer) {
        const leftArea = leftContainer.getBoundingClientRect().width * leftContainer.getBoundingClientRect().height;
        const rightArea = rightContainer.getBoundingClientRect().width * rightContainer.getBoundingClientRect().height;
        return leftArea - rightArea;
      }

      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    });

    return candidates[0];
  }

  // Find and click a menu item by action
  function clickMenuItemByAction(action, menuOverride = null, allowGlobalFallback = true) {
    const menu = getActiveContextMenu(menuOverride);
    
    if (menu) {
      currentContextMenu = menu;
      contextMenuOpen = true;

      // Find all possible menu items
      const menuItems = Array.from(menu.querySelectorAll('[role="menuitem"], [role="button"], li[tabindex], div[tabindex], li, button'))
        .filter(isElementVisible);
      
      console.log(`🔍 WhatsApp Web Improver: Looking for "${action}" action among ${menuItems.length} menu items`);

      const keywords = (actionKeywords[action] || []).map(normalizeText);

      for (const item of menuItems) {
        const text = normalizeText(item.textContent);
        const ariaLabel = normalizeText(item.getAttribute('aria-label'));
        const title = normalizeText(item.getAttribute('title'));
        
        for (const keyword of keywords) {
          if (text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)) {
            console.log(`✓ WhatsApp Web Improver: "${action}" button found! Clicking...`);
            return clickElementReliably(item);
          }
        }
      }

      console.log(`❌ WhatsApp Web Improver: "${action}" button not found inside active menu`);
    } else {
      const scopedCandidate = findMenuScopedActionCandidate(action);
      if (scopedCandidate) {
        console.log(`✓ WhatsApp Web Improver: Menu-scoped fallback found "${action}" item. Clicking...`);
        return clickElementReliably(scopedCandidate);
      }

      if (!allowGlobalFallback) {
        console.log('❌ WhatsApp Web Improver: Active menu not detected for selected-message action');
        return false;
      }
      console.log('⚠️ WhatsApp Web Improver: Active menu not detected, trying global action fallback');
    }

    if (!allowGlobalFallback) {
      const scopedCandidate = findMenuScopedActionCandidate(action);
      if (scopedCandidate) {
        console.log(`✓ WhatsApp Web Improver: Menu-scoped fallback found "${action}" item. Clicking...`);
        return clickElementReliably(scopedCandidate);
      }
      return false;
    }

    const fallbackItem = findVisibleActionCandidate(action);
    if (fallbackItem) {
      console.log(`✓ WhatsApp Web Improver: Fallback found "${action}" item. Clicking...`);
      return clickElementReliably(fallbackItem);
    }

    console.log(`❌ WhatsApp Web Improver: "${action}" action not found in visible UI`);
    return false;
  }
  
  function getActionForKey(key) {
    for (const [action, config] of Object.entries(shortcuts)) {
      if (config.enabled && config.key === key) {
        return action;
      }
    }
    return null;
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;

    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true;
    if (target.contentEditable === 'true') return true;
    if (target.closest('[role="textbox"], [contenteditable="true"]')) return true;

    return false;
  }

  function isChatAreaTarget(target, allowComposer = false) {
    if (!(target instanceof Element)) return false;

    const inComposer = target.closest('footer, [role="textbox"], [contenteditable="true"], [data-tab="10"]');
    if (inComposer && !allowComposer) return false;

    return Boolean(
      target.closest(
        '[data-testid="conversation-panel-messages"], [aria-label*="message" i], [role="application"], [data-tab="8"], main'
      )
    );
  }

  function canEnterNavigationMode(eventTarget, allowComposer = false) {
    const target = eventTarget instanceof Element ? eventTarget : document.activeElement;
    return isChatAreaTarget(target, allowComposer);
  }

  // Listen for keypress events
  document.addEventListener('keydown', (e) => {
    const pressedKey = e.key;
    const pressedKeyLower = pressedKey.toLowerCase();
    const isTyping = isTypingTarget(e.target);

    // ===== MESSAGE NAVIGATION HANDLING =====
    if (contextMenuOpen && !ensureContextMenuOpen()) {
      contextMenuOpen = false;
      currentContextMenu = null;
    }

    const navEnabled = false;
    
    // Handle navigation mode keys
    if (messageNavigationMode) {
      if (navigationActionInProgress) {
        if (pressedKey === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          navigationActionInProgress = false;
          exitNavigationMode();
        } else if (pressedKey === 'ArrowUp' || pressedKey === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Escape to exit
      if (pressedKey === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitNavigationMode();
        return;
      }
      
      // Arrow Up - previous message
      if (pressedKey === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedMessageIndex > 0) {
          selectedMessageIndex--;
          highlightMessage(selectedMessageIndex);
        }
        return;
      }
      
      // Arrow Down - next message
      if (pressedKey === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedMessageIndex < messageElements.length - 1) {
          selectedMessageIndex++;
          highlightMessage(selectedMessageIndex);
        } else {
          // Exit navigation if we go past the last message
          exitNavigationMode();
        }
        return;
      }
      
      // Check for action shortcuts (only after a short delay to prevent accidental triggers)
      const timeSinceEntry = Date.now() - navigationModeEnteredAt;
      console.log(`⌨️ Nav mode key: "${pressedKeyLower}", time since entry: ${timeSinceEntry}ms`);
      
      if (timeSinceEntry > 300) { // 300ms delay before allowing actions
        if (navigationActionInProgress || e.repeat) {
          return;
        }

        for (const [action, config] of Object.entries(shortcuts)) {
          if (config.enabled && config.key === pressedKeyLower) {
            console.log(`🎯 Triggering action: ${action}`);
            e.preventDefault();
            e.stopPropagation();
            triggerActionOnSelectedMessage(action);
            return;
          }
        }
      } else {
        console.log('⏳ Ignoring key - too soon after entering navigation mode');
      }
    }

    // ===== CONTEXT MENU HANDLING =====
    
    // Don't trigger context menu shortcuts if user is typing
    if (isTyping) {
      return;
    }

    // Log all keypress when menu is open for debugging
    if (contextMenuOpen) {
      console.log(`⌨️  WhatsApp Web Improver: Key "${pressedKeyLower}" pressed (menu open: ${contextMenuOpen})`);
    }

    const actionForKey = getActionForKey(pressedKeyLower);
    if (!actionForKey) return;

    const menuDetected = ensureContextMenuOpen();

    console.log(`🎯 WhatsApp Web Improver: Matched shortcut "${pressedKeyLower}" → "${actionForKey}"`);
    
    if (!menuDetected) {
      console.log('⚠️ WhatsApp Web Improver: Menu container not detected, trying visible action fallback');
    }

    if (clickMenuItemByAction(actionForKey, menuDetected ? currentContextMenu : null)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Also exit navigation mode when clicking anywhere
  document.addEventListener('click', () => {
    if (messageNavigationMode && !navigationActionInProgress) {
      exitNavigationMode();
    }
  }, true);

  // Start observing the document for context menu changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('WhatsApp Web Improver: Monitoring for context menus...');

  // ===== HEADER OPTIONS BUTTON =====

  function isHeaderButtonCandidate(button) {
    if (!button) return false;
    if (!isElementVisible(button)) return false;
    if (button.id === 'wa-improver-options-btn') return false;
    return true;
  }

  function getPanelDesiredWidth() {
    return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.58)));
  }

  function ensureInjectedUiStyles() {
    if (document.getElementById('wa-improver-ui-styles')) return;

    const style = document.createElement('style');
    style.id = 'wa-improver-ui-styles';
    style.textContent = `
      #wa-improver-options-btn {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 18px;
        color: #25D366;
        background: rgba(37, 211, 102, 0.14);
        border: 1px solid rgba(37, 211, 102, 0.35);
        cursor: pointer;
        user-select: none;
      }

      #wa-improver-options-btn:hover {
        background: rgba(37, 211, 102, 0.22);
      }

      #wa-improver-options-btn svg {
        width: 18px;
        height: 18px;
        display: block;
      }

      #wa-improver-memory-widget {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-left: 10px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.9);
        font-size: 12px;
        line-height: 1;
      }

      #wa-improver-memory-widget .wa-improver-memory-value {
        font-weight: 600;
        letter-spacing: 0.2px;
      }

      #wa-improver-memory-widget .wa-improver-scale-value {
        font-weight: 600;
        letter-spacing: 0.2px;
      }

      #wa-improver-memory-widget .wa-improver-scale-btn {
        border: none;
        background: rgba(255, 255, 255, 0.14);
        color: rgba(255, 255, 255, 0.95);
        border-radius: 999px;
        padding: 2px 7px;
        font-size: 11px;
        cursor: pointer;
      }

      #wa-improver-memory-widget .wa-improver-scale-btn:hover {
        background: rgba(255, 255, 255, 0.24);
      }

      #wa-improver-memory-widget .wa-improver-reload-btn {
        border: none;
        background: rgba(37, 211, 102, 0.2);
        color: #25D366;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        cursor: pointer;
      }

      #wa-improver-memory-widget .wa-improver-reload-btn:hover {
        background: rgba(37, 211, 102, 0.3);
      }
    `;

    document.head.appendChild(style);
  }

  function createOptionsButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'wa-improver-options-btn';
    btn.setAttribute('title', 'WhatsApp Web Improver Settings');
    btn.setAttribute('aria-label', 'WhatsApp Web Improver Settings');

    btn.innerHTML = `
      <span data-icon="wa-improver-bolt" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
        </svg>
      </span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleOptionsPanel(btn);
    });

    return btn;
  }

  function positionFloatingOptionsButton(button) {
    const sidebarHeader = getSidebarHeader();
    if (!sidebarHeader) return;

    const rect = sidebarHeader.getBoundingClientRect();
    const top = Math.max(8, rect.top + 8);
    const left = Math.max(8, rect.right - 88);

    button.style.position = 'fixed';
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
    button.style.zIndex = '999998';
  }

  function getSidebarHeader() {
    const sideRoot = document.querySelector('#side, [data-testid="chat-list"]') || document;
    return sideRoot.querySelector('header, [data-testid="chat-list-header"], div[role="banner"]');
  }

  function findHeaderActionsRow() {
    const sidebarHeader = getSidebarHeader();
    if (!sidebarHeader) return null;

    const menuIcon = sidebarHeader.querySelector('span[data-icon="menu"], span[data-icon="menu-dots"], span[data-icon="kebab-menu"], span[data-icon="more"]');
    const menuButton = menuIcon?.closest('[role="button"]');
    if (menuButton?.parentElement) {
      return menuButton.parentElement;
    }

    const rows = Array.from(sidebarHeader.querySelectorAll('div')).filter((element) => {
      return element.querySelectorAll(':scope > [role="button"]').length >= 2;
    });

    if (rows.length === 0) return null;

    rows.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      if (Math.abs(leftRect.top - rightRect.top) > 2) return leftRect.top - rightRect.top;
      return rightRect.left - leftRect.left;
    });

    return rows[0];
  }

  function findSidebarTitleNode(sidebarHeader) {
    if (!sidebarHeader) return null;

    const explicit = sidebarHeader.querySelector('[title="WhatsApp"], h1');
    if (explicit && isElementVisible(explicit)) return explicit;

    const candidates = Array.from(sidebarHeader.querySelectorAll('span, div')).filter((node) => {
      const text = (node.textContent || '').trim();
      if (!text || text.length > 40) return false;
      return /whatsapp/i.test(text) && isElementVisible(node);
    });

    return candidates[0] || null;
  }

  function findSidebarTitleContainer(sidebarHeader, titleNode) {
    if (!sidebarHeader) return null;

    const headerRow = sidebarHeader.querySelector(':scope > div');
    if (headerRow) {
      const firstBlock = headerRow.querySelector(':scope > div');
      if (firstBlock) return firstBlock;
    }

    if (titleNode?.parentElement) return titleNode.parentElement;
    return sidebarHeader;
  }

  function createMemoryWidget() {
    const widget = document.createElement('div');
    widget.id = 'wa-improver-memory-widget';
    widget.innerHTML = `
      <button type="button" class="wa-improver-scale-btn" data-delta="-5" title="Decrease WhatsApp scale">−</button>
      <span class="wa-improver-scale-value">Scale: 100%</span>
      <button type="button" class="wa-improver-scale-btn" data-delta="5" title="Increase WhatsApp scale">+</button>
      <span class="wa-improver-memory-value">Mem: --</span>
      <button type="button" class="wa-improver-reload-btn" title="Reload WhatsApp Web" aria-label="Reload WhatsApp Web">Reload</button>
    `;

    widget.querySelectorAll('.wa-improver-scale-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const delta = parseInt(button.getAttribute('data-delta') || '0', 10);
        applyWhatsAppScale(currentUiScale + (Number.isFinite(delta) ? delta : UI_SCALE_STEP));
        updateMemoryWidget();
      });
    });

    const reloadBtn = widget.querySelector('.wa-improver-reload-btn');
    reloadBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      location.reload();
    });

    return widget;
  }

  function updateMemoryWidget() {
    const widget = document.getElementById('wa-improver-memory-widget');
    if (!widget) return;

    const valueEl = widget.querySelector('.wa-improver-memory-value');
    if (!valueEl) return;

    const scaleEl = widget.querySelector('.wa-improver-scale-value');
    if (scaleEl) {
      scaleEl.textContent = `Scale: ${currentUiScale}%`;
    }

    const snapshot = getMemorySnapshot();
    valueEl.textContent = snapshot.available ? `Mem: ${snapshot.usedMB} MB` : 'Mem: N/A';
  }

  function injectMemoryWidget() {
    ensureInjectedUiStyles();

    const existing = document.getElementById('wa-improver-memory-widget');
    if (existing) {
      updateMemoryWidget();
      return;
    }

    const sidebarHeader = getSidebarHeader();
    if (!sidebarHeader) return;

    const titleNode = findSidebarTitleNode(sidebarHeader);
    const titleContainer = findSidebarTitleContainer(sidebarHeader, titleNode);
    const widget = createMemoryWidget();

    if (titleContainer) {
      titleContainer.appendChild(widget);
    } else {
      sidebarHeader.prepend(widget);
    }

    updateMemoryWidget();
    console.log('WhatsApp Web Improver: Memory widget injected');
  }

  function findHeaderAnchorButton() {
    const sidebarHeader = document.querySelector('#side header, [data-testid="chat-list-header"], header');

    if (sidebarHeader) {
      const headerIconSelectors = [
        'span[data-icon="chat"]',
        'span[data-icon="new-chat"]',
        'span[data-icon="new-chat-outline"]',
        'span[data-icon="plus"]',
        'span[data-icon="compose"]'
      ];

      for (const iconSelector of headerIconSelectors) {
        const icon = sidebarHeader.querySelector(iconSelector);
        const button = icon?.closest('[role="button"]');
        if (isHeaderButtonCandidate(button)) return button;
      }

      const headerButtons = Array.from(sidebarHeader.querySelectorAll('[role="button"]'))
        .filter(isHeaderButtonCandidate)
        .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);

      if (headerButtons.length >= 2) {
        return headerButtons[headerButtons.length - 2];
      }
      if (headerButtons.length === 1) {
        return headerButtons[0];
      }
    }

    const iconSelectors = [
      'span[data-icon="chat"]',
      'span[data-icon="new-chat"]',
      'span[data-icon="new-chat-outline"]',
      'span[data-icon="plus"]',
      'span[data-icon="compose"]'
    ];

    for (const iconSelector of iconSelectors) {
      const icon = document.querySelector(iconSelector);
      const button = icon?.closest('[role="button"]');
      if (isHeaderButtonCandidate(button)) return button;
    }

    const ariaButtons = Array.from(document.querySelectorAll('[role="button"][aria-label], [role="button"][title]'));
    const newChatRegex = /(new\s*chat|nuevo\s*chat|nueva\s*conversaci[oó]n|nouvelle\s*discussion|nuova\s*chat|neuer\s*chat|iniciar\s*chat|start\s*chat)/i;
    const textButton = ariaButtons.find((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
      return newChatRegex.test(label);
    });

    if (isHeaderButtonCandidate(textButton)) return textButton;

    return null;
  }

  function injectOptionsButton() {
    if (document.getElementById('wa-improver-options-btn')) return;

    ensureInjectedUiStyles();

    const actionsRow = findHeaderActionsRow();
    if (!actionsRow) {
      const floatingBtn = createOptionsButton();
      document.body.appendChild(floatingBtn);
      positionFloatingOptionsButton(floatingBtn);
      console.log('WhatsApp Web Improver: Floating options button injected');
      return;
    }

    const newChatBtn = findHeaderAnchorButton();
    const btn = createOptionsButton();

    if (newChatBtn && newChatBtn.parentElement === actionsRow) {
      actionsRow.insertBefore(btn, newChatBtn);
      console.log('WhatsApp Web Improver: Options button injected next to new message');
      return;
    }

    const menuButton = Array.from(actionsRow.querySelectorAll('[role="button"]')).pop();
    if (menuButton) {
      actionsRow.insertBefore(btn, menuButton);
      console.log('WhatsApp Web Improver: Options button injected before menu button');
      return;
    }

    actionsRow.appendChild(btn);

    console.log('WhatsApp Web Improver: Options button injected');
  }

  function toggleOptionsPanel(anchorBtn) {
    let panel = document.getElementById('wa-improver-options-panel');

    if (panel) {
      // Toggle visibility
      if (panel.style.display === 'none') {
        panel.style.display = 'block';
        positionPanel(panel, anchorBtn);
      } else {
        panel.style.display = 'none';
      }
    } else {
      // Create panel (iframe wrapper)
      panel = document.createElement('div');
      panel.id = 'wa-improver-options-panel';

      // Style it as a floating popover
      Object.assign(panel.style, {
        position: 'fixed',
        zIndex: '999999',
        width: `${getPanelDesiredWidth()}px`,
        minWidth: `${PANEL_MIN_WIDTH}px`,
        maxWidth: `${PANEL_MAX_WIDTH}px`,
        height: '600px',
        maxHeight: '80vh',
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'transparent',
        display: 'block',
        transition: 'opacity 0.2s ease'
      });

      const iframe = document.createElement('iframe');
      iframe.src = chrome.runtime.getURL('popup.html');
      iframe.style.setProperty('width', '100%', 'important');
      iframe.style.setProperty('min-width', '100%', 'important');
      iframe.style.setProperty('max-width', '100%', 'important');
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.display = 'block';

      panel.appendChild(iframe);
      document.body.appendChild(panel);

      positionPanel(panel, anchorBtn);

      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (panel.style.display !== 'none' &&
            !panel.contains(e.target) &&
            !anchorBtn.contains(e.target)) {
          panel.style.display = 'none';
        }
      });
    }
  }

  function positionPanel(panel, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const margin = 10;
    const desiredWidth = getPanelDesiredWidth();
    const availableWidth = Math.max(260, window.innerWidth - margin * 2);
    const clampedWidth = Math.min(desiredWidth, availableWidth);
    panel.style.setProperty('width', `${clampedWidth}px`, 'important');
    panel.style.setProperty('min-width', `${Math.min(PANEL_MIN_WIDTH, availableWidth)}px`, 'important');
    panel.style.setProperty('max-width', `${Math.min(PANEL_MAX_WIDTH, availableWidth)}px`, 'important');

    const panelWidth = panel.offsetWidth || desiredWidth;
    const panelHeight = panel.offsetHeight || 600;

    let left = rect.left;
    let top = rect.bottom + 12;

    if (left + panelWidth > window.innerWidth - margin) {
      left = window.innerWidth - panelWidth - margin;
    }
    if (left < margin) {
      left = margin;
    }

    if (top + panelHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - panelHeight - 12);
    }

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function scheduleInjectOptionsButton() {
    if (optionsButtonDebounceTimer) return;

    optionsButtonDebounceTimer = setTimeout(() => {
      optionsButtonDebounceTimer = null;
      injectOptionsButton();
    }, 200);
  }

  function startOptionsButtonObserver() {
    if (optionsButtonObserver || !document.body) return;

    injectOptionsButton();
    injectMemoryWidget();

    optionsButtonObserver = new MutationObserver(() => {
      scheduleInjectOptionsButton();
      injectMemoryWidget();
    });

    optionsButtonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Monitor for header injection (WhatsApp loads dynamically)
  startOptionsButtonObserver();
  applyWhatsAppScale(loadStoredUiScale(), false);

  setInterval(() => {
    injectOptionsButton();
    injectMemoryWidget();
    updateMemoryWidget();
    applyWhatsAppScale(currentUiScale, false);

    const panel = document.getElementById('wa-improver-options-panel');
    const anchor = document.getElementById('wa-improver-options-btn');
    if (anchor && anchor.parentElement === document.body) {
      positionFloatingOptionsButton(anchor);
    }
    if (panel && anchor && panel.style.display !== 'none') {
      positionPanel(panel, anchor);
    }
  }, 6000);

  window.addEventListener('resize', () => {
    const panel = document.getElementById('wa-improver-options-panel');
    const anchor = document.getElementById('wa-improver-options-btn');
    if (anchor && anchor.parentElement === document.body) {
      positionFloatingOptionsButton(anchor);
    }
    if (panel && anchor && panel.style.display !== 'none') {
      positionPanel(panel, anchor);
    }
  });
})();
