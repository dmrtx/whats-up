// WhatsApp Web Improver - Content Script
// Adds configurable keyboard shortcuts to WhatsApp Web context menus

(function() {
  'use strict';

  if (window.__WA_IMPROVER_LOADED) return;
  window.__WA_IMPROVER_LOADED = true;

  // Set window.__WA_IMPROVER_DEBUG = true in the console to get verbose logs.
  const debugLog = (...args) => {
    if (window.__WA_IMPROVER_DEBUG) console.log(...args);
  };

  debugLog('WhatsApp Web Improver: Extension loaded');

  let contextMenuOpen = false;
  let currentContextMenu = null;
  let shortcuts = {};
  let performanceSettings = {};
  let lastReloadCheck = null;
  let reloadNotificationShown = false;
  let reloadNotificationCooldownUntil = 0;

  // Message navigation state
  let messageNavigationEnabled = true;
  let messageNavigationMode = false;
  let selectedMessageIndex = -1;
  let selectedMessageElement = null;
  let selectedMessageIdentity = null;
  let navigationChatContext = null;
  let messageElements = [];
  let navigationActionInProgress = false;
  let activeMessageAction = null;
  let activeSlashOperation = null;
  const extensionKeyboardEvents = new WeakSet();
  let optionsButtonObserver = null;
  let optionsButtonDebounceTimer = null;
  let memoryWidgetDebounceTimer = null;
  const PANEL_MIN_WIDTH = 360;
  const PANEL_MAX_WIDTH = 520;
  const UI_SCALE_STORAGE_KEY = 'waImproverUiScale';
  const UI_SCALE_MIN = 85;
  const UI_SCALE_MAX = 130;
  const UI_SCALE_STEP = 5;
  // The slash-command registry. Adding an entry here is all a new command needs
  // to show up in the menu; execution is wired in handleSlashCommandInvocation.
  const SLASH_COMMAND_DEFINITIONS = [
    {
      command: 'gif',
      slash: '/gif',
      icon: 'GIF',
      description: 'Search GIFs',
      argHint: 'search text',
      argRequired: true
    },
    {
      command: 'sticker',
      slash: '/sticker',
      icon: '☺',
      description: 'Open stickers',
      argHint: 'search text (optional)',
      argRequired: false
    }
  ];
  const SLASH_MENU_ID = 'wa-improver-slash-menu';

  // Status + memory reporting (shared with popup/options)
  const MEMORY_STATUS_KEY = 'waImproverMemoryStatus';
  const LAST_ACTIVE_KEY = 'waImproverLastSeen';
  const MEMORY_REPORT_INTERVAL_MS = 10000;
  let lastMemoryReportAt = 0;
  let currentUiScale = 100;
  let extensionContextInvalid = false;
  let slashMenuComposer = null;
  let slashMenuMatches = [];
  let slashMenuIndex = 0;
  let suppressComposerInputHandler = false;
  let programmaticClearDepth = 0;
  let domAdapter = null;
  let messageActionResolver = null;
  let composerController = null;

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
  const {
    DEFAULT_SHORTCUTS: defaultShortcuts,
    DEFAULT_PERFORMANCE_SETTINGS: defaultPerformanceSettings,
    DEFAULT_NAVIGATION_SETTINGS: defaultNavigationSettings,
    withDefaults
  } = window.WAImproverDefaults;

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

  function initializeWhatsAppAdapters() {
    if (!window.WAImproverDomAdapter?.createWhatsAppDomAdapter) {
      console.warn('WhatsApp Web Improver: DOM adapter module unavailable');
      return;
    }

    if (!window.WAImproverMessageActionResolver?.createMessageActionResolver) {
      console.warn('WhatsApp Web Improver: Action resolver module unavailable');
      return;
    }

    if (!window.WAImproverComposerController?.createWhatsAppComposerController) {
      console.warn('WhatsApp Web Improver: Composer controller module unavailable');
      return;
    }

    domAdapter = window.WAImproverDomAdapter.createWhatsAppDomAdapter({
      isElementVisible,
      clickElementReliably
    });

    messageActionResolver = window.WAImproverMessageActionResolver.createMessageActionResolver({
      actionKeywords,
      clickElementReliably,
      domAdapter,
      isElementVisible
    });

    composerController = window.WAImproverComposerController.createWhatsAppComposerController({
      isElementVisible,
      enterProgrammaticMutation: () => {
        programmaticClearDepth += 1;
      },
      exitProgrammaticMutation: () => {
        programmaticClearDepth = Math.max(0, programmaticClearDepth - 1);
      },
      setInputSuppressed: (value) => {
        suppressComposerInputHandler = Boolean(value);
      }
    });
  }

  // Load settings from storage
  function loadSettings() {
    safeStorageSyncGet(['shortcuts', 'performance', 'navigation'], (data) => {
      shortcuts = withDefaults(data.shortcuts, defaultShortcuts);
      performanceSettings = withDefaults(data.performance, defaultPerformanceSettings);
      messageNavigationEnabled = withDefaults(data.navigation, defaultNavigationSettings).enabled !== false;
      applyWhatsAppScale(loadStoredUiScale(), false);
      debugLog('WhatsApp Web Improver: Settings loaded', { shortcuts, performanceSettings });

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
            shortcuts = withDefaults(changes.shortcuts.newValue, defaultShortcuts);
            debugLog('WhatsApp Web Improver: Shortcuts updated', shortcuts);
          }
          if (changes.performance) {
            performanceSettings = withDefaults(changes.performance.newValue, defaultPerformanceSettings);
            debugLog('WhatsApp Web Improver: Performance settings updated', performanceSettings);
          }
          if (changes.navigation) {
            messageNavigationEnabled = withDefaults(changes.navigation.newValue, defaultNavigationSettings).enabled !== false;
            if (!messageNavigationEnabled && messageNavigationMode) {
              exitNavigationMode();
            }
            debugLog('WhatsApp Web Improver: Navigation setting updated', messageNavigationEnabled);
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

  // ===== RELOAD =====

  // A reload right after load would loop forever if WhatsApp is heavy on its
  // own, so an automatic reload needs both a minimum uptime and a gap since the
  // previous one. sessionStorage survives the reload within the same tab.
  const AUTO_RELOAD_MIN_UPTIME_MS = 5 * 60 * 1000;
  const AUTO_RELOAD_MIN_GAP_MS = 15 * 60 * 1000;
  const AUTO_RELOAD_COUNTDOWN_SECONDS = 15;
  const AUTO_RELOAD_STAMP_KEY = 'waImproverLastAutoReload';
  const pageLoadedAt = Date.now();
  let reloadPending = false;

  function getLastAutoReloadAt() {
    try {
      return Number(sessionStorage.getItem(AUTO_RELOAD_STAMP_KEY)) || 0;
    } catch (error) {
      return 0;
    }
  }

  function stampAutoReload() {
    try {
      sessionStorage.setItem(AUTO_RELOAD_STAMP_KEY, String(Date.now()));
    } catch (error) {
      // Private mode / storage disabled: the uptime guard still applies.
    }
  }

  // Reloading would throw away anything the user has not sent yet.
  function hasUnsentDraft() {
    const composer = getActiveComposer();
    return Boolean(composer && getComposerText(composer));
  }

  function isCallActive() {
    return Boolean(
      document.querySelector('[data-testid="call-header"], [aria-label*="call" i][role="dialog"], #call-screen')
    );
  }

  // Returns null when it is safe to auto-reload, otherwise why it is not.
  function getAutoReloadBlocker() {
    if (Date.now() - pageLoadedAt < AUTO_RELOAD_MIN_UPTIME_MS) return 'page loaded too recently';
    if (Date.now() - getLastAutoReloadAt() < AUTO_RELOAD_MIN_GAP_MS) return 'auto-reloaded recently';
    if (isCallActive()) return 'a call is active';
    if (hasUnsentDraft()) return 'there is an unsent draft';
    return null;
  }

  function performReload(auto) {
    if (auto) stampAutoReload();
    location.reload();
  }

  // Single entry point for every reload trigger. `auto` reloads on its own
  // after a cancellable countdown; otherwise the banner just waits for a click.
  function requestReload(reason, options = {}) {
    const { auto = false } = options;

    if (reloadPending) return;

    if (!auto) {
      showReloadNotification(reason);
      return;
    }

    const blocker = getAutoReloadBlocker();
    if (blocker) {
      debugLog(`WhatsApp Web Improver: auto-reload skipped (${blocker})`);
      // Still let the user know, so a blocked auto-reload is not silent.
      if (performanceSettings.showReloadNotification !== false) {
        showReloadNotification(reason);
      }
      return;
    }

    if (performanceSettings.showReloadNotification === false) {
      performReload(true);
      return;
    }

    reloadPending = true;
    showReloadNotification(reason, { countdownSeconds: AUTO_RELOAD_COUNTDOWN_SECONDS });
  }

  // Show reload notification banner
  function showReloadNotification(reason, options = {}) {
    const { countdownSeconds = 0 } = options;

    if (reloadNotificationShown) return;
    if (!countdownSeconds && Date.now() < reloadNotificationCooldownUntil) return;
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
        <span id="wa-reload-reason"></span>
      </div>
      <div class="buttons">
        <button class="reload-btn" id="wa-reload-now">Reload now</button>
        <button class="dismiss-btn" id="wa-reload-later">Not now</button>
      </div>
    `;

    // reason is built from settings/measurements, but keep it out of innerHTML.
    banner.querySelector('#wa-reload-reason').textContent = reason;

    document.body.appendChild(banner);

    let countdownTimer = null;

    const dismiss = () => {
      if (countdownTimer) clearInterval(countdownTimer);
      banner.remove();
      reloadPending = false;
      reloadNotificationCooldownUntil = Date.now() + (60 * 60 * 1000);
      reloadNotificationShown = false;
    };

    banner.querySelector('#wa-reload-now').addEventListener('click', () => {
      if (countdownTimer) clearInterval(countdownTimer);
      performReload(countdownSeconds > 0);
    });

    banner.querySelector('#wa-reload-later').addEventListener('click', dismiss);

    if (countdownSeconds > 0) {
      const laterBtn = banner.querySelector('#wa-reload-later');
      let remaining = countdownSeconds;

      const tick = () => {
        laterBtn.textContent = `Cancel (${remaining}s)`;
        if (remaining <= 0) {
          clearInterval(countdownTimer);
          // Re-check: the user may have started typing during the countdown.
          if (hasUnsentDraft() || isCallActive()) {
            dismiss();
            return;
          }
          performReload(true);
          return;
        }
        remaining -= 1;
      };

      tick();
      countdownTimer = setInterval(tick, 1000);
    }
  }

  // Check memory usage
  function checkMemoryUsage() {
    const monitor = performanceSettings.memoryMonitor;
    if (!monitor?.enabled) return;

    const snapshot = getMemorySnapshot();
    if (!snapshot.available) return;

    const { usedMB, percentage } = snapshot;
    const mbThreshold = monitor.threshold || defaultPerformanceSettings.memoryMonitor.threshold;
    const percentThreshold = monitor.percentThreshold || defaultPerformanceSettings.memoryMonitor.percentThreshold;

    debugLog(`📊 WhatsApp Web Improver: memory ${usedMB} MB (${percentage}% of limit) — thresholds ${mbThreshold} MB / ${percentThreshold}%`);

    // usedMB is the everyday trigger. The percentage is measured against a
    // fixed heap ceiling (~3.5 GB), so it only fires when the tab is genuinely
    // close to running out of heap.
    const overMb = usedMB > mbThreshold;
    const overPercent = percentage > percentThreshold;
    if (!overMb && !overPercent) return;

    const reason = overPercent
      ? `WhatsApp Web is using ${usedMB} MB (${percentage}% of the browser heap limit).`
      : `WhatsApp Web is using ${usedMB} MB, over your ${mbThreshold} MB limit.`;

    requestReload(`${reason} Reloading to free memory.`, {
      auto: monitor.autoReload !== false
    });
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
      debugLog('🕐 WhatsApp Web Improver: Scheduled reload time reached!');
      requestReload('Scheduled daily reload to keep things fast.', { auto: true });
    }
  }

  // Uptime-based reload. Independent of performance.memory, which cannot see
  // the DOM/media growth that actually slows a long WhatsApp Web session down.
  function checkUptimeReload() {
    const uptime = performanceSettings.uptimeReload;
    if (!uptime?.enabled) return;

    const hours = Number(uptime.hours) || defaultPerformanceSettings.uptimeReload.hours;
    const elapsedHours = (Date.now() - pageLoadedAt) / (60 * 60 * 1000);
    if (elapsedHours < hours) return;

    requestReload(
      `WhatsApp Web has been open for ${Math.floor(elapsedHours)} h. Reloading to keep it fast.`,
      { auto: true }
    );
  }

  let performanceMonitoringStarted = false;

  // Start performance monitoring
  function startPerformanceMonitoring() {
    // loadSettings() can run more than once; the timers must not stack up.
    if (performanceMonitoringStarted) return;
    performanceMonitoringStarted = true;

    // Heartbeat + memory snapshot (low frequency to keep overhead minimal)
    startHeartbeat();

    // Memory is checked every minute so a spike is caught while it matters;
    // the reload guards keep that from turning into a reload loop.
    setInterval(checkMemoryUsage, 60 * 1000);

    // Check scheduled + uptime reload every minute
    setInterval(() => {
      checkScheduledReload();
      checkUptimeReload();
    }, 60 * 1000);

    // Initial check after 1 minute
    setTimeout(() => {
      checkMemoryUsage();
      checkScheduledReload();
      checkUptimeReload();
    }, 60 * 1000);

    debugLog('WhatsApp Web Improver: Performance monitoring started');
  }

  // ===== MESSAGE NAVIGATION =====
  
  // Inject styles for message selection
  function injectNavigationStyles() {
    if (document.getElementById('wa-improver-nav-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'wa-improver-nav-styles';
    styles.textContent = `
      .wa-improver-selected-message {
        outline: 2px solid rgba(37, 211, 102, 0.9) !important;
        outline-offset: 1px;
        border-radius: 8px;
        transition: outline-color 0.12s ease;
      }

      .wa-improver-nav-indicator {
        position: fixed;
        bottom: 76px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(20, 26, 24, 0.94);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(37, 211, 102, 0.35);
        color: #e9f3ee;
        padding: 5px 12px;
        border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11.5px;
        line-height: 1.4;
        white-space: nowrap;
        z-index: 999998;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: none;
        opacity: 0.95;
      }

      .wa-improver-nav-indicator.error {
        border-color: rgba(240, 110, 110, 0.7);
        color: #ffd9d9;
      }

      .wa-improver-nav-indicator .nav-position {
        font-weight: 600;
        color: #6ee7a0;
      }

      .wa-improver-nav-indicator .nav-hint {
        color: #9db3a8;
      }

      .wa-improver-nav-indicator kbd {
        background: rgba(255, 255, 255, 0.12);
        padding: 1px 5px;
        border-radius: 4px;
        font-family: inherit;
        font-size: 10.5px;
        border: 1px solid rgba(255, 255, 255, 0.16);
      }
    `;
    document.head.appendChild(styles);
  }

  function injectSlashCommandStyles() {
    if (document.getElementById('wa-improver-slash-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'wa-improver-slash-styles';
    styles.textContent = `
      #${SLASH_MENU_ID} {
        position: fixed;
        z-index: 999999;
        width: min(420px, calc(100vw - 24px));
        background: rgba(17, 27, 23, 0.98);
        backdrop-filter: blur(10px);
        color: #e9f3ee;
        border: 1px solid rgba(37, 211, 102, 0.28);
        border-radius: 10px;
        padding: 4px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }

      #${SLASH_MENU_ID} .wa-slash-header {
        padding: 5px 9px 6px;
        font-size: 10.5px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: #7f968b;
      }

      #${SLASH_MENU_ID} .wa-slash-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 9px;
        border-radius: 7px;
        cursor: pointer;
      }

      #${SLASH_MENU_ID} .wa-slash-item[aria-selected="true"] {
        background: rgba(37, 211, 102, 0.16);
      }

      #${SLASH_MENU_ID} .wa-slash-icon {
        flex: 0 0 30px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 5px;
        font-size: 10px;
        font-weight: 700;
        color: #9fe8bd;
      }

      #${SLASH_MENU_ID} .wa-slash-name {
        font-weight: 600;
        color: #f0f7f3;
      }

      #${SLASH_MENU_ID} .wa-slash-item[aria-selected="true"] .wa-slash-name {
        color: #6ee7a0;
      }

      #${SLASH_MENU_ID} .wa-slash-desc {
        color: #93a89e;
        font-size: 12px;
      }

      #${SLASH_MENU_ID} .wa-slash-arg {
        color: #7f968b;
        font-size: 12px;
        font-style: italic;
      }

      #${SLASH_MENU_ID} .wa-slash-footer {
        display: flex;
        gap: 10px;
        padding: 6px 9px 4px;
        margin-top: 2px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
        color: #7f968b;
        font-size: 11px;
      }

      #${SLASH_MENU_ID} kbd {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 4px;
        padding: 0 4px;
        font-family: inherit;
        font-size: 10.5px;
      }

      #${SLASH_MENU_ID}.ready .wa-slash-item[aria-selected="true"] {
        background: rgba(37, 211, 102, 0.24);
      }
    `;
    document.head.appendChild(styles);
  }

  function getComposerFromTarget(target) {
    return composerController?.getComposerFromTarget(target) || null;
  }

  function getActiveComposer() {
    return composerController?.getActiveComposer() || null;
  }

  function isSendButtonTarget(target) {
    return composerController?.isSendButtonTarget(target) || false;
  }

  function captureChatContext() {
    const main = document.querySelector('#main');
    const header = main?.querySelector('header');
    const title = header?.querySelector('[data-testid="conversation-info-header-chat-title"], [title], [dir="auto"]');
    return {
      main,
      composer: getActiveComposer(),
      header,
      title: title?.getAttribute('title') || title?.textContent || ''
    };
  }

  function isChatContextCurrent(context) {
    if (!context) return false;
    const current = captureChatContext();
    return context.main === current.main && context.composer === current.composer
      && context.header === current.header && context.title === current.title;
  }

  function cancelSlashOperation() {
    activeSlashOperation?.cancel();
    activeSlashOperation = null;
  }

  function isConsumedSlashText(text, originalText, command) {
    const normalized = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    // React may briefly restore just the command prefix, including a lone '/'.
    return normalized.startsWith('/') && (originalText.startsWith(normalized)
      || `/${command}`.startsWith(normalized));
  }

  function handleSlashCommandInvocation(composer, event) {
    if (!composer) return false;
    const originalText = getComposerText(composer);
    const draft = parseSlashCommandDraft(originalText);
    if (!draft.isCommand) return false;

    event?.preventDefault();
    event?.stopPropagation();
    event?.stopImmediatePropagation?.();

    if (draft.command === 'gif' && !draft.query) {
      updateSlashMenu(composer);
      return true;
    }

    cancelSlashOperation();
    const context = captureChatContext();
    const operation = window.WAImproverUiOperation.createUiOperation(() =>
      activeSlashOperation === operation && composer.isConnected && isChatContextCurrent(context));
    operation.composer = composer;
    operation.originalText = originalText;
    operation.command = draft.command;
    activeSlashOperation = operation;
    hideSlashMenu();

    const clearRestoredCommand = () => {
      if (!operation.isCurrent()) return;
      const text = getComposerText(composer);
      if (text && !isConsumedSlashText(text, originalText, draft.command)) {
        cancelSlashOperation();
        return;
      }
      if (text) clearComposerText(composer, {
        preserveFocus: true,
        scheduleMutation: (callback) => operation.schedule(callback, 30),
        shouldClear: () => operation.isCurrent()
          && isConsumedSlashText(getComposerText(composer), originalText, draft.command)
      });
    };
    clearRestoredCommand();
    const cleanupUntil = Date.now() + 2500;
    const cleanup = () => {
      clearRestoredCommand();
      if (Date.now() < cleanupUntil) operation.schedule(cleanup, 80);
    };
    operation.schedule(cleanup, 80);
    operation.schedule(() => {
      if (draft.command === 'gif') openNativeGifPanelWithQuery(draft.query, operation);
      else openNativeStickerPanel(operation, draft.query);
    }, 80);
    operation.schedule(() => {
      if (activeSlashOperation === operation) cancelSlashOperation();
    }, 6000);
    return true;
  }

  function clickVisibleElement(element) {
    return clickElementReliably(element);
  }

  function findPickerTab(kind) {
    const explicitTab = document.querySelector(`[role="tab"][data-testid="expressions-btn-${kind}"]`);
    if (explicitTab && isElementVisible(explicitTab)) return explicitTab;
    const labelPattern = kind === 'gif' ? /^gifs?(?: selector)?$/i : /^(?:stickers?|pegatinas)(?: selector)?$/i;
    const candidates = Array.from(document.querySelectorAll('[role="tab"], [role="button"], button'));
    return candidates.find((node) => {
      if (!isElementVisible(node)) return false;
      const labels = [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent];
      return labels.some((label) => labelPattern.test((label || '').trim()));
    }) || null;
  }

  function findGifTabButton() {
    return findPickerTab('gif');
  }

  function findStickerTabButton() {
    return findPickerTab('sticker');
  }

  async function openPickerPanel(operation, findTab) {
    if (!operation.isCurrent()) return false;
    const footer = operation.composer.closest('footer');
    if (!footer) return false;

    let tab = findTab();
    if (!tab) {
      const emojiCandidates = [
        footer.querySelector('[aria-label*="emoji" i]'),
        footer.querySelector('[data-testid*="emoji"]'),
        footer.querySelector('span[data-icon="smiley"]')?.closest('[role="button"], button')
      ].filter(Boolean);
      for (const candidate of emojiCandidates) {
        if (clickVisibleElement(candidate.closest('[role="button"], button') || candidate)) break;
      }
      tab = await operation.waitFor(findTab, 20, 100);
    }
    if (!tab || !operation.isCurrent()) return false;
    if (tab.getAttribute('aria-selected') !== 'true') clickVisibleElement(tab);
    return true;
  }

  function findNativeGifSearchField() {
    const strictSelectors = [
      'input[name*="GIPHY" i]',
      'input[aria-label*="GIPHY" i]',
      'input[placeholder*="GIPHY" i]',
      'input[aria-label*="GIF" i]',
      'input[placeholder*="GIF" i]',
      '[data-testid*="gif-search"] input'
    ];

    for (const selector of strictSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter((node) => isElementVisible(node));
      if (nodes.length > 0) return nodes[0];
    }

    return null;
  }

  function setSearchFieldText(field, text) {
    if (!field) return false;

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.click();
      field.focus();
      field.select?.();

      // Use native setter so controlled inputs (React-like) pick it up.
      const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (valueSetter) {
        valueSetter.call(field, text);
      } else {
        field.value = text;
      }

      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
      field.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return true;
    }

    field.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(field);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }

  function focusGifSearchField(field) {
    if (!field) return false;

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.focus();
      const valueLength = (field.value || '').length;
      field.setSelectionRange?.(valueLength, valueLength);
      return document.activeElement === field;
    }

    field.focus();
    const selection = window.getSelection();
    if (!selection) return document.activeElement === field;

    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.activeElement === field;
  }


  function findNativeStickerSearchField() {
    const selectors = [
      'input[placeholder*="sticker" i]',
      'input[aria-label*="sticker" i]',
      'input[placeholder*="pegatina" i]',
      'input[aria-label*="pegatina" i]',
      '[data-testid*="sticker-search"] input',
      '[contenteditable="true"][role="textbox"][aria-label*="sticker" i]',
      '[contenteditable="true"][role="textbox"][aria-label*="pegatina" i]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
      if (nodes.length > 0) return nodes[0];
    }

    return null;
  }

  async function openNativeGifPanelWithQuery(query, operation) {
    try {
      if (!await openPickerPanel(operation, findGifTabButton)) return;
      const field = await operation.waitFor(findNativeGifSearchField, 25, 120);
      if (!field || !operation.isCurrent()) return;
      setSearchFieldText(field, query);
      focusGifSearchField(field);
      // No later unconditional clearing or refocusing: the user now owns the UI.
    } catch (error) {
      debugLog('WhatsApp Web Improver: GIF panel failed', error);
      if (activeSlashOperation === operation) cancelSlashOperation();
    }
  }

  async function openNativeStickerPanel(operation, query = '') {
    try {
      if (!await openPickerPanel(operation, findStickerTabButton)) return;
      const field = await operation.waitFor(findNativeStickerSearchField, 25, 120);
      if (!field || !operation.isCurrent()) return;
      if (query) setSearchFieldText(field, query);
      focusGifSearchField(field);
    } catch (error) {
      debugLog('WhatsApp Web Improver: Sticker panel failed', error);
      if (activeSlashOperation === operation) cancelSlashOperation();
    }
  }

  // ---- Slash command parsing -------------------------------------------------

  // Splits the composer text into "the command word" and "everything after it".
  // Returns a match only while the text is still a single word, so a typed
  // query never re-opens the command list.
  function parseSlashInput(text) {
    // Only the leading whitespace is stripped: a trailing space is meaningful,
    // it marks the command word as finished.
    const normalized = (text || '').replace(/ /g, ' ').replace(/^\s+/, '');
    if (!normalized.startsWith('/')) return null;

    const firstSpace = normalized.search(/\s/);
    const word = firstSpace === -1 ? normalized : normalized.slice(0, firstSpace);
    const rest = firstSpace === -1 ? '' : normalized.slice(firstSpace).trim();

    return {
      word,
      lowerWord: word.toLowerCase(),
      query: rest,
      hasSpace: firstSpace !== -1
    };
  }

  function findSlashCommand(lowerWord) {
    return SLASH_COMMAND_DEFINITIONS.find((definition) => definition.slash === lowerWord) || null;
  }

  function getSlashMatches(lowerWord) {
    return SLASH_COMMAND_DEFINITIONS.filter((definition) => definition.slash.startsWith(lowerWord));
  }

  function getComposerText(composer) {
    return composerController?.getComposerText(composer) || '';
  }

  // The trailing space is what separates "/gif" (still picking a command) from
  // "/gif " (command picked, now typing its argument), and getComposerText
  // trims it away. Contenteditable tends to append a newline, so drop only
  // that.
  function getComposerRawText(composer) {
    if (!composer) return '';
    return (composer.innerText || composer.textContent || '')
      .replace(/ /g, ' ')
      .replace(/[\r\n]+$/, '')
      .replace(/^\s+/, '');
  }

  function parseSlashCommandDraft(text) {
    const parsed = parseSlashInput(text);
    if (!parsed) return { isCommand: false, command: null, query: '' };

    const definition = findSlashCommand(parsed.lowerWord);
    if (!definition) return { isCommand: false, command: null, query: '' };

    return {
      isCommand: true,
      command: definition.command,
      definition,
      query: parsed.query
    };
  }


  // ---- Slash command menu ----------------------------------------------------

  function isSlashMenuOpen() {
    return Boolean(document.getElementById(SLASH_MENU_ID));
  }

  function hideSlashMenu() {
    document.getElementById(SLASH_MENU_ID)?.remove();
    slashMenuComposer = null;
    slashMenuMatches = [];
    slashMenuIndex = 0;
  }

  function positionSlashMenu(menu, composer) {
    if (!menu || !composer) return;
    const rect = composer.getBoundingClientRect();
    const width = menu.offsetWidth || 420;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left));
    // Anchor the bottom of the menu just above the composer so it grows upward
    // as commands are added, the way a command palette should.
    const top = Math.max(12, rect.top - menu.offsetHeight - 10);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function getOrCreateSlashMenu() {
    let menu = document.getElementById(SLASH_MENU_ID);
    if (menu) return menu;

    injectSlashCommandStyles();
    menu = document.createElement('div');
    menu.id = SLASH_MENU_ID;
    menu.setAttribute('role', 'listbox');
    document.body.appendChild(menu);
    return menu;
  }

  function selectSlashCommand(definition) {
    const composer = slashMenuComposer || getActiveComposer();
    if (!composer || !definition) return false;

    cancelSlashOperation();
    const context = captureChatContext();
    const originalText = getComposerText(composer);
    const operation = window.WAImproverUiOperation.createUiOperation(() =>
      activeSlashOperation === operation && composer.isConnected && isChatContextCurrent(context));
    Object.assign(operation, { composer, originalText, command: definition.command });
    activeSlashOperation = operation;
    composerController.setComposerText(composer, `${definition.slash} `, {
      scheduleMutation: (callback) => operation.schedule(callback, 30),
      shouldSet: () => operation.isCurrent() && getComposerText(composer) === originalText,
      onComplete: () => operation.schedule(() => {
        updateSlashMenu(composer);
        if (activeSlashOperation === operation) cancelSlashOperation();
      }, 0)
    });
    return true;
  }

  function moveSlashSelection(delta) {
    if (slashMenuMatches.length === 0) return;
    slashMenuIndex = (slashMenuIndex + delta + slashMenuMatches.length) % slashMenuMatches.length;
    renderSlashMenu();
  }

  function getSelectedSlashCommand() {
    return slashMenuMatches[slashMenuIndex] || null;
  }

  function renderSlashMenu() {
    const menu = getOrCreateSlashMenu();
    const composer = slashMenuComposer;
    if (!composer) return;

    const parsed = parseSlashInput(getComposerRawText(composer));
    const exact = parsed ? findSlashCommand(parsed.lowerWord) : null;
    const ready = Boolean(exact && parsed.hasSpace);

    menu.classList.toggle('ready', ready);

    if (ready) {
      // Command is chosen; the menu becomes a hint for its argument.
      const canRun = !exact.argRequired || parsed.query.length > 0;
      menu.innerHTML = `
        <div class="wa-slash-item" aria-selected="true">
          <span class="wa-slash-icon"></span>
          <span>
            <span class="wa-slash-name"></span>
            <span class="wa-slash-arg"></span>
          </span>
        </div>
        <div class="wa-slash-footer"></div>
      `;
      menu.querySelector('.wa-slash-icon').textContent = exact.icon;
      menu.querySelector('.wa-slash-name').textContent = exact.slash;
      menu.querySelector('.wa-slash-arg').textContent = parsed.query
        ? ` ${parsed.query}`
        : ` ${exact.argHint}`;
      menu.querySelector('.wa-slash-footer').innerHTML = canRun
        ? '<span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> cancel</span>'
        : `<span>Type the ${exact.argHint}</span><span><kbd>Esc</kbd> cancel</span>`;

      positionSlashMenu(menu, composer);
      return;
    }

    if (slashMenuMatches.length === 0) {
      hideSlashMenu();
      return;
    }

    menu.innerHTML = '<div class="wa-slash-header">Commands</div>';

    slashMenuMatches.forEach((definition, index) => {
      const item = document.createElement('div');
      item.className = 'wa-slash-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === slashMenuIndex));

      const icon = document.createElement('span');
      icon.className = 'wa-slash-icon';
      icon.textContent = definition.icon;

      const text = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'wa-slash-name';
      name.textContent = definition.slash;
      const desc = document.createElement('span');
      desc.className = 'wa-slash-desc';
      desc.textContent = ` — ${definition.description}`;
      text.appendChild(name);
      text.appendChild(desc);

      item.appendChild(icon);
      item.appendChild(text);

      item.addEventListener('mouseenter', () => {
        slashMenuIndex = index;
        renderSlashMenu();
      });
      item.addEventListener('mousedown', (event) => {
        // mousedown, not click: clicking would blur the composer first.
        event.preventDefault();
        event.stopPropagation();
        selectSlashCommand(definition);
      });

      menu.appendChild(item);
    });

    const footer = document.createElement('div');
    footer.className = 'wa-slash-footer';
    footer.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Tab</kbd>/<kbd>Enter</kbd> pick</span><span><kbd>Esc</kbd> close</span>';
    menu.appendChild(footer);

    positionSlashMenu(menu, composer);
  }

  // Single entry point: reads the composer and puts the menu into the right
  // state, or closes it when the text is no longer a command.
  function updateSlashMenu(composer) {
    if (!composer) {
      hideSlashMenu();
      return;
    }

    const parsed = parseSlashInput(getComposerRawText(composer));
    if (!parsed) {
      hideSlashMenu();
      return;
    }

    const exact = findSlashCommand(parsed.lowerWord);

    // A space after an unknown word means the user is writing prose, not a
    // command ("/hello there"), so get out of the way.
    if (parsed.hasSpace && !exact) {
      hideSlashMenu();
      return;
    }

    const matches = exact && parsed.hasSpace ? [exact] : getSlashMatches(parsed.lowerWord);
    if (matches.length === 0) {
      hideSlashMenu();
      return;
    }

    const previous = getSelectedSlashCommand();
    slashMenuComposer = composer;
    slashMenuMatches = matches;
    // Keep the highlight on the same command while the list narrows.
    const preservedIndex = previous ? matches.indexOf(previous) : -1;
    slashMenuIndex = preservedIndex >= 0 ? preservedIndex : 0;

    renderSlashMenu();
  }

  function clearComposerText(composer, options = {}) {
    composerController?.clearComposerText(composer, options);
  }

  // Get all visible message elements, document order (oldest first).
  function getMessageElements() {
    const panel = document.querySelector(
      '[data-testid="conversation-panel-messages"], #main [data-tab="8"], #main [role="application"]'
    ) || document.querySelector('#main');

    if (!panel) return [];

    // WhatsApp renders one [role="row"] per message and virtualises the list,
    // so this must be re-read on every move rather than cached.
    let rows = Array.from(panel.querySelectorAll('[role="row"]'));

    if (rows.length === 0) {
      rows = Array.from(panel.querySelectorAll('div[class*="message-in"], div[class*="message-out"]'));
    }

    // Two passes. The strict one drops system rows the context menu cannot act
    // on; the permissive one is the safety net, because WhatsApp obfuscates its
    // class names and a heuristic that stops matching must not leave the user
    // with nothing selectable.
    const candidates = rows.filter(isSelectableRow);
    const actionable = candidates.filter((row) => !isSystemRow(row));

    return actionable.length > 0 ? actionable : candidates;
  }

  function isSelectableRow(row) {
    if (!row || !row.isConnected) return false;
    if (!row.querySelector('[data-pre-plain-text], [class*="copyable-text"], span[dir]')) return false;
    return isElementVisible(row);
  }

  // Call logs, encryption notices, date separators and the unread divider look
  // like messages but have no editable/replyable body, so acting on them just
  // makes WhatsApp reject the action.
  function isSystemRow(row) {
    // Real messages carry a message id; dividers and notices do not.
    const hasMessageId = row.hasAttribute?.('data-id') || row.querySelector('[data-id]');
    if (!hasMessageId) return true;

    // Call logs: a call icon and no text body of their own.
    if (row.querySelector('[data-icon*="call"], [data-icon*="video"]') &&
        !row.querySelector('[data-pre-plain-text]')) {
      return true;
    }

    return false;
  }

  // Diagnostic helper. WhatsApp obfuscates its markup and changes it often, so
  // rather than guessing selectors, run window.__waImproverInspect() in the
  // console on WhatsApp Web to see what each stage of the heuristic matches.
  window.__waImproverInspect = function inspectMessageRows() {
    const panel = document.querySelector(
      '[data-testid="conversation-panel-messages"], #main [data-tab="8"], #main [role="application"]'
    ) || document.querySelector('#main');

    const rows = panel ? Array.from(panel.querySelectorAll('[role="row"]')) : [];
    const fallbackRows = panel
      ? Array.from(panel.querySelectorAll('div[class*="message-in"], div[class*="message-out"]'))
      : [];
    const selectable = rows.filter(isSelectableRow);
    const actionable = selectable.filter((row) => !isSystemRow(row));

    const sample = selectable.slice(-3).map((row) => ({
      text: (row.textContent || '').trim().slice(0, 40),
      hasDataId: Boolean(row.hasAttribute('data-id') || row.querySelector('[data-id]')),
      hasPrePlainText: Boolean(row.querySelector('[data-pre-plain-text]')),
      hasBubbleClass: Boolean(row.querySelector('div[class*="message-in"], div[class*="message-out"]')),
      treatedAsSystem: isSystemRow(row)
    }));

    const report = {
      panelFound: Boolean(panel),
      roleRows: rows.length,
      bubbleClassRows: fallbackRows.length,
      selectable: selectable.length,
      actionable: actionable.length,
      usingFallback: actionable.length === 0 && selectable.length > 0,
      sampleOfLast3: sample
    };

    console.log(report);
    return report;
  };

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

    // Deliberately terse: this floats over the chat the whole time navigation
    // is on, so it lists the position and the keys, nothing else.
    indicator.innerHTML = `
      <span class="nav-position">${current}/${total}</span>
      <span class="nav-hint"><kbd>\u2191</kbd><kbd>\u2193</kbd> move \u00b7 <kbd>${shortcuts.edit?.key || 'e'}</kbd><kbd>${shortcuts.reply?.key || 'r'}</kbd><kbd>${shortcuts.delete?.key || 'd'}</kbd> actions \u00b7 <kbd>Esc</kbd> exit</span>
    `;
  }

  // Hide navigation indicator
  function hideNavigationIndicator() {
    const indicator = document.getElementById('wa-improver-nav-indicator');
    if (indicator) indicator.remove();
  }

  // A failed attempt can leave WhatsApp's context menu hanging open over the
  // chat; Escape is what WhatsApp itself listens for to dismiss it.
  function closeStrayContextMenu(menu) {
    if (!menu?.isConnected || menu !== findContextMenu()) return;
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true
    });
    extensionKeyboardEvents.add(event);
    document.body.dispatchEvent(event);
    contextMenuOpen = false;
    currentContextMenu = null;
  }

  const ACTION_LABELS = {
    edit: 'Edit',
    delete: 'Delete',
    reply: 'Reply',
    forward: 'Forward',
    star: 'Star',
    info: 'Info',
    copy: 'Copy',
    pin: 'Pin'
  };

  let navigationErrorTimer = null;

  function showNavigationError(action) {
    const indicator = document.getElementById('wa-improver-nav-indicator');
    if (!indicator) return;

    indicator.classList.add('error');
    const label = ACTION_LABELS[action] || action;
    const slot = indicator.querySelector('.nav-position');
    if (slot) slot.textContent = `${label} unavailable`;

    if (navigationErrorTimer) clearTimeout(navigationErrorTimer);
    navigationErrorTimer = setTimeout(() => {
      indicator.classList.remove('error');
      updateNavigationIndicator();
    }, 1800);
  }

  function clearMessageHighlight() {
    document.querySelectorAll('.wa-improver-selected-message').forEach((el) => {
      el.classList.remove('wa-improver-selected-message');
    });
  }

  // Highlight selected message
  function highlightMessage(index, options = {}) {
    const { scroll = true } = options;
    clearMessageHighlight();

    if (index < 0 || index >= messageElements.length) return;

    const msg = messageElements[index];
    selectedMessageElement = msg;
    selectedMessageIdentity = getMessageIdentity(msg);
    msg.classList.add('wa-improver-selected-message');

    if (scroll) {
      // 'auto' rather than 'smooth': a queued smooth scroll fights the next
      // keypress when the user holds the arrow down.
      msg.scrollIntoView({ behavior: 'auto', block: 'center' });
    }

    updateNavigationIndicator();
    debugLog(`\u{1F4CD} WhatsApp Web Improver: Selected message ${index + 1}/${messageElements.length}`);
  }

  // Re-read the list and locate the previously selected message in it. The
  // virtualised list swaps nodes as it scrolls, so the old index is unreliable.
  function getMessageIdentity(row) {
    if (!row) return null;
    const id = row.getAttribute('data-id') || row.querySelector('[data-id]')?.getAttribute('data-id');
    if (id) return id;
    const body = row.querySelector('[data-pre-plain-text]');
    return `${body?.getAttribute('data-pre-plain-text') || ''}:${row.textContent}`;
  }

  function refreshMessageElements() {
    if (!isChatContextCurrent(navigationChatContext)) return false;
    messageElements = getMessageElements();
    // Never silently transfer a selection to whichever message now occupies
    // the old index after a chat switch, removal or virtualised-list update.
    const foundIndex = messageElements.findIndex((row) => getMessageIdentity(row) === selectedMessageIdentity);
    if (foundIndex < 0) return false;
    selectedMessageIndex = foundIndex;
    selectedMessageElement = messageElements[foundIndex];
    return true;
  }

  function moveSelection(delta) {
    if (!refreshMessageElements()) {
      exitNavigationMode();
      return;
    }

    const nextIndex = selectedMessageIndex + delta;

    // Past the newest message: drop back to the composer, which is what the
    // user is reaching for anyway.
    if (nextIndex >= messageElements.length) {
      exitNavigationMode({ focusComposer: true });
      return;
    }

    if (nextIndex < 0) {
      // Oldest rendered message: WhatsApp loads more as we scroll, so nudge the
      // list up and try to keep going instead of dead-ending.
      messageElements[0]?.scrollIntoView({ behavior: 'auto', block: 'center' });
      return;
    }

    selectedMessageIndex = nextIndex;
    highlightMessage(selectedMessageIndex);
  }

  // Enter message navigation mode
  function enterNavigationMode() {
    messageElements = getMessageElements();

    if (messageElements.length === 0) {
      debugLog('\u274C WhatsApp Web Improver: No messages found');
      return false;
    }

    messageNavigationMode = true;
    cancelSlashOperation();
    navigationChatContext = captureChatContext();
    selectedMessageIndex = messageElements.length - 1; // Start from last message
    selectedMessageElement = messageElements[selectedMessageIndex];
    selectedMessageIdentity = getMessageIdentity(selectedMessageElement);

    // WhatsApp keeps focus in the composer and re-focuses the last message on
    // its own; blurring hands the arrows over to us cleanly.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    injectNavigationStyles();
    showNavigationIndicator();
    highlightMessage(selectedMessageIndex);

    debugLog(`\u{1F3AF} WhatsApp Web Improver: Navigation mode ON (${messageElements.length} messages)`);
    return true;
  }

  // Exit message navigation mode
  function exitNavigationMode(options = {}) {
    const { focusComposer = false } = options;

    messageNavigationMode = false;
    cancelMessageAction();
    selectedMessageIndex = -1;
    selectedMessageElement = null;
    selectedMessageIdentity = null;
    navigationChatContext = null;
    messageElements = [];

    clearMessageHighlight();
    hideNavigationIndicator();

    // Entering navigation blurs the composer, so hand the focus back when the
    // user is leaving in order to type rather than clicking elsewhere.
    if (focusComposer) {
      getActiveComposer()?.focus();
    }

    debugLog('🎯 WhatsApp Web Improver: Navigation mode OFF');
  }

  function cancelMessageAction() {
    const operation = activeMessageAction;
    activeMessageAction = null;
    navigationActionInProgress = false;
    operation?.cancel();
    if (operation?.menu) closeStrayContextMenu(operation.menu);
  }

  // Retry only while locating UI. Once a click is dispatched, never repeat it.
  function triggerActionOnSelectedMessage(action) {
    if (navigationActionInProgress) return false;
    if (!refreshMessageElements()) {
      exitNavigationMode();
      return false;
    }
    if (findContextMenu()) {
      showNavigationError(action);
      return false;
    }

    const msg = selectedMessageElement;
    const identity = selectedMessageIdentity;
    const context = navigationChatContext;
    const operation = window.WAImproverUiOperation.createUiOperation(() =>
      activeMessageAction === operation && messageNavigationMode
      && isChatContextCurrent(context) && msg.isConnected
      && getMessageIdentity(msg) === identity);
    activeMessageAction = operation;
    navigationActionInProgress = true;

    const run = async () => {
      try {
        if (!domAdapter.openContextMenuForMessageElement(msg)) return;
        const menu = await operation.waitFor(findContextMenu, 15, 110);
        if (!menu || !operation.isCurrent()) return;
        operation.menu = menu;
        const item = await operation.waitFor(() =>
          menu.isConnected && isElementVisible(menu)
            && messageActionResolver.findMenuActionCandidate(action, menu), 8, 120);
        if (!item || !operation.isCurrent()) return;
        if (!clickElementReliably(item)) return;
        const closed = await operation.waitFor(() =>
          !menu.isConnected || !isElementVisible(menu), 12, 100);
        if (closed && operation.isCurrent()) {
          exitNavigationMode({ focusComposer: action === 'reply' });
          return;
        }
      } catch (error) {
        debugLog('WhatsApp Web Improver: Message action failed', error);
      } finally {
        if (activeMessageAction === operation) {
          const stillCurrent = operation.isCurrent();
          cancelMessageAction();
          if (stillCurrent) showNavigationError(action);
          else exitNavigationMode();
        }
      }
    };
    run();
    return true;
  }
  

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  initializeWhatsAppAdapters();

  function findContextMenu() {
    return domAdapter?.findContextMenu() || null;
  }

  function ensureContextMenuOpen() {
    const result = domAdapter?.ensureContextMenuOpen(currentContextMenu) || { open: false, menu: null };
    contextMenuOpen = result.open;
    currentContextMenu = result.menu;
    return result.open;
  }


  // Detect when context menu opens
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Check if this is a context menu (span with role="application" containing menu items)
          let menu = null;
          
          if (node.getAttribute && domAdapter?.hasMenuContainerRole(node) && domAdapter?.isContextMenu(node)) {
            menu = node;
          } else if (node.querySelector) {
            const candidate = node.querySelector('[role="menu"], [data-animate-dropdown], [role="dialog"] ul');
            if (candidate && domAdapter?.isContextMenu(candidate)) {
              menu = candidate;
            }
          }
          
          // Additional check: look for menu structure
          if (!menu && domAdapter?.isContextMenu(node)) {
            menu = node;
          }
          
          if (menu) {
            contextMenuOpen = true;
            currentContextMenu = menu;
            debugLog('WhatsApp Web Improver: ✓ Context menu detected!');
            debugLog('Menu element:', menu);
            
            // Log available menu items for debugging
            const items = menu.querySelectorAll('[role="button"], li, div[tabindex]');
            debugLog(`Found ${items.length} menu items:`, Array.from(items).map(i => i.textContent.trim()));
          }
        }
      });

      mutation.removedNodes.forEach((node) => {
        if (node === currentContextMenu || (node.nodeType === 1 && node.contains(currentContextMenu))) {
          contextMenuOpen = false;
          currentContextMenu = null;
          debugLog('WhatsApp Web Improver: Context menu closed');
        }
      });
    });
  });

  function clickElementReliably(element) {
    // The element can be detached or hidden by the time we get here: WhatsApp
    // re-renders menus constantly. Reporting success in that case is what made
    // the retry loops give up on the first attempt.
    if (!element || !element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (!isElementVisible(element)) return false;

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
    // Exactly one click. A second click can undo Star/Pin or activate a
    // confirmation while React is still replacing the original menu.
    if (!element.isConnected || !isElementVisible(element)) return false;
    element.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
    return true;
  }

  // Find and click a menu item by action
  function clickMenuItemByAction(action, menuOverride = null) {
    if (!messageActionResolver) return false;

    const result = messageActionResolver.clickMenuItemByAction(action, {
      currentContextMenu,
      menuOverride
    });

    if (result.menu) {
      currentContextMenu = result.menu;
      contextMenuOpen = true;
    }

    return result.clicked;
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

  // Plain ArrowUp selects messages even while a draft is being written.
  // Alt+ArrowUp remains available elsewhere in the chat.
  function shouldEnterNavigationModeOnArrowUp(event) {
    if (!messageNavigationEnabled) return false;
    if (messageNavigationMode) return false;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (contextMenuOpen) return false;
    if (isSlashMenuOpen()) return false;

    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (!target) return false;

    // Modifier path: no restriction on where the focus is.
    if (event.altKey) return true;

    const composer = getComposerFromTarget(target);
    if (composer) {
      return true;
    }

    if (isTypingTarget(target)) return false;

    return isChatAreaTarget(target);
  }

  // Bound on window rather than document: capture runs window -> document, so
  // this is the earliest point we can intercept a key before WhatsApp's own
  // handlers see it (notably its native ArrowUp "edit last message").
  window.addEventListener('keydown', (e) => {
    if (extensionKeyboardEvents.has(e) || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') cancelSlashOperation();
    const pressedKey = e.key;
    const pressedKeyLower = pressedKey.toLowerCase();
    const isTyping = isTypingTarget(e.target);
    const composerTarget = getComposerFromTarget(e.target) || getComposerFromTarget(document.activeElement) || slashMenuComposer;

    // ===== SLASH COMMAND MENU =====
    // Owns the arrows, Tab, Enter and Escape while it is open, so it behaves
    // like a command palette rather than a passive hint.
    if (isSlashMenuOpen() && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const swallowMenuKey = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      if (pressedKey === 'Escape') {
        swallowMenuKey();
        hideSlashMenu();
        return;
      }

      if (pressedKey === 'ArrowDown') {
        swallowMenuKey();
        moveSlashSelection(1);
        return;
      }

      if (pressedKey === 'ArrowUp') {
        swallowMenuKey();
        moveSlashSelection(-1);
        return;
      }

      // Tab always picks the highlighted command. Enter picks it too while the
      // command word is still incomplete; once complete it runs the command.
      const parsed = parseSlashInput(getComposerRawText(composerTarget));
      const commandComplete = Boolean(parsed && findSlashCommand(parsed.lowerWord) && parsed.hasSpace);

      if (pressedKey === 'Tab' || (pressedKey === 'Enter' && !e.shiftKey && !commandComplete)) {
        const selected = getSelectedSlashCommand();
        if (selected) {
          swallowMenuKey();
          selectSlashCommand(selected);
          return;
        }
      }
    }

    if (composerTarget && pressedKey === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (handleSlashCommandInvocation(composerTarget, e)) {
        return;
      }
    }

    // ===== MESSAGE NAVIGATION HANDLING =====
    if (contextMenuOpen && !ensureContextMenuOpen()) {
      contextMenuOpen = false;
      currentContextMenu = null;
    }

    // WhatsApp binds its own arrow handling and steals focus to the last
    // message, so every key we own has to be swallowed before it gets there.
    const swallow = () => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    // Handle navigation mode keys
    if (messageNavigationMode && !isChatContextCurrent(navigationChatContext)) exitNavigationMode();
    if (messageNavigationMode) {
      if (navigationActionInProgress) {
        if (pressedKey === 'Escape') {
          swallow();
          exitNavigationMode({ focusComposer: true });
        } else if (pressedKey === 'ArrowUp' || pressedKey === 'ArrowDown'
          || (!e.ctrlKey && !e.metaKey && !e.altKey && getActionForKey(pressedKeyLower))) {
          swallow();
        } else if (pressedKey.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          exitNavigationMode({ focusComposer: true });
        }
        return;
      }

      // Escape to exit
      if (pressedKey === 'Escape') {
        swallow();
        exitNavigationMode({ focusComposer: true });
        return;
      }

      // Arrow Up - previous message
      if (pressedKey === 'ArrowUp') {
        swallow();
        moveSelection(-1);
        return;
      }

      // Arrow Down - next message
      if (pressedKey === 'ArrowDown') {
        swallow();
        moveSelection(1);
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.repeat) return;

        const action = getActionForKey(pressedKeyLower);
        if (action) {
          debugLog(`🎯 Triggering action: ${action}`);
          swallow();
          triggerActionOnSelectedMessage(action);
          return;
        }
      }

      // Any other key ends navigation so the user can just start typing.
      if (pressedKey.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        exitNavigationMode({ focusComposer: true });
      }
      return;
    }

    if (pressedKey === 'ArrowUp' && shouldEnterNavigationModeOnArrowUp(e)) {
      // Only swallow once we know we actually took over. Swallowing first would
      // eat the key whenever no message could be selected, which looks exactly
      // like the extension being broken.
      //
      // WhatsApp binds ArrowUp in an empty composer to "edit last message";
      // suppressing it here is what stops that native edit from firing too.
      if (enterNavigationMode()) {
        swallow();
        return;
      }
    }

    // ===== CONTEXT MENU HANDLING =====
    
    // Don't trigger context menu shortcuts if user is typing
    if (isTyping) {
      return;
    }

    // Log all keypress when menu is open for debugging
    if (contextMenuOpen) {
      debugLog(`⌨️  WhatsApp Web Improver: Key "${pressedKeyLower}" pressed (menu open: ${contextMenuOpen})`);
    }

    const actionForKey = getActionForKey(pressedKeyLower);
    if (!actionForKey || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

    const menuDetected = ensureContextMenuOpen();

    debugLog(`🎯 WhatsApp Web Improver: Matched shortcut "${pressedKeyLower}" → "${actionForKey}"`);
    
    if (!menuDetected) return;

    if (clickMenuItemByAction(actionForKey, menuDetected ? currentContextMenu : null)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Safety net: some builds may submit from keypress listeners
  document.addEventListener('keypress', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const composerTarget = getComposerFromTarget(e.target) || getComposerFromTarget(document.activeElement);
    if (!composerTarget) return;
    const draft = parseSlashCommandDraft(getComposerText(composerTarget));
    if (!draft.isCommand) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);


  document.addEventListener('mousedown', (e) => {
    if (e.isTrusted && programmaticClearDepth === 0) {
      cancelSlashOperation();
      if (messageNavigationMode) exitNavigationMode();
    }
    if (!isSendButtonTarget(e.target)) return;
    const composer = getActiveComposer();
    handleSlashCommandInvocation(composer, e);
  }, true);

  // Also exit navigation mode when clicking anywhere
  document.addEventListener('click', (event) => {
    const clickedMenu = document.getElementById(SLASH_MENU_ID)?.contains(event.target);
    if (slashMenuComposer && !slashMenuComposer.contains(event.target) && !clickedMenu) {
      hideSlashMenu();
    }

    if (messageNavigationMode && !navigationActionInProgress) {
      exitNavigationMode();
    }
  }, true);

  window.addEventListener('resize', () => {
    const menu = document.getElementById(SLASH_MENU_ID);
    if (menu && slashMenuComposer) {
      positionSlashMenu(menu, slashMenuComposer);
    }
  });

  document.addEventListener('input', (event) => {
    if (suppressComposerInputHandler || programmaticClearDepth > 0) return;

    const composer = getComposerFromTarget(event.target);
    const operation = activeSlashOperation;
    if (operation && composer === operation.composer) {
      if (!event.isTrusted && isConsumedSlashText(getComposerText(composer), operation.originalText, operation.command)) return;
      cancelSlashOperation();
    }
    if (!composer) {
      hideSlashMenu();
      return;
    }

    updateSlashMenu(composer);
  }, true);

  document.addEventListener('beforeinput', (event) => {
    if (event.isTrusted && programmaticClearDepth === 0) cancelSlashOperation();
  }, true);

  // Start observing the document for context menu changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  debugLog('WhatsApp Web Improver: Monitoring for context menus...');

  // ===== HEADER OPTIONS BUTTON =====

  function isHeaderButtonCandidate(button) {
    if (!button) return false;
    if (!isElementVisible(button)) return false;
    if (button.id === 'wa-improver-options-btn') return false;
    return true;
  }

  function getPanelDesiredWidth() {
    return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.35)));
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
      <span class="wa-improver-memory-value" title="JavaScript heap only; excludes DOM, decoded images and videos, and memory in other heaps.">JS heap: --</span>
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
    valueEl.textContent = snapshot.available ? `JS heap: ${snapshot.usedMB} MB` : 'JS heap: N/A';
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
    debugLog('WhatsApp Web Improver: Memory widget injected');
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
      debugLog('WhatsApp Web Improver: Floating options button injected');
      return;
    }

    const newChatBtn = findHeaderAnchorButton();
    const btn = createOptionsButton();

    if (newChatBtn && newChatBtn.parentElement === actionsRow) {
      actionsRow.insertBefore(btn, newChatBtn);
      debugLog('WhatsApp Web Improver: Options button injected next to new message');
      return;
    }

    const menuButton = Array.from(actionsRow.querySelectorAll('[role="button"]')).pop();
    if (menuButton) {
      actionsRow.insertBefore(btn, menuButton);
      debugLog('WhatsApp Web Improver: Options button injected before menu button');
      return;
    }

    actionsRow.appendChild(btn);

    debugLog('WhatsApp Web Improver: Options button injected');
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
        height: '640px',
        maxHeight: '92vh',
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

  // WhatsApp mutates <body> continuously while scrolling or typing. Injecting
  // the widget on every mutation meant re-reading memory hundreds of times a
  // second, which is what made the extension itself feel heavy.
  function scheduleInjectMemoryWidget() {
    if (memoryWidgetDebounceTimer) return;

    memoryWidgetDebounceTimer = setTimeout(() => {
      memoryWidgetDebounceTimer = null;
      injectMemoryWidget();
    }, 500);
  }

  function startOptionsButtonObserver() {
    if (optionsButtonObserver || !document.body) return;

    injectOptionsButton();
    injectMemoryWidget();

    optionsButtonObserver = new MutationObserver(() => {
      // The widget only needs re-injecting when it is actually gone; that check
      // is a cheap id lookup compared to the work injectMemoryWidget does.
      if (!document.getElementById('wa-improver-options-btn')) {
        scheduleInjectOptionsButton();
      }
      if (!document.getElementById('wa-improver-memory-widget')) {
        scheduleInjectMemoryWidget();
      }
    });

    optionsButtonObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Monitor for header injection (WhatsApp loads dynamically)
  startOptionsButtonObserver();
  applyWhatsAppScale(loadStoredUiScale(), false);

  // Safety net for anything the observer missed; the observer handles the
  // common case, so this only needs to re-check, not re-do the work.
  setInterval(() => {
    injectOptionsButton();
    injectMemoryWidget();
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
