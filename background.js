// Background script for Copy, Paste, Forget (MV3)

let clearTimer = null;
let settings = { interval: 10, enabled: true, clearOnlyOnPasswordPaste: false };
let settingsInitialized = false;
let settingsInitPromise = null;

// Load settings on startup/installation
chrome.runtime.onStartup.addListener(loadSettings);
chrome.runtime.onInstalled.addListener(loadSettings);

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get([
      'clipboardInterval',
      'extensionEnabled',
      'clearOnlyOnPasswordPaste',
    ]);
    settings.interval = result.clipboardInterval || 10;
    settings.enabled = result.extensionEnabled !== false;
    settings.clearOnlyOnPasswordPaste = Boolean(result.clearOnlyOnPasswordPaste);
    settingsInitialized = true;
  } 
  catch (error) {
    console.log('[Copy, Paste, Forget] Error loading settings:', error);
    settings = { interval: 10, enabled: true, clearOnlyOnPasswordPaste: false };
    settingsInitialized = true;
  }
}

function ensureSettingsLoaded() {
  if (settingsInitialized) return Promise.resolve();
  if (settingsInitPromise) return settingsInitPromise;
  settingsInitPromise = loadSettings().finally(() => {
    settingsInitPromise = null;
  });
  return settingsInitPromise;
}

// Message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'PASTE_DETECTED': {
      if (settings.enabled) {
        const isPassword = Boolean(message.isPassword);
        if (!settings.clearOnlyOnPasswordPaste || isPassword) {
          handlePasteEvent();
        }
      }
      sendResponse({ success: true });
      return; // sync response
    }
    case 'GET_SETTINGS': {
      // Ensure settings are loaded before responding
      if (settingsInitialized) {
        sendResponse(settings);
        return; // sync
      }
      ensureSettingsLoaded().then(() => sendResponse(settings));
      return true; // async
    }
    case 'TOGGLE_EXTENSION': {
      try {
        settings.enabled = Boolean(message.enabled);
        if (!settings.enabled && clearTimer) {
          clearTimeout(clearTimer);
          clearTimer = null;
          chrome.action.setBadgeText({ text: '' });
        }
        if (!settings.enabled) {
          chrome.action.setBadgeText({ text: 'OFF' });
          chrome.action.setBadgeBackgroundColor({ color: '#888' });
          setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
        } else {
          chrome.action.setBadgeText({ text: '' });
        }
        chrome.storage.sync.set({ extensionEnabled: settings.enabled }).catch(() => {});
        sendResponse({ success: true });
      } 
      catch (error) {
        console.error('[Copy, Paste, Forget] Toggle error:', error);
        sendResponse({ success: false, error: error.message });
      }
      return; // sync response
    }
    case 'UPDATE_SETTINGS': {
      updateSettings(Number(message.interval))
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true; // async
    }
    case 'UPDATE_PASSWORD_ONLY': {
      (async () => {
        try {
          const value = Boolean(message.value);
          settings.clearOnlyOnPasswordPaste = value;
          await chrome.storage.sync.set({ clearOnlyOnPasswordPaste: value });
          sendResponse({ success: true });
        } catch (error) {
          console.error('[Copy, Paste, Forget] Error updating password-only setting:', error);
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true; // async
    }
    case 'CLEAR_CLIPBOARD_NOW': {
      if (!settings.enabled) {
        sendResponse({ success: false, message: 'Extension is disabled' });
        return; // sync response
      }
      clearClipboard()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true; // async
    }
    default: {
      sendResponse({ success: false, error: 'Unknown message type' });
      return; // sync response
    }
  }
});

function handlePasteEvent() {
  if (clearTimer) clearTimeout(clearTimer);

  let timeLeft = settings.interval;
  chrome.action.setBadgeText({ text: timeLeft.toString() });
  chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });

  const countdownInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) {
      chrome.action.setBadgeText({ text: timeLeft.toString() });
    } else {
      clearInterval(countdownInterval);
    }
  }, 1000);

  clearTimer = setTimeout(() => {
    clearInterval(countdownInterval);
    clearClipboard();
  }, settings.interval * 1000);
}

