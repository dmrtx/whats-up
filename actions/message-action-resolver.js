(function() {
  'use strict';

  function createMessageActionResolver(config) {
    const {
      actionKeywords,
      clickElementReliably,
      domAdapter,
      isElementVisible
    } = config;

    const debugLog = (...args) => {
      if (window.__WA_IMPROVER_DEBUG) console.log(...args);
    };

    function normalizeText(value) {
      return (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
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
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });

      return candidates[0];
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
        const container = domAdapter.getMenuContainerForItem(node);
        if (!container) return false;

        const text = normalizeText(node.textContent);
        const ariaLabel = normalizeText(node.getAttribute('aria-label'));
        const title = normalizeText(node.getAttribute('title'));
        if (!text && !ariaLabel && !title) return false;

        return keywords.some((keyword) => text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword));
      });

      if (candidates.length === 0) return null;

      candidates.sort((left, right) => {
        const leftContainer = domAdapter.getMenuContainerForItem(left);
        const rightContainer = domAdapter.getMenuContainerForItem(right);

        if (leftContainer && rightContainer && leftContainer !== rightContainer) {
          const leftRect = leftContainer.getBoundingClientRect();
          const rightRect = rightContainer.getBoundingClientRect();
          return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
        }

        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });

      return candidates[0];
    }

    function clickMenuItemByAction(action, options) {
      const {
        allowGlobalFallback = true,
        currentContextMenu = null,
        menuOverride = null
      } = options || {};

      const menu = domAdapter.getActiveContextMenu(menuOverride, currentContextMenu);

      if (menu) {
        const menuItems = Array.from(
          menu.querySelectorAll('[role="menuitem"], [role="button"], li[tabindex], div[tabindex], li, button')
        ).filter(isElementVisible);

        debugLog(`🔍 WhatsApp Web Improver: Looking for "${action}" action among ${menuItems.length} menu items`);

        const keywords = (actionKeywords[action] || []).map(normalizeText);

        for (const item of menuItems) {
          const text = normalizeText(item.textContent);
          const ariaLabel = normalizeText(item.getAttribute('aria-label'));
          const title = normalizeText(item.getAttribute('title'));

          for (const keyword of keywords) {
            if (text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)) {
              debugLog(`✓ WhatsApp Web Improver: "${action}" button found! Clicking...`);
              return { clicked: clickElementReliably(item), menu };
            }
          }
        }

        debugLog(`❌ WhatsApp Web Improver: "${action}" button not found inside active menu`);
      } else {
        const scopedCandidate = findMenuScopedActionCandidate(action);
        if (scopedCandidate) {
          debugLog(`✓ WhatsApp Web Improver: Menu-scoped fallback found "${action}" item. Clicking...`);
          return {
            clicked: clickElementReliably(scopedCandidate),
            menu: domAdapter.getMenuContainerForItem(scopedCandidate)
          };
        }

        if (!allowGlobalFallback) {
          debugLog('❌ WhatsApp Web Improver: Active menu not detected for selected-message action');
          return { clicked: false, menu: null };
        }

        debugLog('⚠️ WhatsApp Web Improver: Active menu not detected, trying global action fallback');
      }

      if (!allowGlobalFallback) {
        const scopedCandidate = findMenuScopedActionCandidate(action);
        if (scopedCandidate) {
          debugLog(`✓ WhatsApp Web Improver: Menu-scoped fallback found "${action}" item. Clicking...`);
          return {
            clicked: clickElementReliably(scopedCandidate),
            menu: domAdapter.getMenuContainerForItem(scopedCandidate)
          };
        }
        return { clicked: false, menu: null };
      }

      const fallbackItem = findVisibleActionCandidate(action);
      if (fallbackItem) {
        debugLog(`✓ WhatsApp Web Improver: Fallback found "${action}" item. Clicking...`);
        return {
          clicked: clickElementReliably(fallbackItem),
          menu: domAdapter.getMenuContainerForItem(fallbackItem)
        };
      }

      debugLog(`❌ WhatsApp Web Improver: "${action}" action not found in visible UI`);
      return { clicked: false, menu: null };
    }

    return {
      clickMenuItemByAction,
      normalizeText
    };
  }

  window.WAImproverMessageActionResolver = {
    createMessageActionResolver
  };
})();
