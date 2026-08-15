'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('virtualMixDeck', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveButton: (pageId, button) => ipcRenderer.invoke('config:saveButton', { pageId, button }),
  removeButton: (pageId, row, col) => ipcRenderer.invoke('config:removeButton', { pageId, row, col }),
  swapButtons: (pageId, from, to) => ipcRenderer.invoke('config:swapButtons', { pageId, from, to }),
  setActivePage: (pageId) => ipcRenderer.invoke('config:setActivePage', pageId),
  addPage: (name) => ipcRenderer.invoke('config:addPage', name),
  removePage: (pageId) => ipcRenderer.invoke('config:removePage', pageId),
  renamePage: (pageId, name) => ipcRenderer.invoke('config:renamePage', { pageId, name }),
  executeAction: (action) => ipcRenderer.invoke('action:execute', action),

  listIcons: () => ipcRenderer.invoke('icons:list'),
  pickCustomIconImage: () => ipcRenderer.invoke('icons:pickCustomImage'),
  setCustomIconFromPath: (sourcePath) => ipcRenderer.invoke('icons:setCustomImageFromPath', sourcePath),

  presetList: () => ipcRenderer.invoke('preset:list'),
  presetSave: (name) => ipcRenderer.invoke('preset:save', name),
  presetUpdate: (presetId) => ipcRenderer.invoke('preset:update', presetId),
  presetRename: (presetId, name) => ipcRenderer.invoke('preset:rename', { presetId, name }),
  presetRemove: (presetId) => ipcRenderer.invoke('preset:remove', presetId),
  presetLoad: (presetId) => ipcRenderer.invoke('preset:load', presetId),

  mixerListRunningApps: () => ipcRenderer.invoke('mixer:listRunningApps'),
  mixerList: () => ipcRenderer.invoke('mixer:list'),
  mixerAdd: (entry) => ipcRenderer.invoke('mixer:add', entry),
  mixerRemove: (id) => ipcRenderer.invoke('mixer:remove', id),
  mixerGetVolumes: (entryId) => ipcRenderer.invoke('mixer:getVolumes', entryId),
  mixerSetVolume: (entryId, channel, level) =>
    ipcRenderer.invoke('mixer:setVolume', { entryId, channel, level }),
  mixerSetMute: (entryId, channel, mute) =>
    ipcRenderer.invoke('mixer:setMute', { entryId, channel, mute }),
  mixerSetWindowHint: (id, windowHint) => ipcRenderer.invoke('mixer:setWindowHint', { id, windowHint }),
  onMixerVolumeChanged: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('mixer:volumeChanged', listener);
    return () => ipcRenderer.removeListener('mixer:volumeChanged', listener);
  },

  wavelinkGetStatus: () => ipcRenderer.invoke('wavelink:getStatus'),
  wavelinkListChannels: () => ipcRenderer.invoke('wavelink:listChannels'),

  obsGetConnection: () => ipcRenderer.invoke('obs:getConnection'),
  obsGetStatus: () => ipcRenderer.invoke('obs:getStatus'),
  obsConnect: (url, password) => ipcRenderer.invoke('obs:connect', { url, password }),
  obsListWindowCandidates: (processName) => ipcRenderer.invoke('obs:listWindowCandidates', processName),

  licenseGetStatus: () => ipcRenderer.invoke('license:getStatus'),
  licenseStartPurchase: (email) => ipcRenderer.invoke('license:startPurchase', email),
  licenseVerify: (key) => ipcRenderer.invoke('license:verify', key),

  sendFeedback: (subject, body) => ipcRenderer.invoke('feedback:send', { subject, body }),

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  appMenuReload: () => ipcRenderer.invoke('appMenu:reload'),
  appMenuToggleDevTools: () => ipcRenderer.invoke('appMenu:toggleDevTools'),
  appMenuQuit: () => ipcRenderer.invoke('appMenu:quit'),

  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
});
