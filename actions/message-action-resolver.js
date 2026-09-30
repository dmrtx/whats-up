(function() {
  'use strict';

  function createMessageActionResolver(config) {
    const { actionKeywords, clickElementReliably, domAdapter, isElementVisible } = config;

    function normalizeText(value) {
      return (value || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').trim();
    }

    function findMenuActionCandidate(action, menu) {
      if (!menu?.isConnected || !isElementVisible(menu)) return null;
      const keywords = (actionKeywords[action] || []).map(normalizeText);
      const items = Array.from(menu.querySelectorAll(
        '[role="menuitem"], [role="button"], li[tabindex], div[tabindex], li, button'
      )).filter((item) => isElementVisible(item)
        && item.getAttribute('aria-disabled') !== 'true' && !item.disabled);

      return items.find((item) => {
        const labels = [item.textContent, item.getAttribute('aria-label'), item.getAttribute('title')]
          .map(normalizeText);
        return keywords.some((keyword) => labels.some((label) => label.includes(keyword)));
      }) || null;
    }

    function clickMenuItemByAction(action, options = {}) {
      const menu = domAdapter.getActiveContextMenu(options.menuOverride, options.currentContextMenu);
      const item = findMenuActionCandidate(action, menu);
      // Falling back to the whole document can activate another message's
      // action, or even a Delete confirmation dialog. Require this menu.
      return { clicked: Boolean(item && clickElementReliably(item)), menu };
    }

    return { clickMenuItemByAction, findMenuActionCandidate, normalizeText };
  }

  window.WAImproverMessageActionResolver = { createMessageActionResolver };
})();
