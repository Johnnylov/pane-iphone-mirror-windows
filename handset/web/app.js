const statusList = document.querySelector("#status");
const statusNote = document.querySelector("#status-note");
const devicesEl = document.querySelector("#devices");
const detail = document.querySelector("#detail");
const refresh = document.querySelector("#refresh");
const screenNote = document.querySelector("#screen-note");
const showScreen = document.querySelector("#show-screen");
const screenView = document.querySelector("#screen-view");
const phoneShell = document.querySelector("#phone-shell");
const placeholderHint = document.querySelector("#placeholder-hint");
const pillConnection = document.querySelector("#pill-connection");
const pillDevice = document.querySelector("#pill-device");
const toggleGuide = document.querySelector("#toggle-guide");
const runGuide = document.querySelector("#run-guide");
const workspace = document.querySelector("#workspace");
const remotePanel = document.querySelector("#remote-panel");
const restartScreen = document.querySelector("#restart-screen");
const phoneScreen = document.querySelector("#phone-screen");
const kbToggle = document.querySelector("#kb-toggle");
const wifiState = document.querySelector("#wifi-state");
const wifiPair = document.querySelector("#wifi-pair");
const wheelDialog = document.querySelector("#wheel-settings");
const MIRROR_PAGE = "/mirror.html";
const MIRROR_API = "/mirror";

function mirrorPageUrl(screen) {
  const params = new URLSearchParams();
  if (screen?.iosMajor != null && screen.iosMajor !== "") {
    params.set("iosMajor", String(screen.iosMajor));
  }
  const qs = params.toString();
  return qs ? `${MIRROR_PAGE}?${qs}` : MIRROR_PAGE;
}

let selectedUdid = null;
let screenTimer = 0;
let lastScreenIosMajor = null;
let transport = localStorage.getItem("handset-transport") === "wifi" ? "wifi" : "usb";
let wifiPaired = [];
let usbConnected = false;

document.querySelectorAll("[data-transport]").forEach((btn) => {
  btn.addEventListener("click", () => setTransport(btn.dataset.transport));
});
wifiPair.addEventListener("click", () => setUpWifi());
setTransport(transport, false);

function setTransport(value, reload = true) {
  transport = value === "wifi" ? "wifi" : "usb";
  localStorage.setItem("handset-transport", transport);
  document.querySelectorAll("[data-transport]").forEach((btn) => {
    const active = btn.dataset.transport === transport;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", String(active));
  });
  if (reload) load();
}

function renderWifi() {
  const ready = selectedUdid ? wifiPaired.includes(selectedUdid) : wifiPaired.length > 0;
  wifiState.textContent = ready ? "✓ Wi-Fi 已就绪" : "尚未设置 Wi-Fi";
  wifiState.classList.toggle("ok", ready);
  wifiPair.hidden = ready;
  wifiPair.disabled = !usbConnected;
  wifiPair.title = usbConnected ? "用数据线完成首次配对" : "请先插入数据线，完成 Wi-Fi 配对";
}

async function setUpWifi() {
  wifiPair.disabled = true;
  wifiPair.textContent = "正在设置…";
  try {
    const result = await postJson("/api/wifi/pair", { udid: selectedUdid });
    if (!result.ok) throw new Error(result.error || "Wi-Fi 设置失败。");
    screenNote.textContent = "Wi-Fi 配对完成。现在可以拔下数据线，选择 Wi-Fi 连接。";
    screenNote.className = "";
  } catch (error) {
    screenNote.textContent = error.message;
    screenNote.className = "warn";
  } finally {
    wifiPair.textContent = "设置 Wi-Fi";
    load();
  }
}

refresh.addEventListener("click", () => load());
showScreen.addEventListener("click", () => showPhone());
restartScreen.addEventListener("click", () => restartMirror());
wireRemoteControls();

toggleGuide.addEventListener("click", () => {
  const open = runGuide.hidden;
  runGuide.hidden = !open;
  toggleGuide.setAttribute("aria-expanded", String(open));
  if (open) runGuide.scrollIntoView({ behavior: "smooth", block: "start" });
});

