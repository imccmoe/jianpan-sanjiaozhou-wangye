import { compileSong, crc32, formatDuration, startPreview, stopPreview } from "./music-engine.js";
import { inspectUpgradeDevices, MusicHidDevice, requestBootloader, uploadFirmware, webHidSupported } from "./device.js";

const APP_VERSION = "1.08";
const TEST_STAGE_LABELS = {
  1: "阶段 1 · 新接入未测试",
  2: "阶段 2 · Qt 试听通过",
  3: "阶段 3 · 游戏实测通过",
};
const PLANET_POSITIONS = [
  [54, 70, 1.18], [30, 35, 0.72], [62, 22, 0.66], [76, 42, 0.72], [20, 58, 0.55],
  [45, 44, 0.82], [70, 70, 0.9], [84, 61, 0.55], [36, 70, 0.62], [16, 31, 0.56],
  [87, 28, 0.68], [43, 18, 0.58], [25, 78, 0.7], [59, 51, 0.6], [72, 18, 0.58],
  [12, 70, 0.54], [92, 76, 0.55], [33, 18, 0.52], [51, 83, 0.56], [81, 82, 0.58],
];
const PLANET_COLORS = ["#86ddd4", "#aeb9e7", "#f2aab3", "#8fd4cb", "#9fd9f1", "#d8bb75"];
const KEY_OPTIONS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((key) => [key, key]),
  ["Space", "Space"], ["Enter", "Enter"], ["Esc", "Esc"], ["Tab", "Tab"],
  ["↑", "Up"], ["↓", "Down"], ["←", "Left"], ["→", "Right"],
  ...Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`]),
];
const DEFAULT_MAPPINGS = [
  { mode: "single", modifiers: [], key: "A" },
  { mode: "single", modifiers: [], key: "Space" },
  { mode: "single", modifiers: [], key: "Enter" },
];

const state = {
  view: "library",
  libraryMode: "planet",
  search: "",
  stageFilter: 0,
  stageOverrides: readStageOverrides(),
  songs: [],
  selectedSongId: null,
  slotSongIds: readStorage("gxm_library_slots", [null, null, null]),
  previewSongId: null,
  mappingSlot: 0,
  mappings: readStorage("gxm_key_mappings", DEFAULT_MAPPINGS),
  devices: [],
  device: {
    connected: false,
    label: webHidSupported ? "未发现 GXM 键盘" : "浏览器不支持 WebHID",
    validMask: 0,
    keyMask: null,
    playing: false,
    activeSlot: -1,
    firmwareVersion: 0,
  },
  uploadingSlot: -1,
  uploadPercent: 0,
  firmware: null,
  upgrading: false,
};

const hid = new MusicHidDevice(() => {
  state.device = { ...state.device, connected: false, label: "设备已断开", keyMask: null, playing: false };
  render();
});
let toastTimer = 0;
let statusTimer = 0;

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(value) && value.length === 3 ? value : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function readStageOverrides() {
  try {
    const value = JSON.parse(localStorage.getItem("gxm_test_stage_overrides") || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function normalizeTestStage(value) {
  const stage = Number.parseInt(value, 10);
  return Math.max(1, Math.min(3, Number.isFinite(stage) ? stage : 1));
}

function stageLabel(song) {
  return TEST_STAGE_LABELS[normalizeTestStage(song.test_stage)];
}

function persist() {
  localStorage.setItem("gxm_library_slots", JSON.stringify(state.slotSongIds));
  localStorage.setItem("gxm_key_mappings", JSON.stringify(state.mappings));
  localStorage.setItem("gxm_test_stage_overrides", JSON.stringify(state.stageOverrides));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "info") {
  document.querySelector(".toast")?.remove();
  window.clearTimeout(toastTimer);
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  toastTimer = window.setTimeout(() => node.remove(), 3200);
}

function filteredSongs() {
  const query = state.search.trim().toLowerCase();
  return state.songs.filter((song) => {
    if (state.stageFilter && song.test_stage !== state.stageFilter) return false;
    return !query || `${song.title} ${song.author} ${song.difficulty} ${song.source} ${stageLabel(song)}`.toLowerCase().includes(query);
  });
}

function selectedSong() {
  const visible = filteredSongs();
  return visible.find((song) => song.id === state.selectedSongId) || visible[0] || null;
}

function slotSong(slot) {
  return state.songs.find((song) => song.id === state.slotSongIds[slot]) || null;
}

function sourceTag(song) {
  if (song.source.includes("参考1/")) return "参考1";
  if (song.source.includes("参考2/")) return "参考2";
  return "内置";
}

function mappingText(mapping) {
  const parts = mapping.mode === "combo" ? [...mapping.modifiers] : [];
  parts.push(mapping.key);
  return parts.join(" + ");
}

function footerText() {
  if (state.view === "mapping") return "键位配置仅保存在本次预览中 · 设备写入将在固件支持后开放";
  if (state.view === "device") return "设备维护 · 查看按键状态并在需要时更新固件";
  if (state.view === "about") return `GXM 音乐键盘 ${APP_VERSION}`;
  return "准备就绪 · 把音乐星球拖到 K1～K3，然后直接保存到键盘";
}

function render() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand-block"><strong>GXM</strong><span>把喜欢的音乐装进键盘</span></div>
        <div class="device-controls">
          <label for="device-select">我的设备</label>
          <select id="device-select" aria-label="我的设备">
            ${state.devices.length
              ? state.devices.map((device, index) => `<option value="${index}">${escapeHtml(device.productName || "GXM 键盘")}</option>`).join("")
              : `<option>${escapeHtml(state.device.label)}</option>`}
          </select>
          <button class="button" data-action="scan-device">重新检测</button>
          <button class="button primary" data-action="connect-device">连接</button>
          <span class="device-state ${state.device.connected ? "online" : ""}">${state.device.connected ? "已连接" : "未连接"}</span>
        </div>
      </header>
      <nav class="main-tabs" aria-label="主功能">
        ${[["library", "音乐星球"], ["mapping", "键位设置"], ["device", "设备维护"], ["about", "关于"]]
          .map(([id, label]) => `<button class="main-tab ${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}
      </nav>
      <main class="page">${renderPage()}</main>
      <footer>${escapeHtml(footerText())}</footer>
    </div>`;
  bindEvents();
}

function renderPage() {
  if (state.view === "mapping") return renderMapping();
  if (state.view === "device") return renderDevice();
  if (state.view === "about") return renderAbout();
  return renderLibrary();
}

function pageHeading(eyebrow, title, subtitle, aside = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${aside}</div>`;
}