async function clearClipboard() {
  try {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }

    // Try active tab first
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length && tabs[0].url && !tabs[0].url.startsWith('chrome://')) {
        await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: clearClipboardInTab });
        showClearedBadge();
        return;
      }
    } 
    catch (e) {}

    // Fallback: any suitable tab
    try {
      const allTabs = await chrome.tabs.query({});
      const suitableTabs = allTabs.filter((tab) =>
        tab.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:') &&
        !tab.url.startsWith('moz-extension://')
      );
      if (suitableTabs.length > 0) {
        await chrome.scripting.executeScript({ target: { tabId: suitableTabs[0].id }, func: clearClipboardInTab });
        showClearedBadge();
        return;
      }
    } 
    catch (e) {}

    // Last resort: ask any content script
    try {
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_CLIPBOARD_REQUEST' });
            if (response && response.success) {
              showClearedBadge();
              return;
            }
          } 
          catch (e) {}
        }
      }
    } 
    catch (e) {}

    // Try offscreen document fallback
    if (await clearClipboardOffscreen()) {
      showClearedBadge();
      return;
    }

    console.error('[Copy, Paste, Forget] No suitable context available to clear clipboard');
  } 
  catch (error) {
    console.error('[Copy, Paste, Forget] Error in clearClipboard:', error);
  }
}

function clearClipboardInTab() {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('').catch((err) => {
        console.log('[Copy, Paste, Forget] Modern API failed, trying fallback:', err);
        clearWithExecCommand();
      });
    } else {
      clearWithExecCommand();
    }

    function clearWithExecCommand() {
      try {
        const textarea = document.createElement('textarea');
        // Use a single space to ensure a non-empty selection is copied
        textarea.value = ' ';
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!success) {
          console.log('[Copy, Paste, Forget] execCommand failed');
        } else {
          // If possible, overwrite with a truly empty string using modern API
          try { navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText(''); } catch (_) {}
        }
      } 
      catch (execError) {
        console.log('[Copy, Paste, Forget] execCommand method failed:', execError);
      }
    }
  } 
  catch (error) {
    console.log('[Copy, Paste, Forget] Error in clearClipboardInTab:', error);
  }
}

function showClearedBadge() {
  chrome.action.setBadgeText({ text: 'OK' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
}

async function updateSettings(newInterval) {
  settings.interval = newInterval;
  try {
    await chrome.storage.sync.set({ clipboardInterval: newInterval });
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => clearClipboard(), settings.interval * 1000);
    }
  } 
  catch (error) {
    console.error('[Copy, Paste, Forget] Error saving settings:', error);
  }
}

async function ensureOffscreen() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) return false;
  try {
    const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Clear clipboard when no tabs available',
      });
    }
    // Wait for offscreen to be responsive
    const ready = await pingOffscreen(5, 200);
    return !!ready;
  } 
  catch (_) {
    return false;
  }
}

async function clearClipboardOffscreen() {
  const ready = await ensureOffscreen();
  if (!ready) {
    // Fallback: ephemeral tab
    try {
      let tab;
      try {
        tab = await chrome.tabs.create({ url: chrome.runtime.getURL('offscreen.html'), active: false });
      } 
      catch (_) {
        // If no window exists, create a minimized popup window
        const win = await chrome.windows.create({
          url: chrome.runtime.getURL('offscreen.html'),
          type: 'popup',
          focused: false,
          state: 'minimized',
          width: 200,
          height: 120,
        });
        await new Promise((r) => setTimeout(r, 800));
        try { if (win && win.id) await chrome.windows.remove(win.id); } catch (_) {}
        return true;
      }
      // Give it a moment to run, then close
      await new Promise((r) => setTimeout(r, 700));
      if (tab && tab.id) {
        try { await chrome.tabs.remove(tab.id); } catch (_) {}
      }
      return true; // best effort
    } 
    catch (_) {
      return false;
    }
  }

  // Ask offscreen document to clear clipboard
  try {
    const send = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Offscreen timeout')), 3000);
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_CLEAR_CLIPBOARD' }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    let res;
    try {
      res = await send();
    } catch (e) {
      // Offscreen may not be fully ready; retry once after short delay
      await new Promise((r) => setTimeout(r, 500));
      res = await send();
    }
    if (res && res.success) {
      // Close when not needed
      if (chrome.offscreen && chrome.offscreen.closeDocument) {
        try { await chrome.offscreen.closeDocument(); } catch (_) {}
      }
      return true;
    }
  } 
  catch (_) {}
  // If offscreen did not respond, fall back to ephemeral window path
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('offscreen.html'),
      type: 'popup',
      focused: false,
      state: 'normal',
      width: 240,
      height: 160,
    });
    await new Promise((r) => setTimeout(r, 800));
    try { if (win && win.id) await chrome.windows.remove(win.id); } catch (_) {}
    return true;
  } 
  catch (_) {
    return false;
  }
}

function pingOffscreen(retries = 3, delay = 150) {
  const attempt = () => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(Boolean(response && response.success));
        }
      });
    } 
    catch (_) {
      resolve(false);
    }
  });
  return (async () => {
    for (let i = 0; i < retries; i++) {
      const ok = await attempt();
      if (ok) return true;
      await new Promise((r) => setTimeout(r, delay));
    }
    return false;
  })();
}