async function load() {
  refresh.disabled = true;
  detail.hidden = true;
  detail.replaceChildren();
  try {
    const state = await getJson("/api/status");
    wifiPaired = state.wifi?.paired || [];
    usbConnected = (state.devices || []).length > 0;
    renderStatus(state);
    renderDevices(state.devices || []);
    renderWifi();
    renderScreen(state.screen);
    renderPills(state);
  } catch (error) {
    setPill(pillConnection, "已离线", "bad");
    statusNote.textContent = error.message;
    statusNote.className = "warn";
  } finally {
    refresh.disabled = false;
  }
}

function renderPills(state) {
  const driver = state.driver || {};
  const connected = (state.devices || []).length > 0;
  const overWifi = transport === "wifi" && wifiPaired.length > 0;
  if (state.screen?.phase === "running") {
    setPill(pillConnection, state.screen.transport === "wifi" ? "投屏中 · Wi-Fi" : "投屏中", "ok");
  } else if (overWifi) {
    setPill(pillConnection, "Wi-Fi 已就绪", "ok");
  } else if (state.error) {
    setPill(pillConnection, "连接出错", "bad");
  } else if (!driver.ready) {
    setPill(pillConnection, "请安装 Apple 设备", "warn");
  } else if (!connected) {
    setPill(pillConnection, "请连接 iPhone", "warn");
  } else if (state.developerMode === false) {
    setPill(pillConnection, "开发者模式已关闭", "warn");
  } else if (state.screen?.phase === "running") {
    setPill(pillConnection, "投屏中", "ok");
  } else {
    setPill(pillConnection, "已就绪", "ok");
  }

  if (!connected) {
    pillDevice.hidden = !overWifi;
    pillDevice.textContent = "Wi‑Fi";
    return;
  }
  pillDevice.hidden = false;
  const count = state.devices.length;
  pillDevice.textContent = count === 1 ? "1 台设备 · USB" : `${count} 台设备`;
}

function setPill(el, text, tone) {
  el.textContent = text;
  el.className = "pill" + (tone ? ` pill-${tone}` : "");
}

function renderStatus(state) {
  const library = state.library || {};
  const driver = state.driver || {};
  statusList.replaceChildren(
    ...row("客户端", library.ready ? "已就绪" : "未安装", library.ready),
    ...row("USB 服务", driver.ready ? "运行中" : "不可用", driver.ready),
    ...row("开发者模式", state.developerMode === false ? "关" : state.developerMode ? "开" : "—", state.developerMode !== false),
  );
  const connected = (state.devices || []).length > 0;
  if (state.developerMode === false) {
    statusNote.textContent =
      "在 iPhone 的「设置 → 隐私与安全性」中打开「开发者模式」，按提示重启并确认后再投屏。";
    placeholderHint.textContent = "请先在 iPhone 上开启开发者模式。";
    return;
  }
  statusNote.textContent =
    state.error ||
    (connected ? "已连接设备。点击「开始投屏」。" : driver.detail) ||
    "";
  statusNote.className = state.error || !driver.ready ? "warn" : "";
  if (!connected && (state.wifi?.paired || []).length) {
    statusNote.textContent = "未连接数据线。请选择 Wi-Fi，让 iPhone 保持解锁并连接同一网络，然后点击「开始投屏」。";
    statusNote.className = "";
    placeholderHint.textContent = "选择 Wi-Fi 后，点击「开始投屏」即可无线连接。";
  } else if (!connected) {
    placeholderHint.textContent = "用数据线连接 iPhone，解锁后点按「信任」。";
  }
}

function renderDevices(list) {
  devicesEl.replaceChildren();
  if (!list.length && transport === "wifi" && wifiPaired.length) {
    list = wifiPaired.map((udid) => ({ udid, connection: "Wi‑Fi", wifiOnly: true }));
  }
  if (!list.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "未检测到 iPhone。";
    devicesEl.append(item);
    selectedUdid = null;
    return;
  }
  if (list.length === 1) selectedUdid = list[0].udid;

  for (const device of list) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "device" + (device.udid === selectedUdid ? " selected" : "");
    button.type = "button";
    const name = document.createElement("span");
    name.className = "device-name";
    name.textContent = device.udid.slice(0, 8) + "…";
    const meta = document.createElement("span");
    meta.className = "device-meta";
    meta.textContent = device.connection || "USB";
    button.append(name, meta);
    button.addEventListener("click", () => {
      selectedUdid = device.udid;
      devicesEl.querySelectorAll(".device").forEach((el) => el.classList.remove("selected"));
      button.classList.add("selected");
      if (!device.wifiOnly) openDevice(device.udid);
      renderWifi();
    });
    item.append(button);
    devicesEl.append(item);
  }
  if (list.length === 1 && !list[0].wifiOnly) openDevice(list[0].udid);
}

