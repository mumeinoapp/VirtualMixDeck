'use strict';

// OBS WebSocket（v5）との接続と、配信側音量制御・OBS操作を担うブリッジ。
// 「アプリケーション音声キャプチャ」ソースの自動作成ロジックは
// research/obsws-createinput-test.js での実機検証結果に基づく
// （VirtualMixDeck/docs/設計メモ.md 参照）。

const { OBSWebSocket } = require('obs-websocket-js');

const obs = new OBSWebSocket();
let connected = false;
let lastError = null;

const CAPTURE_INPUT_PREFIX = 'VMD_';

function inputNameFor(processName) {
  return `${CAPTURE_INPUT_PREFIX}${processName}`;
}

async function connect({ url, password }) {
  try {
    await obs.connect(url, password || undefined);
    connected = true;
    lastError = null;
  } catch (e) {
    connected = false;
    lastError = String(e.message || e);
    throw e;
  }
}

obs.on('ConnectionClosed', () => {
  connected = false;
  ensureCache.clear();
  lastBoundWindow.clear();
});

function getStatus() {
  return { connected, lastError };
}

function requireConnected() {
  if (!connected) throw new Error('OBSに接続されていません');
}

// ensureInputForProcessは入力作成の有無確認・ウィンドウ列挙・紐付けと複数回OBSへ
// 往復する重い処理。フェーダーのドラッグ操作のたびに呼ばれるため、直近で確保済みの
// processNameは一定時間キャッシュして無駄なOBS問い合わせ（延いては負荷によるOBS側の
// 不安定化）を避ける。
const ensureCache = new Map(); // key: processName(小文字) -> { matched, ts }
const ENSURE_CACHE_TTL_MS = 3000;

// 直近でOBSへ実際に書き込んだwindow設定値を憶えておき、値が変わっていない限り
// SetInputSettingsを呼び直さない（3秒おきのポーリングのたびに毎回再バインドすると、
// 配信中に一瞬キャプチャが途切れるノイズになりうるため）。接続が切れたら（OBS再起動等）
// クリアし、再接続後の最初の1回だけは強制的に再バインドする。
const lastBoundWindow = new Map(); // key: processName(小文字) -> itemValue

// VMD_DEBUG環境変数が立っている時だけ、配信側音量が反映されない不具合の切り分け用に
// マッチング過程の詳細をコンソールへ出力する（起動.batからは出ないため、
// デバッグ起動.batで起動した時のみターミナルに表示される）。
const DEBUG = !!process.env.VMD_DEBUG;
function debugLog(...args) {
  if (DEBUG) console.log('[obsBridge]', ...args);
}

// OBS入力(inputName)を必要なら作成した上で、processNameの実行ファイル名に一致する
// ウィンドウ候補（wasapi_process_output_captureの"window"プロパティ選択肢）を返す。
// 対象アプリが未起動でウィンドウが存在しない場合は空配列を返す。
async function getWindowCandidatesForInput(inputName, processName) {
  const { inputs } = await obs.call('GetInputList');
  const exists = inputs.some((i) => i.inputName === inputName);
  if (!exists) {
    const { currentProgramSceneName } = await obs.call('GetSceneList');
    await obs.call('CreateInput', {
      sceneName: currentProgramSceneName,
      inputName,
      inputKind: 'wasapi_process_output_capture',
      inputSettings: {},
      sceneItemEnabled: true,
    });
    debugLog(`created input "${inputName}" in scene="${currentProgramSceneName}"`);
  }
  const { propertyItems } = await obs.call('GetInputPropertiesListPropertyItems', {
    inputName,
    propertyName: 'window',
  });
  return propertyItems.filter((item) =>
    String(item.itemValue).toLowerCase().endsWith(`:${processName.toLowerCase()}.exe`)
  );
}

// 同じ実行ファイルで複数ウィンドウが同時に立っている場合（例: Chromeを複数ウィンドウで
// 開いている）、末尾一致だけでは目的のウィンドウを一意に選べない（例: 無音の「新しいタブ」
// ウィンドウを誤って選んでしまい、配信音量が無音のソースに反映される不具合が実機で確認された）。
// windowHintが指定されていれば、それを優先して該当ウィンドウを選ぶ：
// 1. 完全一致（前回選択時のitemValueそのまま）
// 2. タイトル部分（先頭のコロンまで）が一致するもの（タイトルが多少変わっても追従できるように）
// 3. どちらにも該当しなければ候補の先頭にフォールバック（従来通りの挙動、単一ウィンドウの
//    アプリでは影響なし）
//
// 注意: OBSのwindowプロパティのitemValueは「ウィンドウタイトル:クラス名:プロセス名.exe」
// という文字列で、安定したウィンドウハンドル等は含まれない。Chrome等はウィンドウタイトルが
// アクティブタブのタイトルをそのまま反映するため、windowHint保存後にそのウィンドウで別タブへ
// 切り替えるとタイトルが変わり、1・2のどちらにも一致しなくなって3のフォールバックに落ちる
// ことがある（この場合、意図した対象と異なるウィンドウが選ばれる可能性がある）。この状態を
// hintStaleとして呼び出し元に伝え、UI側で「対象ウィンドウの再選択が必要かもしれません」と
// 表示できるようにする。
function pickWindow(candidates, windowHint) {
  if (candidates.length === 0) return { match: null, hintStale: false };
  if (windowHint) {
    const exact = candidates.find((c) => c.itemValue === windowHint);
    if (exact) return { match: exact, hintStale: false };
    const hintTitle = String(windowHint).split(':')[0];
    const byTitle = candidates.find((c) => String(c.itemValue).split(':')[0] === hintTitle);
    if (byTitle) return { match: byTitle, hintStale: false };
    return { match: candidates[0], hintStale: true };
  }
  return { match: candidates[0], hintStale: false };
}

