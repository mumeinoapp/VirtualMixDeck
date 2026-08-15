const { OBSWebSocket } = require('obs-websocket-js');

const obs = new OBSWebSocket();

async function main() {
  await obs.connect('ws://127.0.0.1:4455', 'RxhymSE6lp6u2aXE');

  const propItems = await obs.call('GetInputPropertiesListPropertyItems', {
    inputName: 'StreamMixDeck_TestCapture',
    propertyName: 'window',
  });
  console.log('window property items:', JSON.stringify(propItems.propertyItems, null, 2));

  // Try setting to the first non-empty item found
  const target = propItems.propertyItems.find((i) => i.itemValue && i.itemValue !== '');
  if (target) {
    console.log('setting window to:', target.itemValue);
    await obs.call('SetInputSettings', {
      inputName: 'StreamMixDeck_TestCapture',
      inputSettings: { window: target.itemValue },
    });
    const after = await obs.call('GetInputSettings', { inputName: 'StreamMixDeck_TestCapture' });
    console.log('settings after set:', JSON.stringify(after, null, 2));

    // check volume/mute control via SetInputVolume / SetInputMute
    await obs.call('SetInputVolume', { inputName: 'StreamMixDeck_TestCapture', inputVolumeDb: -10 });
    await obs.call('SetInputMute', { inputName: 'StreamMixDeck_TestCapture', inputMuted: false });
    const vol = await obs.call('GetInputVolume', { inputName: 'StreamMixDeck_TestCapture' });
    console.log('volume after set:', JSON.stringify(vol, null, 2));
  }

  // cleanup
  await obs.call('RemoveInput', { inputName: 'StreamMixDeck_TestCapture' });
  console.log('cleaned up test input');

  await obs.disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
