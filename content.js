// Content script for detecting copy/paste events on web pages

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.clipboardSecurityInjected) {
    return;
  }
  window.clipboardSecurityInjected = true;
  
  // Track if we've already set up listeners to avoid duplicates
  let listenersSetup = false;
  
  // Track extension context validity
  let extensionContextValid = true;
  
  function setupListeners() {
    if (listenersSetup) return;
    listenersSetup = true;
    
    // Listen for keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardEvent, true);
    
    // Listen for copy events
    document.addEventListener('copy', handleCopyEvent, true);
    document.addEventListener('cut', handleCopyEvent, true);
    document.addEventListener('paste', handlePasteEvent, true);
    
    // Listen for clipboard API calls
    interceptClipboardAPI();
    
    // Listen for context menu copy/paste
    document.addEventListener('contextmenu', handleContextMenu, true);
    
    // Test extension context on startup
    testExtensionContext();
  }
  
  function testExtensionContext() {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        // Extension context is valid
        extensionContextValid = true;
      }
    } catch (error) {
      console.log('[Clipboard Security] Extension context invalid on startup');
      extensionContextValid = false;
    }
  }
  
  function handleKeyboardEvent(event) {
    // Detect Ctrl+C (copy) or Ctrl+X (cut)
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'x')) {
      notifyCopyEvent();
    }
    // Detect Ctrl+V (paste)
    else if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
      notifyPasteEvent();
    }
  }
  
  function handleCopyEvent(event) {
    notifyCopyEvent();
  }
  
  function handlePasteEvent(event) {
    notifyPasteEvent();
  }
  
  function handleContextMenu(event) {
    // Detect right-click context menu
    setTimeout(() => {
      // Listen for copy/paste from context menu
      const contextMenuListener = (e) => {
        if (e.type === 'copy' || e.type === 'cut') {
          notifyCopyEvent();
        } else if (e.type === 'paste') {
          notifyPasteEvent();
        }
        document.removeEventListener('copy', contextMenuListener, true);
        document.removeEventListener('cut', contextMenuListener, true);
        document.removeEventListener('paste', contextMenuListener, true);
      };
      
      document.addEventListener('copy', contextMenuListener, true);
      document.addEventListener('cut', contextMenuListener, true);
      document.addEventListener('paste', contextMenuListener, true);
    }, 100);
  }
  
  function interceptClipboardAPI() {
    // Intercept navigator.clipboard.writeText calls
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const originalWriteText = navigator.clipboard.writeText;
      navigator.clipboard.writeText = function(...args) {
        notifyCopyEvent();
        return originalWriteText.apply(this, args);
      };
    }
    
    // Intercept navigator.clipboard.write calls
    if (navigator.clipboard && navigator.clipboard.write) {
      const originalWrite = navigator.clipboard.write;
      navigator.clipboard.write = function(...args) {
        notifyCopyEvent();
        return originalWrite.apply(this, args);
      };
    }
    
    // Intercept navigator.clipboard.readText calls (indicates paste operation)
    if (navigator.clipboard && navigator.clipboard.readText) {
      const originalReadText = navigator.clipboard.readText;
      navigator.clipboard.readText = function(...args) {
        notifyPasteEvent();
        return originalReadText.apply(this, args);
      };
    }
    
    // Intercept document.execCommand for older browsers/extensions
    const originalExecCommand = document.execCommand;
    document.execCommand = function(command, ...args) {
      if (command === 'copy' || command === 'cut') {
        notifyCopyEvent();
      } else if (command === 'paste') {
        notifyPasteEvent();
      }
      return originalExecCommand.apply(this, [command, ...args]);
    };
  }
  
  function notifyCopyEvent() {
    if (!extensionContextValid) {
      console.log('[Clipboard Security] Skipping copy event - extension context invalid');
      return;
    }
    
    console.log('[Clipboard Security] Sending copy event to background');
    sendMessageSafely({
      type: 'COPY_DETECTED',
      timestamp: Date.now(),
      url: window.location.href
    });
  }
  
  function notifyPasteEvent() {
    if (!extensionContextValid) {
      console.log('[Clipboard Security] Skipping paste event - extension context invalid');
      return;
    }
    
    console.log('[Clipboard Security] Sending paste event to background');
    sendMessageSafely({
      type: 'PASTE_DETECTED',
      timestamp: Date.now(),
      url: window.location.href
    });
  }
  
  function sendMessageSafely(message) {
    try {
      // Check if chrome.runtime is available and extension context is valid
      if (!chrome.runtime || !chrome.runtime.id) {
        console.log('[Clipboard Security] Extension context invalidated, stopping notifications');
        extensionContextValid = false;
        return;
      }
      
      chrome.runtime.sendMessage(message, (response) => {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          
          // Handle context invalidation errors
          if (error.includes('Extension context invalidated') || 
              error.includes('Receiving end does not exist') ||
              error.includes('message port closed')) {
            console.log('[Clipboard Security] Extension context invalidated:', error);
            extensionContextValid = false;
            return;
          }
          
          console.log('[Clipboard Security] Runtime error:', error);
        }
        
        // Message sent successfully
        if (response) {
          console.log('[Clipboard Security] Message acknowledged by background script');
        }
      });
      
    } catch (error) {
      console.log('[Clipboard Security] Error sending message:', error.message);
      
      // Mark context as invalid if we get extension-related errors
      if (error.message.includes('Extension context invalidated') ||
          error.message.includes('chrome.runtime') ||
          error.message.includes('Invocation of form')) {
        console.log('[Clipboard Security] Marking extension context as invalid');
        extensionContextValid = false;
      }
    }
  }
  
  // Listen for messages from background script (for clipboard clearing)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CLEAR_CLIPBOARD_REQUEST') {
      try {
        clearClipboardInContent();
        sendResponse({ success: true });
      } catch (error) {
        console.log('[Clipboard Security] Error clearing clipboard in content script:', error);
        sendResponse({ success: false, error: error.message });
      }
    }
    return true; // Keep message channel open
  });
  
  function clearClipboardInContent() {
    try {
      console.log('[Clipboard Security] Clearing clipboard from content script');
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("").then(() => {
          console.log('[Clipboard Security] ✓ Clipboard cleared via content script');
        }).catch(err => {
          console.log('[Clipboard Security] Content script clipboard clear failed:', err);
        });
      } else {
        // Fallback method
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
          console.log('[Clipboard Security] ✓ Clipboard cleared via execCommand in content script');
        }
      }
    } catch (error) {
      console.log('[Clipboard Security] Error in clearClipboardInContent:', error);
      throw error;
    }
  }
  
  // Setup listeners when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupListeners);
  } else {
    setupListeners();
  }
  
  // Also setup immediately
  setupListeners();
  
  // Periodically check extension context validity
  setInterval(() => {
    if (extensionContextValid) {
      try {
        if (!chrome.runtime || !chrome.runtime.id) {
          console.log('[Clipboard Security] Extension context lost during periodic check');
          extensionContextValid = false;
        }
      } catch (error) {
        console.log('[Clipboard Security] Extension context lost during periodic check:', error.message);
        extensionContextValid = false;
      }
    }
  }, 30000); // Check every 30 seconds
  
})();