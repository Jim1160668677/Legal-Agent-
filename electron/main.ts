import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let nestjsProcess: ChildProcess | null = null;
let mongoProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startMongo() {
  const dataDir = path.join(app.getPath('appData'), 'legal-agent', 'data');
  const dbPath = path.join(dataDir, 'mongodb');

  fs.mkdirSync(dbPath, { recursive: true });

  mongoProcess = spawn('mongod', [
    '--dbpath', dbPath,
    '--port', '27017',
    '--bind_ip', '127.0.0.1',
    '--journal'
  ], {
    stdio: 'ignore',
    detached: true
  });

  mongoProcess.on('error', (err) => {
    console.error('MongoDB spawn error:', err);
  });

  console.log(`MongoDB started, data dir: ${dbPath}`);
}

function startNestJS() {
  const distPath = path.join(__dirname, '../dist');

  nestjsProcess = spawn('node', ['dist/main.js'], {
    cwd: distPath,
    env: {
      ...process.env,
      NODE_ENV: 'local',
      MONGO_URI: 'mongodb://127.0.0.1:27017/legal-agent',
      REDIS_URL: '',
      JWT_SECRET: 'local-dev-secret-change-me',
      CORS_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173',
    },
    stdio: 'inherit'
  });

  nestjsProcess.on('error', (err) => {
    console.error('NestJS spawn error:', err);
  });

  nestjsProcess.on('exit', (code) => {
    console.log(`NestJS exited with code ${code}`);
  });

  console.log('NestJS started');
}

app.whenReady().then(() => {
  startMongo();
  startNestJS();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (nestjsProcess) {
    nestjsProcess.kill();
  }
  if (mongoProcess) {
    mongoProcess.kill();
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-server-status', () => {
  return {
    mongo: mongoProcess ? 'running' : 'stopped',
    nestjs: nestjsProcess ? 'running' : 'stopped',
  };
});

ipcMain.handle('restart-server', () => {
  if (nestjsProcess) {
    nestjsProcess.kill();
  }
  if (mongoProcess) {
    mongoProcess.kill();
  }
  startMongo();
  startNestJS();
  return { ok: true };
});