function renderLibrary() {
  const songs = filteredSongs();
  const song = selectedSong();
  const shown = Math.min(songs.length, 20);
  const switches = `<div class="view-switch" role="group"><button class="${state.libraryMode === "planet" ? "active" : ""}" data-library-mode="planet">星球视图</button><button class="${state.libraryMode === "list" ? "active" : ""}" data-library-mode="list">全部音乐&nbsp; ${songs.length}</button><button class="button" data-action="reload-library">重新加载</button></div>`;
  return `
    ${pageHeading("发现音乐", "音乐星球", "像浏览星空一样选歌。单击查看，双击试听，也可以直接拖到 K1～K3。", switches)}
    <section class="search-strip"><strong>查找星球</strong><input id="song-search" value="${escapeHtml(state.search)}" placeholder="搜索歌名、作者、难度或测试阶段" /><select id="stage-filter" aria-label="测试阶段筛选"><option value="0">全部阶段</option>${Object.entries(TEST_STAGE_LABELS).map(([stage, label]) => `<option value="${stage}" ${state.stageFilter === Number(stage) ? "selected" : ""}>${label}</option>`).join("")}</select><span>${state.libraryMode === "planet" ? `星球展示 ${shown} / ${songs.length} 首` : `全部 ${songs.length} 首音乐`}</span></section>
    <div class="library-stage">
      ${state.libraryMode === "planet" ? renderPlanet(songs.slice(0, 20)) : renderSongList(songs)}
      ${renderSongDetail(song)}
    </div>
    <div class="slot-heading"><strong>拖到你的键盘</strong><span>把歌曲拖到 K1～K3，确认后直接点击对应的保存按钮。</span></div>
    <section class="slot-row">${[0, 1, 2].map(renderSlot).join("")}</section>`;
}

