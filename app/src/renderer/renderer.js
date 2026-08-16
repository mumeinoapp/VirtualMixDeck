'use strict';

const ICON_BASE = 'assets/icons/';
const LOCAL_ICON = 'Monitor Output Toggle Headphone.svg';
const STREAM_ICON = 'Output Stream.svg';
const DEFAULT_BUTTON_ICON = 'Set.svg';

function iconUrl(fileName) {
  return ICON_BASE + encodeURIComponent(fileName);
}

function customIconUrl(fileName) {
  return `vmd-icon://${encodeURIComponent(fileName)}`;
}

// ボタン/ミキサーエントリのアイコン表示URL。customIconが設定されていればそちらを優先する。
function resolveIconUrl(data) {
  if (data && data.customIcon) return customIconUrl(data.customIcon);
  return iconUrl((data && data.iconFile) || DEFAULT_BUTTON_ICON);
}

// ---- グリッド（ショートカット） ----

const gridEl = document.getElementById('grid');
const editToggleEl = document.getElementById('edit-toggle');
const dialogEl = document.getElementById('edit-dialog');
const typeEl = document.getElementById('f-type');
const labelEl = document.getElementById('f-label');
const pathEl = document.getElementById('f-path');
const argsEl = document.getElementById('f-args');
const urlEl = document.getElementById('f-url');
const processNameEl = document.getElementById('f-processName');
const levelEl = document.getElementById('f-level');
const comboEl = document.getElementById('f-combo');
const obsOpEl = document.getElementById('f-obsOp');
const sceneNameEl = document.getElementById('f-sceneName');
const iconHiddenEl = document.getElementById('f-icon');
const iconPickerEl = document.getElementById('f-icon-picker');
const customIconHiddenEl = document.getElementById('f-custom-icon');

const pageLabelEl = document.getElementById('page-label');

let config = null;
let editMode = false;
let editingCell = null; // { row, col }
let allIcons = [];
let dragSource = null; // { row, col }（編集モードでのグリッド入れ替え用）

// ---- 通知・確認ダイアログ（window.alert/confirmの代替） ----
// Electronでは開いているネイティブ<dialog>の中でwindow.alert/confirmを呼ぶと、
// ダイアログ側の入力欄がその後操作不能になることがある（フォーカストラップの競合）。
// これを避けるため、自作の<dialog>ベースの通知/確認UIに統一する。

const appAlertDialogEl = document.getElementById('app-alert-dialog');
const appAlertTitleEl = document.getElementById('app-alert-title');
const appAlertMessageEl = document.getElementById('app-alert-message');
const appAlertOkEl = document.getElementById('app-alert-ok');

function showAppAlert(message, title = 'お知らせ') {
  return new Promise((resolve) => {
    appAlertTitleEl.textContent = title;
    appAlertMessageEl.textContent = message;
    const onOk = () => {
      appAlertOkEl.removeEventListener('click', onOk);
      appAlertDialogEl.close();
      resolve();
    };
    appAlertOkEl.addEventListener('click', onOk);
    if (!appAlertDialogEl.open) appAlertDialogEl.showModal();
  });
}

const appConfirmDialogEl = document.getElementById('app-confirm-dialog');
const appConfirmTitleEl = document.getElementById('app-confirm-title');
const appConfirmMessageEl = document.getElementById('app-confirm-message');
const appConfirmOkEl = document.getElementById('app-confirm-ok');
const appConfirmCancelEl = document.getElementById('app-confirm-cancel');

function showAppConfirm(message, title = '確認') {
  return new Promise((resolve) => {
    appConfirmTitleEl.textContent = title;
    appConfirmMessageEl.textContent = message;
    const cleanup = () => {
      appConfirmOkEl.removeEventListener('click', onOk);
      appConfirmCancelEl.removeEventListener('click', onCancel);
    };
    const onOk = () => {
      cleanup();
      appConfirmDialogEl.close();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      appConfirmDialogEl.close();
      resolve(false);
    };
    appConfirmOkEl.addEventListener('click', onOk);
    appConfirmCancelEl.addEventListener('click', onCancel);
    if (!appConfirmDialogEl.open) appConfirmDialogEl.showModal();
  });
}

function updateFieldVisibility() {
  const type = typeEl.value;
  document.querySelectorAll('#edit-form [data-types]').forEach((el) => {
    const types = el.dataset.types.split(' ');
    el.style.display = types.includes(type) ? 'block' : 'none';
  });
}

function currentPage() {
  return config.pages.find((p) => p.id === config.activePageId);
}

function findButton(row, col) {
  return currentPage().buttons.find((b) => b.row === row && b.col === col);
}

// カスタム画像アイコン設定タイル（ピッカー先頭）の共通処理。選択/ドロップされたファイルを
// main側でuserData配下にコピー・リサイズさせ、結果のファイル名をcustomHiddenInputへ保存する。
// SVGプリセット(hiddenInput)とは排他関係のため、設定時はhiddenInputをクリアする。
async function applyCustomIconResult(result, container, hiddenInput, customHiddenInput) {
  if (result.canceled) return;
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  hiddenInput.value = '';
  customHiddenInput.value = result.fileName;
  renderIconPicker(container, hiddenInput, '', customHiddenInput, result.fileName);
}

function renderIconPicker(container, hiddenInput, selectedFile, customHiddenInput, customFile) {
  container.innerHTML = '';

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'icon-picker-item icon-picker-custom' + (customFile ? ' selected' : '');
  customBtn.title = '画像ファイルを選択、またはここへドラッグ&ドロップ';
  if (customFile) {
    const img = document.createElement('img');
    img.src = customIconUrl(customFile);
    img.alt = 'カスタム画像';
    customBtn.appendChild(img);
  } else {
    customBtn.textContent = '＋画像';
  }
  customBtn.addEventListener('click', async () => {
    const result = await window.virtualMixDeck.pickCustomIconImage();
    await applyCustomIconResult(result, container, hiddenInput, customHiddenInput);
  });
  customBtn.addEventListener('dragover', (e) => {
    e.preventDefault();
    customBtn.classList.add('drag-over');
  });
  customBtn.addEventListener('dragleave', () => customBtn.classList.remove('drag-over'));
  customBtn.addEventListener('drop', async (e) => {
    e.preventDefault();
    customBtn.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.path) return;
    const result = await window.virtualMixDeck.setCustomIconFromPath(file.path);
    await applyCustomIconResult(result, container, hiddenInput, customHiddenInput);
  });
  container.appendChild(customBtn);

  allIcons.forEach((fileName) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-picker-item' + (fileName === selectedFile && !customFile ? ' selected' : '');
    const img = document.createElement('img');
    img.src = iconUrl(fileName);
    img.alt = fileName;
    btn.appendChild(img);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.icon-picker-item').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
      hiddenInput.value = fileName;
      customHiddenInput.value = ''; // SVGプリセット選択時はカスタム画像を解除
    });
    container.appendChild(btn);
  });
}

