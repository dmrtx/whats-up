(function() {
  'use strict';

  function createWhatsAppDomAdapter(config) {
    const {
      isElementVisible,
      clickElementReliably
    } = config;

    function isMenuSizeReasonable(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      const viewportArea = (window.innerWidth || 1) * (window.innerHeight || 1);
      const area = rect.width * rect.height;

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
      if (!node || !node.querySelector) return false;
      return Boolean(
        node.querySelector('[role="menuitem"], [role="menu"], [aria-haspopup="menu"], [data-animate-dropdown]')
      );
    }

    // Runs against every node WhatsApp inserts, so the cheap DOM checks have to
    // reject before anything touches layout (getBoundingClientRect /
    // getComputedStyle force a synchronous reflow).
    function isContextMenu(node) {
      if (!node || !node.querySelector) return false;

      if (node.id === 'main') return false;
      if (node.getAttribute && node.getAttribute('role') === 'row') return false;
      if (!hasMenuContainerRole(node) && !hasMenuLikeDescendants(node)) return false;

      // Node count is free; the visibility filter is not.
      const rawItems = getMenuItemsForNode(node);
      if (rawItems.length < 2) return false;

      if (!isElementVisible(node) || !isMenuSizeReasonable(node)) return false;

      const items = Array.from(rawItems).filter(isElementVisible);
      if (items.length < 2 || items.length > 16) return false;

      return true;
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

    function getActiveContextMenu(menuOverride, currentContextMenu) {
      if (menuOverride && menuOverride.isConnected && isElementVisible(menuOverride) && isContextMenu(menuOverride)) {
        return menuOverride;
      }

      if (currentContextMenu && currentContextMenu.isConnected && isElementVisible(currentContextMenu) && isContextMenu(currentContextMenu)) {
        return currentContextMenu;
      }

      return findContextMenu();
    }

    function ensureContextMenuOpen(currentContextMenu) {
      if (currentContextMenu && isElementVisible(currentContextMenu)) {
        return { open: true, menu: currentContextMenu };
      }

      const menu = findContextMenu();
      if (menu) {
        return { open: true, menu };
      }

      return { open: false, menu: null };
    }

    function waitForContextMenu(callback, attempts, delayMs) {
      const menu = findContextMenu();
      if (menu) {
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
          // try next candidate
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

    return {
      ensureContextMenuOpen,
      findContextMenu,
      getActiveContextMenu,
      getMenuContainerForItem,
      getMenuItemsForNode,
      hasMenuContainerRole,
      isContextMenu,
      openContextMenuForMessageElement,
      waitForContextMenu
    };
  }

  window.WAImproverDomAdapter = {
    createWhatsAppDomAdapter
  };
})();
