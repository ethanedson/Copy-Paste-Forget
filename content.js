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
  
  // Determine if an element is a password field
  function isPasswordField(el) {
    try {
      if (!el || !(el instanceof Element)) return false;
      if (el instanceof HTMLInputElement) {
        const type = (el.type || '').toLowerCase();
        if (type === 'password') return true;
        const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
        if (/(^|\s)(current-password|new-password)(\s|$)/.test(ac)) return true;
        const nameId = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
        if (nameId.includes('password')) return true;
        const css = getComputedStyle(el).getPropertyValue('-webkit-text-security');
        if (css && css.trim().toLowerCase() !== 'none') return true;
      }
      // Check ancestors in case of shadow roots or wrapping
      const ancestor = el.closest && el.closest('input,textarea,[contenteditable="true"]');
      if (ancestor && ancestor !== el) return isPasswordField(ancestor);
      return false;
    } catch (_) {
      return false;
    }
  }
  
  function getPasteTarget(event) {
    if (event && typeof event.composedPath === 'function') {
      const path = event.composedPath();
      if (Array.isArray(path) && path.length > 0) return path[0];
    }
    return (event && event.target) || document.activeElement || null;
  }
  
  function setupListeners() {
    if (listenersSetup) return;
    listenersSetup = true;
    
    // Listen for keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardEvent, true);
    
    // Listen for copy events
    document.addEventListener('paste', handlePasteEvent, true);
    
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
    } 
    catch (error) {
      console.log('[Copy, Paste, Forget] Extension context invalid on startup');
      extensionContextValid = false;
    }
  }
  
  function handlePasteEvent(event) {
    try {
      const target = getPasteTarget(event);
      const isPwd = isPasswordField(target);
      // Prefer reading text from the event clipboard data
      const text = (event && event.clipboardData)
        ? (event.clipboardData.getData && event.clipboardData.getData('text')) || ''
        : '';

      if (typeof text === 'string' && text.trim() !== '') {
        notifyPasteEvent(isPwd);
      } else {
        // Blank/whitespace-only paste; do not start countdown
      }
    } catch (e) {
      // Do nothing on failure to read paste content
    }
  }
  
  function handleContextMenu(event) {
    // Detect right-click context menu
    setTimeout(() => {
      // Listen for copy/paste from context menu
      const contextMenuListener = (e) => {
        if (e.type === 'paste') {
          // Reuse paste handler so we only notify on non-empty text
          handlePasteEvent(e);
        }
        document.removeEventListener('paste', contextMenuListener, true);
      };
      document.addEventListener('paste', contextMenuListener, true);
    }, 100);
  }
  
  function notifyPasteEvent(isPasswordFieldPaste = false) {
    if (!extensionContextValid) {
      console.log('[Copy, Paste, Forget] Skipping paste event - extension context invalid');
      return;
    }

    sendMessageSafely({
      type: 'PASTE_DETECTED',
      timestamp: Date.now(),
      isPassword: Boolean(isPasswordFieldPaste)
    });
  }
  
  function sendMessageSafely(message) {
    try {
      // Check if chrome.runtime is available and extension context is valid
      if (!chrome.runtime || !chrome.runtime.id) {
        console.log('[Copy, Paste, Forget] Extension context invalidated, stopping notifications');
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
            console.log('[Copy, Paste, Forget] Extension context invalidated:', error);
            extensionContextValid = false;
            return;
          }
          
          console.log('[Copy, Paste, Forget] Runtime error:', error);
        }
        
        // Message sent successfully
        if (response) {
        }
      });
      
    } 
    catch (error) {
      console.log('[Copy, Paste, Forget] Error sending message:', error.message);
      
      // Mark context as invalid if we get extension-related errors
      if (error.message.includes('Extension context invalidated') ||
          error.message.includes('chrome.runtime') ||
          error.message.includes('Invocation of form')) {
        console.log('[Copy, Paste, Forget] Marking extension context as invalid');
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
      } 
      catch (error) {
        console.log('[Copy, Paste, Forget] Error clearing clipboard in content script:', error);
        sendResponse({ success: false, error: error.message });
      }
    }
    return true; // Keep message channel open
  });
  
  function clearClipboardInContent() {
    try {
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("").then(() => {
        }).catch(err => {
          console.log('[Copy, Paste, Forget] Content script clipboard clear failed:', err);
        });
      } 
      else {
        // Fallback method
        const textarea = document.createElement('textarea');
        textarea.value = ' ';
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (success) {
        }
      }
    } 
    catch (error) {
      console.log('[Copy, Paste, Forget] Error in clearClipboardInContent:', error);
      throw error;
    }
  }
  
  // Setup listeners when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupListeners);
  } 
  else {
    setupListeners();
  }
  
  // Also setup immediately
  setupListeners();
  
  // Periodically check extension context validity
  setInterval(() => {
    if (extensionContextValid) {
      try {
        if (!chrome.runtime || !chrome.runtime.id) {
          console.log('[Copy, Paste, Forget] Extension context lost during periodic check');
          extensionContextValid = false;
        }
      } catch (error) {
        console.log('[Copy, Paste, Forget] Extension context lost during periodic check:', error.message);
        extensionContextValid = false;
      }
    }
  }, 30000); // Check every 30 seconds
  
})();