// ボタンは常に正方形。ウィンドウ最大化時に際限なく巨大化しないよう上限を設け、
// 逆にウィンドウが小さい時は見切れ/スクロールが出ないよう、幅・高さ両方に収まる
// 最大の一辺の長さを都度計算してpx指定する（gridEl自身はflex:1で外枠サイズが
// 決まるため、grid-template-columns/rowsをpx固定にしても外枠とのフィードバック
// ループにはならない）。
const GRID_MAX_CELL = 160;
const GRID_GAP = 12;

function layoutGrid() {
  const { rows, cols } = config.grid;
  const availWidth = gridEl.clientWidth - GRID_GAP * (cols - 1);
  const availHeight = gridEl.clientHeight - GRID_GAP * (rows - 1);
  const cell = Math.max(1, Math.min(GRID_MAX_CELL, Math.floor(availWidth / cols), Math.floor(availHeight / rows)));
  gridEl.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
  gridEl.style.gridTemplateRows = `repeat(${rows}, ${cell}px)`;
}

window.addEventListener('resize', () => requestAnimationFrame(layoutGrid));

function renderGrid() {
  const { rows, cols, freeRows } = config.grid;
  layoutGrid();
  gridEl.innerHTML = '';

  const page = currentPage();
  pageLabelEl.textContent = `${page.name} (${config.pages.findIndex((p) => p.id === page.id) + 1} / ${config.pages.length})`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // 未購入時は下側の行をロック表示にし、干渉（クリック・編集・ドラッグ）できないようにする。
      if (!config.unlocked && row >= freeRows) {
        const lockedBtn = document.createElement('button');
        lockedBtn.className = 'deck-btn locked';
        lockedBtn.disabled = true;
        lockedBtn.textContent = '有料版限定機能';
        gridEl.appendChild(lockedBtn);
        continue;
      }
      const btnData = findButton(row, col);
      const btn = document.createElement('button');
      btn.className = 'deck-btn' + (btnData ? '' : ' empty');
      if (btnData) {
        const img = document.createElement('img');
        img.className = 'deck-btn-icon';
        img.src = resolveIconUrl(btnData);
        img.alt = '';
        const span = document.createElement('span');
        span.className = 'deck-btn-label';
        span.textContent = btnData.label || btnData.action.type;
        btn.appendChild(img);
        btn.appendChild(span);
      } else {
        btn.textContent = '+';
      }
      if (editMode && btnData) {
        btn.draggable = true;
        btn.addEventListener('dragstart', (e) => {
          dragSource = { row, col };
          e.dataTransfer.effectAllowed = 'move';
          btn.classList.add('dragging');
        });
        btn.addEventListener('dragend', () => {
          dragSource = null;
          btn.classList.remove('dragging');
        });
      }
      if (editMode) {
        btn.addEventListener('dragover', (e) => {
          if (!dragSource) return;
          e.preventDefault();
        });
        btn.addEventListener('dragenter', () => {
          if (dragSource) btn.classList.add('drag-over');
        });
        btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
        btn.addEventListener('drop', async (e) => {
          e.preventDefault();
          btn.classList.remove('drag-over');
          if (!dragSource) return;
          const from = dragSource;
          dragSource = null;
          if (from.row === row && from.col === col) return;
          await window.virtualMixDeck.swapButtons(config.activePageId, from, { row, col });
          await reload();
        });
      }
      btn.addEventListener('click', () => onCellClick(row, col, btnData));
      gridEl.appendChild(btn);
    }
  }
}

async function onCellClick(row, col, btnData) {
  if (editMode) {
    openEditDialog(row, col, btnData);
    return;
  }
  if (!btnData) return;
  const result = await window.virtualMixDeck.executeAction(btnData.action);
  if (!result.ok) {
    await showAppAlert(`実行失敗: ${result.error}`, 'エラー');
  }
}

function openEditDialog(row, col, btnData) {
  editingCell = { row, col };
  labelEl.value = btnData?.label || '';
  typeEl.value = btnData?.action?.type || 'launch_app';
  pathEl.value = btnData?.action?.path || '';
  argsEl.value = btnData?.action?.args || '';
  urlEl.value = btnData?.action?.url || '';
  processNameEl.value = btnData?.action?.processName || '';
  levelEl.value = btnData?.action?.level ?? '';
  comboEl.value = btnData?.action?.combo || '';
  obsOpEl.value = btnData?.action?.op || 'switch_scene';
  sceneNameEl.value = btnData?.action?.sceneName || '';
  const selectedIcon = btnData?.iconFile || DEFAULT_BUTTON_ICON;
  const selectedCustomIcon = btnData?.customIcon || '';
  iconHiddenEl.value = selectedCustomIcon ? '' : selectedIcon;
  customIconHiddenEl.value = selectedCustomIcon;
  renderIconPicker(iconPickerEl, iconHiddenEl, iconHiddenEl.value, customIconHiddenEl, selectedCustomIcon);
  document.getElementById('f-processName-list').hidden = true;
  updateFieldVisibility();
  dialogEl.showModal();
}

// ---- 「起動中のアプリから選択」ピッカー（プロセス名の手入力を補助） ----