function renderPlanet(songs) {
  if (!songs.length) return `<div class="planet empty-state">没有找到匹配的音乐</div>`;
  return `<div class="planet" aria-label="音乐星球">${songs.map((song, index) => {
    const [x, y, scale] = PLANET_POSITIONS[index];
    const active = song.id === selectedSong()?.id;
    return `<button class="planet-song ${active ? "active" : ""}" draggable="true" data-song-id="${escapeHtml(song.id)}" style="--x:${x}%;--y:${y}%;--scale:${scale};--color:${PLANET_COLORS[index % PLANET_COLORS.length]};--delay:${-(index % 7)}s"><i></i><span>${escapeHtml(song.title)}</span></button>`;
  }).join("")}</div>`;
}

function renderSongList(songs) {
  if (!songs.length) return `<div class="song-list empty-state">没有找到匹配的音乐</div>`;
  return `<div class="song-list">${songs.map((song) => `<button class="song-list-item ${song.id === selectedSong()?.id ? "active" : ""}" draggable="true" data-song-id="${escapeHtml(song.id)}"><strong>${escapeHtml(song.title)}</strong><span>${escapeHtml(song.author)} · ${escapeHtml(song.difficulty)} · ${song.bpm} BPM · ${sourceTag(song)} · ${stageLabel(song)}</span></button>`).join("")}</div>`;
}

