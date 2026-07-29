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
  let messageElements = [];
  let navigationModeEnteredAt = 0; // Timestamp to prevent immediate actions
  let navigationActionInProgress = false;
  let optionsButtonObserver = null;
  let optionsButtonDebounceTimer = null;
  let memoryWidgetDebounceTimer = null;
  const PANEL_MIN_WIDTH = 360;
  const PANEL_MAX_WIDTH = 520;
  const UI_SCALE_STORAGE_KEY = 'waImproverUiScale';
  const UI_SCALE_MIN = 85;
  const UI_SCALE_MAX = 130;
  const UI_SCALE_STEP = 5;
  const STICKER_COMMAND_PREFIX = '/sticker';
  const SLASH_COMMAND_DEFINITIONS = [
    { command: 'gif', slash: '/gif', description: 'Search GIFs' },
    { command: 'sticker', slash: '/sticker', description: 'Open stickers' }
  ];
  const GIF_INDICATOR_ID = 'wa-improver-gif-indicator';

  // Status + memory reporting (shared with popup/options)
  const MEMORY_STATUS_KEY = 'waImproverMemoryStatus';
  const LAST_ACTIVE_KEY = 'waImproverLastSeen';
  const MEMORY_REPORT_INTERVAL_MS = 10000;
  let lastMemoryReportAt = 0;
  let currentUiScale = 100;
  let extensionContextInvalid = false;
  let gifIndicatorComposer = null;
  let gifCleanupTimer = null;
  let gifCleanupComposer = null;
  let gifCleanupUntil = 0;
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
    if (document.getElementById('wa-improver-gif-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'wa-improver-gif-styles';
    styles.textContent = `
      #${GIF_INDICATOR_ID} {
        position: fixed;
        z-index: 999999;
        max-width: min(380px, calc(100vw - 24px));
        background: rgba(16, 26, 22, 0.96);
        color: #edf7f2;
        border: 1px solid rgba(37, 211, 102, 0.45);
        border-radius: 999px;
        padding: 7px 12px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.15px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        white-space: nowrap;
      }
      #${GIF_INDICATOR_ID}.ready {
        border-color: rgba(37, 211, 102, 0.8);
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

  function handleSlashCommandInvocation(composer, event) {
    if (!composer) return false;
    const draft = parseSlashCommandDraft(getComposerText(composer));
    if (!draft.isCommand) return false;

    event?.preventDefault();
    event?.stopPropagation();
    event?.stopImmediatePropagation?.();

    if (draft.command === 'gif') {
      if (!draft.query) {
        showGifCommandIndicator(composer, draft);
        return true;
      }

      clearAnyVisibleGifCommandComposer(true);
      clearComposerNowAndStabilize(composer);
      setTimeout(() => openNativeGifPanelWithQuery(draft.query, composer), 80);
      return true;
    }

    if (draft.command === 'sticker') {
      if (composer) {
        clearComposerText(composer, { preserveFocus: true });
      }
      setTimeout(() => openNativeStickerPanel(composer, draft.query), 80);
      return true;
    }

    return false;
  }

  function dispatchKeyboardShortcut(key, options = {}) {
    const target = document.activeElement || document.body;
    const eventInit = {
      key,
      code: `Key${key.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
      ...options
    };

    target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  function clickVisibleElement(element) {
    if (!element || !isElementVisible(element)) return false;
    element.click();
    return true;
  }

  function findGifTabButton() {
    const selectors = [
      '[role="tab"][aria-label*="gif" i]',
      '[aria-label*="gif" i]',
      'button[title*="gif" i]',
      '[data-testid*="gif"]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
      const gifNode = nodes.find((node) => /gif/i.test(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || ''));
      if (gifNode) {
        return gifNode.closest('[role="button"], button, [role="tab"]') || gifNode;
      }
    }

    return null;
  }

  function findStickerTabButton() {
    const gifTab = findGifTabButton();
    if (gifTab) {
      const containers = [
        gifTab.closest('[role="tablist"]'),
        gifTab.parentElement,
        gifTab.closest('footer')?.querySelector('[role="dialog"]')
      ].filter(Boolean);

      for (const container of containers) {
        const tabCandidates = Array.from(
          container.querySelectorAll('[role="tab"], [role="button"], button')
        ).filter(isElementVisible);
        const gifIndex = tabCandidates.indexOf(gifTab);
        if (gifIndex >= 0 && gifIndex < tabCandidates.length - 1) {
          const nextCandidate = tabCandidates[gifIndex + 1];
          if (nextCandidate && isElementVisible(nextCandidate)) {
            return nextCandidate;
          }
        }
      }
    }

    const iconSelectors = [
      'span[data-icon*="sticker"]',
      '[data-testid*="sticker"] span[data-icon]',
      'img[alt*="sticker" i]'
    ];

    for (const selector of iconSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
      for (const node of nodes) {
        const clickable = node.closest('[role="button"], button, [role="tab"]') || node;
        if (clickable && isElementVisible(clickable)) {
          return clickable;
        }
      }
    }

    const selectors = [
      '[role="tab"][aria-label*="sticker" i]',
      '[aria-label*="sticker" i]',
      'button[title*="sticker" i]',
      '[data-testid*="sticker"]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
      const stickerNode = nodes.find((node) => {
        const label = node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '';
        return /sticker/i.test(label) && !/gif/i.test(label);
      });
      if (stickerNode) {
        return stickerNode.closest('[role="button"], button, [role="tab"]') || stickerNode;
      }
    }

    return null;
  }

  function waitForGifTabButton(maxAttempts = 12, delayMs = 100) {
    return new Promise((resolve) => {
      let attempts = maxAttempts;
      const tick = () => {
        const tab = findGifTabButton();
        if (tab) {
          resolve(tab);
          return;
        }
        attempts -= 1;
        if (attempts <= 0) {
          resolve(null);
          return;
        }
        setTimeout(tick, delayMs);
      };
      tick();
    });
  }

  function openGifPanelByClickFallback() {
    const footer = document.querySelector('footer');
    if (!footer) return false;

    const emojiCandidates = [
      footer.querySelector('[aria-label*="emoji" i]'),
      footer.querySelector('[data-testid*="emoji"]'),
      footer.querySelector('span[data-icon="smiley"]')?.closest('[role="button"], button')
    ].filter(Boolean);

    for (const candidate of emojiCandidates) {
      if (clickVisibleElement(candidate.closest('[role="button"], button') || candidate)) {
        break;
      }
    }
    
    waitForGifTabButton(14, 90).then((tab) => {
      if (!tab) return;
      clickVisibleElement(tab);
    });

    return true;
  }

  function openStickerPanelByClickFallback() {
    const footer = document.querySelector('footer');
    if (!footer) return false;

    const emojiCandidates = [
      footer.querySelector('[aria-label*="emoji" i]'),
      footer.querySelector('[data-testid*="emoji"]'),
      footer.querySelector('span[data-icon="smiley"]')?.closest('[role="button"], button')
    ].filter(Boolean);

    for (const candidate of emojiCandidates) {
      if (clickVisibleElement(candidate.closest('[role="button"], button') || candidate)) {
        break;
      }
    }

    const attempts = 14;
    const delayMs = 90;
    let remaining = attempts;
    const tick = () => {
      const tab = findStickerTabButton();
      if (tab) {
        clickVisibleElement(tab);
        return;
      }
      remaining -= 1;
      if (remaining <= 0) return;
      setTimeout(tick, delayMs);
    };
    tick();

    return true;
  }

  function findNativeGifSearchField() {
    const strictSelectors = [
      'input[name*="GIPHY" i]',
      'input[aria-label*="GIPHY" i]',
      'input[placeholder*="GIPHY" i]',
      '[role="dialog"] input[name*="GIPHY" i]',
      '[role="dialog"] input[aria-label*="GIPHY" i]',
      '[role="dialog"] input[placeholder*="GIPHY" i]'
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

  function stopGifComposerCleanup() {
    if (gifCleanupTimer) {
      clearTimeout(gifCleanupTimer);
      gifCleanupTimer = null;
    }
    gifCleanupComposer = null;
    gifCleanupUntil = 0;
  }

  function waitForNativeGifSearchField(maxAttempts = 20, delayMs = 120) {
    return new Promise((resolve) => {
      let attempts = maxAttempts;
      const tick = () => {
        const field = findNativeGifSearchField();
        if (field) {
          resolve(field);
          return;
        }
        attempts -= 1;
        if (attempts <= 0) {
          resolve(null);
          return;
        }
        setTimeout(tick, delayMs);
      };
      tick();
    });
  }

  function getSearchFieldText(field) {
    if (!field) return '';
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      return (field.value || '').trim();
    }
    return (field.innerText || field.textContent || '').trim();
  }

  function findNativeStickerSearchField() {
    const selectors = [
      '[role="dialog"] input[placeholder*="sticker" i]',
      '[role="dialog"] input[aria-label*="sticker" i]',
      '[role="dialog"] input[type="text"]',
      '[role="dialog"] [contenteditable="true"][role="textbox"]'
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
      if (nodes.length > 0) return nodes[0];
    }

    return null;
  }

  function openNativeGifPanelWithQuery(query, composer = null) {
    hideGifCommandIndicator();

    if (composer) {
      clearComposerText(composer, { preserveFocus: true });
    }
    if (document.activeElement === composer) {
      composer.blur?.();
    }
    
    // Open GIF panel via UI flow first to avoid focusing global chat search.
    openGifPanelByClickFallback();

    waitForNativeGifSearchField(20, 140).then((field) => {
      if (!field) {
        // Try shortcuts only as fallback and still require strict GIPHY input.
        dispatchKeyboardShortcut('g', { ctrlKey: true });
        dispatchKeyboardShortcut('g', { metaKey: true });
        return waitForNativeGifSearchField(10, 140);
      }
      return field;
    }).then((field) => {
      if (!field) {
        console.info('WhatsApp Web Improver: Native GIF search field not found (strict GIPHY selector)');
        return;
      }

      stopGifComposerCleanup();
      setSearchFieldText(field, query);
      focusGifSearchField(field);
      if (composer) {
        clearComposerText(composer, { preserveFocus: true });
      }
      setTimeout(() => {
        if (!getSearchFieldText(field)) {
          setSearchFieldText(field, query);
        }
        stopGifComposerCleanup();
        focusGifSearchField(field);
        if (composer) {
          clearComposerText(composer, { preserveFocus: true });
        }
      }, 180);
    });
  }

  function openNativeStickerPanel(composer = null, query = '') {
    hideGifCommandIndicator();
    stopGifComposerCleanup();

    if (composer) {
      clearComposerText(composer, { preserveFocus: true });
    }

    openStickerPanelByClickFallback();

    const focusStickerUi = () => {
      const searchField = findNativeStickerSearchField();
      if (!searchField) return false;
      if (query) {
        setSearchFieldText(searchField, query);
      }
      return focusGifSearchField(searchField);
    };

    setTimeout(focusStickerUi, 180);
    setTimeout(focusStickerUi, 360);
  }

  function getSlashCommandSuggestion(text) {
    const normalized = (text || '').replace(/\u00A0/g, ' ').trim().toLowerCase();
    if (!normalized.startsWith('/')) return null;
    if (/\s/.test(normalized)) return null;

    const matches = SLASH_COMMAND_DEFINITIONS.filter((definition) => definition.slash.startsWith(normalized));
    if (matches.length === 0) return null;

    const exact = matches.find((definition) => definition.slash === normalized);
    return {
      isSuggestion: true,
      typed: normalized,
      match: exact || matches[0],
      exact: Boolean(exact)
    };
  }

  function getComposerText(composer) {
    return composerController?.getComposerText(composer) || '';
  }

  function parseSlashCommandDraft(text) {
    const normalized = (text || '').trim();
    if (!normalized) return { isCommand: false, command: null, query: '' };

    const lower = normalized.toLowerCase();
    if (lower.startsWith('/gif')) {
      const parts = normalized.split(/\s+/);
      if (parts[0].toLowerCase() !== '/gif') return { isCommand: false, command: null, query: '' };
      return {
        isCommand: true,
        command: 'gif',
        query: normalized.slice(parts[0].length).trim()
      };
    }

    if (lower.startsWith(STICKER_COMMAND_PREFIX)) {
      const parts = normalized.split(/\s+/);
      if (parts[0].toLowerCase() !== STICKER_COMMAND_PREFIX) return { isCommand: false, command: null, query: '' };
      return {
        isCommand: true,
        command: 'sticker',
        query: normalized.slice(parts[0].length).trim()
      };
    }

    return { isCommand: false, command: null, query: '' };
  }

  function parseGifDraft(text) {
    const draft = parseSlashCommandDraft(text);
    if (!draft.isCommand || draft.command !== 'gif') {
      return { isCommand: false, query: '' };
    }
    return { isCommand: true, query: draft.query };
  }

  function applySlashCommandSuggestion(composer, suggestion) {
    if (!composer || !suggestion?.match) return false;
    setComposerText(composer, `${suggestion.match.slash} `);
    const draft = parseSlashCommandDraft(getComposerText(composer));
    if (draft.isCommand) {
      showGifCommandIndicator(composer, draft);
    }
    return true;
  }

  function getOrCreateGifIndicator() {
    let indicator = document.getElementById(GIF_INDICATOR_ID);
    if (indicator) return indicator;

    indicator = document.createElement('div');
    indicator.id = GIF_INDICATOR_ID;
    document.body.appendChild(indicator);
    return indicator;
  }

  function positionGifIndicator(indicator, composer) {
    if (!indicator || !composer) return;
    const rect = composer.getBoundingClientRect();
    const top = Math.max(10, rect.top - 42);
    const left = Math.max(12, Math.min(window.innerWidth - indicator.offsetWidth - 12, rect.left));
    indicator.style.top = `${top}px`;
    indicator.style.left = `${left}px`;
  }

  function hideGifCommandIndicator() {
    const indicator = document.getElementById(GIF_INDICATOR_ID);
    if (indicator) indicator.remove();
    gifIndicatorComposer = null;
  }

  function showGifCommandIndicator(composer, draft) {
    if (!composer || (!draft?.isCommand && !draft?.isSuggestion)) {
      hideGifCommandIndicator();
      return;
    }

    injectSlashCommandStyles();
    const indicator = getOrCreateGifIndicator();
    gifIndicatorComposer = composer;
    indicator.classList.remove('ready');

    if (draft.isSuggestion) {
      indicator.textContent = `${draft.match.slash} · ${draft.match.description} (Tab to complete)`;
      if (draft.exact) {
        indicator.classList.add('ready');
      }
    } else if (draft.command === 'sticker') {
      indicator.textContent = draft.query
        ? `/sticker ready: "${draft.query}" (Enter to open stickers)`
        : '/sticker detected. Enter to open stickers.';
    } else if (!draft.query) {
      indicator.textContent = '/gif detected. Type what to search for.';
    } else {
      indicator.textContent = `/gif ready: "${draft.query}" (Enter to search)`;
      indicator.classList.add('ready');
    }

    positionGifIndicator(indicator, composer);
  }

  function setComposerText(composer, text) {
    composerController?.setComposerText(composer, text);
  }

  function hasGifCommandText(composer) {
    return composerController?.hasGifCommandText(composer) || false;
  }

  function clearAnyVisibleGifCommandComposer(onlyIfGif = true) {
    composerController?.clearVisibleGifCommandComposers(onlyIfGif);
  }

  function clearComposerText(composer, options = {}) {
    composerController?.clearComposerText(composer, options);
  }

  function clearComposerNowAndStabilize(composer) {
    if (!composer) return;

    if (gifCleanupTimer) {
      clearTimeout(gifCleanupTimer);
      gifCleanupTimer = null;
    }

    gifCleanupComposer = composer;
    gifCleanupUntil = Date.now() + 12000;

    const runClear = () => {
      if (findNativeGifSearchField()) {
        stopGifComposerCleanup();
        return;
      }
      clearComposerText(composer, { preserveFocus: true });
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Immediate clear before any GIF UI action.
    runClear();

    // Keep it clear while WhatsApp may restore draft text asynchronously.
    const loop = () => {
      if (!gifCleanupComposer || Date.now() >= gifCleanupUntil || findNativeGifSearchField()) {
        stopGifComposerCleanup();
        return;
      }
      runClear();
      gifCleanupTimer = setTimeout(loop, 90);
    };

    [20, 40, 80, 140, 220, 320, 460, 620].forEach((delay) => {
      setTimeout(runClear, delay);
    });
    gifCleanupTimer = setTimeout(loop, 120);
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
  function closeStrayContextMenu() {
    if (!findContextMenu()) return;
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true
    }));
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
  function refreshMessageElements() {
    const previous = selectedMessageElement;
    messageElements = getMessageElements();

    if (messageElements.length === 0) {
      selectedMessageIndex = -1;
      return false;
    }

    if (previous && previous.isConnected) {
      const foundIndex = messageElements.indexOf(previous);
      if (foundIndex !== -1) {
        selectedMessageIndex = foundIndex;
        return true;
      }
    }

    selectedMessageIndex = Math.min(
      Math.max(selectedMessageIndex, 0),
      messageElements.length - 1
    );
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
    navigationModeEnteredAt = Date.now(); // Record entry time
    selectedMessageIndex = messageElements.length - 1; // Start from last message
    selectedMessageElement = messageElements[selectedMessageIndex];

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
    navigationActionInProgress = false;
    selectedMessageIndex = -1;
    selectedMessageElement = null;
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

  // Trigger action on selected message
  function triggerActionOnSelectedMessage(action) {
    debugLog(`🎯 triggerActionOnSelectedMessage called with action: "${action}"`);

    if (navigationActionInProgress) {
      debugLog('⏳ Navigation action already in progress, ignoring key press');
      return false;
    }

    // The row may have been recycled by the virtualised list since selection.
    if (!refreshMessageElements()) {
      exitNavigationMode();
      return false;
    }

    const msg = messageElements[selectedMessageIndex];
    if (!msg) {
      debugLog('❌ Invalid message index');
      exitNavigationMode();
      return false;
    }

    navigationActionInProgress = true;

    // Find the message bubble/container to right-click on
    const targetElement = msg.querySelector('[data-pre-plain-text]') ||
                msg.querySelector('[class*="copyable-text"]') ||
                msg;

    debugLog(`🎯 WhatsApp Web Improver: Triggering "${action}" on selected message`, targetElement);

    const finishWithFailure = () => {
      debugLog('❌ Failed to trigger action after retries');
      navigationActionInProgress = false;

      // Staying in navigation mode keeps the selection and the keyboard focus,
      // so an action WhatsApp refuses (editing someone else's message, editing
      // past the time limit) does not throw the user out of the flow.
      closeStrayContextMenu();
      showNavigationError(action);
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

        const retry = () => {
          remainingClickAttempts -= 1;
          if (remainingClickAttempts <= 0) {
            finishWithFailure();
            return;
          }
          setTimeout(() => attemptClick(findContextMenu()), 120);
        };

        const attemptClick = (menuCandidate = null) => {
          const menuBeforeClick = menuCandidate || findContextMenu();

          if (!clickMenuItemByAction(action, menuCandidate, false)) {
            retry();
            return;
          }

          // Dispatching the click is not proof it landed. WhatsApp closes the
          // menu when an action actually runs, so that is the signal.
          setTimeout(() => {
            const menuStillOpen = menuBeforeClick
              && menuBeforeClick.isConnected
              && isElementVisible(menuBeforeClick);

            if (menuStillOpen) {
              retry();
              return;
            }

            finishWithSuccess();
          }, 180);
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

  function waitForContextMenu(callback, attempts = 6, delayMs = 100) {
    if (!domAdapter) {
      callback(null);
      return;
    }

    domAdapter.waitForContextMenu((menu) => {
      currentContextMenu = menu;
      contextMenuOpen = Boolean(menu);
      callback(menu);
    }, attempts, delayMs);
  }

  function openContextMenuForMessageElement(messageElement) {
    domAdapter?.openContextMenuForMessageElement(messageElement);
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
    element.dispatchEvent(new MouseEvent('click', base));
    if (element.isConnected) element.click();
    return true;
  }

  // Find and click a menu item by action
  function clickMenuItemByAction(action, menuOverride = null, allowGlobalFallback = true) {
    if (!messageActionResolver) return false;

    const result = messageActionResolver.clickMenuItemByAction(action, {
      allowGlobalFallback,
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

  // Two ways in, because neither alone covers every situation:
  //  - Alt+ArrowUp works anywhere, including mid-draft, and never collides with
  //    WhatsApp's own arrow handling.
  //  - plain ArrowUp works from an empty composer (where WhatsApp parks the
  //    focus by default) or from the message list when not typing.
  function shouldEnterNavigationModeOnArrowUp(event) {
    if (!messageNavigationEnabled) return false;
    if (messageNavigationMode) return false;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (contextMenuOpen) return false;
    if (document.getElementById(GIF_INDICATOR_ID)) return false;

    const target = event.target instanceof Element ? event.target : document.activeElement;
    if (!target) return false;

    // Modifier path: no restriction on where the focus is.
    if (event.altKey) return true;

    const composer = getComposerFromTarget(target);
    if (composer) {
      // Only from an empty composer: otherwise we would hijack cursor movement
      // in a draft the user is writing.
      return getComposerText(composer) === '';
    }

    if (isTypingTarget(target)) return false;

    return isChatAreaTarget(target);
  }

  // Bound on window rather than document: capture runs window -> document, so
  // this is the earliest point we can intercept a key before WhatsApp's own
  // handlers see it (notably its native ArrowUp "edit last message").
  window.addEventListener('keydown', (e) => {
    const pressedKey = e.key;
    const pressedKeyLower = pressedKey.toLowerCase();
    const isTyping = isTypingTarget(e.target);
    const composerTarget = getComposerFromTarget(e.target) || getComposerFromTarget(document.activeElement) || gifIndicatorComposer;

    if ((composerTarget || gifIndicatorComposer) && pressedKey === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tabComposer = composerTarget || gifIndicatorComposer;
      const indicatorVisible = Boolean(document.getElementById(GIF_INDICATOR_ID));
      const suggestion = getSlashCommandSuggestion(getComposerText(tabComposer));
      if (suggestion || indicatorVisible) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      if (suggestion) {
        applySlashCommandSuggestion(tabComposer, suggestion);
        return;
      }

      if (indicatorVisible && tabComposer) {
        tabComposer.focus();
        return;
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
    if (messageNavigationMode) {
      if (navigationActionInProgress) {
        if (pressedKey === 'Escape') {
          swallow();
          navigationActionInProgress = false;
          exitNavigationMode();
        } else if (pressedKey === 'ArrowUp' || pressedKey === 'ArrowDown') {
          swallow();
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

      // Check for action shortcuts (only after a short delay to prevent accidental triggers)
      const timeSinceEntry = Date.now() - navigationModeEnteredAt;

      if (timeSinceEntry > 300) { // 300ms delay before allowing actions
        if (e.repeat) return;

        const action = getActionForKey(pressedKeyLower);
        if (action) {
          debugLog(`🎯 Triggering action: ${action}`);
          swallow();
          triggerActionOnSelectedMessage(action);
          return;
        }
      } else {
        debugLog('⏳ Ignoring key - too soon after entering navigation mode');
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
    if (!actionForKey) return;

    const menuDetected = ensureContextMenuOpen();

    debugLog(`🎯 WhatsApp Web Improver: Matched shortcut "${pressedKeyLower}" → "${actionForKey}"`);
    
    if (!menuDetected) {
      debugLog('⚠️ WhatsApp Web Improver: Menu container not detected, trying visible action fallback');
    }

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

  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter') return;
    const composerTarget = getComposerFromTarget(e.target) || getComposerFromTarget(document.activeElement);
    if (!composerTarget) return;
    if (composerTarget !== gifCleanupComposer) return;
    if (Date.now() > gifCleanupUntil + 1200) return;
    clearComposerText(composerTarget);
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (!isSendButtonTarget(e.target)) return;
    const composer = getActiveComposer();
    handleSlashCommandInvocation(composer, e);
  }, true);

  // Also exit navigation mode when clicking anywhere
  document.addEventListener('click', (event) => {
    if (gifIndicatorComposer && !gifIndicatorComposer.contains(event.target)) {
      hideGifCommandIndicator();
    }

    if (messageNavigationMode && !navigationActionInProgress) {
      exitNavigationMode();
    }
  }, true);

  window.addEventListener('resize', () => {
    const indicator = document.getElementById(GIF_INDICATOR_ID);
    if (indicator && gifIndicatorComposer) {
      positionGifIndicator(indicator, gifIndicatorComposer);
    }
  });

  document.addEventListener('input', (event) => {
    if (suppressComposerInputHandler || programmaticClearDepth > 0) return;

    const composer = getComposerFromTarget(event.target);
    if (!composer) {
      hideGifCommandIndicator();
      return;
    }

    const currentText = getComposerText(composer);
    const suggestion = getSlashCommandSuggestion(currentText);
    if (suggestion) {
      showGifCommandIndicator(composer, suggestion);
      return;
    }

    const draft = parseSlashCommandDraft(currentText);
    if (draft.isCommand) {
      showGifCommandIndicator(composer, draft);
    } else {
      hideGifCommandIndicator();
    }
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