function setupProcessPicker(pickBtn, listEl, inputEl) {
  pickBtn.addEventListener('click', async () => {
    const isHidden = listEl.hidden;
    listEl.hidden = true;
    if (!isHidden) return; // トグルで閉じる
    const names = await window.virtualMixDeck.mixerListRunningApps();
    listEl.innerHTML = '';
    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'app-pick-empty';
      empty.textContent = '音声を出力中のアプリが見つかりません';
      listEl.appendChild(empty);
    } else {
      names.forEach((name) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'app-pick-item';
        item.textContent = name;
        item.addEventListener('click', () => {
          inputEl.value = name;
          listEl.hidden = true;
        });
        listEl.appendChild(item);
      });
    }
    listEl.hidden = false;
  });
}

setupProcessPicker(
  document.getElementById('f-processName-pick'),
  document.getElementById('f-processName-list'),
  processNameEl
);

typeEl.addEventListener('change', updateFieldVisibility);

document.getElementById('f-cancel').addEventListener('click', () => dialogEl.close());

document.getElementById('f-save').addEventListener('click', async () => {
  const type = typeEl.value;
  const action = { type };
  if (type === 'launch_app') {
    action.path = pathEl.value;
    action.args = argsEl.value;
  } else if (type === 'open_url') {
    action.url = urlEl.value;
  } else if (type === 'local_volume' || type === 'stream_volume') {
    action.processName = processNameEl.value;
    action.level = Number(levelEl.value);
  } else if (type === 'hotkey') {
    action.combo = comboEl.value;
  } else if (type === 'obs') {
    action.op = obsOpEl.value;
    action.sceneName = sceneNameEl.value;
  }
  const button = {
    row: editingCell.row,
    col: editingCell.col,
    label: labelEl.value,
    iconFile: iconHiddenEl.value || DEFAULT_BUTTON_ICON,
    customIcon: customIconHiddenEl.value || null,
    action,
  };
  await window.virtualMixDeck.saveButton(config.activePageId, button);
  await reload();
  dialogEl.close();
});

document.getElementById('f-delete').addEventListener('click', async () => {
  await window.virtualMixDeck.removeButton(config.activePageId, editingCell.row, editingCell.col);
  await reload();
  dialogEl.close();
});

editToggleEl.addEventListener('click', () => {
  editMode = !editMode;
  editToggleEl.textContent = `編集モード: ${editMode ? 'ON' : 'OFF'}`;
  editToggleEl.classList.toggle('active', editMode);
  renderGrid(); // draggable属性など編集モード依存のマークアップを反映するため再描画
});

// ---- ページ送り ----

document.getElementById('page-prev').addEventListener('click', async () => {
  const idx = config.pages.findIndex((p) => p.id === config.activePageId);
  const prev = config.pages[(idx - 1 + config.pages.length) % config.pages.length];
  await window.virtualMixDeck.setActivePage(prev.id);
  await reload();
});

document.getElementById('page-next').addEventListener('click', async () => {
  const idx = config.pages.findIndex((p) => p.id === config.activePageId);
  const next = config.pages[(idx + 1) % config.pages.length];
  await window.virtualMixDeck.setActivePage(next.id);
  await reload();
});

document.getElementById('page-add').addEventListener('click', async () => {
  const result = await window.virtualMixDeck.addPage();
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await reload();
});

document.getElementById('page-remove').addEventListener('click', async () => {
  if (config.pages.length <= 1) {
    await showAppAlert('最後の1ページは削除できません');
    return;
  }
  const ok = await showAppConfirm(`「${currentPage().name}」を削除しますか？`, 'ページの削除');
  if (!ok) return;
  await window.virtualMixDeck.removePage(config.activePageId);
  await reload();
});

// ---- ページ名のインライン編集（ダブルクリックで開始） ----

pageLabelEl.addEventListener('dblclick', () => {
  if (pageLabelEl.classList.contains('editing')) return;
  const page = currentPage();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = page.name;
  input.maxLength = 20;
  pageLabelEl.classList.add('editing');
  pageLabelEl.textContent = '';
  pageLabelEl.appendChild(input);
  input.focus();
  input.select();

  let cancelled = false;
  const commit = async () => {
    pageLabelEl.classList.remove('editing');
    const name = input.value.trim();
    if (!cancelled && name && name !== page.name) {
      await window.virtualMixDeck.renamePage(page.id, name);
      await reload();
    } else {
      renderGrid();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      cancelled = true;
      input.blur();
    }
  });
  input.addEventListener('blur', commit, { once: true });
});

async function reload() {
  config = await window.virtualMixDeck.getConfig();
  renderGrid();
}

// ---- プリセット（ページ構成一式の保存/切替） ----

let presets = [];
let presetRenameTargetId = null; // nullなら新規保存、設定時は既存プリセットの名前変更モード

const presetSelectEl = document.getElementById('preset-select');
const presetSaveDialogEl = document.getElementById('preset-save-dialog');
const presetSaveDialogTitleEl = document.getElementById('preset-save-dialog-title');
const presetManageDialogEl = document.getElementById('preset-manage-dialog');
const presetManageListEl = document.getElementById('preset-manage-list');
const pNameEl = document.getElementById('p-name');

function presetOptionLabel(preset) {
  return preset.name;
}

async function reloadPresets() {
  presets = await window.virtualMixDeck.presetList();
  const selected = presetSelectEl.value;
  presetSelectEl.innerHTML = '<option value="">プリセットを選択...</option>';
  presets.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = presetOptionLabel(p);
    presetSelectEl.appendChild(opt);
  });
  if (presets.some((p) => p.id === selected)) presetSelectEl.value = selected;
}

document.getElementById('preset-load-btn').addEventListener('click', async () => {
  const id = presetSelectEl.value;
  if (!id) return;
  const preset = presets.find((p) => p.id === id);
  if (!preset) return;
  const ok = await showAppConfirm(
    `現在のページ構成を「${preset.name}」で置き換えます。保存していない変更は失われます。よろしいですか？`,
    'プリセットの読み込み'
  );
  if (!ok) return;
  const result = await window.virtualMixDeck.presetLoad(id);
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await reload();
});

document.getElementById('preset-save-btn').addEventListener('click', () => {
  presetRenameTargetId = null;
  presetSaveDialogTitleEl.textContent = 'プリセットとして保存';
  pNameEl.value = '';
  presetSaveDialogEl.showModal();
});