// UIから「対象ウィンドウを選ぶ」ピッカーを表示するための一覧取得。
async function listWindowCandidates(processName) {
  requireConnected();
  const inputName = inputNameFor(processName);
  const candidates = await getWindowCandidatesForInput(inputName, processName);
  return candidates.map((c) => ({ itemValue: c.itemValue, title: String(c.itemValue).split(':')[0] }));
}

// processNameにマッチするウィンドウキャプチャ入力を確保する。
// 既存の入力（VMD_<processName>）があればそれを使い、無ければ現在のシーンに新規作成する。
async function ensureInputForProcess(processName, windowHint) {
  requireConnected();
  const inputName = inputNameFor(processName);
  const cacheKey = processName.toLowerCase();
  const cached = ensureCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ENSURE_CACHE_TTL_MS) {
    debugLog(`(cache hit) processName=${processName} matched=${cached.matched}`);
    return { inputName, matched: cached.matched, hintStale: cached.hintStale };
  }

  const candidates = await getWindowCandidatesForInput(inputName, processName);
  debugLog(
    `window candidates (${candidates.length}):`,
    candidates.map((i) => i.itemValue)
  );
  const { match, hintStale } = pickWindow(candidates, windowHint);
  debugLog(`windowHint=${windowHint || '(none)'} match=${match ? match.itemValue : '(none)'} hintStale=${hintStale}`);
  if (match) {
    if (lastBoundWindow.get(cacheKey) !== match.itemValue) {
      // OBSはwindow設定の文字列が前回SetInputSettingsした値と同一だと「変化なし」とみなし、
      // 実際のキャプチャ対象プロセス（PID）の再アタッチを内部でスキップすることがある。
      // Chrome/OBS再起動でPIDは変わってもウィンドウタイトル文字列は同じままのケースが多く
      // （例:「新しいタブ - Google Chrome:...」）、これが原因で再起動後だけ無音になる不具合が
      // 実機で確認された。一度windowを空にしてから目的値を入れ直し、必ず値の変化を発生させて
      // OBS側に強制的に再アタッチさせる。
      // lastBoundWindowは接続が切れるとクリアされるため、再接続後の最初の1回は
      // （文字列が前回と同じでも）ここを通って必ず再バインドされる。文字列が変わらない
      // 限り2回目以降はこの分岐に入らないため、3秒おきのポーリングで毎回再バインドして
      // 配信音声が瞬断することはない。
      await obs.call('SetInputSettings', { inputName, inputSettings: { window: '' } });
      await obs.call('SetInputSettings', { inputName, inputSettings: { window: match.itemValue } });
      lastBoundWindow.set(cacheKey, match.itemValue);
      if (DEBUG) {
        const after = await obs.call('GetInputSettings', { inputName });
        debugLog('settings after SetInputSettings:', JSON.stringify(after.inputSettings));
      }
    } else {
      debugLog('window unchanged since last bind, skipping SetInputSettings');
    }
  }

  ensureCache.set(cacheKey, { matched: !!match, hintStale, ts: Date.now() });
  return { inputName, matched: !!match, hintStale };
}

// ミキサーエントリの「対象ウィンドウ」をユーザーが変更した直後など、次回の
// ensureInputForProcess呼び出しでTTLキャッシュに邪魔されず必ず新しいwindowHintで
// 再判定・再バインドさせたい時に呼ぶ。ポーリング間隔(3秒)とENSURE_CACHE_TTL_MSが
// 同じ値のため、これを呼ばずに放置すると反映が最大3秒以上遅れたりタイミング次第で
// 反映されないままになる不具合が実機で確認された。
function invalidateProcessCache(processName) {
  const key = processName.toLowerCase();
  ensureCache.delete(key);
  lastBoundWindow.delete(key);
}

// 現在の配信側音量を取得する。接続していない/未マッチの場合は found:false を返す。
async function getVolume(processName, windowHint) {
  if (!connected) return { found: false };
  try {
    const { matched, hintStale } = await ensureInputForProcess(processName, windowHint);
    if (!matched) return { found: false };
    const inputName = inputNameFor(processName);
    const vol = await obs.call('GetInputVolume', { inputName });
    const muteState = await obs.call('GetInputMute', { inputName });
    return { found: true, level: vol.inputVolumeMul, muted: muteState.inputMuted, hintStale };
  } catch {
    return { found: false };
  }
}

async function setVolume(processName, level, windowHint) {
  const { matched } = await ensureInputForProcess(processName, windowHint);
  const inputName = inputNameFor(processName);
  await obs.call('SetInputVolume', { inputName, inputVolumeMul: Math.max(0, Math.min(1, level)) });
  return { matched };
}

async function setMute(processName, mute, windowHint) {
  await ensureInputForProcess(processName, windowHint);
  const inputName = inputNameFor(processName);
  await obs.call('SetInputMute', { inputName, inputMuted: mute });
}

async function switchScene(sceneName) {
  requireConnected();
  await obs.call('SetCurrentProgramScene', { sceneName });
}

async function startStream() {
  requireConnected();
  await obs.call('StartStream');
}

async function stopStream() {
  requireConnected();
  await obs.call('StopStream');
}

function shutdown() {
  if (connected) obs.disconnect();
}

module.exports = {
  connect,
  getStatus,
  getVolume,
  setVolume,
  setMute,
  listWindowCandidates,
  invalidateProcessCache,
  switchScene,
  startStream,
  stopStream,
  shutdown,
};