function renderSongDetail(song) {
  if (!song) return `<aside class="song-detail"><span class="detail-eyebrow">当前星球</span><h2>选择一颗音乐星球</h2><p>单击查看，双击可以直接试听。</p><span class="status-chip">等待选择</span><button class="preview-button" disabled>试听</button></aside>`;
  return `<aside class="song-detail">
    <span class="detail-eyebrow">当前星球</span>
    <h2>${escapeHtml(song.title)}</h2>
    <p>${escapeHtml(song.author)}</p>
    <p>${escapeHtml(song.difficulty)} · ${song.bpm} BPM · ${formatDuration(song.compiled.durationMs)}<br>${state.libraryMode === "planet" ? "按住星球拖到下方键位即可选中。" : "从列表拖到下方键位，双击可以直接试听。"}</p>
    <span class="status-chip">${stageLabel(song)}</span>
    <label class="stage-editor"><span>测试阶段</span><select id="detail-stage" aria-label="测试阶段">${Object.entries(TEST_STAGE_LABELS).map(([stage, label]) => `<option value="${stage}" ${song.test_stage === Number(stage) ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <button class="preview-button" data-action="preview-song" data-song-id="${escapeHtml(song.id)}">${state.previewSongId === song.id ? "停止" : "试听"}</button>
  </aside>`;
}

function renderSlot(slot) {
  const song = slotSong(slot);
  const uploading = state.uploadingSlot === slot;
  return `<article class="slot-target ${song ? "filled" : ""}" data-slot="${slot}">
    <span class="slot-badge">K${slot + 1}</span>
    <div><strong>${escapeHtml(song?.title || "拖到这里")}</strong><small>${song ? "拖入后点击右侧保存" : "拖入后点击右侧保存"}</small></div>
    <button class="save-button" data-action="save-slot" data-slot="${slot}" ${song && !state.upgrading ? "" : "disabled"}>${uploading ? `写入 ${state.uploadPercent}%` : `保存到 K${slot + 1}`}</button>
  </article>`;
}

function renderMapping() {
  const mapping = state.mappings[state.mappingSlot];
  return `
    ${pageHeading("键盘模式", "键位设置", "为三颗实体按键设计单键或组合键，先在这里完成你的键盘布局。", `<span class="preview-chip">UI 预览</span>`)}
    <section class="keyboard-deck"><div><strong>GXM 三键键盘</strong><span>选择一颗键帽进行设置</span></div>${state.mappings.map((item, slot) => `<button class="keycap ${state.mappingSlot === slot ? "active" : ""}" data-mapping-slot="${slot}"><b>K${slot + 1}</b><span>${escapeHtml(mappingText(item))}</span></button>`).join("")}</section>
    <div class="mapping-layout">
      <section class="mapping-editor">
        <div class="section-heading"><h2>编辑 K${state.mappingSlot + 1}</h2><span>修改会暂存在本次配置中</span></div>
        <div class="form-row"><label>触发方式</label><div class="segmented"><button class="${mapping.mode === "single" ? "active" : ""}" data-map-mode="single">单键</button><button class="${mapping.mode === "combo" ? "active" : ""}" data-map-mode="combo">组合键</button></div></div>
        <div class="form-row"><label>修饰键</label><div class="modifier-row">${["Ctrl", "Shift", "Alt", "Win"].map((name) => `<label><input type="checkbox" data-modifier="${name}" ${mapping.modifiers.includes(name) ? "checked" : ""} ${mapping.mode === "single" ? "disabled" : ""}> ${name}</label>`).join("")}</div></div>
        <div class="form-row"><label for="key-capture">按键录入</label><div class="key-entry"><input id="key-capture" value="${escapeHtml(mappingText(mapping))}" readonly><select id="key-select">${KEY_OPTIONS.map(([label, value]) => `<option value="${value}" ${mapping.key === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div>
        <div class="output-box"><span>最终输出</span><strong>${escapeHtml(mappingText(mapping))}</strong></div>
        <div class="editor-actions"><button class="button" data-action="reset-mapping">恢复默认</button><button class="button primary" data-action="apply-mapping">应用到当前键位</button></div>
      </section>
      <aside class="mapping-summary">
        <h2>当前键盘布局</h2><p>三个键位会分别保留设置</p>
        ${state.mappings.map((item, slot) => `<div class="summary-row"><span>K${slot + 1}</span><strong>${escapeHtml(mappingText(item))}</strong></div>`).join("")}
        <div class="write-state"><span>设备写入</span><b>等待固件支持</b></div>
        <button class="button" disabled>写入键盘</button>
      </aside>
    </div>`;
}

function renderDevice() {
  const firmware = state.firmware;
  return `
    ${pageHeading("设备与支持", "设备维护", "查看实体按键状态，或在需要时更新键盘固件。")}
    <fieldset class="key-status"><legend>键盘按键状态</legend>${[0, 1, 2].map((slot) => {
      const pressed = state.device.connected && Boolean(state.device.keyMask & (1 << slot));
      return `<div class="${pressed ? "pressed" : ""}"><strong>K${slot + 1}</strong><span>${state.device.connected ? (pressed ? "按下" : "松开") : "未连接"}</span></div>`;
    }).join("")}</fieldset>
    <section class="firmware-card">
      <h2>固件更新</h2><p>更新不会清除 K1～K3 中的音乐。升级中途断开时，可以重新选择同一文件继续。请选择项目默认 APP 文件 <code>../CH32V203C8T/obj/CH32V203C8T.hex</code>。</p>
      <div class="firmware-file"><span>${firmware ? escapeHtml(firmware.summary) : "尚未选择更新文件"}</span><label class="button">选择更新文件<input id="firmware-input" type="file" accept=".hex,text/plain"></label></div>
      <div class="progress"><span style="width:${firmware?.progress || 0}%"></span></div>
      <button class="button primary update-button" data-action="start-update" ${firmware?.valid && !state.upgrading ? "" : "disabled"}>${state.upgrading ? "正在更新" : "开始更新"}</button>
      <pre class="upgrade-log">${escapeHtml(firmware?.log?.join("\n") || "更新过程会显示在这里")}</pre>
    </section>`;
}

function renderAbout() {
  return `
    ${pageHeading("ABOUT GXM", "关于 GXM 音乐键盘", "它如何工作，以及为什么正常的音乐演奏通常不具备外挂特征。")}
    <section class="process-flow">${["本地乐谱", "GXM 芯片", "标准 USB HID", "游戏按键响应"].map((text, index) => `${index ? "<i>→</i>" : ""}<span>${text}</span>`).join("")}</section>
    <section class="about-section"><h2>专业原理</h2><p>GXM 是一套独立运行的嵌入式 USB HID 音乐控制器。PC 端首先将简谱编译为带时间信息的 HID 事件序列，再通过设备通信接口写入微控制器的非易失存储器。按下 K1～K3 后，音乐播放和时序调度完全由设备端完成，并以标准键盘、鼠标 HID Report 的形式提交给操作系统。</p><p>它不申请游戏进程句柄，不读取或写入游戏内存，不注入 DLL，不修改游戏文件与网络数据，也不安装用于干预游戏的内核驱动。从系统边界看，游戏接收到的是操作系统输入栈中的标准外设事件，而不是进程内部被篡改的数据。</p></section>
    <section class="about-section"><h2>用大白话讲</h2><p>它不像外挂那样“钻进游戏里”改东西，更像一把会照着乐谱自动按琴键的外置电子琴。歌曲存在键盘自己的芯片里，你按下 K1、K2 或 K3，它就像普通键盘一样把对应按键送给电脑；关闭 GXM 软件后，设备里的歌曲也可以独立播放。</p></section>
    <section class="about-section caution"><h2>为什么正常演奏通常不会触发封禁</h2><p>反作弊系统重点识别的是代码注入、内存篡改、数据包修改、非法驱动和利用自动化获得竞技优势等行为。GXM 没有这些侵入式能力，它只通过标准外设通道完成音乐演奏，也不参与瞄准、移动、射击或战斗决策，因此在正常的乐器演奏场景下，通常不具备传统外挂的技术特征。</p><p>但必须说明：任何第三方硬件都不能代替游戏官方承诺“绝对不会封号”。游戏规则和反作弊策略可能更新，某些平台也可能把高精度自动输入统一视为宏。建议只用于游戏内乐器和娱乐演奏，不做无人值守循环，不绑定战斗操作，并始终遵守《三角洲行动》最新用户协议与官方公告。</p></section>`;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  }));
  document.querySelectorAll("[data-library-mode]").forEach((button) => button.addEventListener("click", () => {
    state.libraryMode = button.dataset.libraryMode;
    render();
  }));
  document.querySelector("#song-search")?.addEventListener("input", (event) => {
    state.search = event.target.value;
    state.selectedSongId = filteredSongs()[0]?.id || null;
    render();
    const input = document.querySelector("#song-search");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
  document.querySelector("#stage-filter")?.addEventListener("change", (event) => {
    state.stageFilter = Number(event.target.value);
    state.selectedSongId = filteredSongs()[0]?.id || null;
    render();
  });
  document.querySelector("#detail-stage")?.addEventListener("change", (event) => {
    const song = selectedSong();
    if (!song) return;
    song.test_stage = normalizeTestStage(event.target.value);
    state.stageOverrides[song.id] = song.test_stage;
    state.songs.sort((left, right) => left.test_stage - right.test_stage || left.catalogIndex - right.catalogIndex);
    persist();
    render();
  });
  document.querySelectorAll("[data-song-id]").forEach((node) => {
    node.addEventListener("click", () => { state.selectedSongId = node.dataset.songId; render(); });
    node.addEventListener("dblclick", () => previewSong(node.dataset.songId));
    node.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", node.dataset.songId));
  });
  document.querySelectorAll("[data-slot]").forEach((node) => {
    if (!node.classList.contains("slot-target")) return;
    node.addEventListener("dragover", (event) => { event.preventDefault(); node.classList.add("drag-over"); });
    node.addEventListener("dragleave", () => node.classList.remove("drag-over"));
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      assignSong(Number(node.dataset.slot), event.dataTransfer.getData("text/plain"));
    });
    node.addEventListener("click", (event) => {
      if (!event.target.closest("button") && selectedSong()) assignSong(Number(node.dataset.slot), selectedSong().id);
    });
  });
  document.querySelectorAll("[data-mapping-slot]").forEach((button) => button.addEventListener("click", () => {
    state.mappingSlot = Number(button.dataset.mappingSlot);
    render();
  }));
  document.querySelectorAll("[data-map-mode]").forEach((button) => button.addEventListener("click", () => {
    const mapping = state.mappings[state.mappingSlot];
    mapping.mode = button.dataset.mapMode;
    if (mapping.mode === "single") mapping.modifiers = [];
    render();
  }));
  document.querySelectorAll("[data-modifier]").forEach((input) => input.addEventListener("change", () => {
    const mapping = state.mappings[state.mappingSlot];
    mapping.modifiers = [...document.querySelectorAll("[data-modifier]:checked")].map((item) => item.dataset.modifier);
    render();
  }));
  document.querySelector("#key-select")?.addEventListener("change", (event) => {
    state.mappings[state.mappingSlot].key = event.target.value;
    render();
  });
  document.querySelector("#key-capture")?.addEventListener("keydown", captureKey);
  document.querySelector("#firmware-input")?.addEventListener("change", readFirmware);
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button)));
}

