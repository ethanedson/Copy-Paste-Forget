// Offscreen document script: clears clipboard on request

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'OFFSCREEN_PING') {
    sendResponse({ success: true });
    return true;
  }
  if (message && message.type === 'OFFSCREEN_CLEAR_CLIPBOARD') {
    clearClipboard()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e && e.message }));
    return true; // async
  }
});

async function clearClipboard() {
  // Try modern API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText('');
      return;
    } 
    catch (e) {
      // Fall back
    }
  }

  // Try event-driven copy override to force truly empty clipboard
  try {
    await setClipboardEmptyViaCopyEvent();
    return;
  } 
  catch (_) {}

  // Fallback to execCommand with non-empty overwrite then try empty
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea');
      // Use a single space so there is a non-empty selection to copy
      textarea.value = ' ';
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        // Overwrite with true empty if possible
        try { navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText(''); } catch (_) {}
        resolve();
      } else {
        reject(new Error('execCommand failed'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

function setClipboardEmptyViaCopyEvent() {
  return new Promise((resolve, reject) => {
    const handler = (e) => {
      try {
        e.clipboardData.setData('text/plain', '');
        e.preventDefault();
        resolve(true);
      } catch (err) {
        reject(err);
      }
    };
    document.addEventListener('copy', handler, { once: true });
    const ok = document.execCommand('copy');
    if (!ok) {
      document.removeEventListener('copy', handler);
      reject(new Error('execCommand copy failed'));
    }
  });
}

// If opened as a regular tab (fallback), clear immediately then close
(async () => {
  try {
    await clearClipboard();
  } 
  catch (_) {}
  // Attempt to close if this is a visible tab
  try { window.close(); } catch (_) {}
})();