async function openDevice(udid) {
  detail.hidden = false;
  detail.textContent = "正在读取设备信息…";
  try {
    const device = await getJson(`/api/devices/${encodeURIComponent(udid)}`);
    renderDetail(device);
    if (device.info?.DeviceName) {
      pillDevice.hidden = false;
      pillDevice.textContent = device.info.DeviceName;
    }
  } catch (error) {
    detail.textContent = error.message;
  }
}

function renderDetail(device) {
  detail.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = device.info?.DeviceName || "iPhone";
  detail.append(title);
  if (device.error) {
    const note = document.createElement("p");
    note.className = "warn";
    note.textContent = device.error;
    detail.append(note);
  }
  const list = document.createElement("dl");
  list.className = "kv";
  const labels = {
    ProductType: "机型",
    ProductVersion: "iOS",
    BuildVersion: "系统构建号",
  };
  for (const [key, label] of Object.entries(labels)) {
    if (device.info && device.info[key] != null) list.append(...row(label, String(device.info[key]), true));
  }
  if (list.childElementCount) detail.append(list);
}

function renderScreen(screen) {
  if (!screen) return;
  if (screen.iosMajor != null) lastScreenIosMajor = screen.iosMajor;
  const mirroring = screen.phase === "running";
  if (mirroring) {
    workspace.classList.add("is-live");
    phoneShell.classList.add("live");
    remotePanel.hidden = false;
    restartScreen.hidden = false;
    kbToggle.hidden = false;
    screenNote.textContent = "正在投屏。现在可以用电脑键盘在 iPhone 上输入。";
    screenNote.className = "";
    showScreen.textContent = "正在投屏…";
    showScreen.disabled = true;
    const mirrorSrc = mirrorPageUrl(screen);
    const src = screenView.getAttribute("src") || "";
    if (!src.includes("/mirror.html")) {
      screenView.src = mirrorSrc;
    }
    screenView.hidden = false;
    const compactName = document.querySelector("#compact-device-name");
    if (compactName && screen.transport) {
      compactName.textContent = `iPhone (${screen.transport === "wifi" ? "Wi-Fi" : "数据线"})`;
    }
    return;
  }

  workspace.classList.remove("is-live");
  phoneShell.classList.remove("live", "is-landscape");
  remotePanel.hidden = true;
  renderAutoScroll(false, false);
  restartScreen.hidden = true;
  kbToggle.hidden = true;
  screenView.hidden = true;
  screenView.src = "about:blank";
  showScreen.textContent = "开始投屏";
  showScreen.disabled = false;

  if (screen.phase === "starting") {
    screenNote.textContent = screen.note || "正在启动投屏，请保持 iPhone 解锁。";
    screenNote.className = "";
    showScreen.disabled = true;
    showScreen.textContent = "正在连接…";
    return;
  }
  if (screen.error) {
    screenNote.textContent = screen.error;
    screenNote.className = "warn";
    return;
  }
  screenNote.textContent = "";
  screenNote.className = "";
}

async function showPhone() {
  showScreen.disabled = true;
  showScreen.textContent = "正在连接…";
  try {
    renderScreen(await postJson("/api/screen", { udid: selectedUdid, transport }));
    watchScreen();
    load();
  } catch (error) {
    screenNote.textContent = error.message;
    screenNote.className = "warn";
    showScreen.textContent = "开始投屏";
    showScreen.disabled = false;
  }
}

function watchScreen() {
  window.clearInterval(screenTimer);
  screenTimer = window.setInterval(async () => {
    try {
      const screen = await getJson("/api/screen");
      renderScreen(screen);
      if (screen.phase !== "starting") {
        window.clearInterval(screenTimer);
        load();
      }
    } catch (error) {
      screenNote.textContent = error.message;
      window.clearInterval(screenTimer);
    }
  }, 1000);
}