function captureKey(event) {
  event.preventDefault();
  const ignored = ["Control", "Shift", "Alt", "Meta"];
  if (ignored.includes(event.key)) return;
  const aliases = { " ": "Space", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
  const key = aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const mapping = state.mappings[state.mappingSlot];
  mapping.key = key;
  mapping.modifiers = [event.ctrlKey && "Ctrl", event.shiftKey && "Shift", event.altKey && "Alt", event.metaKey && "Win"].filter(Boolean);
  mapping.mode = mapping.modifiers.length ? "combo" : "single";
  render();
  document.querySelector("#key-capture")?.focus();
}

function handleAction(button) {
  const action = button.dataset.action;
  if (action === "preview-song") return previewSong(button.dataset.songId);
  if (action === "save-slot") return saveSlot(Number(button.dataset.slot));
  if (action === "scan-device") return scanDevices();
  if (action === "connect-device") return connectDevice();
  if (action === "reload-library") return loadCatalog(true);
  if (action === "reset-mapping") {
    state.mappings[state.mappingSlot] = structuredClone(DEFAULT_MAPPINGS[state.mappingSlot]);
    persist(); render(); showToast(`K${state.mappingSlot + 1} 已恢复默认设置`); return;
  }
  if (action === "apply-mapping") { persist(); showToast(`K${state.mappingSlot + 1} 已应用到本次配置`); return; }
  if (action === "start-update") return startFirmwareUpdate();
}

function assignSong(slot, songId) {
  if (!state.songs.some((song) => song.id === songId)) return;
  state.slotSongIds[slot] = songId;
  persist();
  render();
  showToast(`《${slotSong(slot).title}》已放到 K${slot + 1}`);
}

async function previewSong(songId) {
  const song = state.songs.find((item) => item.id === songId);
  if (!song) return;
  if (state.previewSongId === songId) {
    stopPreview();
    state.previewSongId = null;
    render();
    return;
  }
  state.previewSongId = songId;
  render();
  try {
    await startPreview(song.compiled, () => {
      state.previewSongId = null;
      render();
    });
  } catch (error) {
    state.previewSongId = null;
    render();
    showToast(`试听失败：${error.message}`, "error");
  }
}

async function scanDevices() {
  try {
    state.devices = await hid.authorizedDevices();
    state.device.label = state.devices.length ? (state.devices[0].productName || "GXM 键盘") : (webHidSupported ? "未发现 GXM 键盘" : "浏览器不支持 WebHID");
    render();
    showToast(state.devices.length ? `发现 ${state.devices.length} 台已授权设备` : "没有发现已授权的 GXM 键盘");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function connectDevice() {
  try {
    const status = await hid.connect({ request: true });
    state.device = {
      connected: true,
      label: hid.device.productName || "GXM 键盘",
      validMask: status.validMask,
      keyMask: status.keyMask,
      playing: status.playing,
      activeSlot: status.activeSlot,
      firmwareVersion: status.firmwareVersion,
    };
    state.devices = [hid.device];
    render();
    startStatusPolling();
    showToast("GXM 键盘已连接", "success");
  } catch (error) {
    showToast(error.message || "连接已取消", "error");
  }
}

function startStatusPolling() {
  window.clearInterval(statusTimer);
  statusTimer = window.setInterval(async () => {
    if (!state.device.connected || state.upgrading) return;
    try {
      const status = await hid.getStatus();
      Object.assign(state.device, {
        validMask: status.validMask, keyMask: status.keyMask, playing: status.playing,
        activeSlot: status.activeSlot, firmwareVersion: status.firmwareVersion,
      });
      if (state.view === "device") render();
    } catch {
      // A transient status miss does not disconnect a healthy HID handle.
    }
  }, 800);
}

async function saveSlot(slot) {
  const song = slotSong(slot);
  if (!song) return;
  if (!state.device.connected) {
    showToast("请先在右上角连接 GXM 键盘", "error");
    return;
  }
  state.uploadingSlot = slot;
  state.uploadPercent = 0;
  render();
  try {
    const status = await hid.upload(slot, song.compiled.packageBytes, (current, total) => {
      state.uploadPercent = Math.round(current * 100 / total);
      render();
    });
    state.device.validMask = status.validMask;
    showToast(`保存完成，《${song.title}》已经放进 K${slot + 1}`, "success");
  } catch (error) {
    showToast(`保存失败：${error.message}`, "error");
  } finally {
    state.uploadingSlot = -1;
    render();
  }
}

function firmwareVersionFromName(name) {
  const match = name.match(/(?:^|[^a-z0-9])v(\d+)\.(\d+)/i);
  return match ? ((Number(match[1]) << 16) | Number(match[2])) >>> 0 : 0;
}

function parseIntelHex(text, name) {
  const APP_BASE = 0x3100;
  const APP_END = 0xd000;
  const memory = new Map();
  let upper = 0;
  let eof = false;
  let mode = null;
  let sourceLow = Infinity;
  let sourceHigh = 0;
  const lines = String(text).split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) continue;
    if (eof) throw new Error(`第 ${lineIndex + 1} 行位于 EOF 记录之后`);
    if (!line.startsWith(":") || line.length < 11 || (line.length - 1) % 2) throw new Error(`第 ${lineIndex + 1} 行不是有效 Intel HEX`);
    if (!/^[0-9a-f]+$/i.test(line.slice(1))) throw new Error(`第 ${lineIndex + 1} 行含有非十六进制字符`);
    const record = Uint8Array.from(line.slice(1).match(/../g).map((pair) => Number.parseInt(pair, 16)));
    if (record.length !== record[0] + 5) throw new Error(`第 ${lineIndex + 1} 行长度无效`);
    if ([...record].reduce((sum, value) => sum + value, 0) & 0xff) throw new Error(`第 ${lineIndex + 1} 行校验和错误`);
    const offset = (record[1] << 8) | record[2];
    const type = record[3];
    const payload = record.slice(4, -1);
    if (type === 0) {
      for (let index = 0; index < payload.length; index += 1) {
        const source = upper + offset + index;
        const currentMode = source >= APP_BASE && source < APP_END ? "alias" : source >= 0x08003100 && source < 0x0800d000 ? "physical" : null;
        if (!currentMode) throw new Error(`地址 0x${source.toString(16).toUpperCase()} 超出 APP 分区`);
        if (mode && mode !== currentMode) throw new Error("HEX 混用了别名地址与物理地址");
        mode = currentMode;
        const normalized = currentMode === "physical" ? source - 0x08000000 : source;
        if (memory.has(normalized) && memory.get(normalized) !== payload[index]) throw new Error("HEX 存在冲突的重复数据");
        memory.set(normalized, payload[index]);
        sourceLow = Math.min(sourceLow, source);
        sourceHigh = Math.max(sourceHigh, source + 1);
      }
    } else if (type === 1) {
      if (record[0] !== 0) throw new Error("EOF 记录长度无效");
      eof = true;
    } else if (type === 2) {
      upper = ((payload[0] << 8) | payload[1]) << 4;
    } else if (type === 4) {
      upper = (((payload[0] << 8) | payload[1]) << 16) >>> 0;
    } else if (![3, 5].includes(type)) {
      throw new Error(`不支持的 HEX 记录类型 0x${type.toString(16)}`);
    }
  }
  if (!eof) throw new Error("Intel HEX 缺少 EOF 记录");
  if (!memory.has(APP_BASE)) throw new Error("APP 必须从 0x00003100（或 0x08003100）开始");
  const end = Math.max(...memory.keys()) + 1;
  const data = new Uint8Array(end - APP_BASE);
  data.fill(0xff);
  memory.forEach((value, address) => { data[address - APP_BASE] = value; });
  return { data, crc32: crc32(data), firmwareVersion: firmwareVersionFromName(name), sourceLow, sourceHigh, mode };
}

async function readFirmware(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const image = parseIntelHex(await file.text(), file.name);
    state.firmware = {
      ...image, valid: true, progress: 0,
      summary: `${file.name} · ${image.data.length.toLocaleString()} 字节 · CRC32 ${image.crc32.toString(16).toUpperCase().padStart(8, "0")}`,
      log: [`更新文件校验通过`, `APP 地址 0x${image.sourceLow.toString(16).toUpperCase()} - 0x${(image.sourceHigh - 1).toString(16).toUpperCase()}`],
    };
  } catch (error) {
    state.firmware = { valid: false, progress: 0, summary: `固件无效：${error.message}`, log: [error.message] };
    showToast(error.message, "error");
  }
  render();
}

