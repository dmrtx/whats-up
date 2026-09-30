const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).content_scripts[0].js;

function setup(t) {
  const dom = new JSDOM(`<!doctype html><body><div id="app">
    <aside id="side"><header><h1>WhatsApp</h1><input id="chat-search" role="textbox"></header></aside>
    <main id="main"><header><span title="Chat A">Chat A</span></header>
    <div data-testid="conversation-panel-messages">
      <div role="row" data-id="a-1"><div data-pre-plain-text="First">First message</div></div>
      <div role="row" data-id="a-2"><div data-pre-plain-text="Second">Second message</div></div>
    </div>
    <footer><button aria-label="Emoji">Emoji</button>
      <div contenteditable="true" role="textbox" data-tab="10" tabindex="0"><p>My unsent draft</p></div>
      <button id="send"><span data-icon="send"></span></button>
    </footer></main></div></body>`, {
    url: 'https://web.whatsapp.com/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const { document } = window;
  const observers = [];
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  t.after(() => {
    observers.forEach((observer) => observer.disconnect());
    dom.window.close();
  });
  // No network or WhatsApp account: scripts run against this local DOM only.
  window.HTMLElement.prototype.getBoundingClientRect = function() {
    return this.isConnected && this.style.display !== 'none'
      ? { left: 0, top: 0, right: 120, bottom: 32, width: 120, height: 32 }
      : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.PointerEvent = window.MouseEvent;
  document.elementFromPoint = () => document.querySelector('.wa-improver-selected-message [data-pre-plain-text]');
  document.execCommand = () => false; // Exercise DOM fallback too.
  const listeners = new Map();
  const originalAdd = document.addEventListener.bind(document);
  document.addEventListener = (type, fn, options) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
    originalAdd(type, fn, options);
  };
  let now = 1_800_000_000_000;
  window.Date.now = () => now;
  let nextTimer = 0;
  const timers = new Map();
  window.setTimeout = (fn, delay = 0) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = () => ++nextTimer; // Background monitoring is unrelated.
  window.clearInterval = () => {};
  window.chrome = {
    runtime: { id: 'test-extension', getURL: (name) => `chrome-extension://test/${name}` },
    storage: {
      sync: { get: (_, callback) => window.setTimeout(() => callback({}), 0) },
      local: { set: (_, callback) => callback?.() },
      onChanged: { addListener: () => {} }
    }
  };
  for (const script of scripts) window.eval(fs.readFileSync(path.join(root, script), 'utf8'));

  async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
  async function advance(ms) {
    const end = now + ms;
    await settle();
    let count = 0;
    while (true) {
      const entry = [...timers.entries()].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      if (++count > 10000) throw new Error('Timer loop');
      const [id, timer] = entry;
      timers.delete(id);
      now = timer.at;
      timer.fn();
      await settle();
    }
    now = end;
    await settle();
  }
  const composer = document.querySelector('footer [contenteditable]');
  function key(key, options = {}, target = document.activeElement) {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  }
  // Browser-generated user input is trusted. jsdom cannot manufacture trusted
  // events, so invoke the registered capture listener with the equivalent data.
  function userEvent(type, target = composer) {
    const event = { target, isTrusted: true, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
    for (const listener of listeners.get(type) || []) listener(event);
  }
  let sends = 0;
  document.querySelector('#send').addEventListener('click', () => sends++);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === composer) sends++;
  });
  function menu(labels = ['Reply', 'Delete'], onClick = () => {}) {
    const node = document.createElement('div');
    node.setAttribute('role', 'menu');
    labels.forEach((label) => {
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.addEventListener('click', () => onClick(label, node));
      node.appendChild(item);
    });
    document.body.appendChild(node);
    return node;
  }
  function select() {
    composer.focus();
    return key('ArrowUp');
  }
  function command(text) {
    composer.textContent = text;
    composer.focus();
    composer.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
    key('Enter');
  }
  function installPicker({ delay = 0, searchDelay = 0, sticker = false } = {}) {
    let opens = 0;
    let switches = 0;
    document.querySelector('[aria-label="Emoji"]').addEventListener('click', () => {
      opens++;
      window.setTimeout(() => {
        const panel = document.createElement('div');
        panel.setAttribute('data-testid', 'simulated-picker');
        panel.innerHTML = '<div role="tablist"><button role="tab" data-testid="expressions-btn-gif" aria-label="Gifs selector">ic-gif</button><button role="tab" data-testid="expressions-btn-sticker" aria-label="Stickers selector">ic-sticker</button></div>';
        document.querySelector('footer').appendChild(panel);
        panel.querySelectorAll('[role="tab"]').forEach((tab) => tab.addEventListener('click', () => {
          switches++;
          tab.setAttribute('aria-selected', 'true');
          window.setTimeout(() => {
            const field = document.createElement('input');
            field.type = 'text';
            field.setAttribute('aria-label', sticker ? 'Sticker search' : 'Search GIPHY');
            panel.appendChild(field);
          }, searchDelay);
        }));
      }, delay);
    });
    return { opens: () => opens, switches: () => switches, field: () => document.querySelector('[data-testid="simulated-picker"] input') };
  }
  return { window, document, composer, key, advance, settle, userEvent, menu, select, command, installPicker, sends: () => sends };
}