function row(label, value, ok) {
  const term = document.createElement("dt");
  term.textContent = label;
  const data = document.createElement("dd");
  data.textContent = value;
  if (ok === true) data.className = "ok";
  if (ok === false) data.className = "warn";
  return [term, data];
}

async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
}

function mirrorMessage(cmd, extra = {}) {
  if (!screenView.contentWindow || screenView.hidden) return;
  screenView.contentWindow.postMessage({ source: "handset", cmd, ...extra }, window.location.origin);
}

const autoScrollButtons = document.querySelectorAll("[data-auto-scroll]");
function renderAutoScroll(available, active) {
  for (const button of autoScrollButtons) {
    button.disabled = !available;
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "停止下滑" : "自动下滑";
  }
}
for (const button of autoScrollButtons) {
  button.addEventListener("click", () => mirrorMessage("toggle-auto-scroll"));
}

window.addEventListener("message", (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.source !== screenView.contentWindow || e.data?.source !== "handset-mirror") return;
  if (e.data.autoScroll && !screenView.hidden) {
    renderAutoScroll(e.data.autoScroll.available, e.data.autoScroll.active);
  } else if ("landscape" in e.data) {
    phoneShell.classList.toggle("is-landscape", Boolean(e.data.landscape));
  }
});

function reloadMirrorIframe() {
  if (screenView.hidden) return;
  renderAutoScroll(false, false);
  const stamp = `t=${Date.now()}`;
  screenView.src = "about:blank";
  requestAnimationFrame(() => {
    const base = mirrorPageUrl({ iosMajor: lastScreenIosMajor });
    const sep = base.includes("?") ? "&" : "?";
    screenView.src = `${base}${sep}${stamp}`;
  });
}

async function restartMirror() {
  mirrorMessage("stop-auto-scroll");
  restartScreen.disabled = true;
  screenNote.textContent = "正在重启投屏，请保持 iPhone 解锁。";
  screenNote.className = "";
  try {
    await postJson("/api/screen/restart", { udid: selectedUdid });
    await new Promise((r) => setTimeout(r, 1500));
    reloadMirrorIframe();
    screenNote.textContent = "已请求重启投屏，正在等待画面…";
    window.setTimeout(() => {
      if (workspace.classList.contains("is-live")) {
        screenNote.textContent = "正在投屏。如果持续黑屏，请点击「重启投屏」。";
      }
    }, 4000);
  } catch (error) {
    screenNote.textContent = error.message;
    screenNote.className = "warn";
  } finally {
    restartScreen.disabled = false;
  }
}