async function startFirmwareUpdate() {
  if (!state.firmware?.valid || state.upgrading) return;
  state.upgrading = true;
  state.firmware.log.push("准备连接 GXM Bootloader");
  render();
  try {
    await inspectUpgradeDevices();
    let switchedFromApp = false;
    if (state.device.connected) {
      await hid.enterIap();
      switchedFromApp = true;
      state.device.connected = false;
      state.firmware.log.push("设备已进入更新模式");
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }
    const bootloader = await requestBootloader({ afterSwitch: switchedFromApp });
    await uploadFirmware(bootloader, state.firmware, (percent, message) => {
      state.firmware.progress = Math.max(0, Math.min(100, percent));
      if (state.firmware.log.at(-1) !== message) state.firmware.log.push(message);
      render();
    });
    state.firmware.log.push("固件升级完成");
    showToast("固件升级完成", "success");
    await bootloader.close();
  } catch (error) {
    state.firmware.log.push(`升级失败：${error.message}`);
    showToast(`固件升级失败：${error.message}`, "error");
  } finally {
    state.upgrading = false;
    render();
  }
}

async function loadCatalog(reload = false) {
  try {
    const response = await fetch(`./data/music-catalog.json${reload ? `?t=${Date.now()}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.songs = (payload.songs || [])
      .filter((song) => song.verified)
      .map((song, catalogIndex) => ({
        ...song,
        catalogIndex,
        test_stage: normalizeTestStage(state.stageOverrides[song.id] ?? song.test_stage),
        compiled: compileSong(song),
      }))
      .sort((left, right) => left.test_stage - right.test_stage || left.catalogIndex - right.catalogIndex);
    state.selectedSongId = state.songs.some((song) => song.id === state.selectedSongId) ? state.selectedSongId : state.songs[0]?.id || null;
    render();
    if (reload) showToast(`音乐库已重新加载，共 ${state.songs.length} 首`);
  } catch (error) {
    state.songs = [];
    render();
    showToast(`音乐库读取失败：${error.message}`, "error");
  }
}

render();
loadCatalog();
scanDevices();
