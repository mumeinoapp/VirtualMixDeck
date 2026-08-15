'use strict';

// VirtualMixDeck.Helper（.NETコンソールアプリ）を子プロセスとして常駐起動し、
// stdin/stdoutのJSON1行=1メッセージでコマンドをやり取りするブリッジ。
// プロトコル詳細は VirtualMixDeck/helper/Program.cs 参照。

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const { app } = require('electron');

let child = null;
let rl = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject }

function resolveHelperExePath() {
  // パッケージ後: electron-builderのextraResourcesで
  // resources/helper/VirtualMixDeck.Helper.exe に配置される（package.jsonのbuild.extraResources参照）。
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'helper', 'VirtualMixDeck.Helper.exe');
    if (fs.existsSync(packagedPath)) return packagedPath;
    throw new Error(`ヘルパーexeが見つかりません: ${packagedPath}`);
  }

  // 開発時: リポジトリ内のdotnet buildの出力先を直接参照する。
  const devPath = path.join(
    __dirname,
    '..',
    '..',
    'helper',
    'bin',
    'Debug',
    'net10.0-windows',
    'win-x64',
    'VirtualMixDeck.Helper.exe'
  );
  if (fs.existsSync(devPath)) return devPath;

  throw new Error(`ヘルパーexeが見つかりません: ${devPath}`);
}

function ensureStarted() {
  if (child) return;

  const exePath = resolveHelperExePath();
  child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

  rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // パース不能な行は無視（ログ等が混ざった場合の保険）
    }
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.data);
    else waiter.reject(new Error(msg.error || 'ヘルパーでエラーが発生しました'));
  });

  child.on('exit', () => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error('ヘルパープロセスが終了しました'));
    }
    pending.clear();
    child = null;
    rl = null;
  });

  child.stderr.on('data', (buf) => {
    console.error('[VirtualMixDeck.Helper]', buf.toString());
  });
}

function call(cmd, params = {}, timeoutMs = 5000) {
  ensureStarted();
  const id = String(nextId++);
  const payload = { id, cmd, ...params };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`ヘルパー呼び出しがタイムアウトしました: ${cmd}`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}

function shutdown() {
  if (child) child.kill();
}

module.exports = { call, shutdown };