document.getElementById('p-cancel').addEventListener('click', () => presetSaveDialogEl.close());

presetSaveDialogEl.addEventListener('close', () => {
  presetRenameTargetId = null;
});

document.getElementById('p-save').addEventListener('click', async () => {
  if (presetRenameTargetId) {
    const result = await window.virtualMixDeck.presetRename(presetRenameTargetId, pNameEl.value);
    if (!result.ok) {
      await showAppAlert(result.error, 'エラー');
      return;
    }
    presetRenameTargetId = null;
    await reloadPresets();
    await renderPresetManageList();
    presetSaveDialogEl.close();
    return;
  }
  const result = await window.virtualMixDeck.presetSave(pNameEl.value);
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await reloadPresets();
  presetSelectEl.value = result.preset.id;
  presetSaveDialogEl.close();
});

async function renderPresetManageList() {
  presetManageListEl.innerHTML = '';
  if (presets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'app-pick-empty';
    empty.textContent = '保存されたプリセットはありません';
    presetManageListEl.appendChild(empty);
    return;
  }
  presets.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'preset-manage-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'preset-manage-name';
    nameSpan.textContent = presetOptionLabel(p);
    row.appendChild(nameSpan);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = '名前変更';
    renameBtn.addEventListener('click', () => {
      presetRenameTargetId = p.id;
      presetSaveDialogTitleEl.textContent = 'プリセット名を変更';
      pNameEl.value = p.name;
      presetSaveDialogEl.showModal();
    });

    const overwriteBtn = document.createElement('button');
    overwriteBtn.type = 'button';
    overwriteBtn.textContent = '上書き保存';
    overwriteBtn.addEventListener('click', async () => {
      const ok = await showAppConfirm(`「${p.name}」を現在のページ構成で上書きしますか？`, '上書き保存');
      if (!ok) return;
      await window.virtualMixDeck.presetUpdate(p.id);
      await reloadPresets();
      await renderPresetManageList();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '削除';
    removeBtn.addEventListener('click', async () => {
      const ok = await showAppConfirm(`「${p.name}」を削除しますか？`, 'プリセットの削除');
      if (!ok) return;
      await window.virtualMixDeck.presetRemove(p.id);
      await reloadPresets();
      await renderPresetManageList();
    });

    row.appendChild(renameBtn);
    row.appendChild(overwriteBtn);
    row.appendChild(removeBtn);
    presetManageListEl.appendChild(row);
  });
}

document.getElementById('preset-manage-btn').addEventListener('click', async () => {
  await reloadPresets();
  await renderPresetManageList();
  presetManageDialogEl.showModal();
});

document.getElementById('preset-manage-close').addEventListener('click', () => presetManageDialogEl.close());

// ---- 音量ミキサーパネル ----

const mixerListEl = document.getElementById('mixer-list');
const mixerAddDialogEl = document.getElementById('mixer-add-dialog');
const mLabelEl = document.getElementById('m-label');
const mIconHiddenEl = document.getElementById('m-icon');
const mIconPickerEl = document.getElementById('m-icon-picker');
const mCustomIconHiddenEl = document.getElementById('m-custom-icon');

// ---- ミキサー追加ダイアログ: Wave Linkチャンネル選択 ----
const mWavelinkStatusEl = document.getElementById('m-wavelink-status');
const mChannelEl = document.getElementById('m-channel');
const mLocalMixEl = document.getElementById('m-localMix');
const mStreamMixEl = document.getElementById('m-streamMix');

async function loadWaveLinkChannelOptions() {
  mChannelEl.innerHTML = '';
  mLocalMixEl.innerHTML = '';
  mStreamMixEl.innerHTML = '';
  mWavelinkStatusEl.textContent = '読み込み中...';
  const result = await window.virtualMixDeck.wavelinkListChannels();
  if (!result.ok) {
    mWavelinkStatusEl.textContent = `Wave Linkに接続できません: ${result.error}`;
    return;
  }
  if (result.channels.length === 0 || result.mixes.length === 0) {
    mWavelinkStatusEl.textContent = 'Wave Link側にチャンネルまたはミックスがありません';
    return;
  }
  mWavelinkStatusEl.textContent = '';
  for (const c of result.channels) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    mChannelEl.appendChild(opt);
  }
  for (const m of result.mixes) {
    const optL = document.createElement('option');
    optL.value = m.id;
    optL.textContent = m.name;
    mLocalMixEl.appendChild(optL);
    const optS = document.createElement('option');
    optS.value = m.id;
    optS.textContent = m.name;
    mStreamMixEl.appendChild(optS);
  }
  // 実機確認済みのミックス名（Personal Mix / Stream Mix）から、ローカル🎧/配信📡ゲージへの
  // 割り当てをあらかじめ推測しておく。一致しない環境では一覧の先頭のままなのでユーザーが選び直す。
  const byName = (needle) => result.mixes.find((m) => m.name.toLowerCase().includes(needle));
  const personal = byName('personal');
  const streamMix = byName('stream');
  if (personal) mLocalMixEl.value = personal.id;
  if (streamMix) mStreamMixEl.value = streamMix.id;
}

// ---- 配信キャプチャ対象ウィンドウのピッカー ----
// 同じ実行ファイルで複数ウィンドウが開いているアプリ（Chrome等）向けに、OBS上で実際に
// キャプチャするウィンドウをユーザーに選ばせる。プロセス名の末尾一致だけでは無音の
// ウィンドウ（例: 空の「新しいタブ」）を誤って選んでしまう不具合が実機で確認されたため。
const windowPickDialogEl = document.getElementById('window-pick-dialog');
const windowPickListEl = document.getElementById('window-pick-list');
const windowPickCancelEl = document.getElementById('window-pick-cancel');

