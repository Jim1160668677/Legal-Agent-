import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

function initDataDir() {
  const dataDir = path.join(app.getPath('appData'), 'legal-agent', 'data');
  const dbPath = path.join(dataDir, 'mongodb');
  const backupPath = path.join(dataDir, 'backups');

  // 创建目录
  fs.mkdirSync(dbPath, { recursive: true });
  fs.mkdirSync(backupPath, { recursive: true });

  console.log(`Data directory initialized: ${dataDir}`);
  return { dataDir, dbPath, backupPath };
}

export default initDataDir;