test('ArrowUp with a draft, immediate Reply: one click, same draft and restored focus', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let replies = 0;
  let deletes = 0;
  let opens = 0;
  h.document.addEventListener('contextmenu', () => {
    opens++;
    h.menu(['Reply', 'Delete'], (label, menu) => {
      if (label === 'Reply') replies++; else deletes++;
      // React closes the menu asynchronously, exposing duplicate clicks.
      h.window.setTimeout(() => menu.remove(), 400);
    });
  });
  assert.equal(h.select().defaultPrevented, true);
  assert.equal(h.composer.textContent, 'My unsent draft');
  assert.equal(h.document.querySelector('.wa-improver-selected-message').dataset.id, 'a-2');
  h.key('r'); // No arbitrary 300ms pause required.
  await h.advance(1500);
  assert.equal(replies, 1);
  assert.equal(deletes, 0);
  assert.equal(opens, 1);
  assert.equal(h.composer.textContent, 'My unsent draft');
  assert.equal(h.document.activeElement, h.composer);
  assert.equal(h.document.querySelector('.wa-improver-selected-message'), null);
  assert.equal(h.sends(), 0);
});

test('ArrowUp and ArrowDown navigate with text; Escape returns to the intact draft', async (t) => {
  const h = setup(t);
  await h.advance(0);
  h.select();
  h.key('ArrowUp');
  assert.equal(h.document.querySelector('.wa-improver-selected-message').dataset.id, 'a-1');
  h.key('ArrowDown');
  h.key('Escape');
  assert.equal(h.document.activeElement, h.composer);
  assert.equal(h.composer.textContent, 'My unsent draft');
  assert.equal(h.sends(), 0);
});

test('Escape cancels a pending action before a slow menu arrives', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let clicks = 0;
  h.document.addEventListener('contextmenu', () => {
    h.window.setTimeout(() => h.menu(['Reply', 'Delete'], () => clicks++), 500);
  });
  h.select();
  h.key('d');
  h.key('Escape');
  await h.advance(5000);
  assert.equal(clicks, 0);
  assert.equal(h.composer.textContent, 'My unsent draft');
  assert.equal(h.sends(), 0);
});

test('Old action completion cannot clear a new selection after cancellation', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let opens = 0;
  h.document.addEventListener('contextmenu', () => opens++);
  h.select();
  h.key('r');
  h.key('Escape');
  h.select();
  await h.advance(5000);
  assert.equal(opens, 1);
  assert.equal(h.document.querySelector('.wa-improver-selected-message').dataset.id, 'a-2');
});

test('Changing chat cancels a pending action without clicking its new menu', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let clicks = 0;
  h.document.addEventListener('contextmenu', () => {
    h.window.setTimeout(() => h.menu(['Reply', 'Delete'], () => clicks++), 500);
  });
  h.select();
  h.key('d');
  h.document.querySelector('#main header span').setAttribute('title', 'Chat B');
  await h.advance(5000);
  assert.equal(clicks, 0);
  assert.equal(h.document.querySelector('.wa-improver-selected-message'), null);
});

test('A recycled row cannot silently become the selected action target', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let opens = 0;
  h.document.addEventListener('contextmenu', () => opens++);
  h.select();
  h.document.querySelector('[data-id="a-2"]').dataset.id = 'a-3';
  h.key('d');
  await h.advance(5000);
  assert.equal(opens, 0);
});

