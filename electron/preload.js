const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the window
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  send: (channel, data) => {
    // Whitelist safe channels
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});
