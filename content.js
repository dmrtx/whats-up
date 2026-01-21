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
    
    // Look for menu items - WhatsApp menus typically have multiple list items or buttons
    const buttons = node.querySelectorAll('[role="button"]');
    const listItems = node.querySelectorAll('li');
    
    // If we have multiple menu-like items, it's likely a context menu
    return buttons.length >= 2 || listItems.length >= 2;
  }

  // Find and click a menu item by action
  function clickMenuItemByAction(action) {
    if (!currentContextMenu) {
      console.log('❌ WhatsApp Web Improver: No context menu found');
      return false;
    }

    // Find all possible menu items
    const menuItems = currentContextMenu.querySelectorAll('[role="button"], li[tabindex], div[tabindex], li, div[role="button"]');
    
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

  // Listen for keypress events
  document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in an input field
    if (e.target.tagName === 'INPUT' || 
        e.target.tagName === 'TEXTAREA' || 
        e.target.contentEditable === 'true') {
      return;
    }

    const pressedKey = e.key.toLowerCase();
    
    // Log all keypress when menu is open for debugging
    if (contextMenuOpen) {
      console.log(`⌨️  WhatsApp Web Improver: Key "${pressedKey}" pressed (menu open: ${contextMenuOpen})`);
    }

    if (!contextMenuOpen) return;

    // Check if the pressed key matches any enabled shortcut
    for (const [action, config] of Object.entries(shortcuts)) {
      if (config.enabled && config.key === pressedKey) {
        console.log(`🎯 WhatsApp Web Improver: Matched shortcut "${pressedKey}" → "${action}"`);
        
        if (clickMenuItemByAction(action)) {
          e.preventDefault();
          e.stopPropagation();
        }
        break;
      }
    }
  }, true);

  // Start observing the document for context menu changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('WhatsApp Web Improver: Monitoring for context menus...');
})();