function openWindowPicker(processName, currentHint) {
  return new Promise(async (resolve) => {
    if (!processName) {
      await showAppAlert('先に対象プロセス名を入力してください');
      resolve(null);
      return;
    }
    const result = await window.virtualMixDeck.obsListWindowCandidates(processName);
    if (!result.ok) {
      await showAppAlert(result.error, 'エラー');
      resolve(null);
      return;
    }

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    windowPickListEl.innerHTML = '';
    if (result.candidates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'app-pick-empty';
      empty.textContent = '対象アプリのウィンドウが見つかりません（起動しているか確認してください）';
      windowPickListEl.appendChild(empty);
    } else {
      result.candidates.forEach((c) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'app-pick-item';
        item.textContent = c.itemValue === currentHint ? `● ${c.title}` : c.title;
        item.addEventListener('click', () => {
          finish(c.itemValue);
          windowPickDialogEl.close();
        });
        windowPickListEl.appendChild(item);
      });
    }
    // キャンセルボタン、Escキー、背景クリック等どの経路で閉じてもcloseイベントは
    // 必ず発火するため、「選択されずに閉じた」場合の後始末（null解決）はここに一本化する。
    windowPickDialogEl.addEventListener('close', () => finish(null), { once: true });
    windowPickDialogEl.showModal();
  });
}

windowPickCancelEl.addEventListener('click', () => windowPickDialogEl.close());

function buildGaugeRow(kind, iconFile) {
  const row = document.createElement('div');
  row.className = 'mixer-gauge';
  row.dataset.kind = kind;
  row.innerHTML = `
    <span class="mixer-gauge-icon-wrap"><img class="mixer-gauge-icon" src="${iconUrl(iconFile)}" alt="${kind}" /></span>
    <div class="mixer-gauge-track"><div class="mixer-gauge-fill" style="width:0%"></div></div>
    <span class="mixer-gauge-pct">--%</span>
  `;
  return row;
}

