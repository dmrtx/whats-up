const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');

function setup(t, bubbleHtml) {
  const dom = new JSDOM(`<!doctype html><body>
    <div role="row" data-id="m-1"><div id="bubble">${bubbleHtml}</div></div>
  </body>`, { url: 'https://web.whatsapp.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = function() {
    return { left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 };
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.PointerEvent = window.MouseEvent;
  window.eval(fs.readFileSync(path.join(root, 'compat/whatsapp-dom-adapter.js'), 'utf8'));
  const adapter = window.WAImproverDomAdapter.createWhatsAppDomAdapter({
    isElementVisible: () => true,
    clickElementReliably: () => true
  });
  const contextmenuTargets = [];
  window.document.addEventListener('contextmenu', (event) => contextmenuTargets.push(event.target), true);
  return { window, adapter, contextmenuTargets };
}

test('right-click for a URL-only message never targets the link itself', (t) => {
  const { window, adapter, contextmenuTargets } = setup(t,
    '<div data-pre-plain-text="[1] A: "><span dir="auto"><a href="https://example.com/x">https://example.com/x</a></span></div>');
  const link = window.document.querySelector('a');
  // Every probe point lands on the URL, as it does for a one-line link.
  window.document.elementFromPoint = () => link;

  const row = window.document.querySelector('[role="row"]');
  assert.equal(adapter.openContextMenuForMessageElement(row), true);

  assert.equal(contextmenuTargets.length, 1);
  assert.equal(contextmenuTargets[0].closest('a, [role="link"]'), null);
  assert.ok(row.contains(contextmenuTargets[0]));
});

test('right-click on plain text still targets the element under the pointer', (t) => {
  const { window, adapter, contextmenuTargets } = setup(t,
    '<div data-pre-plain-text="[1] A: "><span dir="auto" id="text">hello</span></div>');
  const text = window.document.querySelector('#text');
  window.document.elementFromPoint = () => text;

  assert.equal(adapter.openContextMenuForMessageElement(window.document.querySelector('[role="row"]')), true);
  assert.deepEqual(contextmenuTargets, [text]);
});