test('A new DOM row with the same message id retains the selection', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let replies = 0;
  h.document.addEventListener('contextmenu', () => h.menu(['Reply', 'Delete'], (_, menu) => {
    replies++;
    menu.remove();
  }));
  h.select();
  const row = h.document.querySelector('[data-id="a-2"]');
  row.replaceWith(row.cloneNode(true));
  h.key('r');
  await h.advance(500);
  assert.equal(replies, 1);
});

test('A slow action is never clicked twice and unavailable actions stay selected', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let clicks = 0;
  h.document.addEventListener('contextmenu', () => h.menu(['Reply', 'Delete'], () => clicks++));
  h.select();
  h.key('r');
  h.key('r', { repeat: true });
  await h.advance(5000);
  assert.equal(clicks, 1);
  assert.ok(h.document.querySelector('.wa-improver-selected-message'));
});

test('A missing menu never activates a Delete button elsewhere', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const button = h.document.createElement('button');
  button.setAttribute('role', 'button');
  button.textContent = 'Delete for everyone';
  h.document.body.appendChild(button);
  let deletes = 0;
  button.addEventListener('click', () => deletes++);
  h.composer.blur();
  h.key('d');
  assert.equal(deletes, 0);
});

test('Ctrl+R and IME ArrowUp do not invoke message shortcuts', async (t) => {
  const h = setup(t);
  await h.advance(0);
  h.composer.focus();
  h.key('ArrowUp', { isComposing: true });
  assert.equal(h.document.querySelector('.wa-improver-selected-message'), null);
  h.select();
  let opens = 0;
  h.document.addEventListener('contextmenu', () => opens++);
  h.key('r', { ctrlKey: true });
  assert.equal(opens, 0);
});

test('/gif waits for slow tabs and search, removing a restored lone slash', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const picker = h.installPicker({ delay: 500, searchDelay: 600 });
  h.command('/gif cats');
  await h.advance(30);
  assert.equal(h.composer.textContent, '');
  await h.advance(250);
  h.composer.innerHTML = '<p><br></p><span>/</span>';
  await h.advance(2000);
  assert.equal(h.composer.textContent, '');
  assert.equal(picker.opens(), 1);
  assert.equal(picker.switches(), 1);
  assert.equal(picker.field().value, 'cats');
  assert.equal(h.document.activeElement, picker.field());
  assert.equal(h.sends(), 0);
});

test('A new draft after /gif is preserved even before the deferred opening', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const picker = h.installPicker();
  h.command('/gif cats');
  h.userEvent('beforeinput');
  h.composer.textContent = 'New draft';
  h.userEvent('input');
  await h.advance(5000);
  assert.equal(h.composer.textContent, 'New draft');
  assert.equal(picker.opens(), 0);
  assert.equal(h.sends(), 0);
});

test('A newly typed slash command is not erased by the old command cleanup', async (t) => {
  const h = setup(t);
  await h.advance(0);
  h.installPicker({ delay: 500 });
  h.command('/gif cats');
  h.userEvent('beforeinput');
  h.composer.textContent = '/gif dogs';
  h.userEvent('input');
  await h.advance(5000);
  assert.equal(h.composer.textContent, '/gif dogs');
  assert.equal(h.sends(), 0);
});

test('Changing chat during /gif does not open or fill the other chat picker', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const picker = h.installPicker();
  h.command('/gif cats');
  h.document.querySelector('#main header span').setAttribute('title', 'Chat B');
  h.composer.textContent = 'Other chat draft';
  await h.advance(5000);
  assert.equal(picker.opens(), 0);
  assert.equal(h.composer.textContent, 'Other chat draft');
});

test('Escape prevents deferred GIF panel clicks', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const picker = h.installPicker({ delay: 500 });
  h.command('/gif cats');
  await h.advance(100);
  h.key('Escape');
  await h.advance(5000);
  assert.equal(picker.switches(), 0);
  assert.equal(h.sends(), 0);
});

test('/sticker waits for slow UI and does not overwrite subsequent search input', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const picker = h.installPicker({ delay: 800, searchDelay: 800, sticker: true });
  h.command('/sticker cats');
  await h.advance(2000);
  assert.equal(picker.field().value, 'cats');
  h.userEvent('beforeinput', picker.field());
  picker.field().value = 'dogs';
  await h.advance(5000);
  assert.equal(picker.field().value, 'dogs');
  assert.equal(h.sends(), 0);
});

