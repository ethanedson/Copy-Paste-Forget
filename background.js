// Background script for clipboard security extension

let clearTimer = null;
let settings = { interval: 10, enabled: true, clearOnlyOnPasswordPaste: false };

// Load settings on startup
chrome.runtime.onStartup.addListener(loadSettings);
chrome.runtime.onInstalled.addListener(loadSettings);

async function loadSettings() {
  try {
    if (!chrome.storage || !chrome.storage.sync) {
      console.error('[Clipboard Security] Chrome storage API not available');
      return;
    }
    
    const result = await chrome.storage.sync.get(['clipboardInterval', 'extensionEnabled', 'clearOnlyOnPasswordPaste']);
    console.log('[Clipboard Security] Loaded settings from storage:', result);
    
    settings.interval = result.clipboardInterval || 10;
    settings.enabled = result.extensionEnabled !== false;
    settings.clearOnlyOnPasswordPaste = Boolean(result.clearOnlyOnPasswordPaste);
    
    console.log('[Clipboard Security] Final settings:', settings);
  } catch (error) {
    console.log('[Clipboard Security] Error loading settings:', error);
    settings.interval = 10;
    settings.enabled = true;
  }
}

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.type, message);
  
  if (message.type === 'COPY_DETECTED') {
    if (settings.enabled) {
      handleCopyEvent();
    }
    sendResponse({ success: true });
    return;
  }
  
  if (message.type === 'PASTE_DETECTED') {
    if (settings.enabled) {
      const isPassword = Boolean(message.isPassword);
      if (!settings.clearOnlyOnPasswordPaste || isPassword) {
        handlePasteEvent();
      } else {
        console.log('[Background] Paste detected but skipping due to password-only setting');
      }
    }
    sendResponse({ success: true });
    return;
  }
  
  if (message.type === 'GET_SETTINGS') {
    console.log('[Background] Sending settings:', settings);
    sendResponse(settings);
    return;
  }
  
  if (message.type === 'TOGGLE_EXTENSION') {
    console.log('[Background] Processing toggle to:', message.enabled);
    
    try {
      settings.enabled = message.enabled;
      console.log('[Background] Settings updated in memory');
      
      if (!message.enabled && clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
        chrome.action.setBadgeText({ text: "" });
        console.log('[Background] Cleared timer');
      }
      
      if (!message.enabled) {
        chrome.action.setBadgeText({ text: "❌" });
        chrome.action.setBadgeBackgroundColor({ color: "#888" });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: "" });
        }, 2000);
      } else {
        chrome.action.setBadgeText({ text: "" });
      }
      
      chrome.storage.sync.set({ extensionEnabled: message.enabled }).catch(err => {
        console.warn('[Background] Storage save failed:', err);
      });
      
      console.log('[Background] Toggle completed, sending success');
      sendResponse({ success: true });
      
    } catch (error) {
      console.error('[Background] Toggle error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return;
  }
  
  if (message.type === 'UPDATE_SETTINGS') {
    console.log('[Background] Updating interval to:', message.interval);
    
    updateSettings(message.interval)
      .then(() => {
        console.log('[Background] Settings updated successfully');
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('[Background] Error updating settings:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'UPDATE_PASSWORD_ONLY') {
    // Handle asynchronously and keep the message channel open
    (async () => {
      try {
        const value = Boolean(message.value);
        settings.clearOnlyOnPasswordPaste = value;
        await chrome.storage.sync.set({ clearOnlyOnPasswordPaste: value });
        console.log('[Background] Updated clearOnlyOnPasswordPaste to:', value);
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Background] Error updating password-only setting:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  
  if (message.type === 'CLEAR_CLIPBOARD_NOW') {
    if (settings.enabled) {
      clearClipboard()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    } else {
      sendResponse({ success: false, message: 'Extension is disabled' });
      return;
    }
  }
  
  console.log('[Background] Unknown message type:', message.type);
  sendResponse({ success: false, error: 'Unknown message type' });
});

function handleCopyEvent() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  
  console.log(`[Clipboard Security] Copy detected! Waiting for paste event to start timer`);
  
  chrome.action.setBadgeText({ text: "📋" });
  chrome.action.setBadgeBackgroundColor({ color: "#2196F3" });
}

function handlePasteEvent() {

  if (clearTimer) {
    clearTimeout(clearTimer);
  }
  
  console.log(`[Clipboard Security] Paste detected! Clipboard will be cleared in ${settings.interval} seconds`);
  
  let timeLeft = settings.interval;
  
  chrome.action.setBadgeText({ text: timeLeft.toString() });
  chrome.action.setBadgeBackgroundColor({ color: "#ff9800" });
  
  const countdownInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) {
      chrome.action.setBadgeText({ text: timeLeft.toString() });
      console.log(`[Clipboard Security] Countdown: ${timeLeft} seconds remaining`);
    } else {
      clearInterval(countdownInterval);
    }
  }, 1000);
  
  clearTimer = setTimeout(() => {
    clearInterval(countdownInterval);
    console.log('[Clipboard Security] Timer expired - clearing clipboard now!');
    clearClipboard();
  }, settings.interval * 1000);
}

async function clearClipboard() {
  try {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    
    console.log('[Clipboard Security] Attempting to clear clipboard...');
    
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0 && tabs[0].url && !tabs[0].url.startsWith('chrome://')) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: clearClipboardInTab
        });
        
        console.log('[Clipboard Security] Clipboard clear script injected into active tab');
        showClearedBadge();
        return;
      }
    } catch (error) {
      console.log('[Clipboard Security] Active tab method failed:', error);
    }
    
    try {
      const allTabs = await chrome.tabs.query({});
      const suitableTabs = allTabs.filter(tab => 
        tab.url && 
        !tab.url.startsWith('chrome://') && 
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('edge://') &&
        !tab.url.startsWith('about:') &&
        !tab.url.startsWith('moz-extension://')
      );
      
      if (suitableTabs.length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId: suitableTabs[0].id },
          func: clearClipboardInTab
        });
        
        console.log('[Clipboard Security] Clipboard clear script injected into fallback tab');
        showClearedBadge();
        return;
      }
    } catch (error) {
      console.log('[Clipboard Security] Fallback tab method failed:', error);
    }
    
    try {
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_CLIPBOARD_REQUEST' });
            if (response && response.success) {
              console.log('[Clipboard Security] Clipboard cleared via content script');
              showClearedBadge();
              return;
            }
          } catch (e) {
            // Continue to next tab
          }
        }
      }
    } catch (error) {
      console.log('[Clipboard Security] Content script method failed:', error);
    }
    
    console.error('[Clipboard Security] All clipboard clearing methods failed - no suitable tabs available');
    
  } catch (error) {
    console.error('[Clipboard Security] Error in clearClipboard:', error);
  }
}

