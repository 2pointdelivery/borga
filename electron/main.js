const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess = null;
const PORT = 13000;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

// Function to check if the Next.js server is up and responsive
function checkServerReady(callback) {
  let settled = false;
  const done = (ready) => {
    if (!settled) {
      settled = true;
      callback(ready);
    }
  };

  const req = http.request(
    SERVER_URL,
    { method: 'GET', timeout: 1000 },
    (res) => {
      // Any response (even redirect or auth prompt) means the server is running.
      // Drain the socket so it closes instead of idling into a keep-alive timeout.
      res.resume();
      done(true);
    }
  );

  req.on('error', () => done(false));

  req.on('timeout', () => {
    req.destroy();
    done(false);
  });

  req.end();
}

// Spawns the Next.js server
function startNextServer(onStarted) {
  const appPath = app.getAppPath();
  const isDev = !app.isPackaged;

  // If something is already serving on our port (e.g. a dev server the user
  // started in a terminal), don't spawn a duplicate — just attach to it.
  checkServerReady((ready) => {
    if (ready) {
      console.log(`Server already responding at ${SERVER_URL} — skipping spawn.`);
      onStarted();
      return;
    }

    console.log(`Starting Next.js server in ${isDev ? 'development' : 'production'} mode...`);
    console.log(`Working directory: ${appPath}`);

    // Run Next via the Electron binary in plain-Node mode. This makes the
    // packaged desktop app fully self-contained: no system Node.js, pnpm or
    // npm needs to be installed on the user's machine.
    const nextBin = path.join(appPath, 'node_modules', 'next', 'dist', 'bin', 'next');
    const isWin = process.platform === 'win32';

    // NOTE: in packaged mode appPath lives inside app.asar, which is not a
    // real directory — using it as spawn cwd makes CreateProcess fail with
    // ENOENT. cwd must be a real directory (userData), and the app dir is
    // passed as the positional [directory] argument to `next dev|start`
    // instead (Next reads asar paths fine through Electron's patched fs).
    const cwd = isDev ? appPath : app.getPath('userData');

    // Combine parent environment variables with child process
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

    try {
      serverProcess = spawn(process.execPath, [nextBin, isDev ? 'dev' : 'start', appPath, '-p', String(PORT)], {
        cwd: cwd,
        env: env,
        detached: !isWin, // Process group support for Unix/Mac graceful shutdown
      });

      serverProcess.stdout.on('data', (data) => {
        console.log(`[Next Server]: ${data.toString().trim()}`);
      });

      serverProcess.stderr.on('data', (data) => {
        console.error(`[Next Server Error]: ${data.toString().trim()}`);
      });

      serverProcess.on('close', (code) => {
        console.log(`Next.js server process exited with code ${code}`);
        serverProcess = null;
        if (code !== 0 && code !== null) {
          // The port may belong to a healthy server started elsewhere (e.g. a
          // dev server in a terminal, or a duplicate instance that lost the
          // single-instance race) — only surface an error if nothing serves.
          checkServerReady((ready) => {
            if (!ready) {
              dialog.showErrorBox(
                'Backend Server Error',
                `The Next.js backend process exited unexpectedly with code ${code}. Please make sure ports are clear and database is running.`
              );
            }
          });
        }
      });

      serverProcess.on('error', (err) => {
        console.error('Failed to start Next.js server:', err);
        dialog.showErrorBox(
          'Backend Startup Failed',
          `Could not spawn Next.js process: ${err.message}. Please check the application installation.`
        );
      });

      onStarted();
    } catch (err) {
      console.error('Exception starting Next.js server:', err);
    }
  });
}

// Graceful cleanup of Next.js server
function killNextServer() {
  if (!serverProcess) return;

  console.log('Terminating Next.js server process...');
  try {
    if (process.platform === 'win32') {
      // On Windows, use taskkill to kill the entire process tree
      exec(`taskkill /pid ${serverProcess.pid} /f /t`, (err) => {
        if (err) console.error('Error in taskkill:', err);
      });
    } else {
      // On Unix/Mac, kill the process group (minus prefix kills the group)
      process.kill(-serverProcess.pid, 'SIGKILL');
    }
  } catch (err) {
    console.error('Error killing Next.js server process:', err);
  }
  serverProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'Borga — AI Company OS',
    backgroundColor: '#09090b',
    show: false, // Don't show until ready-to-show
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // 1. First, load the high-fidelity local loading screen
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  
  // Show window as soon as loading.html is parsed and displayed
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 2. Poll the Next.js server until it starts responding
  let pollAttempts = 0;
  const maxAttempts = 60; // 60 seconds timeout
  const pollInterval = setInterval(() => {
    pollAttempts++;
    
    checkServerReady((isReady) => {
      if (isReady) {
        clearInterval(pollInterval);
        console.log(`Next.js server is ready at ${SERVER_URL}! Redirecting window...`);
        // Redirect main window to Next.js dashboard
        mainWindow.loadURL(SERVER_URL);
      } else if (pollAttempts >= maxAttempts) {
        clearInterval(pollInterval);
        console.error('Timeout waiting for Next.js server to start.');
        dialog.showMessageBoxSync(mainWindow, {
          type: 'error',
          title: 'Connection Timeout',
          message: 'The internal server took too long to respond. Please verify your database is running and try again.',
        });
        app.quit();
      }
    });
  }, 1000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('ready', () => {
    // Start (or attach to) the Next.js server, then show the window —
    // the window polls the port itself and swaps to the app when ready.
    startNextServer(() => {});
    createWindow();
  });
}

app.on('window-all-closed', () => {
  // On macOS it is common for apps and their menu bar to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up processes on quit
app.on('before-quit', () => {
  killNextServer();
});

// Fallback safety if the process exits unexpectedly
process.on('exit', () => {
  killNextServer();
});
