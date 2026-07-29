# WhatsApp Web Improver

A Chrome extension that adds configurable keyboard shortcuts to WhatsApp Web, similar to Slack's interface.

## Features

- **🔧 Fully Configurable**: Customize all keyboard shortcuts to your preference
- **⚡ Quick Actions**: Perform common actions with a single keypress
- **🎨 Beautiful Settings UI**: Easy-to-use popup dashboard with toggle switches
- **📌 Popup Dashboard**: Manage shortcuts and performance from the extension popup (auto-saves changes)
- **🌍 Multi-language Support**: Works with WhatsApp in different languages
- **🚀 Lightweight**: Fast and efficient, no performance impact

### Message Navigation

Press <kbd>↑</kbd> from an empty composer (or <kbd>Alt</kbd>+<kbd>↑</kbd> from anywhere, even mid-draft) to select the last message. Then:

| Key | What it does |
|-----|--------------|
| `↑` / `↓` | Move between messages |
| shortcut key | Run that action on the selected message |
| `Esc` | Exit and return focus to the composer |

Going past the newest message also exits. The extension swallows these keys before WhatsApp sees them, so its own arrow handling does not fight the selection.

Can be turned off under **Message Navigation** in the popup.

### Default Keyboard Shortcuts

| Key | Action | Description |
|-----|--------|-------------|
| `e` | Edit | Edit your own messages |
| `d` | Delete | Delete messages for everyone |
| `r` | Reply | Quick reply to any message |
| `f` | Forward | Forward message to another chat |
| `s` | Star | Add message to starred |
| `i` | Info | View message details and status |
| `c` | Copy | Copy message text to clipboard |
| `p` | Pin | Pin/unpin message in chat |

## Installation

### For Development/Testing

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the `WhatsappImprover` folder
5. The extension should now be loaded and active

## Usage

### Basic Usage

1. Go to [WhatsApp Web](https://web.whatsapp.com)
2. Press <kbd>↑</kbd> (empty composer) or <kbd>Alt</kbd>+<kbd>↑</kbd> to select a message
3. Press your configured shortcut key (e.g., `e` for edit)
4. The action is triggered automatically!

Right-clicking a message to open its context menu and then pressing the shortcut key still works too.

### Customizing Shortcuts

1. Click the extension icon to open the popup dashboard
2. Configure your preferred keyboard shortcuts
3. Toggle actions on/off as needed
4. Click "Reset Defaults" if you want to restore the original setup

## How It Works

- In navigation mode the extension opens the message's own context menu for you, then finds and clicks the matching item — retrying until the menu actually closes, which is how it knows the action landed
- It also monitors WhatsApp Web for context menus you open yourself, using a MutationObserver
- Works with multiple languages (English, Spanish, French, German, Italian)
- Settings are synced across your Chrome browsers using Chrome Sync

### Performance and auto-reload

WhatsApp Web grows heavy over a long session. Under **Performance** in the popup:

- **Memory Monitor** watches the JS heap every minute and trips at your MB limit *or* at 85% of the browser's heap limit, whichever comes first
- **Reload Automatically** reloads the tab by itself instead of only warning. It never reloads while you have an unsent draft or an active call, not within 5 minutes of page load, and not more than once every 15 minutes — those guards are what keep it from looping
- **Show Notification Before Reload** puts a 15-second cancellable banner in front of every automatic reload. Turn it off for a silent reload
- **Auto Reload (Daily)** reloads once per day at a time you pick

### Debug logging

Logs are off by default. In the DevTools console on WhatsApp Web:

```js
window.__WA_IMPROVER_DEBUG = true
```

## Limitations

- **Edit**: Only works on your own messages within WhatsApp's time limit (typically 15 minutes)
- **Delete**: Only your own messages can be deleted
- **Pin**: Limited to WhatsApp's pinning rules (max 3 pinned messages per chat)
- Some actions may not be available depending on message type (e.g., can't edit media files)

## Icon Files

The project includes `icon16.png` for UI use. You can add more sizes and wire them in `manifest.json` if you want branded extension icons in Chrome.

## Browser Support

- ✅ Chrome (tested)
- ✅ Edge (Chromium-based)
- ✅ Brave
- ✅ Any Chromium-based browser with Manifest V3 support

## Troubleshooting

### Extension not working?

1. Check that the extension is enabled in `chrome://extensions/`
2. Reload WhatsApp Web (F5)
3. Make sure you're right-clicking on messages (not other elements)
4. Open the browser console (F12), set `window.__WA_IMPROVER_DEBUG = true`, and look for "WhatsApp Web Improver" messages
5. Try the action manually first to confirm it's available for that message

### Shortcuts not triggering?

1. Open the extension popup and verify your shortcuts are enabled
2. Check for duplicate key assignments
3. Make sure you're not typing in an input field
4. A message must be selected (navigation mode) or a context menu must be open

### Settings not saving?

1. Check that Chrome Sync is enabled (Settings → Sync and Google services)
2. Try clicking "Reset to Defaults" and reconfiguring

## Development

### File Structure

```
WhatsappImprover/
├── manifest.json       # Extension configuration
├── content.js          # Main content script (runs on WhatsApp Web)
├── popup.html          # Popup dashboard HTML (also used as in-page panel)
├── popup.css           # Popup dashboard styles
├── options.js          # Settings logic for the popup
├── background.js       # Service worker
├── shared/             # Defaults shared by content script and popup
├── compat/             # WhatsApp Web DOM + composer adapters
├── actions/            # Message action resolution
└── README.md           # This file
```

### Extending the Extension

To add a new action:

1. Add the action to `DEFAULT_SHORTCUTS` in `shared/default-settings.js`
2. Add keywords for the action in `actionKeywords` in `content.js`
3. Add the UI elements in `popup.html`
4. Update the README

## Privacy

This extension:
- ✅ Does NOT collect any data
- ✅ Does NOT send any information to external servers
- ✅ Only stores your keyboard shortcut preferences locally
- ✅ Only runs on web.whatsapp.com
- ✅ Open source - you can review all the code

## Contributing

Found a bug or have a feature request? Contributions are welcome!

## License

MIT

---

Made with ❤️ for better WhatsApp Web experience
