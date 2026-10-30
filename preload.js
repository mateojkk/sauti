// Safe bridge between the sandboxed UI and Electron's native dialogs.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sauti', {
    /** Opens the native save dialog and writes the content where the user picks. */
    saveToFile: (content, fileName) => ipcRenderer.invoke('sauti-save-to-file', { content, fileName }),
});
