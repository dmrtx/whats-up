// WhatsApp Web Improver - Content Script
// Adds configurable keyboard shortcuts to WhatsApp Web context menus

(function() {
  'use strict';

  console.log('WhatsApp Web Improver: Extension loaded');

  let contextMenuOpen = false;
  let currentContextMenu = null;
  let shortcuts = {};

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

  // Load shortcuts from storage
  function loadShortcuts() {
    chrome.storage.sync.get('shortcuts', (data) => {
      shortcuts = data.shortcuts || defaultShortcuts;
      console.log('WhatsApp Web Improver: Shortcuts loaded', shortcuts);
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.shortcuts) {
      shortcuts = changes.shortcuts.newValue;
      console.log('WhatsApp Web Improver: Shortcuts updated', shortcuts);
    }
  });

  // Initialize shortcuts
  loadShortcuts();

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
