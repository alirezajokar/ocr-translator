'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// This is the ENTIRE API surface any renderer (popup or settings window) will ever
// see. contextIsolation is on and nodeIntegration is off, so this is the only bridge
// between untrusted web content and the privileged main process — every function here
// is a narrow, specific verb, never a generic passthrough (no "readFile", no raw
// "ipcRenderer.invoke" exposed directly).

const VALID_UPDATE_TYPES = new Set(['status', 'cancelled', 'error', 'result']);

contextBridge.exposeInMainWorld('api', {
  // -- capture flow --
  triggerCapture: () => ipcRenderer.invoke('capture:start'),

  // Subscribe to push updates about an in-flight capture (status/cancelled/error/result).
  // Returns an unsubscribe function. Only ever forwards the one 'capture:update' channel —
  // the renderer cannot listen to arbitrary main-process events through this bridge.
  onCaptureUpdate: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      if (payload && VALID_UPDATE_TYPES.has(payload.type)) {
        callback(payload);
      }
    };
    ipcRenderer.on('capture:update', listener);
    return () => ipcRenderer.removeListener('capture:update', listener);
  },

  // -- settings --
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // -- on-demand translation (popup's "Translate" button) --
  translateNow: (text) => ipcRenderer.invoke('translate:start', text),

  // -- misc window/util actions --
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:copy', text),
  closePopup: () => ipcRenderer.invoke('popup:close'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
});
