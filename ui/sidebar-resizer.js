// Resize only the chat-list column; leave WhatsApp's narrow-screen layout intact.
(() => {
  'use strict';
  if (window.__WA_IMPROVER_SIDEBAR_LOADED) return;
  window.__WA_IMPROVER_SIDEBAR_LOADED = true;

  const STORAGE_KEY = 'waImproverSidebarWidth';
  const MIN_WIDTH = 260;
  const MAX_WIDTH = 600;
  const CHAT_MIN_WIDTH = 360;
  const properties = ['flex', 'width', 'min-width', 'max-width', 'position'];
  let preferredWidth = null;
  let binding = null;
  let drag = null;
  let frame = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = Number(raw);
    if (raw !== null && Number.isFinite(value) && value > 0) {
      preferredWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
    }
  } catch (_) { /* Storage may be unavailable. Resizing still works. */ }

  function persist() {
    try {
      if (preferredWidth === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(preferredWidth));
    } catch (_) { /* Keep the current session's width. */ }
  }

  function restore() {
    if (!binding) return;
    for (const [property, value, priority] of binding.original) {
      if (value) binding.panel.style.setProperty(property, value, priority);
      else binding.panel.style.removeProperty(property);
    }
  }

  function bounds() {
    const { panel, container } = binding;
    const scale = container.getBoundingClientRect().width / container.offsetWidth || 1;
    const siblingsWidth = [...container.children].reduce((width, child) => {
      // The navigation rail is outside the chat-list column.
      return width + (child.tagName === 'HEADER' && child !== panel
        ? child.getBoundingClientRect().width / scale : 0);
    }, 0);
    return { min: MIN_WIDTH, max: Math.min(MAX_WIDTH, container.clientWidth - siblingsWidth - CHAT_MIN_WIDTH), scale };
  }

  function update() {
    if (!binding) return;
    const limits = bounds();
    const enabled = limits.max >= limits.min && binding.panel.getBoundingClientRect().height > 0;
    binding.handle.hidden = !enabled;
    restore();
    if (!enabled) {
      finishDrag(true);
      return;
    }
    binding.panel.style.setProperty('position', 'relative', 'important');
    if (preferredWidth !== null) {
      const width = Math.round(Math.max(limits.min, Math.min(limits.max, preferredWidth)));
      for (const property of ['width', 'min-width', 'max-width']) {
        binding.panel.style.setProperty(property, `${width}px`, 'important');
      }
      binding.panel.style.setProperty('flex', `0 0 ${width}px`, 'important');
    }
    const width = Math.round(binding.panel.getBoundingClientRect().width / limits.scale);
    binding.handle.setAttribute('aria-valuemin', String(limits.min));
    binding.handle.setAttribute('aria-valuemax', String(Math.floor(limits.max)));
    binding.handle.setAttribute('aria-valuenow', String(width));
  }

  function setWidth(width) {
    const limits = bounds();
    preferredWidth = Math.round(Math.max(limits.min, Math.min(limits.max, width)));
    update();
  }

  function finishDrag(cancel = false) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    previous.handle.removeAttribute('data-dragging');
    if (previous.handle.hasPointerCapture?.(previous.pointerId)) {
      previous.handle.releasePointerCapture(previous.pointerId);
    }
    if (cancel) preferredWidth = previous.preferredWidth;
    else persist();
    update();
  }

  function findPanel() {
    const side = document.querySelector('#side');
    if (!side?.querySelector('#pane-side')) return null;
    for (let panel = side; panel && panel.id !== 'app'; panel = panel.parentElement) {
      const container = panel.parentElement;
      if (!container) break;
      const style = getComputedStyle(container);
      if (style.display === 'flex' && style.flexDirection === 'row') return { panel, container };
    }
    return null;
  }

  function reconcile() {
    frame = null;
    const next = findPanel();
    if (binding && (!next || next.panel !== binding.panel)) {
      finishDrag(true);
      restore();
      binding.resizeObserver?.disconnect();
      binding.panel.removeAttribute('data-wa-improver-sidebar');
      binding.handle.remove();
      binding = null;
    }
    if (!next) return;
    if (!binding) {
      const handle = document.createElement('div');
      handle.className = 'wa-improver-sidebar-resizer';
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize chat list');
      handle.title = 'Drag to resize chats · Double-click to reset';
      binding = { ...next, handle, original: properties.map(property => [
        property, next.panel.style.getPropertyValue(property), next.panel.style.getPropertyPriority(property)
      ]) };
      next.panel.setAttribute('data-wa-improver-sidebar', '');
      next.panel.appendChild(handle);
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || handle.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        const limits = bounds();
        drag = { handle, pointerId: event.pointerId, x: event.clientX,
          width: next.panel.getBoundingClientRect().width / limits.scale,
          scale: limits.scale, preferredWidth,
          direction: getComputedStyle(next.container).direction === 'rtl' ? -1 : 1 };
        handle.setPointerCapture(event.pointerId);
        handle.setAttribute('data-dragging', '');
        handle.focus({ preventScroll: true });
      });
      handle.addEventListener('pointermove', event => {
        if (drag?.pointerId !== event.pointerId) return;
        setWidth(drag.width + (event.clientX - drag.x) / drag.scale * drag.direction);
      });
      handle.addEventListener('pointerup', event => {
        if (drag?.pointerId === event.pointerId) finishDrag();
      });
      handle.addEventListener('pointercancel', () => finishDrag(true));
      handle.addEventListener('lostpointercapture', () => finishDrag(true));
      handle.addEventListener('dblclick', event => {
        event.preventDefault();
        finishDrag(true);
        preferredWidth = null;
        persist();
        update();
      });
      if (window.ResizeObserver) {
        binding.resizeObserver = new ResizeObserver(schedule);
        binding.resizeObserver.observe(next.container);
      }
    }
    update();
  }

  function schedule() {
    if (frame === null) frame = requestAnimationFrame(reconcile);
  }

  // Capture before message shortcuts: the focused splitter owns these keys.
  window.addEventListener('keydown', event => {
    if (!binding || event.target !== binding.handle || binding.handle.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { finishDrag(true); return; }
    const limits = bounds();
    const width = binding.panel.getBoundingClientRect().width / limits.scale;
    const direction = getComputedStyle(binding.container).direction === 'rtl' ? -1 : 1;
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * direction * (event.shiftKey ? 40 : 16);
    setWidth(event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max : width + delta);
    persist();
  }, true);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  reconcile();
})();
