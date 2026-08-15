'use strict';

// Elgato Wave Linkとの接続・チャンネル/ミックス単位の音量制御を担うブリッジ。
// 非公式だが実機検証済みのTypeScriptクライアント`@raphiiko/wavelink-ts`
// （research/wavelink-connect-test.jsでの検証結果、VirtualMixDeck/docs/設計メモ.md参照）を利用する。
// このパッケージは`type:module`のESM専用でrequire()できないため、dynamic import()で読み込む
// （本ファイルはapp/src配下にありapp/node_modulesを解決できるため、research/内のスクリプトと
// 異なり絶対パス指定は不要）。

let clientClassPromise = null;
function loadClientClass() {
  if (!clientClassPromise) {
    clientClassPromise = import('@raphiiko/wavelink-ts').then((m) => m.WaveLinkClient);
  }
  return clientClassPromise;
}

let client = null;
let connected = false;
let lastError = null;

async function connect() {
  try {
    const WaveLinkClient = await loadClientClass();
    client = new WaveLinkClient();
    client.on('disconnected', () => {
      connected = false;
    });
    await client.connect();
    connected = true;
    lastError = null;
  } catch (e) {
    connected = false;
    lastError = String(e.message || e);
    throw e;
  }
}

function getStatus() {
  return { connected, lastError };
}

function requireConnected() {
  if (!connected || !client) throw new Error('Wave Linkに接続されていません');
}

// ミキサー追加ダイアログでチャンネル/ミックスを選ばせるための一覧取得。
async function listChannels() {
  requireConnected();
  const { channels } = await client.getChannels();
  const { mixes } = await client.getMixes();
  return {
    channels: channels.map((c) => ({ id: c.id, name: c.name })),
    mixes: mixes.map((m) => ({ id: m.id, name: m.name })),
  };
}

// 現在のチャンネル×ミックスの音量を取得する。未接続/未マッチの場合は found:false を返す。
async function getVolume(channelId, mixId) {
  if (!connected || !client || !channelId || !mixId) return { found: false };
  try {
    const { channels } = await client.getChannels();
    const channel = channels.find((c) => c.id === channelId);
    const mix = channel?.mixes?.find((m) => m.id === mixId);
    if (!mix) return { found: false };
    return { found: true, level: mix.level, muted: mix.isMuted };
  } catch {
    return { found: false };
  }
}

async function setVolume(channelId, mixId, level) {
  requireConnected();
  await client.setChannelMixVolume(channelId, mixId, Math.max(0, Math.min(1, level)));
}

async function setMute(channelId, mixId, mute) {
  requireConnected();
  await client.setChannelMixMute(channelId, mixId, mute);
}

function shutdown() {
  if (connected && client) client.disconnect();
}

module.exports = {
  connect,
  getStatus,
  listChannels,
  getVolume,
  setVolume,
  setMute,
  shutdown,
};
