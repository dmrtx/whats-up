// WhatsApp Web Improver - Shared default settings
// Loaded both as a content script and by popup.html, so it must not use
// chrome.* APIs or DOM globals at load time.

(function() {
  'use strict';

  const DEFAULT_SHORTCUTS = {
    edit: { key: 'e', enabled: true },
    delete: { key: 'd', enabled: true },
    reply: { key: 'r', enabled: true },
    forward: { key: 'f', enabled: true },
    star: { key: 's', enabled: true },
    info: { key: 'i', enabled: true },
    copy: { key: 'c', enabled: true },
    pin: { key: 'p', enabled: true }
  };

  const DEFAULT_PERFORMANCE_SETTINGS = {
    autoReload: {
      enabled: false,
      time: '04:00'
    },
    memoryMonitor: {
      enabled: true,
      threshold: 1500,        // MB of used JS heap
      // performance.memory only reports the JS heap and measures it against a
      // fixed ~3.5 GB ceiling, not the machine's RAM. This percentage is an
      // about-to-OOM backstop, not the everyday trigger — that is `threshold`.
      percentThreshold: 85,
      autoReload: true        // reload by itself instead of only warning
    },
    // The JS heap misses DOM nodes, images and media, which is most of what
    // makes WhatsApp Web heavy. Uptime is a coarser but far more honest proxy.
    uptimeReload: {
      enabled: false,
      hours: 12
    },
    showReloadNotification: true
  };

  const DEFAULT_NAVIGATION_SETTINGS = {
    enabled: true
  };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  // Stored settings replace defaults wholesale in chrome.storage, so settings
  // saved by an older version are missing any key added since. Merging keeps
  // those users on the new defaults instead of `undefined`.
  function withDefaults(stored, defaults) {
    if (!isPlainObject(stored)) return structuredCloneSafe(defaults);

    const result = structuredCloneSafe(defaults);
    for (const [key, value] of Object.entries(stored)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = withDefaults(value, result[key]);
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const api = {
    DEFAULT_SHORTCUTS,
    DEFAULT_PERFORMANCE_SETTINGS,
    DEFAULT_NAVIGATION_SETTINGS,
    withDefaults
  };

  if (typeof window !== 'undefined') {
    window.WAImproverDefaults = api;
  }
})();