function bindGaugeInteraction(trackEl, onSet) {
  let dragging = false;
  const rectRatio = (e) => {
    const rect = trackEl.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  // mousemoveは1秒間に100回以上発火しうるが、onSetはIPC経由でOBS WebSocketまで
  // 往復する非同期処理。素早くドラッグすると呼び出しが際限なく並行実行され、同じ
  // OBS入力ソースへの操作が競合してOBSごと落ちる不具合があったため、直前の呼び出しが
  // 完了するまで次の呼び出しを溜め込み、完了後に最新値だけを1回送る形に絞る。
  let pendingRatio = null;
  let inFlight = false;
  const dispatch = async () => {
    if (inFlight || pendingRatio === null) return;
    const ratio = pendingRatio;
    pendingRatio = null;
    inFlight = true;
    try {
      await onSet(ratio);
    } finally {
      inFlight = false;
      if (pendingRatio !== null) dispatch();
    }
  };
  const request = (ratio) => {
    pendingRatio = ratio;
    dispatch();
  };

  trackEl.addEventListener('mousedown', (e) => {
    if (trackEl.classList.contains('disabled')) return;
    dragging = true;
    trackEl.closest('.mixer-entry').dataset.dragging = '1';
    request(rectRatio(e));
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    request(rectRatio(e));
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    trackEl.closest('.mixer-entry').dataset.dragging = '';
  });

  // マウスホイールで1%刻みの微調整をできるようにする。ドラッグと同じrequest()経由
  // なので、勢いよく回してもOBS/ヘルパーへの呼び出しは直列化されたまま。
  trackEl.addEventListener(
    'wheel',
    (e) => {
      if (trackEl.classList.contains('disabled')) return;
      e.preventDefault();
      const fill = trackEl.querySelector('.mixer-gauge-fill');
      const current = (parseFloat(fill.style.width) || 0) / 100;
      const delta = e.deltaY < 0 ? 0.01 : -0.01;
      request(Math.min(1, Math.max(0, current + delta)));
    },
    { passive: false }
  );
}

function setMuteVisual(rowEl, muted) {
  rowEl.dataset.muted = muted ? '1' : '';
  // 赤枠(box-shadow)はアイコンの薄暗く表示する演出(opacity/grayscale)と別要素
  // (`.mixer-gauge-icon-wrap`)に分離してある。同一要素にopacityと重ねると、
  // opacityが赤枠まで一緒に薄めてしまい視認できなくなるため。
  rowEl.querySelector('.mixer-gauge-icon-wrap').classList.toggle('muted', !!muted);
  rowEl.querySelector('.mixer-gauge-track').classList.toggle('muted', !!muted);
  const card = rowEl.closest('.mixer-entry');
  if (card) updateEntryMuteIndicator(card);
}

// 大アイコン（アプリアイコン）は、ローカル・配信の両方がミュート済みかどうかで
// 見た目を切り替える「全体ミュート状態インジケーター」として使う。
function updateEntryMuteIndicator(card) {
  const localRow = card.querySelector('.mixer-gauge[data-kind="local"]');
  const streamRow = card.querySelector('.mixer-gauge[data-kind="stream"]');
  const bothMuted = localRow?.dataset.muted === '1' && streamRow?.dataset.muted === '1';
  card.querySelector('.mixer-entry-icon-wrap')?.classList.toggle('muted', !!bothMuted);
}

function setGaugeVisual(rowEl, level, found, muted) {
  const fill = rowEl.querySelector('.mixer-gauge-fill');
  const pct = rowEl.querySelector('.mixer-gauge-pct');
  const track = rowEl.querySelector('.mixer-gauge-track');
  if (!found) {
    fill.style.width = '0%';
    pct.textContent = '--%';
    track.classList.add('disabled');
    setMuteVisual(rowEl, false);
    return;
  }
  track.classList.remove('disabled');
  const pctVal = Math.round(level * 100);
  fill.style.width = `${pctVal}%`;
  pct.textContent = `${pctVal}%`;
  setMuteVisual(rowEl, muted);
}

function buildMixerCard(entry) {
  const isWavelink = (entry.sourceType || 'process') === 'wavelink';
  const card = document.createElement('div');
  card.className = 'mixer-entry';
  if (entry.processName) card.dataset.processName = entry.processName;
  card.dataset.id = entry.id;

  const iconCol = document.createElement('div');
  iconCol.className = 'mixer-entry-icon-col';
  const nameDiv = document.createElement('div');
  nameDiv.className = 'mixer-entry-name';
  nameDiv.textContent = entry.label;
  const iconWrap = document.createElement('span');
  iconWrap.className = 'mixer-entry-icon-wrap';
  const iconImg = document.createElement('img');
  iconImg.className = 'mixer-entry-icon';
  iconImg.src = resolveIconUrl(entry);
  iconImg.alt = '';
  iconWrap.appendChild(iconImg);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'mixer-entry-remove';
  removeBtn.textContent = '削除';
  // 同じ実行ファイルで複数ウィンドウが立っているアプリ（Chrome等）向けに、配信キャプチャ
  // 対象ウィンドウを後から選び直せるボタン。Chromeのタブ入れ替え等で対象ウィンドウを
  // 変えたい場合や、追加時に指定し忘れた場合に使う。
  const windowBtn = document.createElement('button');
  windowBtn.type = 'button';
  windowBtn.className = 'mixer-entry-window';
  windowBtn.textContent = '対象ウィンドウ';
  // nameDivをアイコン列の中に置くと、その分だけアイコンの見た目の中心がフェーダー列の
  // 中心よりも下にズレてしまう（実機報告で非対称に見えると指摘された）ため、名前ラベルは
  // アイコン列/フェーダー列の外（カード最上段）に独立させ、アイコン列にはアイコンのみを
  // 置いて縦中央寄せすることで、アイコンの中心とフェーダー列の中心を一致させる。
  iconCol.appendChild(iconWrap);
  windowBtn.addEventListener('click', async () => {
    const chosen = await openWindowPicker(entry.processName, entry.windowHint);
    if (!chosen) return;
    entry.windowHint = chosen;
    await window.virtualMixDeck.mixerSetWindowHint(entry.id, chosen);
    await refreshMixerVolumes();
  });
  removeBtn.addEventListener('click', async () => {
    await window.virtualMixDeck.mixerRemove(entry.id);
    await reloadMixerEntries();
  });

  const gauges = document.createElement('div');
  gauges.className = 'mixer-entry-gauges';
  const localRow = buildGaugeRow('local', LOCAL_ICON);
  const streamRow = buildGaugeRow('stream', STREAM_ICON);
  gauges.appendChild(localRow);
  gauges.appendChild(streamRow);

  bindGaugeInteraction(localRow.querySelector('.mixer-gauge-track'), async (ratio) => {
    setGaugeVisual(localRow, ratio, true, localRow.dataset.muted === '1');
    await window.virtualMixDeck.mixerSetVolume(entry.id, 'local', ratio);
  });
  bindGaugeInteraction(streamRow.querySelector('.mixer-gauge-track'), async (ratio) => {
    setGaugeVisual(streamRow, ratio, true, streamRow.dataset.muted === '1');
    await window.virtualMixDeck.mixerSetVolume(entry.id, 'stream', ratio);
  });

  // 小アイコン（🎧/📡）クリックで、そのチャンネル単体のミュートを切り替える。
  async function toggleChannelMute(row, channel) {
    const next = row.dataset.muted !== '1';
    setMuteVisual(row, next);
    await window.virtualMixDeck.mixerSetMute(entry.id, channel, next);
  }
  localRow.querySelector('.mixer-gauge-icon').addEventListener('click', () => toggleChannelMute(localRow, 'local'));
  streamRow.querySelector('.mixer-gauge-icon').addEventListener('click', () => toggleChannelMute(streamRow, 'stream'));

  // 大アイコンクリックで、ローカル・配信の両方を一括ミュート/解除する。
  // 現在どちらか一方でも鳴っていれば「両方ミュート」、両方ミュート済みなら「両方解除」。
  iconImg.addEventListener('click', async () => {
    const bothMuted = localRow.dataset.muted === '1' && streamRow.dataset.muted === '1';
    const next = !bothMuted;
    setMuteVisual(localRow, next);
    setMuteVisual(streamRow, next);
    await Promise.all([
      window.virtualMixDeck.mixerSetMute(entry.id, 'local', next),
      window.virtualMixDeck.mixerSetMute(entry.id, 'stream', next),
    ]);
  });

  // 「削除」と「対象ウィンドウ」の文字の高さが噛み合わない（片方はアイコン列、
  // 片方はフェーダー列の下に付いていたためカラムの高さが揃わずズレて見えた）不具合が
  // 実機報告されたため、上段(アイコン+フェーダー)と下段(削除+対象ウィンドウ)の
  // 2行構成にし、下段は上段と同じカラム幅(アイコン列56px / フェーダー列flex1)で
  // 揃えることで、両ボタンの高さが必ず一致するようにする。
  const topRow = document.createElement('div');
  topRow.className = 'mixer-entry-top';
  topRow.appendChild(iconCol);
  topRow.appendChild(gauges);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'mixer-entry-actions';
  actionsRow.appendChild(removeBtn);
  // 「対象ウィンドウ」再選択はプロセス方式のみ意味を持つ（Wave Linkチャンネルは
  // ウィンドウキャプチャではなくWave Link側の音声チャンネルを直接参照するため）。
  if (!isWavelink) actionsRow.appendChild(windowBtn);

  card.appendChild(nameDiv);
  card.appendChild(topRow);
  card.appendChild(actionsRow);
  return card;
}

let mixerEntries = [];

async function reloadMixerEntries() {
  mixerEntries = await window.virtualMixDeck.mixerList();
  mixerListEl.innerHTML = '';
  mixerEntries.forEach((entry) => mixerListEl.appendChild(buildMixerCard(entry)));
  await refreshMixerVolumes();
}

async function refreshMixerVolumes() {
  for (const entry of mixerEntries) {
    const card = mixerListEl.querySelector(`.mixer-entry[data-id="${entry.id}"]`);
    if (!card || card.dataset.dragging === '1') continue;
    const { local, stream } = await window.virtualMixDeck.mixerGetVolumes(entry.id);
    setGaugeVisual(card.querySelector('.mixer-gauge[data-kind="local"]'), local.level, local.found, local.muted);
    setGaugeVisual(card.querySelector('.mixer-gauge[data-kind="stream"]'), stream.level, stream.found, stream.muted);
    // windowHintを保存したウィンドウが（Chromeのタブ切り替え等でタイトルが変わり）見つからず
    // 候補の先頭へフォールバックした場合、ユーザーに再選択を促す印を「対象ウィンドウ」ボタンに出す。
    const windowBtn = card.querySelector('.mixer-entry-window');
    if (windowBtn) {
      windowBtn.classList.toggle('hint-stale', !!stream.hintStale);
      windowBtn.textContent = stream.hintStale ? '⚠ 対象ウィンドウ（再選択推奨）' : '対象ウィンドウ';
    }
  }
}

// ショートカットからの音量操作を、次回ポーリング（最大3秒後）を待たずゲージへ即時反映する。
window.virtualMixDeck.onMixerVolumeChanged(({ processName, channel, level }) => {
  const card = mixerListEl.querySelector(`.mixer-entry[data-process-name="${CSS.escape(processName)}"]`);
  if (!card || card.dataset.dragging === '1') return;
  const row = card.querySelector(`.mixer-gauge[data-kind="${channel === 'local' ? 'local' : 'stream'}"]`);
  if (row) setGaugeVisual(row, level, true, row.dataset.muted === '1');
});

document.getElementById('mixer-add-btn').addEventListener('click', () => {
  mLabelEl.value = '';
  mIconHiddenEl.value = DEFAULT_BUTTON_ICON;
  mCustomIconHiddenEl.value = '';
  renderIconPicker(mIconPickerEl, mIconHiddenEl, DEFAULT_BUTTON_ICON, mCustomIconHiddenEl, '');
  loadWaveLinkChannelOptions();
  mixerAddDialogEl.showModal();
});

document.getElementById('m-cancel').addEventListener('click', () => mixerAddDialogEl.close());

document.getElementById('m-save').addEventListener('click', async () => {
  if (!mChannelEl.value || !mLocalMixEl.value || !mStreamMixEl.value) {
    await showAppAlert('チャンネルとミックスを選択してください');
    return;
  }
  const channelName = mChannelEl.selectedOptions[0]?.textContent || '';
  const result = await window.virtualMixDeck.mixerAdd({
    sourceType: 'wavelink',
    channelId: mChannelEl.value,
    channelName,
    localMixId: mLocalMixEl.value,
    streamMixId: mStreamMixEl.value,
    label: mLabelEl.value || channelName,
    iconFile: mIconHiddenEl.value || DEFAULT_BUTTON_ICON,
    customIcon: mCustomIconHiddenEl.value || null,
  });
  if (result && result.error) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await reloadMixerEntries();
  mixerAddDialogEl.close();
});

// ---- OBS接続設定 ----

const obsDialogEl = document.getElementById('obs-dialog');
const obsStatusEl = document.getElementById('obs-status');
const obsUrlEl = document.getElementById('obs-url');
const obsPasswordEl = document.getElementById('obs-password');

async function refreshObsStatus() {
  const status = await window.virtualMixDeck.obsGetStatus();
  obsStatusEl.textContent = `OBS: ${status.connected ? '接続済み' : '未接続'}`;
  obsStatusEl.classList.toggle('connected', status.connected);
}

document.getElementById('obs-settings-btn').addEventListener('click', async () => {
  const conn = await window.virtualMixDeck.obsGetConnection();
  obsUrlEl.value = conn.url || '';
  obsPasswordEl.value = conn.password || '';
  obsDialogEl.showModal();
});

document.getElementById('obs-cancel').addEventListener('click', () => obsDialogEl.close());

document.getElementById('obs-connect').addEventListener('click', async () => {
  const result = await window.virtualMixDeck.obsConnect(obsUrlEl.value, obsPasswordEl.value);
  await refreshObsStatus();
  if (!result.ok) {
    await showAppAlert(`OBS接続失敗: ${result.error}`, 'エラー');
    return;
  }
  obsDialogEl.close();
});

// ---- 自作メニューバー ----

document.querySelectorAll('.menu-bar-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    if (e.target.closest('.menu-bar-dropdown-item')) return;
    document.querySelectorAll('.menu-bar-item').forEach((i) => {
      if (i !== item) i.classList.remove('open');
    });
    item.classList.toggle('open');
  });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-bar-item')) {
    document.querySelectorAll('.menu-bar-item.open').forEach((i) => i.classList.remove('open'));
  }
});

