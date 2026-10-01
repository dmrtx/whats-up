const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../ui/sidebar-resizer.js'), 'utf8');

function setup(t, stored = null) {
  const dom = new JSDOM(`<div id="app"><div id="layout" style="display:flex;flex-direction:row">
    <header></header><div id="column" style="flex:0 0 30%;position:relative">
    <header></header><div id="side" style="display:flex;flex-direction:column"><div id="pane-side"></div></div>
    </div><main id="main"></main></div></div>`, { url: 'https://web.whatsapp.com', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  let viewport = 1200;
  let scale = 1;
  let frame;
  window.requestAnimationFrame = fn => { frame = fn; return 1; };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() {
    return this.id === 'layout' ? viewport : this.tagName === 'HEADER' ? 64 : parseFloat(this.style.width) || 390;
  } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return this.offsetWidth; } });
  window.HTMLElement.prototype.getBoundingClientRect = function() {
    return { x: 64 * scale, y: 0, width: this.offsetWidth * scale, height: 800, left: 64 * scale };
  };
  let captured = null;
  window.HTMLElement.prototype.setPointerCapture = id => { captured = id; };
  window.HTMLElement.prototype.hasPointerCapture = id => captured === id;
  window.HTMLElement.prototype.releasePointerCapture = () => { captured = null; };
  if (stored !== null) window.localStorage.setItem('waImproverSidebarWidth', stored);
  window.eval(source);
  const handle = () => document.querySelector('[role="separator"]');
  const column = () => document.querySelector('#column');
  function key(key, options = {}) {
    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  }
  function pointer(type, x, pointerId = 1) {
    const event = new window.MouseEvent(type, { button: 0, clientX: x, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    handle().dispatchEvent(event);
  }
  async function flush() {
    await Promise.resolve();
    const callback = frame;
    frame = null;
    callback?.();
  }
  return { window, document, handle, column, key, pointer, flush,
    stored: () => window.localStorage.getItem('waImproverSidebarWidth'),
    resize: async width => { viewport = width; window.dispatchEvent(new window.Event('resize')); await flush(); },
    zoom: value => { scale = value; } };
}

test('chat-list divider keeps original layout until resized and persists a completed drag', t => {
  const h = setup(t);
  assert.equal(h.column().style.flex, '0 0 30%');
  const search = h.document.createElement('input');
  h.document.querySelector('#side').prepend(search);
  search.focus();
  h.pointer('pointerdown', 454);
  assert.equal(h.document.activeElement, h.handle());
  h.pointer('pointermove', 534);
  assert.equal(h.column().style.width, '470px');
  assert.equal(h.stored(), null);
  h.pointer('pointerup', 534);
  assert.equal(h.document.activeElement, search);
  assert.equal(h.handle().hasAttribute('data-dragging'), false);
  assert.equal(h.stored(), '470');
  assert.equal(h.handle().getAttribute('aria-valuenow'), '470');
});

test('drag accounts for UI zoom and cancellation restores the previous preference', t => {
  const h = setup(t, '420');
  h.zoom(1.25);
  h.pointer('pointerdown', 605);
  h.pointer('pointermove', 705);
  assert.equal(h.column().style.width, '500px');
  h.pointer('pointercancel', 705);
  assert.equal(h.column().style.width, '420px');
  assert.equal(h.stored(), '420');
});

test('width clamps leave space for conversation and recover after a narrow window', async t => {
  const h = setup(t, '560');
  await h.resize(800);
  assert.equal(h.column().style.width, '376px');
  assert.equal(h.stored(), '560');
  await h.resize(600);
  assert.equal(h.handle().hidden, true);
  assert.equal(h.column().style.flex, '0 0 30%');
  assert.equal(h.column().style.width, '');
  await h.resize(1200);
  assert.equal(h.handle().hidden, false);
  assert.equal(h.column().style.width, '560px');
});

test('keyboard and double click support bounded adjustment and original-width reset', t => {
  const h = setup(t);
  h.key('ArrowLeft');
  assert.equal(h.column().style.width, '374px');
  h.key('End');
  assert.equal(h.column().style.width, '600px');
  h.key('Home');
  assert.equal(h.column().style.width, '260px');
  h.handle().dispatchEvent(new h.window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(h.stored(), null);
  assert.equal(h.column().style.flex, '0 0 30%');
  assert.equal(h.column().style.width, '');
});

test('React replacing the column rebinds one divider and reapplies the saved width', async t => {
  const h = setup(t, '450');
  const old = h.column();
  const replacement = old.cloneNode(true);
  replacement.querySelector('[role="separator"]').remove();
  replacement.removeAttribute('data-wa-improver-sidebar');
  replacement.style.cssText = 'flex:0 0 30%;position:relative';
  old.replaceWith(replacement);
  await h.flush();
  assert.equal(h.document.querySelectorAll('[role="separator"]').length, 1);
  assert.equal(h.column().style.width, '450px');
  assert.equal(old.style.flex, '0 0 30%');
});

test('invalid stored width is ignored and RTL arrows follow the visual direction', t => {
  const h = setup(t, 'invalid');
  assert.equal(h.column().style.width, '');
  h.document.querySelector('#layout').style.direction = 'rtl';
  h.key('ArrowLeft');
  assert.equal(h.column().style.width, '406px');
});
