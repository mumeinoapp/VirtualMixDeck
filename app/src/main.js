'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, protocol, dialog, nativeImage, net } = require('electron');

// カスタムプロトコル(vmd-icon://)はfile://同様の特権(secure/standard)をapp.whenReady()より前に
// 登録しておく必要がある（Electronの制約。whenReady後に呼んでもエラーにはならないが無効）。
protocol.registerSchemesAsPrivileged([
  { scheme: 'vmd-icon', privileges: { standard: false, secure: true, supportFetchAPI: true } },
]);

// リモート/仮想デスクトップ環境でGPUプロセスが不安定になりウィンドウが黒く描画される
// 問題を回避するため、環境変数VMD_NO_GPUが設定されている場合はハードウェアアクセラレーションを無効化する。
if (process.env.VMD_NO_GPU) {
  app.disableHardwareAcceleration();
}
// 新しめのChromiumのFluent系スクロールバーは::-webkit-scrollbarのカスタムCSSを
// 無視してOS標準見た目で描画してしまうため無効化し、常に自作デザインを反映させる。
app.commandLine.appendSwitch('disable-features', 'FluentScrollbar,FluentOverlayScrollbar');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Store = require('electron-store');
const helperBridge = require('./helperBridge');
const obsBridge = require('./obsBridge');
const waveLinkBridge = require('./waveLinkBridge');

const GRID_ROWS = 4;
const GRID_COLS = 5;
const ICONS_DIR = path.join(__dirname, 'renderer', 'assets', 'icons');
// ユーザーが設定したカスタム画像アイコンの保存先。プリセットSVGアイコン(ICONS_DIR、
// アプリ同梱)とは別に、userData配下（アンインストール後も残る書き込み可能領域）に置く。
const CUSTOM_ICONS_DIR = path.join(app.getPath('userData'), 'custom-icons');
const CUSTOM_ICON_SIZE = 128; // ボタン最大表示サイズ(160px)よりやや小さめ、HiDPI考慮
// vmd-icon://配信で許可するファイル名の形式。protocol.handle側のパストラバーサル対策として
// このパターンに一致しないリクエストは問答無用で拒否する。
const CUSTOM_ICON_NAME_RE = /^icon-[0-9a-f-]+\.png$/;

function ensureCustomIconsDir() {
  fs.mkdirSync(CUSTOM_ICONS_DIR, { recursive: true });
}