test('Multiline composer cleanup removes text outside paragraphs too', async (t) => {
  const h = setup(t);
  await h.advance(0);
  h.composer.innerHTML = '<p>/gif cats</p><p>and dogs</p><span>/</span>';
  h.composer.focus();
  h.key('Enter');
  await h.advance(30);
  assert.equal(h.composer.textContent, '');
  assert.equal(h.composer.querySelectorAll('p').length, 1);
  assert.equal(h.sends(), 0);
});

test('Sidebar search is never treated as the message composer', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const search = h.document.querySelector('#chat-search');
  search.value = '/gif cats';
  search.focus();
  h.key('ArrowUp');
  assert.equal(h.document.querySelector('.wa-improver-selected-message'), null);
  h.key('Enter');
  await h.advance(500);
  assert.equal(search.value, '/gif cats');
  assert.equal(h.composer.textContent, 'My unsent draft');
});

test('/gif cleanup handles truncated restored commands without clearing new text', async (t) => {
  const h = setup(t);
  await h.advance(0);
  const picker = h.installPicker({ delay: 500 });
  h.command('/gif cats');
  h.composer.textContent = '/gif cat';
  await h.advance(300);
  assert.equal(h.composer.textContent, '');
  await h.advance(1000);
  assert.equal(picker.field().value, 'cats');
  h.userEvent('beforeinput');
  h.composer.textContent = '/gif cat'; // Same prefix, but now actually typed by the user.
  await h.advance(3000);
  assert.equal(h.composer.textContent, '/gif cat');
  assert.equal(h.sends(), 0);
});

test('A managed editor consumes one deletion with the full command selected', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let deletions = 0;
  h.composer.addEventListener('beforeinput', (event) => {
    assert.equal(h.window.getSelection().toString(), '/gif cats');
    event.preventDefault();
    deletions++;
    h.composer.textContent = '';
  });
  h.command('/gif cats');
  await h.advance(500);
  assert.equal(deletions, 1);
  assert.equal(h.composer.textContent, '');
  assert.equal(h.sends(), 0);
});

test('Tab replaces an incomplete command in a managed editor without duplicating it', async (t) => {
  const h = setup(t);
  await h.advance(0);
  let insertions = 0;
  h.composer.setAttribute('data-lexical-editor', 'true');
  h.composer.addEventListener('beforeinput', (event) => {
    if (event.inputType !== 'insertText') return;
    assert.equal(h.window.getSelection().toString(), '/g');
    // WhatsApp's Lexical editor processes this without cancelling the event.
    insertions++;
    h.composer.textContent = event.data;
  });
  h.composer.textContent = '/g';
  h.composer.focus();
  h.userEvent('input');
  h.key('Tab');
  await h.advance(100);
  assert.equal(insertions, 1);
  assert.equal(h.composer.textContent, '/gif ');
  assert.match(h.document.querySelector('#wa-improver-slash-menu').textContent, /search text/);
  assert.equal(h.sends(), 0);
});

test('Typing while command completion is pending preserves the new draft', async (t) => {
  const h = setup(t);
  await h.advance(0);
  h.composer.textContent = '/g';
  h.composer.focus();
  h.userEvent('input');
  h.key('Tab');
  h.userEvent('beforeinput');
  h.composer.textContent = 'New draft';
  h.userEvent('input');
  await h.advance(500);
  assert.equal(h.composer.textContent, 'New draft');
  assert.equal(h.sends(), 0);
});

test('Native command insertion is not followed by another synthetic insertText event', async (t) => {
  const h = setup(t);
  await h.advance(0);
  h.composer.setAttribute('data-lexical-editor', 'true');
  let nativeInsertions = 0;
  let duplicateEvents = 0;
  h.document.execCommand = (command, _, text) => {
    if (command !== 'insertText') return true;
    nativeInsertions++;
    h.composer.textContent = text;
    h.composer.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    return true;
  };
  h.composer.addEventListener('input', (event) => {
    if (event.inputType === 'insertText') duplicateEvents++;
  });
  h.composer.textContent = '/g';
  h.composer.focus();
  h.userEvent('input');
  h.key('Tab');
  await h.advance(100);
  assert.equal(nativeInsertions, 1);
  assert.equal(duplicateEvents, 0);
  assert.equal(h.composer.textContent, '/gif ');
  assert.equal(h.sends(), 0);
});
