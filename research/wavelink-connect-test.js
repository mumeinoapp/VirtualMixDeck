const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  // このスクリプトはapp/の外（research/）に置かれているため、ESMのbare specifier解決が
  // app/node_modules を見つけられない。パッケージのエントリファイルを直接絶対パスでimportする。
  const pkgEntry = pathToFileURL(
    path.join(__dirname, '..', 'app', 'node_modules', '@raphiiko', 'wavelink-ts', 'dist', 'index.js')
  ).href;
  const { WaveLinkClient } = await import(pkgEntry);
  const client = new WaveLinkClient();

  console.log('Wave Linkへ接続を試みます...');
  await client.connect();
  console.log('接続成功');

  const info = await client.getApplicationInfo();
  console.log('getApplicationInfo:', JSON.stringify(info, null, 2));

  const { channels } = await client.getChannels();
  console.log('getChannels (channels):', JSON.stringify(channels, null, 2));

  const { mixes } = await client.getMixes();
  console.log('getMixes (mixes):', JSON.stringify(mixes, null, 2));

  if (channels.length > 0 && mixes.length > 0) {
    const targetChannel = channels[0];
    const targetMix = mixes[0];
    console.log(
      `\n動作確認: channel="${targetChannel.name}" (${targetChannel.id}) の mix="${targetMix.name}" (${targetMix.id}) を一時的に50%へ設定します...`
    );
    await client.setChannelMixVolume(targetChannel.id, targetMix.id, 0.5);
    console.log('setChannelMixVolume(0.5) 呼び出し完了。Wave Link側の表示を確認してください。');

    const { channels: after } = await client.getChannels();
    const updated = after.find((c) => c.id === targetChannel.id);
    console.log('設定後のチャンネル情報:', JSON.stringify(updated, null, 2));
  } else {
    console.log('\nチャンネルまたはミックスが0件のため、音量設定の動作確認はスキップしました。');
  }

  client.disconnect();
  console.log('\n切断しました。');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
