document.addEventListener('DOMContentLoaded', async function() {
  // Get DOM elements
  const intervalInput = document.getElementById('intervalInput');
  const clearNowBtn = document.getElementById('clearNowBtn');
  const statusDiv = document.getElementById('status');
  const enableToggle = document.getElementById('enableToggle');
  const toggleText = document.getElementById('toggleText');
  const settingsContainer = document.getElementById('settingsContainer');
  const passwordOnlyToggle = document.getElementById('passwordOnlyToggle');
  const coffeeButton = document.getElementById('coffee');
  const COFFEE_LICENSE_URL = 'https://edsonresearchsystems.gumroad.com/l/coffee'
  
  // Assign link to coffee button
  coffeeButton.onclick = () => {
    chrome.tabs.create({url: COFFEE_LICENSE_URL});
  }

  // Check if all required elements exist
  if (!intervalInput || !clearNowBtn || !statusDiv || !enableToggle || !toggleText || !settingsContainer || !passwordOnlyToggle) {
    console.error('Some required DOM elements not found');
    return;
  }
  
  // Load current settings
  await loadCurrentSettings();
  
  // Event listeners
  clearNowBtn.addEventListener('click', clearClipboardNow);
  enableToggle.addEventListener('change', toggleExtension);
  passwordOnlyToggle.addEventListener('change', togglePasswordOnly);
  
  // Add click handler for the toggle container to make it clickable
  const toggleContainer = document.querySelector('.toggle-container');
  if (toggleContainer) {
    toggleContainer.addEventListener('click', function(e) {
      if (e.target !== enableToggle) {
        enableToggle.checked = !enableToggle.checked;
        toggleExtension();
      }
    });
  }
  
  intervalInput.addEventListener('change', autoSaveInterval);
  intervalInput.addEventListener('input', debounce(autoSaveInterval, 1000));

  async function loadCurrentSettings() {
    try {
      console.log('Loading current settings...');
      
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout loading settings'));
        }, 5000);
        
        chrome.runtime.sendMessage({
          type: 'GET_SETTINGS'
        }, (response) => {
          clearTimeout(timeoutId);
          
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      console.log('Settings response:', response);
      
      if (response) {
        if (typeof response.interval === 'number') {
          intervalInput.value = response.interval;
        }
        
        const enabled = Boolean(response.enabled);
        console.log('Setting toggle to:', enabled);
        
        enableToggle.checked = enabled;
        updateUI(enabled);
        
        // Initialize password-only toggle
        passwordOnlyToggle.checked = Boolean(response.clearOnlyOnPasswordPaste);
        
        console.log('Settings loaded successfully');
      } else {
        console.error('No response received from background script');
        enableToggle.checked = true;
        updateUI(true);
        intervalInput.value = 10;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      enableToggle.checked = true;
      updateUI(true);
      intervalInput.value = 10;
      showStatus('Using default settings - could not load saved settings', 'error');
    }
  }

  async function togglePasswordOnly() {
    const value = passwordOnlyToggle.checked;
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout saving option'));
        }, 5000);
        
        chrome.runtime.sendMessage({
          type: 'UPDATE_PASSWORD_ONLY',
          value
        }, (response) => {
          clearTimeout(timeoutId);
          
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response && response.success) {
        showStatus('Option saved', 'success', 1500);
      } else {
        showStatus('Error saving option', 'error');
      }
    } catch (error) {
      console.error('Error updating password-only option:', error);
      showStatus('Error saving option', 'error');
      passwordOnlyToggle.checked = !value; // revert on error
    }
  }
  
  async function toggleExtension() {
    const enabled = enableToggle.checked;
    console.log('Toggling extension to:', enabled);
    
    updateUI(enabled);
    
    try {
      console.log('Sending TOGGLE_EXTENSION message...');
      
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Message timeout - background script may not be responding'));
        }, 5000);
        
        chrome.runtime.sendMessage({
          type: 'TOGGLE_EXTENSION',
          enabled: enabled
        }, (response) => {
          clearTimeout(timeoutId);
          
          if (chrome.runtime.lastError) {
            console.error('Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('Received response:', response);
            resolve(response);
          }
        });
      });
      
      console.log('Toggle response received:', response);
      
      if (response && response.success) {
        showStatus(enabled ? 'Extension Enabled' : 'Extension Disabled', 'success');
        console.log('Toggle successful');
      } else {
        console.error('Toggle failed with response:', response);
        enableToggle.checked = !enabled;
        updateUI(!enabled);
        showStatus('Failed to update extension state', 'error');
      }
    } catch (error) {
      console.error('Error in toggleExtension:', error);
      enableToggle.checked = !enabled;
      updateUI(!enabled);
      showStatus('Error: ' + error.message, 'error');
    }
  }
  
  function updateUI(enabled) {
    toggleText.textContent = enabled ? 'Extension Enabled' : 'Extension Disabled';
    
    if (enabled) {
      settingsContainer.classList.remove('disabled');
      clearNowBtn.disabled = false;
    } else {
      settingsContainer.classList.add('disabled');
      clearNowBtn.disabled = true;
    }
  }
  
  async function autoSaveInterval() {
    const interval = parseInt(intervalInput.value);
    
    if (isNaN(interval) || interval < 1 || interval > 300) {
      showStatus('Please enter a valid interval (1-300 seconds)', 'error');
      return;
    }
    
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout saving settings'));
        }, 5000);
        
        chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          interval: interval
        }, (response) => {
          clearTimeout(timeoutId);
          
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response && response.success) {
        showStatus('Settings auto-saved', 'success', 1500);
      } else {
        showStatus('Error saving settings', 'error');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      showStatus('Error saving settings', 'error');
    }
  }
  
  async function clearClipboardNow() {
    try {
      clearNowBtn.disabled = true;
      clearNowBtn.textContent = 'Clearing...';
      
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout clearing clipboard'));
        }, 5000);
        
        chrome.runtime.sendMessage({
          type: 'CLEAR_CLIPBOARD_NOW'
        }, (response) => {
          clearTimeout(timeoutId);
          
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response && response.success) {
        showStatus('Clipboard cleared!', 'success');
      } else {
        showStatus(response.message || 'Error clearing clipboard', 'error');
      }
    } catch (error) {
      console.error('Error clearing clipboard:', error);
      showStatus('Error clearing clipboard', 'error');
    } finally {
      clearNowBtn.disabled = false;
      clearNowBtn.textContent = 'Clear Now';
    }
  }
  
  function showStatus(message, type, timeout = 3000) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, timeout);
  }
  
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
});
