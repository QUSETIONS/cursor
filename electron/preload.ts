const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script — securely exposes IPC to renderer process.
 * Only whitelisted methods are available. No Node.js access in renderer.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  once: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args));
  },
});