async function mirrorPost(path, payload) {
  try {
    await fetch(`${MIRROR_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}

async function swipe(direction) {
  const yMid = 32768;
  const xStart = direction === "left" ? 60000 : 5000;
  const xEnd = direction === "left" ? 5000 : 60000;
  const steps = 10;
  const dt = 20;
  await mirrorPost("/touch", { type: "contact", x: xStart, y: yMid });
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(xStart + (xEnd - xStart) * (i / steps));
    await new Promise((r) => setTimeout(r, dt));
    await mirrorPost("/touch", { type: "contact", x, y: yMid });
  }
  await mirrorPost("/touch", { type: "release", x: xEnd, y: yMid });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Coordinates are HID units (0..65535). iOS only treats a swipe as a system
// gesture when the contact starts on the very edge of the screen.
const GESTURES = {
  notifications: { from: [16000, 0], to: [16000, 42000], steps: 12, dt: 16 },
  control: { from: [58000, 0], to: [58000, 42000], steps: 12, dt: 16 },
};

// A swipe-up injected over USB is too slow for iOS to treat as the Home
// gesture, so Home and the app switcher use the Home button instead.
async function pressHome(times) {
  for (let i = 0; i < times; i++) {
    if (i) await sleep(120);
    await mirrorPost("/button", { name: "home", state: "press" });
  }
}

async function gesture(name) {
  if (name === "home") return pressHome(1);
  if (name === "switcher") return pressHome(2);
  const g = GESTURES[name];
  if (!g) return;
  const [x0, y0] = g.from;
  const [x1, y1] = g.to;
  await mirrorPost("/touch", { type: "contact", x: x0, y: y0 });
  for (let i = 1; i <= g.steps; i++) {
    await sleep(g.dt);
    const t = i / g.steps;
    await mirrorPost("/touch", {
      type: "contact",
      x: Math.round(x0 + (x1 - x0) * t),
      y: Math.round(y0 + (y1 - y0) * t),
    });
  }
  if (g.hold) {
    await sleep(g.hold);
    await mirrorPost("/touch", { type: "contact", x: x1, y: y1 });
  }
  await mirrorPost("/touch", { type: "release", x: x1, y: y1 });
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  phoneScreen.requestFullscreen?.().catch(() => {});
}

window.handsetKeyboardOn = true;

function setKeyboard(on) {
  window.handsetKeyboardOn = on;
  kbToggle.setAttribute("aria-pressed", String(on));
  kbToggle.textContent = `⌨ 键盘输入到 iPhone：${on ? "开" : "关"}`;
  kbToggle.classList.toggle("is-on", on);
  if (!on) keyboard.releaseAll();
}

const keyboard = window.HandsetKeys.attach({
  post: (payload) => mirrorPost("/key", payload),
  enabled: () => !wheelDialog.open && window.handsetKeyboardOn && workspace.classList.contains("is-live"),
});

const wheelSlider = document.querySelector("#wheel-slider");
const wheelDistance = document.querySelector("#wheel-distance");
for (const input of [wheelSlider, wheelDistance]) {
  input.min = wheelSettings.min;
  input.max = wheelSettings.max;
  input.step = wheelSettings.step;
}
function showWheelPercent(value) {
  wheelSlider.value = value;
  wheelSlider.setAttribute("aria-valuetext", value + "% 屏高");
  wheelDistance.value = value;
}
for (const button of document.querySelectorAll("[data-wheel-settings]")) {
  button.addEventListener("click", () => {
    keyboard.releaseAll();
    showWheelPercent(wheelSettings.readPercent());
    wheelDialog.showModal();
  });
}
wheelSlider.addEventListener("input", () => {
  showWheelPercent(wheelSlider.value);
  localStorage.setItem(wheelSettings.key, wheelSlider.value);
});
wheelDistance.addEventListener("input", () => {
  if (!wheelDistance.validity.valid) return;
  wheelSlider.value = wheelDistance.value;
  wheelSlider.setAttribute("aria-valuetext", wheelDistance.value + "% 屏高");
  localStorage.setItem(wheelSettings.key, wheelDistance.value);
});
document.querySelector("#wheel-reset").addEventListener("click", () => {
  localStorage.removeItem(wheelSettings.key);
  showWheelPercent(wheelSettings.defaultPercent);
});

const COMPACT_SIZE = { width: 440, height: 890 };
const STANDARD_SIZE = { width: 1280, height: 860 };

function postWindow(action, size = {}) {
  return fetch(`/api/window/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(size),
  }).catch(() => {});
}

function setCompact(enable) {
  const on = document.body.classList.toggle("is-compact", enable);
  document.documentElement.classList.toggle("is-compact", on);
  const toggleCompact = document.querySelector("#toggle-compact");
  const compactBtn = document.querySelector("#compact-btn");
  const compactBar = document.querySelector("#compact-bar");
  if (toggleCompact) {
    toggleCompact.textContent = on ? "展开窗口" : "紧凑模式";
    toggleCompact.title = on ? "返回完整布局" : "切换到紧凑窗口";
  }
  if (compactBtn) {
    compactBtn.textContent = on ? "完整布局" : "紧凑窗口";
  }
  if (compactBar) compactBar.hidden = !on;
  const size = on ? COMPACT_SIZE : STANDARD_SIZE;
  postWindow("resize", size);
}