const HELP_TEXTS = {
  'help-shortcut':
    'ショートカットボタンの登録方法：\n' +
    '1. ヘッダーの「編集モード」ボタンをONにする\n' +
    '2. 空いているマス（＋表示）をクリックする\n' +
    '3. 種類（アプリ起動／URLを開く／音量操作／ホットキー送信／OBS操作）を選び、必要な項目とアイコンを設定する\n' +
    '4. 「保存」で登録完了。編集モードをOFFにするとクリックでボタンを実行できます。',
  'help-mixer':
    '音量ミキサーの使い方：\n' +
    '右上の「＋」でミキサーに操作したいアプリを追加します。\n' +
    '上段はローカル（自分のPCで聞こえる音量）、下段は配信（OBS側の音量）のゲージです。\n' +
    'ゲージをクリック／ドラッグすると、その場で音量を変更できます。\n' +
    '同じアプリ（例: Chrome）で複数のウィンドウを開いている場合、配信フェーダーが' +
    '意図しないウィンドウ（無音のタブ等）を捉えてしまうことがあります。その場合は' +
    'カードの「対象ウィンドウ」ボタンから、実際に音を鳴らしているウィンドウを選び直してください。',
  'help-obs':
    'OBS連携の設定方法：\n' +
    '1. OBS側で「ツール」→「WebSocketサーバー設定」を開き、サーバーを有効化してURL・パスワードを確認する\n' +
    '2. VirtualMixDeckのヘッダーにある「OBS設定」ボタンから同じURL・パスワードを入力して「接続」\n' +
    '3. 接続に成功するとヘッダーの表示が「OBS: 接続済み」になります。',
  'help-preset':
    'プリセットの使い方：\n' +
    'プリセットは、全ページ分のショートカット構成をまとめて名前付きで保存・切替できる機能です。\n' +
    '「現在の構成を保存」で今の全ページ構成を新規プリセットとして保存し、\n' +
    'プルダウンで選んで「読み込む」と、その構成に丸ごと置き換わります（未保存の変更は失われるので注意）。\n' +
    '「管理」から既存プリセットの上書き保存・名前変更・削除ができます。',
};

