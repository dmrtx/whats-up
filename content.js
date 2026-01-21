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
          // WhatsApp context menu typically has these characteristics
          const menu = node.querySelector('[role="application"]') || 
                      (node.getAttribute && node.getAttribute('role') === 'application');
          
          if (menu || isContextMenu(node)) {
            contextMenuOpen = true;
            currentContextMenu = menu || node;
            console.log('WhatsApp Web Improver: Context menu detected');
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
    
    // Look for menu items with specific WhatsApp patterns
    const hasMenuItems = node.querySelector('[role="button"]') !== null;
    const hasMenuStructure = node.classList && (
      node.classList.contains('_3yz-8') || 
      Array.from(node.classList).some(c => c.includes('menu'))
    );
    
    return hasMenuItems || hasMenuStructure;
  }

  // Find and click a menu item by action
  function clickMenuItemByAction(action) {
    if (!currentContextMenu) {
      console.log('WhatsApp Web Improver: No context menu found');
      return false;
    }

    // Find all buttons/menu items in the context menu
    const menuItems = currentContextMenu.querySelectorAll('[role="button"], li[tabindex], div[role="button"]');
    
    console.log(`WhatsApp Web Improver: Found ${menuItems.length} menu items, looking for "${action}"`);

    const keywords = actionKeywords[action] || [];

    for (const item of menuItems) {
      const text = item.textContent.toLowerCase().trim();
      const ariaLabel = item.getAttribute('aria-label')?.toLowerCase() || '';
      
      // Check if any keyword matches
      for (const keyword of keywords) {
        if (text.includes(keyword) || ariaLabel.includes(keyword)) {
          console.log(`WhatsApp Web Improver: ${action} button found, clicking...`);
          item.click();
          return true;
        }
      }
    }

    console.log(`WhatsApp Web Improver: ${action} button not found (action may not be available for this message)`);
    return false;
  }

  // Listen for keypress events
  document.addEventListener('keydown', (e) => {
    if (!contextMenuOpen) return;

    // Don't trigger if user is typing in an input field
    if (e.target.tagName === 'INPUT' || 
        e.target.tagName === 'TEXTAREA' || 
        e.target.contentEditable === 'true') {
      return;
    }

    const pressedKey = e.key.toLowerCase();

    // Check if the pressed key matches any enabled shortcut
    for (const [action, config] of Object.entries(shortcuts)) {
      if (config.enabled && config.key === pressedKey) {
        console.log(`WhatsApp Web Improver: "${pressedKey}" key pressed for action "${action}"`);
        
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