function clearClipboardInTab() {
  try {
    console.log('[Clipboard Security] Attempting to clear clipboard in tab context');
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText("").then(() => {
        console.log('[Clipboard Security] ✓ Clipboard cleared with modern API');
      }).catch(err => {
        console.log('[Clipboard Security] Modern API failed, trying fallback:', err);
        clearWithExecCommand();
      });
    } else {
      console.log('[Clipboard Security] Modern clipboard API not available, using fallback');
      clearWithExecCommand();
    }
    
    function clearWithExecCommand() {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = '';
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        
        textarea.select();
        textarea.setSelectionRange(0, 0);
        
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (success) {
          console.log('[Clipboard Security] ✓ Clipboard cleared with execCommand');
        } else {
          console.log('[Clipboard Security] ✗ execCommand failed');
        }
      } catch (execError) {
        console.log('[Clipboard Security] ✗ execCommand method failed:', execError);
      }
    }
    
  } catch (error) {
    console.log('[Clipboard Security] ✗ Error in clearClipboardInTab:', error);
  }
}

function showClearedBadge() {
  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
  
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, 2000);
}

async function updateSettings(newInterval) {
  settings.interval = newInterval;
  try {
    await chrome.storage.sync.set({ clipboardInterval: newInterval });
    
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearClipboard();
      }, settings.interval * 1000);
    }
  } catch (error) {
    console.error('[Clipboard Security] Error saving settings:', error);
  }
}

// Handle keyboard shortcuts globally
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'copy-detected' && settings.enabled) {
      handleCopyEvent();
    }
  });
}

// Listen for tab updates to inject content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(() => {
      // Ignore errors
    });
  }
});
