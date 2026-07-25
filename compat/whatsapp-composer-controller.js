(function() {
  'use strict';

  function createWhatsAppComposerController(config) {
    const {
      isElementVisible,
      enterProgrammaticMutation,
      exitProgrammaticMutation,
      setInputSuppressed
    } = config;

    function getComposerFromTarget(target) {
      if (!(target instanceof Element)) return null;
      return target.closest('[contenteditable="true"][role="textbox"], [contenteditable="true"][data-tab="10"], footer [contenteditable="true"]');
    }

    function getActiveComposer() {
      const focused = getComposerFromTarget(document.activeElement);
      if (focused) return focused;

      const candidates = Array.from(
        document.querySelectorAll('footer [contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"][data-tab="10"]')
      );
      for (const candidate of candidates) {
        if (isElementVisible(candidate)) return candidate;
      }
      return null;
    }

    function isSendButtonTarget(target) {
      if (!(target instanceof Element)) return false;
      const button = target.closest('[role="button"], button');
      if (!button) return false;

      if (button.querySelector('span[data-icon="send"]')) return true;

      const label = (button.getAttribute('aria-label') || '').toLowerCase();
      const testId = (button.getAttribute('data-testid') || '').toLowerCase();
      return label.includes('send') || testId.includes('send');
    }

    function getComposerText(composer) {
      if (!composer) return '';
      const raw = (composer.innerText || composer.textContent || '').replace(/\u00A0/g, ' ');
      return raw.trim();
    }

    function setComposerText(composer, text) {
      if (!composer) return;
      composer.focus();
      const selection = window.getSelection();
      if (!selection) return;

      composer.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));

      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);

      let insertedWithExecCommand = false;
      try {
        insertedWithExecCommand = document.execCommand('insertText', false, text);
      } catch (error) {
        insertedWithExecCommand = false;
      }

      if (!insertedWithExecCommand || getComposerText(composer) !== text) {
        range.deleteContents();

        const paragraph = getComposerParagraph(composer);
        if (paragraph) {
          paragraph.textContent = text;
          const textNode = paragraph.firstChild || document.createTextNode(text);
          if (!paragraph.firstChild) {
            paragraph.appendChild(textNode);
          }
          range.selectNodeContents(paragraph);
          range.collapse(false);
        } else {
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.collapse(true);
        }

        selection.removeAllRanges();
        selection.addRange(range);
      }

      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      composer.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    function getComposerParagraph(composer) {
      if (!composer) return null;
      return composer.querySelector('p.copyable-text, p._aupe, p[class*="copyable-text"]') || composer.querySelector('p');
    }

    function scrubGifCommandFromComposer(composer, force) {
      if (!composer) return;
      const rawText = (composer.innerText || composer.textContent || '').replace(/\u00A0/g, ' ').trim();
      if (!force && !rawText.toLowerCase().startsWith('/gif')) return;

      const paragraph = getComposerParagraph(composer);
      if (paragraph) {
        paragraph.textContent = '';
        paragraph.innerHTML = '<br>';
      }

      if (!paragraph) {
        composer.textContent = '';
      }
    }

    function ensureComposerEmptyStructure(composer) {
      if (!composer) return;
      const existingParagraph = getComposerParagraph(composer);
      if (existingParagraph) {
        existingParagraph.textContent = '';
        existingParagraph.innerHTML = '<br>';
        return;
      }
      composer.textContent = '';
      composer.innerHTML = '<br>';
    }

    function getGifCommandComposerCandidates() {
      const preferred = Array.from(
        document.querySelectorAll('footer [contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"][data-tab="10"]')
      );
      return preferred.filter((node, index) => preferred.indexOf(node) === index);
    }

    function hasGifCommandText(composer) {
      const text = getComposerText(composer)
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .toLowerCase()
        .trim();
      return /^\/(?:g(?:i(?:f)?)?)?(?:\s.*)?$/i.test(text);
    }

    function clearComposerText(composer, options) {
      if (!composer) return;
      const { emitEvents = true, preserveFocus = false } = options || {};
      const previousActiveElement = document.activeElement;

      enterProgrammaticMutation();
      try {
        if (!preserveFocus) {
          composer.focus();
        }
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(composer);
          selection.removeAllRanges();
          selection.addRange(range);
          try {
            document.execCommand('delete');
          } catch (error) {
            // Ignore and continue with DOM-based clearing fallback.
          }
        }

        if (emitEvents) {
          composer.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'deleteContentBackward',
            data: null
          }));
        }

        scrubGifCommandFromComposer(composer, true);
        ensureComposerEmptyStructure(composer);

        if (emitEvents) {
          setInputSuppressed(true);
          composer.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'deleteContentBackward',
            data: null
          }));
          composer.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          setTimeout(() => {
            setInputSuppressed(false);
          }, 0);
        }

        if (preserveFocus && previousActiveElement instanceof HTMLElement && previousActiveElement !== composer) {
          previousActiveElement.focus();
        }
      } finally {
        exitProgrammaticMutation();
      }
    }

    function clearVisibleGifCommandComposers(onlyIfGif) {
      const composers = getGifCommandComposerCandidates();
      for (const candidate of composers) {
        if (!isElementVisible(candidate)) continue;
        if (onlyIfGif && !hasGifCommandText(candidate)) continue;
        clearComposerText(candidate, { emitEvents: true, preserveFocus: true });
      }
    }

    return {
      clearComposerText,
      clearVisibleGifCommandComposers,
      getActiveComposer,
      getComposerFromTarget,
      getComposerText,
      hasGifCommandText,
      isSendButtonTarget,
      setComposerText
    };
  }

  window.WAImproverComposerController = {
    createWhatsAppComposerController
  };
})();