document.getElementById('win-minimize-btn').addEventListener('click', () => {
  window.virtualMixDeck.windowMinimize();
});
document.getElementById('win-close-btn').addEventListener('click', () => {
  window.virtualMixDeck.windowClose();
});

document.querySelectorAll('.menu-bar-dropdown-item').forEach((item) => {
  item.addEventListener('click', () => {
    if (!item.classList.contains('disabled')) {
      const action = item.dataset.action;
      if (action === 'reload') window.virtualMixDeck.appMenuReload();
      else if (action === 'toggle-devtools') window.virtualMixDeck.appMenuToggleDevTools();
      else if (action === 'quit') window.virtualMixDeck.appMenuQuit();
      else if (action === 'open-license') openLicenseDialog();
      else if (action === 'open-feedback') openFeedbackDialog();
      else if (action in HELP_TEXTS) showAppAlert(HELP_TEXTS[action], item.textContent);
    }
    document.querySelectorAll('.menu-bar-item.open').forEach((i) => i.classList.remove('open'));
  });
});

// ---- 購入・ライセンス ----

const licenseDialogEl = document.getElementById('license-dialog');
const licenseStatusEl = document.getElementById('license-status');
const licensePurchaseSectionEl = document.getElementById('license-purchase-section');
const licenseEmailEl = document.getElementById('license-email');
const licenseKeyInputEl = document.getElementById('license-key-input');

async function openLicenseDialog() {
  const status = await window.virtualMixDeck.licenseGetStatus();
  if (status.unlocked) {
    licenseStatusEl.textContent = '✅ 有料版が有効です。ショートカット4×5枠・ミキサー無制限・プリセット管理・複数ページをご利用いただけます。';
    licensePurchaseSectionEl.hidden = true;
  } else {
    licenseStatusEl.textContent = '無料版でご利用中です。';
    licensePurchaseSectionEl.hidden = false;
  }
  licenseKeyInputEl.value = '';
  licenseDialogEl.showModal();
}

// ---- ライセンスキー確認（メール＋確認コード） ----
// 一般利用者向けには「ライセンスキーが見つからない場合」のメール確認機能に見える表示だが、
// 内部的には決済方針.md記載の開発者アカウント限定アンロックと同じ確認コードログインを使う。
// 開発者本人以外がこのフローを完了しても、isUnlocked()側の判定でunlocked:falseが返るだけで
// 見た目上は「ライセンス情報が見つからない」という自然な結果になる（devAuthLogoutのIPCは
// UIから外したが内部関数としては残し、必要な際はコンソール等から呼び出せる）。

const devAuthEmailEl = document.getElementById('dev-auth-email');
const devAuthCodeEl = document.getElementById('dev-auth-code');

document.getElementById('dev-auth-request-btn').addEventListener('click', async () => {
  const email = devAuthEmailEl.value.trim();
  if (!email) {
    await showAppAlert('メールアドレスを入力してください');
    return;
  }
  const result = await window.virtualMixDeck.devAuthRequestCode(email);
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await showAppAlert('確認コードを送信しました。メールをご確認ください。');
});

document.getElementById('dev-auth-verify-btn').addEventListener('click', async () => {
  const email = devAuthEmailEl.value.trim();
  const code = devAuthCodeEl.value.trim();
  const result = await window.virtualMixDeck.devAuthVerifyCode(email, code);
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  devAuthCodeEl.value = '';
  if (result.unlocked) {
    await showAppAlert('ライセンス情報を確認できました。');
    await reload();
  } else {
    await showAppAlert('このメールアドレスに紐づくライセンス情報が見つかりませんでした。');
  }
});

document.getElementById('license-close').addEventListener('click', () => licenseDialogEl.close());

document.getElementById('license-purchase-btn').addEventListener('click', async () => {
  const email = licenseEmailEl.value.trim();
  if (!email) {
    await showAppAlert('メールアドレスを入力してください');
    return;
  }
  const result = await window.virtualMixDeck.licenseStartPurchase(email);
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await showAppAlert('ブラウザで決済ページを開きました。お支払い完了後、登録したメールアドレスにライセンスキーが届きます。');
});

document.getElementById('license-verify-btn').addEventListener('click', async () => {
  const result = await window.virtualMixDeck.licenseVerify(licenseKeyInputEl.value);
  if (!result.ok) {
    await showAppAlert(result.error, 'エラー');
    return;
  }
  await showAppAlert('有料機能を解除しました！');
  licenseDialogEl.close();
  await reload();
});

// ---- フィードバック ----

const feedbackDialogEl = document.getElementById('feedback-dialog');
const feedbackSubjectEl = document.getElementById('feedback-subject');
const feedbackBodyEl = document.getElementById('feedback-body');

function openFeedbackDialog() {
  feedbackDialogEl.showModal();
}

document.getElementById('feedback-cancel').addEventListener('click', () => feedbackDialogEl.close());

document.getElementById('feedback-send').addEventListener('click', async () => {
  const subject = feedbackSubjectEl.value.trim();
  const body = feedbackBodyEl.value.trim();
  if (!subject && !body) {
    await showAppAlert('件名または本文を入力してください');
    return;
  }
  const result = await window.virtualMixDeck.sendFeedback(subject, body);
  if (!result.ok) {
    await showAppAlert(`送信に失敗しました: ${result.error}`, 'エラー');
    return;
  }
  feedbackSubjectEl.value = '';
  feedbackBodyEl.value = '';
  feedbackDialogEl.close();
  await showAppAlert('フィードバックを送信しました。ありがとうございます！');
});

// ---- 初期化 ----

async function init() {
  allIcons = await window.virtualMixDeck.listIcons();
  await reload();
  await refreshObsStatus();
  await reloadMixerEntries();
  await reloadPresets();
  const version = await window.virtualMixDeck.getAppVersion();
  document.getElementById('version-display').textContent = `現在のバージョン: v${version}`;
  setInterval(refreshMixerVolumes, 3000);
}

init();
