(function() {
  'use strict';

  // Every delayed UI effect belongs to one operation and one chat context.
  function createUiOperation(contextIsCurrent) {
    let active = true;
    const timers = new Set();
    const waiters = new Set();

    function cancel() {
      active = false;
      timers.forEach(clearTimeout);
      timers.clear();
      waiters.forEach((resolve) => resolve(null));
      waiters.clear();
    }

    function isCurrent() {
      if (!active) return false;
      if (!contextIsCurrent()) {
        cancel();
        return false;
      }
      return true;
    }

    function schedule(callback, delayMs) {
      if (!isCurrent()) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (isCurrent()) callback();
      }, delayMs);
      timers.add(timer);
    }

    function waitFor(find, attempts = 20, delayMs = 100) {
      return new Promise((resolve) => {
        waiters.add(resolve);
        const finish = (value) => {
          waiters.delete(resolve);
          resolve(value);
        };
        const tick = () => {
          if (!isCurrent()) {
            finish(null);
            return;
          }
          const value = find();
          if (value || --attempts <= 0) {
            finish(value || null);
            return;
          }
          schedule(tick, delayMs);
        };
        tick();
      });
    }

    return { cancel, isCurrent, schedule, waitFor };
  }

  window.WAImproverUiOperation = { createUiOperation };
})();
