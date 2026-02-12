// WhatsApp Web Improver - Content Script
// Adds configurable keyboard shortcuts to WhatsApp Web context menus

(function() {
  'use strict';

  console.log('WhatsApp Web Improver: Extension loaded');

  let contextMenuOpen = false;
  let currentContextMenu = null;
  let shortcuts = {};
  let performanceSettings = {};
  let lastReloadCheck = null;
  let reloadNotificationShown = false;
  
  // Message navigation state
  let messageNavigationEnabled = false;
  let messageNavigationMode = false;
  let selectedMessageIndex = -1;
  let messageElements = [];
  let navigationModeEnteredAt = 0; // Timestamp to prevent immediate actions
  
  // Status + memory reporting (shared with popup/options)
  const MEMORY_STATUS_KEY = 'waImproverMemoryStatus';
  const LAST_ACTIVE_KEY = 'waImproverLastSeen';
  const MEMORY_REPORT_INTERVAL_MS = 10000;
  let lastMemoryReportAt = 0;

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
    showReloadNotification: true,
    messageNavigation: { enabled: true }
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
    chrome.storage.sync.get(['shortcuts', 'performance'], (data) => {
      shortcuts = data.shortcuts || defaultShortcuts;
      performanceSettings = data.performance || defaultPerformanceSettings;
      console.log('WhatsApp Web Improver: Settings loaded', { shortcuts, performanceSettings });
      
      // Start performance monitoring
      startPerformanceMonitoring();
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
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

  // Initialize settings
  loadSettings();

  // ===== PERFORMANCE MONITORING =====
  
  function markExtensionActive() {
    chrome.storage.local.set({ [LAST_ACTIVE_KEY]: Date.now() });
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
    chrome.storage.local.set({ [MEMORY_STATUS_KEY]: getMemorySnapshot() });
  }
  
  function startHeartbeat() {
    markExtensionActive();
    reportMemorySnapshot(true);
    
    setInterval(() => {
      markExtensionActive();
      reportMemorySnapshot();
    }, MEMORY_REPORT_INTERVAL_MS);
  }

  // Show reload notification banner
  function showReloadNotification(reason) {
    if (reloadNotificationShown) return;
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
      reloadNotificationShown = false;
      // Don't ask again for 1 hour
      setTimeout(() => { reloadNotificationShown = false; }, 60 * 60 * 1000);
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
    
    if (selectedMessageIndex < 0 || selectedMessageIndex >= messageElements.length) {
      console.log('❌ Invalid message index');
      return false;
    }
    
    const msg = messageElements[selectedMessageIndex];
    
    // Find the message bubble/container to right-click on
    const targetElement = msg.querySelector('[data-pre-plain-text]') || 
                          msg.querySelector('[class*="copyable-text"]') ||
                          msg;
    
    console.log(`🎯 WhatsApp Web Improver: Triggering "${action}" on selected message`, targetElement);
    
    // Create and dispatch right-click event to open context menu
    const rightClickEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      clientX: targetElement.getBoundingClientRect().x + 50,
      clientY: targetElement.getBoundingClientRect().y + 20
    });
    
    targetElement.dispatchEvent(rightClickEvent);
    
    // Wait for context menu to appear, then trigger action
    waitForContextMenu((menu) => {
      if (menu) {
        clickMenuItemByAction(action, menu);
      } else {
        console.log('❌ Context menu did not open');
      }
      exitNavigationMode();
    });
    
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
    if (area > viewportArea * 0.7) return false;
    return true;
  }
  
  function getMenuItemsForNode(node) {
    return node.querySelectorAll('[role="button"], [role="menuitem"], li[tabindex], div[tabindex], li');
  }
  
  function findContextMenu() {
    const selectors = [
      '[role="menu"]',
      'div[role="dialog"] [role="menu"]',
      'ul[role="menu"]',
      'div[role="presentation"] ul',
      'span[role="application"]',
      'div[role="application"]'
    ];
    
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
      for (const menu of candidates) {
        if (!isElementVisible(menu) || !isMenuSizeReasonable(menu)) continue;
        const items = getMenuItemsForNode(menu);
        if (items.length >= 2) {
          return menu;
        }
      }
    }
    
    // Fallback: find a small container with multiple visible menu-like items
    const visibleItems = Array.from(document.querySelectorAll('[role="button"], [role="menuitem"], li[tabindex], div[tabindex]'))
      .filter(isElementVisible);
    
    const containerCounts = new Map();
    for (const item of visibleItems) {
      const container = item.closest('[role="menu"], [role="dialog"], ul, div, span');
      if (!container) continue;
      const count = containerCounts.get(container) || 0;
      containerCounts.set(container, count + 1);
    }
    
    for (const [container, count] of containerCounts.entries()) {
      if (count >= 2 && isElementVisible(container) && isMenuSizeReasonable(container)) {
        return container;
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
              
  // Detect when context menu opens
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Check if this is a context menu (span with role="application" containing menu items)
          let menu = null;
          
          if (node.getAttribute && node.getAttribute('role') === 'application') {
            menu = node;
          } else if (node.querySelector) {
            menu = node.querySelector('span[role="application"]');
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
    
    // Optimization: Check for menu items first (cheap DOM traversal)
    // before checking visibility/size (expensive layout thrashing)
    // Most added nodes (like messages) have < 2 items and fail here fast.
    const items = getMenuItemsForNode(node);
    if (items.length < 2) return false;

    // Only do expensive layout checks if it looks like a menu structure
    if (!isElementVisible(node) || !isMenuSizeReasonable(node)) return false;

    return true;
  }

  // Find and click a menu item by action
  function clickMenuItemByAction(action, menuOverride = null) {
    const menu = menuOverride || currentContextMenu || findContextMenu();
    
    if (!menu) {
      console.log('❌ WhatsApp Web Improver: No context menu found');
      return false;
    }
    
    currentContextMenu = menu;
    contextMenuOpen = true;

    // Find all possible menu items
    const menuItems = menu.querySelectorAll('[role="button"], li[tabindex], div[tabindex], li, div[role="button"]');
    
    console.log(`🔍 WhatsApp Web Improver: Looking for "${action}" action among ${menuItems.length} menu items`);

    const keywords = actionKeywords[action] || [];

    for (const item of menuItems) {
      const text = item.textContent.toLowerCase().trim();
      const ariaLabel = item.getAttribute('aria-label')?.toLowerCase() || '';
      const title = item.getAttribute('title')?.toLowerCase() || '';
      
      console.log(`  - Checking: "${text.substring(0, 30)}..."`);
      
      // Check if any keyword matches in text, aria-label, or title
      for (const keyword of keywords) {
        if (text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)) {
          console.log(`✓ WhatsApp Web Improver: "${action}" button found! Clicking...`);
          item.click();
          return true;
        }
      }
    }

    console.log(`❌ WhatsApp Web Improver: "${action}" button not found. Available items:`, 
                Array.from(menuItems).map(i => i.textContent.trim().substring(0, 20)));
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

  // Listen for keypress events
  document.addEventListener('keydown', (e) => {
    const pressedKey = e.key;
    const pressedKeyLower = pressedKey.toLowerCase();
    const isTyping = e.target.tagName === 'INPUT' || 
                     e.target.tagName === 'TEXTAREA' || 
                     e.target.contentEditable === 'true';

    // ===== MESSAGE NAVIGATION HANDLING =====
    const navEnabled = performanceSettings.messageNavigation?.enabled !== false;
    
    // Arrow Up to enter navigation mode (only when NOT typing)
    if (navEnabled && pressedKey === 'ArrowUp' && !messageNavigationMode && !contextMenuOpen && !isTyping) {
      console.log('🚀 WhatsApp Web Improver: Entering navigation mode via ArrowUp');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      enterNavigationMode();
      return;
    }
    
    // Escape to enter navigation mode (alternative)
    if (navEnabled && pressedKey === 'Escape' && !messageNavigationMode && !contextMenuOpen && !isTyping) {
      console.log('🚀 WhatsApp Web Improver: Entering navigation mode via Escape');
      e.preventDefault();
      e.stopPropagation();
      enterNavigationMode();
      return;
    }
    
    // Handle navigation mode keys
    if (messageNavigationMode) {
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
        for (const [action, config] of Object.entries(shortcuts)) {
          if (config.enabled && config.key === pressedKeyLower) {
            console.log(`🎯 Triggering action: ${action}`);
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
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
    
    if (!contextMenuOpen && !ensureContextMenuOpen()) {
      return;
    }

    console.log(`🎯 WhatsApp Web Improver: Matched shortcut "${pressedKeyLower}" → "${actionForKey}"`);
    
    if (clickMenuItemByAction(actionForKey)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Also exit navigation mode when clicking anywhere
  document.addEventListener('click', () => {
    if (messageNavigationMode) {
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

  function injectOptionsButton() {
    if (document.getElementById('wa-improver-options-btn')) return;

    // Find "New Chat" button by looking for the chat icon
    // This is robust across languages as it relies on the data-icon attribute
    const chatIcon = document.querySelector('span[data-icon="chat"]');
    if (!chatIcon) return;

    const newChatBtn = chatIcon.closest('[role="button"]');
    if (!newChatBtn) return;

    const headerContainer = newChatBtn.parentElement;
    if (!headerContainer) return;

    // Create our button
    const btn = document.createElement('div');
    btn.id = 'wa-improver-options-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('title', 'WhatsApp Web Improver Settings');
    btn.setAttribute('aria-label', 'WhatsApp Web Improver Settings');

    // Copy classes from New Chat button to match WhatsApp style (hover effects, size)
    btn.className = newChatBtn.className;

    // Inner HTML with a Bolt icon ⚡
    btn.innerHTML = `
      <span data-icon="wa-improver-bolt" style="display: flex; align-items: center; justify-content: center;">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
        </svg>
      </span>
    `;

    // Add specific style to ensure icon color matches theme
    // WhatsApp usually sets color on the svg or path.
    // We'll set generic currentColor and let it inherit.

    // Insert before the New Chat button
    headerContainer.insertBefore(btn, newChatBtn);

    // Add click listener
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleOptionsPanel(btn);
    });

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
        width: '380px',
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
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';

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
    const top = rect.bottom + 12;
    // Align to the right of the button, but ensuring it fits in viewport
    // WhatsApp sidebar is on the left, so we likely want it left-aligned or centered to button
    // but constrained to the screen.
    const left = Math.max(10, rect.left);

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  // Monitor for header injection (WhatsApp loads dynamically)
  setInterval(injectOptionsButton, 2000);
})();