async function refreshAirPlayUi() {
  const btn = document.querySelector("#compact-audio");
  const note = document.querySelector("#audio-popup-note");
  if (!btn) return;
  try {
    const data = await getJson("/api/airplay/status");
    btn.classList.toggle("is-connected", Boolean(data.connected));
    btn.classList.toggle("is-unavailable", !data.available);
    if (!data.available) {
      btn.title = "未安装 AirPlay 接收器（可添加 handset/bin/shairport.exe）";
      if (note) {
        note.hidden = false;
        note.textContent =
          "此版本未包含 Pane Audio。使用源码运行时，可将 Shairport4w 放在 handset/bin/shairport.exe 以启用音频。";
      }
    } else if (data.connected) {
      btn.title = "正在通过 Pane Audio 播放声音";
      if (note) note.hidden = true;
    } else {
      btn.title = "设置 AirPlay 音频（点击查看步骤）";
      if (note) note.hidden = true;
    }
  } catch (_) {}
}

function wireRemoteControls() {
  const toggleCompact = () => setCompact(!document.body.classList.contains("is-compact"));
  document.querySelector("#toggle-compact")?.addEventListener("click", toggleCompact);
  document.querySelector("#compact-btn")?.addEventListener("click", toggleCompact);
  document.querySelector("#compact-close")?.addEventListener("click", () => setCompact(false));
  document.querySelector("#compact-min")?.addEventListener("click", () => postWindow("minimize"));
  document.querySelector("#compact-expand")?.addEventListener("click", toggleFullscreen);
  document.querySelector("#win-min")?.addEventListener("click", () => postWindow("minimize"));
  document.querySelector("#win-close")?.addEventListener("click", () => postWindow("close"));

  const audioPopup = document.querySelector("#audio-popup");
  const openAudio = async (e) => {
    e?.preventDefault?.();
    await refreshAirPlayUi();
    if (audioPopup) audioPopup.hidden = false;
  };
  document.querySelector("#compact-audio")?.addEventListener("click", openAudio);
  document.querySelector("#open-audio")?.addEventListener("click", openAudio);
  const closeAudio = () => {
    if (audioPopup) audioPopup.hidden = true;
  };
  document.querySelector("#audio-popup-close")?.addEventListener("click", closeAudio);
  document.querySelector("#audio-popup-ok")?.addEventListener("click", closeAudio);
  document.addEventListener("click", (e) => {
    if (audioPopup && !audioPopup.hidden && !e.target.closest("#audio-popup, #compact-audio")) {
      closeAudio();
    }
  });
  setInterval(refreshAirPlayUi, 4000);
  refreshAirPlayUi();

  const startDrag = (el) => {
    if (!el) return;
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button, a, input, select, textarea")) return;
      postWindow("drag");
    });
  };
  startDrag(document.querySelector(".bar-drag"));

  kbToggle.addEventListener("click", () => setKeyboard(!window.handsetKeyboardOn));
  setKeyboard(true);
  // A focused button would swallow Space and Enter instead of typing them.
  document.addEventListener("pointerup", (e) => {
    const btn = e.target.closest?.("button");
    if (btn) btn.blur();
  });
  document.querySelectorAll("[data-gesture]").forEach((btn) => {
    btn.addEventListener("click", () => gesture(btn.dataset.gesture));
  });
  document.querySelector("#fullscreen")?.addEventListener("click", toggleFullscreen);
  document.querySelector("#fs-exit")?.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    const btn = document.querySelector("#fullscreen");
    if (btn) btn.textContent = document.fullscreenElement ? "退出全屏" : "⛶ 全屏";
  });
  document.querySelectorAll("[data-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.btn;
      if (name) mirrorPost("/button", { name, state: "press" });
    });
  });
  document.querySelectorAll("[data-swipe]").forEach((btn) => {
    btn.addEventListener("click", () => swipe(btn.dataset.swipe));
  });
  document.querySelector("#zoom-in")?.addEventListener("click", () => mirrorMessage("zoom-in"));
  document.querySelector("#zoom-out")?.addEventListener("click", () => mirrorMessage("zoom-out"));
  document.querySelector("#zoom-reset")?.addEventListener("click", () => mirrorMessage("zoom-reset"));
  document.querySelector("#rotate-cw")?.addEventListener("click", () => mirrorMessage("rotate", { deg: 90 }));
  document.querySelector("#rotate-ccw")?.addEventListener("click", () => mirrorMessage("rotate", { deg: -90 }));
}

load();