// 選択された画像ファイル(任意の絶対パス)をuserData配下へPNG化してコピーする。
// 常にPNGへ変換して保存することで、入力形式(jpg/gif/webp等)によらずvmd-icon://配信側の
// 実装を単純化できる。nativeImageは不正/未対応形式でも例外を投げず空画像を返すだけなので、
// isEmpty()で明示的にエラー扱いする。
function processCustomIconFile(sourcePath) {
  if (!sourcePath) return { ok: false, error: 'ファイルが選択されていません' };
  try {
    const img = nativeImage.createFromPath(sourcePath);
    if (img.isEmpty()) return { ok: false, error: '画像として読み込めませんでした（対応形式: PNG/JPG/GIF/WebP）' };
    const resized = img.resize({ width: CUSTOM_ICON_SIZE, height: CUSTOM_ICON_SIZE, quality: 'good' });
    ensureCustomIconsDir();
    const fileName = `icon-${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(CUSTOM_ICONS_DIR, fileName), resized.toPNG());
    return { ok: true, fileName };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// customIconの差し替え/削除時に古いファイルを掃除する。存在しなくてもエラーにしない。
function deleteCustomIconFile(fileName) {
  if (!fileName || !CUSTOM_ICON_NAME_RE.test(fileName)) return;
  try {
    fs.unlinkSync(path.join(CUSTOM_ICONS_DIR, fileName));
  } catch {
    // 既に存在しない場合等は無視
  }
}

const store = new Store({
  defaults: {
    activePageId: 'page-1',
    pages: [{ id: 'page-1', name: 'ページ1', buttons: [], autoNamed: true }],
    obsConnection: { url: 'ws://127.0.0.1:4455', password: '' },
    mixerEntries: [],
    presets: [],
    lastVolumeLevels: { process: {}, wavelink: {} },
  },
});

// 「ページ1」等の自動採番名がついたページだけ、ページの追加/削除のたびに
// 現在の並び順に応じて振り直す。ユーザーが手動リネームしたページ（autoNamed: false）は対象外。
function renumberAutoPages(pages) {
  let n = 0;
  for (const page of pages) {
    n++;
    if (page.autoNamed !== false) {
      page.name = `ページ${n}`;
    }
  }
  return pages;
}

function getConfig() {
  return {
    grid: { rows: GRID_ROWS, cols: GRID_COLS },
    activePageId: store.get('activePageId'),
    pages: store.get('pages'),
  };
}

// 注意：button.customIconファイルは、ボタンの上書き保存/削除時にここでは削除しない。
// プリセット（savePreset）がページ構成のスナップショットとしてcustomIconファイル名も
// 一緒に保存しているため、ボタン側だけを見て「もう参照されていない」と判断して削除すると、
// 過去に保存したプリセットを読み込んだ際にアイコン画像が失われてしまう。孤立ファイルは
// userData/custom-icons配下に残り続けるが、実害（誤動作）より安全側を優先した既知の制約。
function saveButton(pageId, button) {
  const pages = store.get('pages');
  const page = pages.find((p) => p.id === pageId);
  if (!page) return false;
  const idx = page.buttons.findIndex((b) => b.row === button.row && b.col === button.col);
  if (idx >= 0) {
    page.buttons[idx] = button;
  } else {
    page.buttons.push(button);
  }
  store.set('pages', pages);
  return true;
}

function removeButton(pageId, row, col) {
  const pages = store.get('pages');
  const page = pages.find((p) => p.id === pageId);
  if (!page) return false;
  page.buttons = page.buttons.filter((b) => !(b.row === row && b.col === col));
  store.set('pages', pages);
  return true;
}

// 編集モードでのドラッグ&ドロップ入れ替え用。移動先に既存ボタンがあれば位置を
// 交換し、空きマスならそこへ移動するだけにする（どちらも同じロジックで扱える）。
function swapButtons(pageId, from, to) {
  const pages = store.get('pages');
  const page = pages.find((p) => p.id === pageId);
  if (!page) return false;
  const fromBtn = page.buttons.find((b) => b.row === from.row && b.col === from.col);
  if (!fromBtn) return false;
  const toBtn = page.buttons.find((b) => b.row === to.row && b.col === to.col);
  if (toBtn) {
    toBtn.row = from.row;
    toBtn.col = from.col;
  }
  fromBtn.row = to.row;
  fromBtn.col = to.col;
  store.set('pages', pages);
  return true;
}

function setActivePage(pageId) {
  const pages = store.get('pages');
  if (!pages.some((p) => p.id === pageId)) return false;
  store.set('activePageId', pageId);
  return true;
}

function addPage(name) {
  const pages = store.get('pages');
  const id = `page-${crypto.randomUUID()}`;
  pages.push({ id, name: name || `ページ${pages.length + 1}`, buttons: [], autoNamed: !name });
  store.set('pages', renumberAutoPages(pages));
  store.set('activePageId', id);
  return id;
}

function removePage(pageId) {
  const pages = store.get('pages');
  if (pages.length <= 1) return false; // 最後の1ページは削除させない
  const next = pages.filter((p) => p.id !== pageId);
  store.set('pages', renumberAutoPages(next));
  if (store.get('activePageId') === pageId) store.set('activePageId', next[0].id);
  return true;
}

function renamePage(pageId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  const pages = store.get('pages');
  const page = pages.find((p) => p.id === pageId);
  if (!page) return false;
  page.name = trimmed;
  page.autoNamed = false; // 手動リネーム後は自動採番の対象から外す
  store.set('pages', pages);
  return true;
}

// --- プリセット（ページ構成一式のスナップショット保存/切替） ---
// electron-storeはdefaultsに無いキーでも自動補完するため、既存configに
// presetsキーが無くても store.get('presets') は [] を返す（マイグレーション不要）。
// ただしユーザーによる手動編集等でconfig.jsonが壊れているケースへの防御はしておく。

function listPresets() {
  const presets = store.get('presets');
  return Array.isArray(presets) ? presets : [];
}

function savePreset(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'プリセット名を入力してください' };
  const presets = listPresets();
  const preset = {
    id: `preset-${crypto.randomUUID()}`,
    name: trimmed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: JSON.parse(JSON.stringify(store.get('pages'))),
    activePageId: store.get('activePageId'),
  };
  presets.push(preset);
  store.set('presets', presets);
  return { ok: true, preset };
}

function updatePreset(presetId) {
  const presets = listPresets();
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: 'プリセットが見つかりません' };
  preset.pages = JSON.parse(JSON.stringify(store.get('pages')));
  preset.activePageId = store.get('activePageId');
  preset.updatedAt = Date.now();
  store.set('presets', presets);
  return { ok: true };
}

function renamePreset(presetId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { ok: false, error: 'プリセット名を入力してください' };
  const presets = listPresets();
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: 'プリセットが見つかりません' };
  preset.name = trimmed;
  store.set('presets', presets);
  return { ok: true };
}

function removePreset(presetId) {
  const presets = listPresets();
  store.set('presets', presets.filter((p) => p.id !== presetId));
  return true;
}

// プリセット読込時はページIDを新規UUIDへ再採番する。保存時のIDをそのまま復元すると、
// 同じプリセットを複数回読み込んだ場合や複数プリセット間でIDが衝突しうるため。
function loadPreset(presetId) {
  const presets = listPresets();
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return { ok: false, error: 'プリセットが見つかりません' };
  const clonedPages = JSON.parse(JSON.stringify(preset.pages));
  const idMap = new Map();
  const restoredPages = clonedPages.map((page) => {
    const newId = `page-${crypto.randomUUID()}`;
    idMap.set(page.id, newId);
    return { ...page, id: newId };
  });
  if (restoredPages.length === 0) return { ok: false, error: 'プリセットにページがありません' };
  const restoredActiveId = idMap.get(preset.activePageId) || restoredPages[0].id;
  store.set('pages', restoredPages);
  store.set('activePageId', restoredActiveId);
  return { ok: true };
}

function listIcons() {
  try {
    return fs.readdirSync(ICONS_DIR).filter((f) => f.endsWith('.svg')).sort();
  } catch {
    return [];
  }
}

// --- 音量ミキサーパネル（ローカル🎧/配信📡の二段ゲージ表示）用のエントリ管理 ---

function listMixerEntries() {
  return store.get('mixerEntries');
}

// sourceType: 'process'（アプリ別ローカル/配信音量、既存方式）または
// 'wavelink'（Wave Linkチャンネルの特定ミックス2つを直接ローカル/配信ゲージに割り当てる方式）。
// 保存済みconfig.jsonの既存エントリにはsourceTypeが無いため、参照側は必ず
// `(entry.sourceType || 'process')` 相当のフォールバックを行うこと。
function addMixerEntry({ sourceType, processName, label, iconFile, customIcon, windowHint, channelId, channelName, localMixId, streamMixId }) {
  const entries = store.get('mixerEntries');
  const type = sourceType === 'wavelink' ? 'wavelink' : 'process';
  const entry =
    type === 'wavelink'
      ? {
          id: `mixer-${crypto.randomUUID()}`,
          sourceType: 'wavelink',
          channelId,
          channelName,
          localMixId,
          streamMixId,
          label: label || channelName,
          iconFile: iconFile || 'System.svg',
          customIcon: customIcon || null,
        }
      : {
          id: `mixer-${crypto.randomUUID()}`,
          sourceType: 'process',
          processName,
          label: label || processName,
          iconFile: iconFile || 'System.svg',
          customIcon: customIcon || null,
          windowHint: windowHint || null,
        };
  entries.push(entry);
  store.set('mixerEntries', entries);
  if (type === 'process') {
    // 直前に同名プロセスのエントリを削除→再追加した場合など、古いwindowHintに基づく
    // キャッシュ/バインド状態が残っていると新しいwindowHintがすぐ反映されないため。
    obsBridge.invalidateProcessCache(processName);
  }
  return entry;
}

// ミキサーエントリはプリセットにスナップショットされない（savePresetはpagesのみ保存）ため、
// ボタン側のcustomIconと異なり、削除時にファイルを掃除しても他の保存済み構成を壊さない。
function removeMixerEntry(id) {
  const entries = store.get('mixerEntries');
  const target = entries.find((e) => e.id === id);
  if (target?.customIcon) deleteCustomIconFile(target.customIcon);
  store.set('mixerEntries', entries.filter((e) => e.id !== id));
}

function findMixerEntry(id) {
  return store.get('mixerEntries').find((e) => e.id === id);
}

// 同じ実行ファイルで複数ウィンドウが同時に立っているアプリ（Chrome等）向けに、配信側の
// キャプチャ対象ウィンドウを後から選び直せるようにする（obsBridge.pickWindowが参照するヒント）。
function setMixerWindowHint(id, windowHint) {
  const entries = store.get('mixerEntries');
  const entry = entries.find((e) => e.id === id);
  if (!entry || (entry.sourceType || 'process') !== 'process') return false;
  entry.windowHint = windowHint || null;
  store.set('mixerEntries', entries);
  // obsBridge側のTTLキャッシュ(3秒)はポーリング間隔(3秒)と同じ長さのため、
  // ここで明示的に無効化しないと変更が反映されるまで大きく遅れたり、タイミング次第で
  // 反映されないままになる不具合が実機で確認された。
  obsBridge.invalidateProcessCache(entry.processName);
  return true;
}

function windowHintForProcess(processName) {
  // obsBridge側のウィンドウ末尾一致マッチングは大小文字を無視するため、こちらも合わせる
  // （ショートカットボタンのprocessNameがミキサーエントリと大小文字だけ違う場合に
  // ヒントが適用されず、対象ウィンドウを誤って自動選択してしまうのを防ぐ）。
  const key = processName.toLowerCase();
  const entry = store.get('mixerEntries').find((e) => e.processName && e.processName.toLowerCase() === key);
  return entry?.windowHint || undefined;
}

// 音量操作の対象プロセス名を手入力させる代わりに、現在オーディオセッションを持っている
// （＝音を出している/出せる）アプリを一覧提示するための起動中アプリ取得。
async function listRunningProcessNames() {
  try {
    const sessions = await helperBridge.call('list_sessions');
    const seen = new Set();
    const names = [];
    for (const s of sessions) {
      const key = s.processName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(s.processName);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names;
  } catch {
    return [];
  }
}

// wavelinkエントリのchannel('local'/'stream')から対応するWave LinkミックスIDを引く。
function waveLinkMixIdFor(entry, channel) {
  if (channel === 'local') return entry.localMixId;
  if (channel === 'stream') return entry.streamMixId;
  return null;
}

// 音量設定の永続化（要望④）：ミキサーパネル/ショートカットボタンで設定した音量・ミュート値を
// sourceTypeごとにキャッシュする。processはprocessName（小文字化）、wavelinkはentryIdをキーにする
// （processNameが無いため）。これによりショートカットの local_volume/stream_volume アクション
// （processName起点）とミキサーパネルのゲージ操作（entryId起点）でキャッシュを共有できる。
// 既知の制約：wavelinkエントリを削除して同じチャンネルを再追加すると新しいentryIdが
// 発行されるため、旧エントリのキャッシュは引き継がれない（channelId+mixIdベースのキーの
// 方が安定するが、実装簡素化のため現状はentryIdベースとしている）。
function recordLastLevel(sourceType, key, channel, patch) {
  if (!key) return;
  const levels = store.get('lastVolumeLevels') || { process: {}, wavelink: {} };
  const bucket = levels[sourceType] || (levels[sourceType] = {});
  const entry = bucket[key] || (bucket[key] = {});
  entry[channel] = { ...entry[channel], ...patch };
  store.set('lastVolumeLevels', levels);
}

function getLastLevel(sourceType, key, channel) {
  const levels = store.get('lastVolumeLevels');
  return levels?.[sourceType]?.[key]?.[channel] || null;
}

async function fetchChannelVolume(entry, channel) {
  if ((entry.sourceType || 'process') === 'wavelink') {
    const mixId = waveLinkMixIdFor(entry, channel);
    return waveLinkBridge.getVolume(entry.channelId, mixId).catch(() => ({ found: false }));
  }
  if (channel === 'local') {
    return helperBridge.call('get_volume', { processName: entry.processName }).catch(() => ({ found: false }));
  }
  return obsBridge.getVolume(entry.processName, entry.windowHint || undefined).catch(() => ({ found: false }));
}

// 対象（プロセス/Wave Linkチャンネル）が直前のポーリングでは見つからず、今回初めて
// found: true になった＝「新規に検知された」瞬間を捉えてキャッシュ済み音量を再適用する。
// VMD自身の起動直後は必ずこの遷移が発生するため、専用の起動時一括再適用処理は不要。
const mixerFoundState = new Map();

async function maybeReapplyOnNewlyFound(entry, channel, current) {
  const stateKey = `${entry.id}:${channel}`;
  const wasFound = mixerFoundState.get(stateKey) || false;
  mixerFoundState.set(stateKey, !!current.found);
  if (!current.found || wasFound) return current;

  const sourceType = (entry.sourceType || 'process') === 'wavelink' ? 'wavelink' : 'process';
  const cacheKey = sourceType === 'wavelink' ? entry.id : (entry.processName || '').toLowerCase();
  const cached = getLastLevel(sourceType, cacheKey, channel);
  if (!cached) return current;

  try {
    if (cached.level != null) await setMixerVolume(entry.id, channel, cached.level);
    if (cached.muted != null) await setMixerMute(entry.id, channel, cached.muted);
    if (process.env.VMD_DEBUG) {
      console.log(`[VMD_DEBUG] reapplied cached volume: entry=${entry.id} channel=${channel}`, cached);
    }
    return await fetchChannelVolume(entry, channel);
  } catch {
    return current;
  }
}

async function getMixerVolumes(entryId) {
  const entry = findMixerEntry(entryId);
  if (!entry) return { local: { found: false }, stream: { found: false } };
  const local = await maybeReapplyOnNewlyFound(entry, 'local', await fetchChannelVolume(entry, 'local'));
  const stream = await maybeReapplyOnNewlyFound(entry, 'stream', await fetchChannelVolume(entry, 'stream'));
  return { local, stream };
}

// entry起点（ミキサーパネル/自動再適用）の音量キャッシュキーは sourceType により
// wavelinkならentryId、processならprocessName（小文字化）を使う（recordLastLevel/getLastLevelと対応）。
function lastLevelKeyFor(entry) {
  return (entry.sourceType || 'process') === 'wavelink' ? entry.id : (entry.processName || '').toLowerCase();
}

async function setMixerVolume(entryId, channel, level) {
  const entry = findMixerEntry(entryId);
  if (!entry) throw new Error('ミキサーエントリが見つかりません');
  if ((entry.sourceType || 'process') === 'wavelink') {
    const mixId = waveLinkMixIdFor(entry, channel);
    if (!mixId) throw new Error(`未知のチャンネル: ${channel}`);
    await waveLinkBridge.setVolume(entry.channelId, mixId, level);
    recordLastLevel('wavelink', lastLevelKeyFor(entry), channel, { level });
    return { applied: true };
  }
  if (channel === 'local') {
    const data = await helperBridge.call('set_volume', { processName: entry.processName, level });
    if (data.applied > 0) recordLastLevel('process', lastLevelKeyFor(entry), channel, { level });
    return { applied: data.applied > 0 };
  }
  if (channel === 'stream') {
    const { matched } = await obsBridge.setVolume(entry.processName, level, entry.windowHint || undefined);
    if (matched) recordLastLevel('process', lastLevelKeyFor(entry), channel, { level });
    return { applied: matched };
  }
  throw new Error(`未知のチャンネル: ${channel}`);
}

async function setMixerMute(entryId, channel, mute) {
  const entry = findMixerEntry(entryId);
  if (!entry) throw new Error('ミキサーエントリが見つかりません');
  if ((entry.sourceType || 'process') === 'wavelink') {
    const mixId = waveLinkMixIdFor(entry, channel);
    if (!mixId) throw new Error(`未知のチャンネル: ${channel}`);
    await waveLinkBridge.setMute(entry.channelId, mixId, mute);
    recordLastLevel('wavelink', lastLevelKeyFor(entry), channel, { muted: mute });
    return { applied: true };
  }
  if (channel === 'local') {
    const data = await helperBridge.call('set_mute', { processName: entry.processName, mute });
    if (data.applied > 0) recordLastLevel('process', lastLevelKeyFor(entry), channel, { muted: mute });
    return { applied: data.applied > 0 };
  }
  if (channel === 'stream') {
    await obsBridge.setMute(entry.processName, mute, entry.windowHint || undefined);
    recordLastLevel('process', lastLevelKeyFor(entry), channel, { muted: mute });
    return { applied: true };
  }
  throw new Error(`未知のチャンネル: ${channel}`);
}

// ショートカットからの音量操作は、ミキサーパネルの3秒ポーリングを待たせず即座に
// ゲージへ反映させるため、mainWindowへ変更内容を通知する（対象がパネルに未追加の
// プロセスでもレンダラー側で該当カードが無ければ無視されるだけで問題ない）。
function notifyMixerVolumeChanged(processName, channel, level) {
  mainWindow?.webContents.send('mixer:volumeChanged', { processName, channel, level });
}

// アクション種類ごとの実行結果は { ok: boolean, error?: string } で返す。
async function executeAction(action) {
  if (!action || !action.type) return { ok: false, error: 'アクションが未設定です' };

  switch (action.type) {
    case 'launch_app': {
      if (!action.path) return { ok: false, error: 'パスが未設定です' };
      try {
        spawn(action.path, action.args ? action.args.split(' ').filter(Boolean) : [], {
          detached: true,
          stdio: 'ignore',
        }).unref();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }
    case 'open_url': {
      if (!action.url) return { ok: false, error: 'URLが未設定です' };
      await shell.openExternal(action.url);
      return { ok: true };
    }
    case 'local_volume': {
      if (!action.processName) return { ok: false, error: '対象プロセス名が未設定です' };
      try {
        const data = await helperBridge.call('set_volume', {
          processName: action.processName,
          level: Number(action.level),
        });
        if (data.applied === 0) return { ok: false, error: `対象プロセスが見つかりません: ${action.processName}` };
        recordLastLevel('process', action.processName.toLowerCase(), 'local', { level: Number(action.level) });
        notifyMixerVolumeChanged(action.processName, 'local', Number(action.level));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }
    case 'hotkey': {
      if (!action.combo) return { ok: false, error: 'キー組み合わせが未設定です' };
      try {
        await helperBridge.call('send_hotkey', { combo: action.combo });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }
    case 'stream_volume': {
      if (!action.processName) return { ok: false, error: '対象プロセス名が未設定です' };
      try {
        const { matched } = await obsBridge.setVolume(
          action.processName,
          Number(action.level),
          windowHintForProcess(action.processName)
        );
        if (!matched) return { ok: false, error: `OBS上に対象ウィンドウが見つかりません（未起動の可能性）: ${action.processName}` };
        recordLastLevel('process', action.processName.toLowerCase(), 'stream', { level: Number(action.level) });
        notifyMixerVolumeChanged(action.processName, 'stream', Number(action.level));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }
    case 'obs': {
      try {
        if (action.op === 'switch_scene') {
          if (!action.sceneName) return { ok: false, error: 'シーン名が未設定です' };
          await obsBridge.switchScene(action.sceneName);
        } else if (action.op === 'start_stream') {
          await obsBridge.startStream();
        } else if (action.op === 'stop_stream') {
          await obsBridge.stopStream();
        } else {
          return { ok: false, error: `未知のOBS操作: ${action.op}` };
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    }
    default:
      return { ok: false, error: `未知のアクション種類: ${action.type}` };
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    // ショートカットグリッドの左端をプリセット欄の左端に揃えるCSS修正（#grid の
    // justify-content: start化）を行ったうえで、デフォルト/最小/最大解像度を
    // すべて同一値に統一し、リサイズ不可の固定サイズウィンドウにしている
    // （resizable: falseのためmaximizeも実質無意味になり、タイトルバー側の
    // 最大化ボタンを廃止したこととも整合する）。
    width: 1000,
    height: 700,
    resizable: false,
    // frame:false化した自作メニューバーはドラッグ領域(-webkit-app-region:drag)を持つが、
    // resizable:falseだけではOSのダブルクリック→最大化(全画面化)ジェスチャーを防げないため、
    // maximizable:falseで明示的に無効化する。
    maximizable: false,
    // OSネイティブのタイトルバーを廃止し、自作メニューバー（#app-menu-bar）側に
    // 最小化/閉じるボタンとドラッグ領域を実装する（ヘッダーの「VirtualMixDeck」表記との
    // 二重ラベルを解消するため）。
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.VMD_DEBUG) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }
}

app.whenReady().then(() => {
  // ネイティブメニューバーは使わず、レンダラー側のHTML/CSSで日本語の自作メニューバーを描画する
  // （MultiCastDeckで採用している方式を踏襲。Claude-2nd-Brain/オリジナル要素/自作メニューバー.md参照）。
  Menu.setApplicationMenu(null);

  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:saveButton', (_e, { pageId, button }) => saveButton(pageId, button));
  ipcMain.handle('config:removeButton', (_e, { pageId, row, col }) => removeButton(pageId, row, col));
  ipcMain.handle('config:swapButtons', (_e, { pageId, from, to }) => swapButtons(pageId, from, to));
  ipcMain.handle('config:setActivePage', (_e, pageId) => setActivePage(pageId));
  ipcMain.handle('config:addPage', (_e, name) => addPage(name));
  ipcMain.handle('config:removePage', (_e, pageId) => removePage(pageId));
  ipcMain.handle('config:renamePage', (_e, { pageId, name }) => renamePage(pageId, name));
  ipcMain.handle('action:execute', (_e, action) => executeAction(action));

  ipcMain.handle('icons:list', () => listIcons());
  // ファイル選択ダイアログ経由でのカスタム画像アイコン設定。sandbox:trueのレンダラーからは
  // dialogを直接呼べないため、必ずmain側で開いてパスを受け取る。
  ipcMain.handle('icons:pickCustomImage', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: '画像ファイル', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    return processCustomIconFile(result.filePaths[0]);
  });
  // 編集ダイアログへの画像ファイルのドラッグ&ドロップ用。sandbox化されたレンダラーでも
  // ドロップされたFileオブジェクトの絶対パス(file.path)は取得できるため、そのパスを渡す。
  ipcMain.handle('icons:setCustomImageFromPath', (_e, sourcePath) => processCustomIconFile(sourcePath));

  ensureCustomIconsDir();
  // カスタム画像アイコンをuserData配下からvmd-icon://経由で配信する。パストラバーサル対策として
  // リクエストされたホスト名(=ファイル名部分)を許可リスト正規表現で検証してから読み出す。
  protocol.handle('vmd-icon', (request) => {
    const requestedName = decodeURIComponent(new URL(request.url).hostname);
    if (!CUSTOM_ICON_NAME_RE.test(requestedName)) {
      return new Response('Not Found', { status: 404 });
    }
    const filePath = path.join(CUSTOM_ICONS_DIR, requestedName);
    if (path.dirname(filePath) !== CUSTOM_ICONS_DIR) {
      return new Response('Not Found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  ipcMain.handle('preset:list', () => listPresets());
  ipcMain.handle('preset:save', (_e, name) => savePreset(name));
  ipcMain.handle('preset:update', (_e, presetId) => updatePreset(presetId));
  ipcMain.handle('preset:rename', (_e, { presetId, name }) => renamePreset(presetId, name));
  ipcMain.handle('preset:remove', (_e, presetId) => removePreset(presetId));
  ipcMain.handle('preset:load', (_e, presetId) => loadPreset(presetId));

  ipcMain.handle('mixer:listRunningApps', () => listRunningProcessNames());
  ipcMain.handle('mixer:list', () => listMixerEntries());
  ipcMain.handle('mixer:add', (_e, entry) => addMixerEntry(entry));
  ipcMain.handle('mixer:remove', (_e, id) => removeMixerEntry(id));
  ipcMain.handle('mixer:getVolumes', (_e, entryId) => getMixerVolumes(entryId));
  ipcMain.handle('mixer:setVolume', (_e, { entryId, channel, level }) => setMixerVolume(entryId, channel, level));
  ipcMain.handle('mixer:setMute', (_e, { entryId, channel, mute }) => setMixerMute(entryId, channel, mute));
  ipcMain.handle('mixer:setWindowHint', (_e, { id, windowHint }) => setMixerWindowHint(id, windowHint));

  ipcMain.handle('wavelink:getStatus', () => waveLinkBridge.getStatus());
  ipcMain.handle('wavelink:listChannels', async () => {
    try {
      return { ok: true, ...(await waveLinkBridge.listChannels()) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('obs:getConnection', () => store.get('obsConnection'));
  ipcMain.handle('obs:getStatus', () => obsBridge.getStatus());
  ipcMain.handle('obs:listWindowCandidates', async (_e, processName) => {
    try {
      return { ok: true, candidates: await obsBridge.listWindowCandidates(processName) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
  ipcMain.handle('obs:connect', async (_e, { url, password }) => {
    store.set('obsConnection', { url, password });
    try {
      await obsBridge.connect({ url, password });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('appMenu:reload', () => mainWindow?.webContents.reload());
  ipcMain.handle('appMenu:toggleDevTools', () => mainWindow?.webContents.toggleDevTools());
  ipcMain.handle('appMenu:quit', () => app.quit());

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:close', () => mainWindow?.close());

  // 起動時に保存済みのOBS接続設定で自動接続を試みる（OBS未起動時は失敗して構わない）。
  const savedConnection = store.get('obsConnection');
  if (savedConnection?.url) {
    obsBridge.connect(savedConnection).catch(() => {});
  }
  // Wave Linkはポートスキャン方式で接続するため保存設定は不要。未起動時は失敗して構わない。
  waveLinkBridge.connect().catch(() => {});

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  helperBridge.shutdown();
  obsBridge.shutdown();
  waveLinkBridge.shutdown();
});
