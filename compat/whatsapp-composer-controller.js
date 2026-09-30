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
      const composer = target.closest('footer [contenteditable="true"], #main [contenteditable="true"][data-tab="10"]');
      return composer && !composer.closest('[role="dialog"]') ? composer : null;
    }

    function getActiveComposer() {
      const focused = getComposerFromTarget(document.activeElement);
      if (focused) return focused;

      const candidates = Array.from(
        document.querySelectorAll('#main footer [contenteditable="true"], footer [contenteditable="true"], #main [contenteditable="true"][data-tab="10"]')
      );
      for (const candidate of candidates) {
        if (!candidate.closest('[role="dialog"]') && isElementVisible(candidate)) return candidate;
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

    function selectComposerContents(composer) {
      composer.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand('selectAll');
      } catch (error) {
        // The Range still selects the complete composer.
      }
    }

    function setComposerText(composer, text, options = {}) {
      const { scheduleMutation = (callback) => callback(), shouldSet = () => true,
        onComplete = () => {} } = options;
      if (!composer?.isConnected || !shouldSet()) return;
      selectComposerContents(composer);
      scheduleMutation(() => {
        if (!composer.isConnected || !shouldSet() || document.activeElement !== composer) return;
        enterProgrammaticMutation();
        try {
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text
          });
          composer.dispatchEvent(beforeInput);
          const managedEditor = composer.hasAttribute('data-lexical-editor');
          if (!beforeInput.defaultPrevented) {
            try {
              document.execCommand('insertText', false, text);
            } catch (error) {
              // Continue with the DOM fallback for unmanaged composers.
            }
            if (!managedEditor && getComposerText(composer) !== text.trim()) {
              const paragraph = getComposerParagraph(composer);
              const target = paragraph || composer;
              target.textContent = text;
              if (paragraph) composer.replaceChildren(paragraph);
              const range = document.createRange();
              range.selectNodeContents(target);
              range.collapse(false);
              window.getSelection()?.removeAllRanges();
              window.getSelection()?.addRange(range);
            }
            // Native insertion already emits input. A second insertText event
            // makes Lexical apply the same text again at the new caret.
            if (!managedEditor) {
              composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
              composer.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          onComplete();
        } finally {
          exitProgrammaticMutation();
        }
      });
    }

    function getComposerParagraph(composer) {
      if (!composer) return null;
      return composer.querySelector('p.copyable-text, p._aupe, p[class*="copyable-text"]') || composer.querySelector('p');
    }

    // WhatsApp renders one <p> per line and can split a line across nodes, so
    // clearing only the first paragraph leaves the rest of the text behind.
    function ensureComposerEmptyStructure(composer) {
      if (!composer) return;

      const paragraph = getComposerParagraph(composer);
      const emptyLine = document.createElement('br');
      if (paragraph) {
        paragraph.replaceChildren(emptyLine);
        composer.replaceChildren(paragraph);
      } else {
        composer.replaceChildren(emptyLine);
      }
    }

    function clearComposerText(composer, options = {}) {
      if (!composer?.isConnected) return;
      const { emitEvents = true, preserveFocus = false,
        scheduleMutation = (callback) => callback(), shouldClear = () => true } = options;
      const previousActiveElement = document.activeElement;
      if (!shouldClear()) return;

      enterProgrammaticMutation();
      try {
        selectComposerContents(composer);
      } finally {
        exitProgrammaticMutation();
      }

      // Let WhatsApp process selectionchange before deleting. Its Lexical
      // model otherwise still holds the old caret, then restores the draft.
      // The caller owns this delayed mutation and cancels it on user input.
      scheduleMutation(() => {
        if (!composer.isConnected || !shouldClear() || document.activeElement !== composer) return;
        enterProgrammaticMutation();
        try {
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, composed: true,
            inputType: 'deleteContentBackward', data: null
          });
          composer.dispatchEvent(beforeInput);
          // Managed editors consume beforeinput to update their model. Do not
          // delete again after that: it can remove a character from a new caret.
          const handledByEditor = beforeInput.defaultPrevented;
          if (!handledByEditor) {
            try {
              document.execCommand('delete');
            } catch (error) {
              // Continue with the DOM fallback for unmanaged composers.
            }
            if (getComposerText(composer) !== '') ensureComposerEmptyStructure(composer);
          }
          if (emitEvents && !handledByEditor) {
            setInputSuppressed(true);
            composer.dispatchEvent(new InputEvent('input', {
              bubbles: true, composed: true, inputType: 'deleteContentBackward', data: null
            }));
            composer.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(() => setInputSuppressed(false), 0);
          }
          if (preserveFocus && previousActiveElement instanceof HTMLElement
            && previousActiveElement.isConnected && previousActiveElement !== composer) {
            previousActiveElement.focus();
          }
        } finally {
          exitProgrammaticMutation();
        }
      });
    }

    return {
      clearComposerText,
      getActiveComposer,
      getComposerFromTarget,
      getComposerText,
      isSendButtonTarget,
      setComposerText
    };
  }

  window.WAImproverComposerController = {
    createWhatsAppComposerController
  };
})();
