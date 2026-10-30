// Sauti desktop shell. Boots the local QVAC server, then opens it in a native window.
// Run with: npm run app  (requires `node` on PATH for the child server)
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { app, BrowserWindow, Menu, dialog } from 'electron';

const ROOT = app.getAppPath();
const PORT = 8787;
const URL = `http://127.0.0.1:${PORT}`;

let win;
let child;
let quitting = false;

const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(URL);
            if (res.ok) return true;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
};

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        Menu.setApplicationMenu(null);
        child = spawn('node', ['src/server.js'], {
            cwd: ROOT,
            env: { ...process.env, QVAC_CONFIG_PATH: join(ROOT, 'qvac.config.json') },
            stdio: 'ignore',
        });
        child.on('exit', (code) => {
            if (quitting) return;
            dialog.showErrorBox('Sauti', `The local engine exited unexpectedly (code ${code}). Please close the app and start it again.`);
            app.exit(1);
        });
        if (!(await waitReady())) {
            dialog.showErrorBox('Sauti', 'The local engine did not respond on port 8787. Is another Sauti already running?');
            app.exit(1);
            return;
        }
        win = new BrowserWindow({
            width: 1440,
            height: 950,
            minWidth: 1040,
            minHeight: 640,
            title: 'Sauti',
            backgroundColor: '#0b0910',
            icon: join(ROOT, 'public', 'icon.png'),
            autoHideMenuBar: true,
            show: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        win.on('close', () => { quitting = true; });
        win.once('ready-to-show', () => win.show());
        win.on('page-title-updated', (e) => e.preventDefault()); // keep "Sauti"
        win.loadURL(URL);
        // Refresh keys: the app menu is null, so F5 / Ctrl+R must be re-bound here.
        win.webContents.on('before-input-event', (e, input) => {
            if (input.type !== 'keyDown') return;
            const r = input.key.toLowerCase() === 'r';
            if (input.key === 'F5' || (r && input.control)) {
                win.webContents.reload();
                e.preventDefault();
            }
        });
    });
}

app.on('before-quit', () => {
    quitting = true;
    try { child?.kill('SIGTERM'); } catch {}
});
app.on('window-all-closed', () => app.quit());
