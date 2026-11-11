// ../../../../Projects/124_dataflou/web/src/state.ts
var VERSION = "58";
var PALETTE = [
  "#5b9bd5",
  "#ed7d31",
  "#70ad47",
  "#ffc000",
  "#9b59b6",
  "#e74c3c",
  "#1abc9c",
  "#e67e22"
];
var state = {
  nodes: [],
  svg: null,
  g: null,
  ws: null,
  statusEl: document.getElementById("status"),
  tooltip: null,
  hoveredSubLine: null,
  shiftHeld: false,
  changedParams: {},
  identifying: {},
  universe: null,
  perfMode: false,
  debugOverlay: false,
  dragState: null,
  lastMouseClient: { x: 0, y: 0 },
  allParamData: [],
  nodeData: [],
  pendingSubscriptions: [],
  editingParamKey: null,
  hoveredParamIdx: -1,
  hoverGroupPath: null,
  hoveredFlushSku: null,
  hoveredFlushEl: null,
  ringHover: null,
  rotationOffset: 0,
  collapsedGroups: {},
  tempExpandedGroup: null,
  collapsedDots: [],
  editingSku: null,
  coreVersion: null,
  atelierVersion: null,
  wasConnected: false,
  drawModeOffset: 0,
  graphiteMode: false,
  wsRate: 0,
  fps: 0,
  dashboardSkus: {}
};

// ../../../../Projects/124_dataflou/web/src/params.ts
function countParams(pnode) {
  if (!pnode) return 0;
  if (pnode.kind === "param") return 1;
  let n = 0;
  if (pnode.children) {
    for (let i = 0; i < pnode.children.length; i++) {
      n += countParams(pnode.children[i]);
    }
  }
  return n;
}
function collectParamsWithAncestors(pnode, ancestors, pathParts, out, isRoot) {
  if (!pnode) return;
  if (pnode.kind === "param") {
    const fullPath = pathParts.concat([pnode.name || pnode.label || ""]).join("/");
    out.push({ param: pnode, ancestors: ancestors.slice(), path: fullPath });
    return;
  }
  let newAnc = ancestors;
  let newPath = pathParts;
  if (pnode.kind === "group" && !isRoot) {
    newAnc = ancestors.concat([pnode.name || pnode.label || ""]);
    newPath = pathParts.concat([pnode.name || pnode.label || ""]);
  }
  if (pnode.children) {
    for (let i = 0; i < pnode.children.length; i++) {
      collectParamsWithAncestors(pnode.children[i], newAnc, newPath, out, false);
    }
  }
}
function buildValueMap(nodeList) {
  const map = {};
  for (let i = 0; i < nodeList.length; i++) {
    const n = nodeList[i];
    const params = [];
    collectParamsWithAncestors(n.params, [], [], params, true);
    for (let j = 0; j < params.length; j++) {
      const key = n.sku + "|" + params[j].path;
      map[key] = params[j].param.value;
    }
  }
  return map;
}
function findChangedParams(oldMap, newMap) {
  const changed2 = {};
  for (const key in newMap) {
    if (!(key in oldMap)) continue;
    if (JSON.stringify(oldMap[key]) !== JSON.stringify(newMap[key])) {
      changed2[key] = true;
    }
  }
  return changed2;
}
function formatParamValue(p) {
  if (p.value === void 0 || p.value === null) return "";
  switch (p.type) {
    case "number":
      return Number(p.value).toFixed(2);
    case "bool":
      return p.value ? "true" : "false";
    case "v2":
    case "v3":
    case "v4":
      if (Array.isArray(p.value))
        return p.value.map(function(v) {
          return Number(v).toFixed(1);
        }).join(", ");
      return "";
    case "colour":
      if (typeof p.value === "string") return p.value;
      return "";
    default:
      return "";
  }
}
function countDisplayItems(pnode, sku, parentPath, collapsedSet) {
  if (!pnode) return 0;
  if (pnode.kind === "param") return 1;
  let path;
  if (parentPath === null) {
    path = "";
  } else {
    path = parentPath ? parentPath + "/" + (pnode.name || pnode.label) : pnode.name || pnode.label || "";
    if (collapsedSet[sku + "|" + path]) return 1;
  }
  let n = 0;
  if (pnode.children) {
    for (let i = 0; i < pnode.children.length; i++) {
      n += countDisplayItems(pnode.children[i], sku, path, collapsedSet);
    }
  }
  return n;
}
function collectDisplayItems(pnode, sku, parentPath, ancestors, collapsedSet, out) {
  if (!pnode) return;
  if (pnode.kind === "param") {
    const fullPath = parentPath ? parentPath + "/" + (pnode.name || pnode.label) : pnode.name || pnode.label || "";
    out.push({ kind: "param", param: pnode, path: fullPath, ancestors: ancestors.slice() });
    return;
  }
  let path;
  let newAnc;
  if (parentPath === null) {
    path = "";
    newAnc = ancestors;
  } else {
    path = parentPath ? parentPath + "/" + (pnode.name || pnode.label) : pnode.name || pnode.label || "";
    newAnc = ancestors.concat([pnode.name || pnode.label || ""]);
    if (collapsedSet[sku + "|" + path]) {
      const innerParams = [];
      const innerPaths = [];
      collectInnerLeaves(pnode, path, innerParams, innerPaths);
      out.push({
        kind: "collapsed",
        groupName: pnode.name || pnode.label || "",
        groupLabel: pnode.label || pnode.name,
        groupPath: path,
        ancestors: newAnc.slice(),
        innerParams,
        innerPaths
      });
      return;
    }
  }
  if (pnode.children) {
    for (let i = 0; i < pnode.children.length; i++) {
      collectDisplayItems(pnode.children[i], sku, path, newAnc, collapsedSet, out);
    }
  }
}
function collectInnerLeaves(groupNode, groupPath, params, paths) {
  if (!groupNode.children) return;
  for (let i = 0; i < groupNode.children.length; i++) {
    const child = groupNode.children[i];
    if (child.kind === "param") {
      paths.push(groupPath + "/" + (child.name || child.label));
      params.push(child);
    } else if (child.kind === "group") {
      collectInnerLeaves(child, groupPath + "/" + (child.name || child.label), params, paths);
    }
  }
}
function collectGroupsCollapsed(pnode, baseOffset, depth, ancestors, sku, parentPath, collapsedSet, out) {
  if (!pnode || pnode.kind === "param" || !pnode.children) return;
  let offset = baseOffset;
  for (let i = 0; i < pnode.children.length; i++) {
    const child = pnode.children[i];
    const childParentPath = parentPath === null ? "" : parentPath;
    const count = countDisplayItems(child, sku, childParentPath, collapsedSet);
    if (child.kind === "group" && count > 0) {
      const grpName = child.label || child.name;
      const childName = child.name || child.label;
      const grpPath = childParentPath ? childParentPath + "/" + childName : childName || "";
      const isCollapsed = !!collapsedSet[sku + "|" + grpPath];
      out.push({
        name: grpName,
        offset,
        count,
        depth,
        ancestors: ancestors.slice(),
        collapsed: isCollapsed,
        groupPath: grpPath
      });
      if (!isCollapsed) {
        collectGroupsCollapsed(child, offset, depth + 1, ancestors.concat([grpName]), sku, grpPath, collapsedSet, out);
      }
    }
    offset += count;
  }
}
function collectTopGroupsCollapsed(pnode, sku, collapsedSet) {
  const groups = [];
  if (!pnode || pnode.kind === "param" || !pnode.children) return groups;
  let offset = 0;
  for (let i = 0; i < pnode.children.length; i++) {
    const child = pnode.children[i];
    const count = countDisplayItems(child, sku, "", collapsedSet);
    if (count > 0) groups.push({ offset, count });
    offset += count;
  }
  return groups;
}
function maxGroupDepthCollapsed(pnode, sku, collapsedSet) {
  const groups = [];
  collectGroupsCollapsed(pnode, 0, 0, [], sku, null, collapsedSet, groups);
  let m = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].depth > m) m = groups[i].depth;
  }
  return m;
}

// ../../../../Projects/124_dataflou/web/src/display.ts
var DEFAULTS = {
  theme: "dataflou",
  font: "default",
  textScale: 1,
  paramScale: 1,
  weight: 400,
  showText: true,
  autoCollapseOver: 24,
  glass: false,
  hideAbsent: false,
  outputText: false,
  lineScale: 1,
  ringScale: 1,
  connScale: 1,
  dragExpand: "hover",
  labelBoxes: "off",
  maxName: 40,
  showAddresses: false,
  videoOn: false,
  videoSource: "",
  videoBright: 0.8,
  videoFit: "cover",
  videoLines: "halo"
};
var STORE_KEY = "dataflou.display";
var settings = loadSettings();
var hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
var isOutput = hashParams.has("output");
function isOutputWindow() {
  return isOutput;
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
  } catch (_) {
  }
  return Object.assign({}, DEFAULTS);
}
function saveSettings() {
  if (isOutput) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch (_) {
  }
}
var THEMES = {
  studio: { name: "Studio Dark", bg: "30 30 30", panel: "42 42 42", border: "17 17 17", accent: "255 142 15", muted: "138 138 138", text: "216 216 216", success: "110 180 120" },
  warm: { name: "Warm Charcoal", bg: "29 29 29", panel: "42 42 42", border: "17 17 17", accent: "255 140 66", muted: "138 138 138", text: "234 234 234", success: "110 180 120" },
  graphite: { name: "Graphite", bg: "28 28 28", panel: "38 38 38", border: "14 14 14", accent: "238 126 17", muted: "154 154 154", text: "224 224 224", success: "110 180 120" },
  cream: { name: "Cream", bg: "229 224 213", panel: "237 232 220", border: "184 176 160", accent: "212 176 72", muted: "126 120 104", text: "63 64 71", success: "122 153 96" },
  nature: { name: "Nature", bg: "26 26 26", panel: "38 38 38", border: "14 14 14", accent: "93 212 176", muted: "138 138 138", text: "220 220 220", success: "125 212 156" },
  paper: { name: "Paper Light", bg: "235 236 240", panel: "255 255 255", border: "199 199 205", accent: "13 153 255", muted: "107 107 115", text: "15 15 17", success: "55 140 85" },
  dark: { name: "Dark", bg: "29 29 29", panel: "42 42 42", border: "20 20 20", accent: "255 153 51", muted: "138 138 138", text: "212 212 212", success: "119 192 122" },
  light: { name: "Light", bg: "214 214 214", panel: "236 236 236", border: "160 160 160", accent: "200 95 20", muted: "90 90 90", text: "30 30 30", success: "55 140 85" },
  pastel: { name: "Pastel", bg: "232 218 232", panel: "244 230 242", border: "180 158 190", accent: "182 108 146", muted: "130 110 146", text: "64 48 78", success: "108 172 130" },
  reaper: { name: "Classic", bg: "30 30 30", panel: "43 43 43", border: "16 16 16", accent: "74 144 200", muted: "128 128 128", text: "208 208 208", success: "110 180 120" },
  smooth: { name: "Smooth", bg: "44 42 40", panel: "54 52 50", border: "32 30 28", accent: "164 146 124", muted: "120 114 106", text: "186 178 168", success: "136 160 132" },
  hydra: { name: "Hydra", bg: "26 37 48", panel: "37 51 64", border: "10 18 24", accent: "77 208 225", muted: "120 144 156", text: "207 216 220", success: "129 199 132" },
  darkside: { name: "DarkSide", bg: "10 10 10", panel: "20 20 20", border: "0 0 0", accent: "255 87 34", muted: "112 112 112", text: "224 224 224", success: "118 196 122" },
  solaris: { name: "Solaris", bg: "26 40 56", panel: "34 51 72", border: "15 26 38", accent: "41 182 246", muted: "106 138 165", text: "207 226 234", success: "129 199 132" },
  flame: { name: "Flame", bg: "28 28 28", panel: "40 40 40", border: "12 12 12", accent: "255 122 0", muted: "140 140 140", text: "224 224 224", success: "98 198 122" },
  analog: { name: "Analog", bg: "58 46 34", panel: "74 59 44", border: "40 30 20", accent: "230 180 94", muted: "168 144 120", text: "240 228 200", success: "152 188 122" }
};
var FONTS = [
  ["default", "dataflou mono (default)"],
  ["Inter", "Inter"],
  ["Roboto", "Roboto"],
  ["Work Sans", "Work Sans"],
  ["IBM Plex Sans", "IBM Plex Sans"],
  ["DM Sans", "DM Sans"],
  ["Manrope", "Manrope"],
  ["Outfit", "Outfit"],
  ["Lexend", "Lexend"],
  ["Space Grotesk", "Space Grotesk"],
  ["Syne", "Syne"],
  ["Unbounded", "Unbounded"],
  ["Oswald", "Oswald"],
  ["Bebas Neue", "Bebas Neue"],
  ["JetBrains Mono", "JetBrains Mono"],
  ["Fira Code", "Fira Code"],
  ["Courier Prime", "Courier Prime"],
  ["VT323", "VT323"],
  ["Silkscreen", "Silkscreen"],
  ["Major Mono Display", "Major Mono Display"],
  ["Orbitron", "Orbitron"],
  ["Tektur", "Tektur"],
  ["Crimson Pro", "Crimson Pro"],
  ["EB Garamond", "EB Garamond"],
  ["Fraunces", "Fraunces"]
];
var styleEl = null;
function applyStyle() {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "display-style";
    document.head.appendChild(styleEl);
  }
  const s = settings;
  const k = s.textScale;
  const pk = s.textScale * s.paramScale;
  let css = "";
  const fam = s.font === "default" ? null : "'" + s.font + "', 'SF Mono', 'Fira Code', monospace";
  if (fam) css += "body, .param-tooltip, #vis svg text { font-family: " + fam + "; }\n";
  css += "#vis svg text { font-weight: " + s.weight + "; }\n";
  css += "#vis .node-label { font-size: " + nodeTitleSize() + "px; }\n";
  css += "#vis .node-addr { font-size: " + nodeAddrSize() + "px; }\n";
  css += "#vis .group-label { font-size: " + groupTitleSize(0) + "px; }\n";
  css += "#vis .group-label.depth-1 { font-size: " + groupTitleSize(1) + "px; }\n";
  css += "#vis .group-label.depth-2 { font-size: " + groupTitleSize(2) + "px; }\n";
  css += "#vis .param-label { font-size: " + 6 * pk + "px; }\n";
  css += "#vis .group-arc { stroke-width: " + s.lineScale + "; }\n";
  css += "#vis .collapsed-stem { stroke-width: " + 0.8 * s.lineScale + "; }\n";
  css += "#vis { --conn-w: " + (s.connScale > 0 ? s.connScale : 1) + "; }\n";
  const t = THEMES[s.theme];
  if (t) {
    css += "body { background: rgb(" + t.bg + "); color: rgb(" + t.text + "); }\n";
    css += "#status { color: rgb(" + t.muted + "); }\n";
    css += "#status.connected { color: rgb(" + t.success + "); }\n";
    css += "#vis .node-label { fill: rgb(" + t.text + "); }\n";
    css += "#vis .node-label.offline { fill: rgb(" + t.muted + " / 0.45); }\n";
    css += "#vis .node-addr { fill: rgb(" + t.muted + "); }\n";
    css += "#vis .group-label { fill: rgb(" + t.muted + "); }\n";
    css += "#vis .group-label.depth-1 { fill: rgb(" + t.muted + " / 0.85); }\n";
    css += "#vis .group-label.depth-2 { fill: rgb(" + t.muted + " / 0.7); }\n";
    css += "#vis .param-label { fill: rgb(" + t.text + " / 0.62); }\n";
    css += "#vis .param-label.offline { fill: rgb(" + t.muted + " / 0.4); }\n";
    css += "#vis .param-value { fill: rgb(" + t.muted + "); }\n";
    css += "#vis .collapsed-label { fill: rgb(" + t.text + " / 0.55) !important; }\n";
    css += "#vis .drop-highlight { stroke: rgb(" + t.accent + "); }\n";
    css += '#vis .drag-line[stroke="#fff"] { stroke: rgb(' + t.text + "); }\n";
    const bgSum = t.bg.split(" ").reduce(function(acc, v) {
      return acc + +v;
    }, 0);
    if (bgSum > 384) css += "html[data-glass='on'] #display-tab, html[data-glass='on'] #scenes-tab { color: rgb(" + t.text + "); text-shadow: none; }\n";
    css += ".param-tooltip .tt-name { color: rgb(" + t.text + "); }\n";
    css += ".param-tooltip .tt-path, .param-tooltip .tt-hint, .param-tooltip td:first-child { color: rgb(" + t.muted + "); }\n";
    css += ".param-tooltip td:last-child { color: rgb(" + t.text + " / 0.85); }\n";
    css += ".param-tooltip, .dashboard-panel { background: rgb(" + t.panel + " / 0.92); color: rgb(" + t.text + "); border-color: rgb(" + t.border + "); }\n";
    css += "#display-panel, #display-tab, #search-palette, #history-btns, #scenes-panel, #scenes-tab { --dp-bg: " + t.panel + "; --dp-text: " + t.text + "; --dp-muted: " + t.muted + "; --dp-border: " + t.border + "; --dp-accent: " + t.accent + "; }\n";
  }
  styleEl.textContent = css;
  document.body.classList.toggle("no-text", !s.showText);
  document.documentElement.setAttribute("data-glass", s.glass ? "on" : "off");
  refreshGlass();
}
function ringScale() {
  return settings.ringScale > 0 ? settings.ringScale : 1;
}
function lineScale() {
  return settings.lineScale > 0 ? settings.lineScale : 1;
}
function connScale() {
  return settings.connScale > 0 ? settings.connScale : 1;
}
function dragExpandsAll() {
  return settings.dragExpand === "all";
}
function showAddresses() {
  return settings.showAddresses;
}
var relayoutQueued = false;
function queueRelayout() {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(function() {
    relayoutQueued = false;
    rerender(false);
  });
}
function visibleNodes(nodes) {
  if (!settings.hideAbsent) return nodes;
  return nodes.filter(function(n) {
    return n.online || n.is_local;
  });
}
function setShowAddresses(on) {
  settings.showAddresses = on;
  saveSettings();
  syncPanel();
  queueRelayout();
}
function setHideAbsent(on) {
  settings.hideAbsent = on;
  saveSettings();
  syncPanel();
  rerender(false);
}
var autoCollapsedSeen = {};
function collectGroupKeys(pnode, sku, parentPath, out) {
  if (!pnode || pnode.kind === "param" || !pnode.children) return;
  for (let i = 0; i < pnode.children.length; i++) {
    const c = pnode.children[i];
    if (c.kind !== "group" || countParams(c) === 0) continue;
    const name = c.name || c.label || "";
    const path = parentPath ? parentPath + "/" + name : name;
    out.push(sku + "|" + path);
    collectGroupKeys(c, sku, path, out);
  }
}
function collapseAllOf(n) {
  const keys = [];
  collectGroupKeys(n.params, n.sku, null, keys);
  for (let i = 0; i < keys.length; i++) state.collapsedGroups[keys[i]] = true;
}
function autoCollapseNewNodes() {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (autoCollapsedSeen[n.sku]) continue;
    const count = countParams(n.params);
    if (count === 0) continue;
    autoCollapsedSeen[n.sku] = true;
    if (settings.autoCollapseOver > 0 && count > settings.autoCollapseOver) collapseAllOf(n);
  }
}
function rerender(animate) {
  state._animating = false;
  if (animate && state._capturePositions) state._collapseAnim = state._capturePositions();
  state.tempExpandedGroup = null;
  state.ringHover = null;
  if (state._render) state._render();
}
var base = { x: -500, y: -500, w: 1e3, h: 1e3 };
var zoomK = 1;
var center = null;
var ZOOM_MAX = 40;
var ZOOM_MIN = 0.25;
var baseLocked = false;
function setBaseViewBox(x, y, w, h) {
  if (!baseLocked) base = { x, y, w, h };
  applyViewBox();
  applyVideo();
}
var VIDEO_PORT = 8091;
function videoBase() {
  return location.protocol + "//" + location.hostname + ":" + VIDEO_PORT;
}
function videoLines() {
  return settings.videoOn ? settings.videoLines : "plain";
}
var videoFo = null;
var videoImg = null;
var videoRetry = null;
var videoSrcOn = "";
function videoUrl() {
  return videoBase() + "/flux.mjpg?t=" + Date.now();
}
function applyVideo() {
  if (!state.svg) return;
  const svg = state.svg.node();
  document.body.classList.toggle("video-on", settings.videoOn);
  if (!settings.videoOn) {
    if (videoImg && videoImg.getAttribute("src")) videoImg.removeAttribute("src");
    if (videoFo) videoFo.style.display = "none";
    videoSrcOn = "";
    return;
  }
  if (!videoFo) {
    videoFo = document.createElementNS(SVGNS, "foreignObject");
    videoFo.setAttribute("class", "video-layer");
    videoImg = document.createElement("img");
    videoImg.className = "video-img";
    videoImg.alt = "";
    videoImg.draggable = false;
    videoImg.addEventListener("error", function() {
      if (videoRetry !== null || !settings.videoOn) return;
      videoRetry = window.setTimeout(function() {
        videoRetry = null;
        if (settings.videoOn && videoImg) videoImg.src = videoUrl();
      }, 2e3);
    });
    videoFo.appendChild(videoImg);
  }
  if (videoFo.parentNode !== svg || svg.firstChild !== videoFo) svg.insertBefore(videoFo, svg.firstChild);
  const r = Math.max(10, (state._innerR || 200) - 4);
  videoFo.setAttribute("x", String(-r));
  videoFo.setAttribute("y", String(-r));
  videoFo.setAttribute("width", String(2 * r));
  videoFo.setAttribute("height", String(2 * r));
  videoFo.style.display = "";
  videoImg.style.objectFit = settings.videoFit === "contain" ? "contain" : "cover";
  videoImg.style.opacity = String(settings.videoBright);
  if (!videoSrcOn) {
    videoSrcOn = "1";
    videoImg.src = videoUrl();
  }
}
var videoChosen = null;
function chooseVideoSource() {
  if (isOutput || !settings.videoOn || videoChosen === settings.videoSource) return;
  videoChosen = settings.videoSource;
  fetch(videoBase() + "/choisir?nom=" + encodeURIComponent(settings.videoSource)).catch(function() {
    videoChosen = null;
  });
}
var videoPoll = null;
function pollVideo() {
  if (!panelEl) return;
  const sel2 = panelEl.querySelector("[data-k=videoSource]");
  const st = panelEl.querySelector("[data-s=videoStatus]");
  fetch(videoBase() + "/etat").then(function(r) {
    return r.json();
  }).then(function(e) {
    const names = e.sources || [];
    if (settings.videoSource && names.indexOf(settings.videoSource) < 0) names.push(settings.videoSource);
    const want = "|" + names.join("|");
    if (sel2.getAttribute("data-list") !== want) {
      sel2.setAttribute("data-list", want);
      let h = '<option value="">automatic</option>';
      for (let i = 0; i < names.length; i++) h += '<option value="' + names[i].replace(/"/g, "&quot;") + '">' + names[i].replace(/</g, "&lt;") + "</option>";
      sel2.innerHTML = h;
    }
    sel2.value = settings.videoSource;
    if (!settings.videoOn) st.textContent = names.length ? names.length + " NDI source" + (names.length > 1 ? "s" : "") + " found" : "no NDI source found";
    else if (e.source) st.textContent = e.source + (e.taille ? " \xB7 " + e.taille[0] + "\xD7" + e.taille[1] : "") + " \xB7 " + e.ips + " fps";
    else st.textContent = names.length ? "connecting\u2026" : "no NDI source found";
  }).catch(function() {
    st.textContent = "NDI bridge not running (port " + VIDEO_PORT + ")";
  });
}
function setVideoPolling(on) {
  if (on && videoPoll === null) {
    pollVideo();
    videoPoll = window.setInterval(pollVideo, 1500);
  } else if (!on && videoPoll !== null) {
    clearInterval(videoPoll);
    videoPoll = null;
  }
}
function applyViewBox() {
  if (!state.svg) return;
  if (Math.abs(zoomK - 1) < 1e-4 && !center) zoomK = 1;
  const cx = center ? center.x : base.x + base.w / 2;
  const cy = center ? center.y : base.y + base.h / 2;
  const w = base.w / zoomK, h = base.h / zoomK;
  state.svg.attr("viewBox", cx - w / 2 + " " + (cy - h / 2) + " " + w + " " + h);
  document.body.classList.toggle("zoomed", zoomK !== 1 || !!center);
}
function clientToView(clientX, clientY) {
  const svgNode = state.svg && state.svg.node();
  const ctm = svgNode && svgNode.getScreenCTM();
  if (!svgNode || !ctm) return null;
  const pt = svgNode.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
function zoomAt(clientX, clientY, factor) {
  const p = clientToView(clientX, clientY);
  if (!p) return;
  let k2 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomK * factor));
  if (zoomK > 1 && k2 < 1 || zoomK < 1 && k2 > 1) k2 = 1;
  if (k2 === zoomK) return;
  const c = center || { x: base.x + base.w / 2, y: base.y + base.h / 2 };
  const r = zoomK / k2;
  center = { x: p.x + (c.x - p.x) * r, y: p.y + (c.y - p.y) * r };
  zoomK = k2;
  applyViewBox();
}
function panByClient(dxClient, dyClient) {
  if (zoomK === 1 && !center) return;
  const svgNode = state.svg && state.svg.node();
  const ctm = svgNode && svgNode.getScreenCTM();
  if (!ctm) return;
  const c = center || { x: base.x + base.w / 2, y: base.y + base.h / 2 };
  center = { x: c.x - dxClient / ctm.a, y: c.y - dyClient / ctm.d };
  applyViewBox();
}
function resetZoom() {
  if (zoomAnim !== null) {
    cancelAnimationFrame(zoomAnim);
    zoomAnim = null;
  }
  zoomK = 1;
  center = null;
  applyViewBox();
}
var zoomAnim = null;
function zoomTo(gx, gy, k, ms = 450) {
  const r = state.rotationOffset * Math.PI / 180;
  const tx = gx * Math.cos(r) - gy * Math.sin(r);
  const ty = gx * Math.sin(r) + gy * Math.cos(r);
  const k0 = zoomK;
  const c0 = center || { x: base.x + base.w / 2, y: base.y + base.h / 2 };
  const k1 = Math.max(1, Math.min(ZOOM_MAX, k));
  if (zoomAnim !== null) cancelAnimationFrame(zoomAnim);
  const t02 = performance.now();
  const step = function(now) {
    const t = Math.min(1, (now - t02) / ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    zoomK = Math.exp(Math.log(k0) + (Math.log(k1) - Math.log(k0)) * e);
    center = { x: c0.x + (tx - c0.x) * e, y: c0.y + (ty - c0.y) * e };
    applyViewBox();
    zoomAnim = t < 1 ? requestAnimationFrame(step) : null;
  };
  zoomAnim = requestAnimationFrame(step);
}
function initZoom() {
  const vis = document.getElementById("vis");
  window.addEventListener("wheel", function(e) {
    if (e.target.closest && e.target.closest("#display-panel, .param-tooltip, .dashboard-panel")) {
      if (e.ctrlKey) e.preventDefault();
      return;
    }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * 2e-3));
    } else if (zoomK !== 1 || center) {
      e.preventDefault();
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      panByClient(-dx * unit, -dy * unit);
    }
  }, { passive: false });
  let pan = null;
  vis.addEventListener("mousedown", function(e) {
    if (e.button !== 1) return;
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY };
    document.body.style.cursor = "move";
  });
  window.addEventListener("mousemove", function(e) {
    if (!pan) return;
    panByClient(e.clientX - pan.x, e.clientY - pan.y);
    pan = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mouseup", function(e) {
    if (e.button === 1 && pan) {
      pan = null;
      document.body.style.cursor = "";
    }
  });
  window.addEventListener("resize", applyViewBox);
}
function setShowText(on) {
  settings.showText = on;
  saveSettings();
  applyStyle();
  syncPanel();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(function() {
  });
  else document.documentElement.requestFullscreen().catch(function() {
  });
}
var idleTimer = null;
function initIdleCursor() {
  window.addEventListener("mousemove", function() {
    document.body.classList.remove("cursor-idle");
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(function() {
      if (!settings.showText) document.body.classList.add("cursor-idle");
    }, 2500);
  });
}
function isTyping(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === "INPUT") {
    const type = t.type;
    return type !== "checkbox" && type !== "range" && type !== "button";
  }
  return tag === "SELECT" || tag === "TEXTAREA" || t.isContentEditable;
}
function initKeys() {
  document.addEventListener("keydown", function(e) {
    if (isTyping(e) || e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      }
      return;
    }
    if (e.key === "t" || e.key === "T") setShowText(!settings.showText);
    else if (e.key === "f" || e.key === "F") toggleFullscreen();
    else if (e.key === "h" || e.key === "H") setHideAbsent(!settings.hideAbsent);
    else if (e.key === "o" || e.key === "O") openOutputWindow();
    else if (e.key === "i" || e.key === "I") setShowAddresses(!settings.showAddresses);
    else if (e.key === "v" || e.key === "V") toggleVideo();
    else if (e.key === "0") resetZoom();
  });
}
var probe = null;
var widthCache = /* @__PURE__ */ new Map();
var widthCacheKey = "";
var lastRoom = -1;
function shortName(s) {
  const m = settings.maxName;
  return m > 0 && s.length > m ? s.slice(0, Math.max(1, m - 1)).replace(/\s+$/, "") + "\u2026" : s;
}
function paramFontSize() {
  return 6 * settings.textScale * settings.paramScale;
}
var TITLE_STEPS = { node: 1.5, groups: [1.3, 1.2, 1.1] };
function nodeTitleSize() {
  return Math.max(9 * settings.textScale, paramFontSize() * TITLE_STEPS.node);
}
function nodeAddrSize() {
  return Math.max(6 * settings.textScale, nodeTitleSize() * 0.7);
}
function groupTitleSize(depth) {
  const d = Math.min(Math.max(depth, 0), 2);
  return Math.max([7, 6, 5.5][d] * settings.textScale, paramFontSize() * TITLE_STEPS.groups[d]);
}
function measureName(text, collapsed) {
  return measureClass(text, collapsed ? "param-label collapsed-label" : "param-label");
}
function measureClass(text, cls) {
  if (!state.svg) return text.length * 4;
  const key = [settings.font, settings.weight, settings.textScale, settings.paramScale].join("|");
  if (key !== widthCacheKey) {
    widthCache.clear();
    widthCacheKey = key;
  }
  const ck = cls + "|" + text;
  const hit = widthCache.get(ck);
  if (hit !== void 0) return hit;
  if (!probe || !probe.isConnected) {
    probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("visibility", "hidden");
    probe.setAttribute("aria-hidden", "true");
    probe.style.setProperty("display", "inline", "important");
    probe.style.pointerEvents = "none";
    state.svg.node().appendChild(probe);
  }
  probe.setAttribute("class", cls);
  probe.textContent = text;
  let w = 0;
  try {
    w = probe.getBBox().width;
  } catch (_) {
    w = text.length * 4;
  }
  if (widthCache.size > 5e3) widthCache.clear();
  widthCache.set(ck, w);
  return w;
}
function fitCurvedTitle(textEl, tp, full, arcLen, fontPx, cls) {
  const avail = arcLen * 0.94;
  const w = measureClass(full, cls);
  if (!(w > avail)) return;
  const scale = Math.max(0.72, avail / w);
  if (scale < 1) textEl.style.fontSize = fontPx * scale + "px";
  const w2 = w * scale;
  if (w2 <= avail) return;
  const keep = Math.floor(full.length * avail / w2) - 1;
  if (keep < 2) {
    textEl.style.display = "none";
    return;
  }
  tp.textContent = full.slice(0, keep).replace(/\s+$/, "") + "\u2026";
}
function stableNameRoom(extent) {
  const want = Math.max(24, Math.ceil(extent / 6) * 6);
  if (lastRoom >= 0 && want <= lastRoom && lastRoom - want < 30) return lastRoom;
  lastRoom = want;
  return want;
}
if (document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener("loadingdone", function() {
    widthCache.clear();
    lastRoom = -1;
    queueRelayout();
  });
}
function readableOn(color) {
  const c = d3.color(color);
  const rgb = c ? c.rgb() : null;
  if (!rgb) return "#f2f2f2";
  const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return lum > 140 ? "#111" : "#f4f4f4";
}
function boxPaint(defs, color, id, x1, y1, x2, y2, userSpace) {
  const style = settings.labelBoxes;
  if (style === "flat") return color;
  const c = d3.color(color);
  if (!c) return color;
  const g = defs.append("linearGradient").attr("id", id);
  if (userSpace) g.attr("gradientUnits", "userSpaceOnUse").attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2);
  g.append("stop").attr("offset", "0%").attr("stop-color", c.brighter(0.7).formatHex());
  g.append("stop").attr("offset", "55%").attr("stop-color", color);
  g.append("stop").attr("offset", "100%").attr("stop-color", c.darker(0.7).formatHex());
  return "url(#" + id + ")";
}
var SVGNS = "http://www.w3.org/2000/svg";
function ensureGlassDefs(defs) {
  if (!defs.select("#label-glass-shadow").empty()) return;
  defs.append("filter").attr("id", "label-glass-shadow").attr("x", "-30%").attr("y", "-60%").attr("width", "160%").attr("height", "240%").append("feDropShadow").attr("dx", 0).attr("dy", 1.2).attr("stdDeviation", 1.4).attr("flood-color", "#000").attr("flood-opacity", 0.55);
}
function glassSheen(defs, id, x1, y1, x2, y2, userSpace) {
  const g = defs.append("linearGradient").attr("id", id);
  if (userSpace) g.attr("gradientUnits", "userSpaceOnUse").attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2);
  else g.attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
  g.append("stop").attr("offset", "0%").attr("stop-color", "#fff").attr("stop-opacity", 0.42);
  g.append("stop").attr("offset", "42%").attr("stop-color", "#fff").attr("stop-opacity", 0.06);
  g.append("stop").attr("offset", "100%").attr("stop-color", "#000").attr("stop-opacity", 0.12);
  return "url(#" + id + ")";
}
function capsulePath(rb, sw, s0, s1, dir) {
  const ro = rb + sw / 2, ri = Math.max(0.1, rb - sw / 2), rc = sw / 2;
  const P = function(r, a) {
    return Math.cos(a) * r + "," + Math.sin(a) * r;
  };
  const large = Math.abs(s1 - s0) > Math.PI ? 1 : 0;
  const f = dir > 0 ? 1 : 0, b = dir > 0 ? 0 : 1;
  return "M" + P(ro, s0) + " A" + ro + "," + ro + " 0 " + large + " " + f + " " + P(ro, s1) + " A" + rc + "," + rc + " 0 0 " + f + " " + P(ri, s1) + " A" + ri + "," + ri + " 0 " + large + " " + b + " " + P(ri, s0) + " A" + rc + "," + rc + " 0 0 " + f + " " + P(ro, s0) + " Z";
}
function glassText(color, alpha) {
  const t = THEMES[settings.theme];
  const bg = t ? "rgb(" + t.bg.split(" ").join(",") + ")" : "#0d0d0d";
  return readableOn(d3.interpolateRgb(bg, color)(alpha));
}
function glassPiece(tag, cls, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  el.setAttribute("class", cls);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function decorateLabels() {
  const style = settings.labelBoxes;
  if (!state.g || !state.svg || !style || style === "off") return;
  const svgNode = state.svg.node();
  const defs = state.svg.select("defs").empty() ? state.svg.append("defs") : state.svg.select("defs");
  let filter = null;
  if (style === "shadow") {
    defs.append("filter").attr("id", "label-box-shadow").attr("x", "-30%").attr("y", "-60%").attr("width", "160%").attr("height", "220%").append("feDropShadow").attr("dx", 0).attr("dy", 1).attr("stdDeviation", 1.1).attr("flood-color", "#000").attr("flood-opacity", 0.75);
    filter = "url(#label-box-shadow)";
  } else if (style === "glow") {
    const f = defs.append("filter").attr("id", "label-box-glow").attr("x", "-40%").attr("y", "-80%").attr("width", "180%").attr("height", "260%");
    f.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", 2.2).attr("result", "b");
    const m = f.append("feMerge");
    m.append("feMergeNode").attr("in", "b");
    m.append("feMergeNode").attr("in", "SourceGraphic");
    filter = "url(#label-box-glow)";
  }
  let n = 0;
  const glass = settings.glass;
  if (glass) ensureGlassDefs(defs);
  const glassFilter = style === "glow" ? filter : "url(#label-glass-shadow)";
  state.g.selectAll(".node-label, .group-label").each(function(d) {
    if (!d) return;
    const nd = state.nodeData[d.nodeIdx];
    if (!nd) return;
    const tp = this.querySelector("textPath");
    const href = tp && tp.getAttribute("href");
    const pathEl = href ? svgNode.querySelector(href) : null;
    const pd = pathEl && pathEl.getAttribute("d");
    if (!pd) return;
    const t = pd.trim().split(/[\s,]+/);
    const sweep = +t[8];
    if (sweep !== 0 && sweep !== 1) return;
    const nChars = this.getNumberOfChars();
    if (nChars < 1) return;
    let pS, pE;
    let rSum = 0;
    try {
      pS = this.getStartPositionOfChar(0);
      pE = this.getEndPositionOfChar(nChars - 1);
      for (let i = 0; i < nChars; i++) {
        const e = this.getExtentOfChar(i);
        rSum += Math.hypot(e.x + e.width / 2, e.y + e.height / 2);
      }
    } catch (_) {
      return;
    }
    const fs = parseFloat(getComputedStyle(this).fontSize) || 7;
    const rb = rSum / nChars;
    const dir = sweep ? 1 : -1;
    const TAU = Math.PI * 2;
    const aS = Math.atan2(pS.y, pS.x);
    let span = Math.atan2(pE.y, pE.x) - aS;
    span = dir > 0 ? (span % TAU + TAU) % TAU : -((-span % TAU + TAU) % TAU);
    const pad = fs * 0.12 / rb;
    const s0 = aS - dir * pad, s1 = aS + span + dir * pad;
    const half = Math.abs(s1 - s0) / 2;
    const bx1 = Math.cos(s0) * rb, by1 = Math.sin(s0) * rb, bx2 = Math.cos(s1) * rb, by2 = Math.sin(s1) * rb;
    const isNode = this.classList.contains("node-label");
    const color = nd.node.online ? nd.color : "#3a3a3a";
    const dm = (this.getAttribute("class") || "").match(/depth-(\d+)/);
    const depth = dm ? +dm[1] : 0;
    if (glass) {
      const sw = fs * 1.5;
      const d2 = capsulePath(rb, sw, s0, s1, dir);
      const midA = (s0 + s1) / 2;
      const rTop = rb + dir * sw / 2, rBot = rb - dir * sw / 2;
      const cls = "label-box label-glass" + (isNode ? " node-box" : " group-box");
      const c = d3.color(color);
      const tint = c ? c.copy({ opacity: isNode ? 0.42 : Math.max(0.24, 0.36 - depth * 0.05) }).formatRgb() : color;
      const body = glassPiece("path", cls, { d: d2, fill: tint, filter: glassFilter || "" });
      const sheen = glassPiece("path", cls + " glass-sheen", {
        d: d2,
        fill: glassSheen(defs, "label-glass-s" + n++, Math.cos(midA) * rTop, Math.sin(midA) * rTop, Math.cos(midA) * rBot, Math.sin(midA) * rBot, true),
        stroke: "rgba(255,255,255,0.32)",
        "stroke-width": String(Math.max(0.35, fs * 0.06))
      });
      this.parentNode.insertBefore(body, this);
      this.parentNode.insertBefore(sheen, this);
      this.style.setProperty("fill", glassText(color, isNode ? 0.42 : 0.3), "important");
      return;
    }
    const box = document.createElementNS("http://www.w3.org/2000/svg", "path");
    box.setAttribute("class", "label-box" + (isNode ? " node-box" : " group-box"));
    box.setAttribute("d", "M" + bx1 + "," + by1 + " A" + rb + "," + rb + " 0 " + (2 * half > Math.PI ? 1 : 0) + " " + sweep + " " + bx2 + "," + by2);
    box.setAttribute("fill", "none");
    box.setAttribute("stroke", boxPaint(defs, color, "label-box-g" + n++, bx1, by1, bx2, by2, true));
    box.setAttribute("stroke-width", String(fs * 1.45));
    box.setAttribute("stroke-linecap", "round");
    box.setAttribute("opacity", String(isNode ? 0.92 : Math.max(0.5, 0.85 - depth * 0.12)));
    if (filter) box.setAttribute("filter", filter);
    this.parentNode.insertBefore(box, this);
    this.style.setProperty("fill", readableOn(color), "important");
  });
  state.g.selectAll(".collapsed-label").each(function(d) {
    if (!d || !d.groupKey) return;
    const sku = d.groupKey.slice(0, d.groupKey.indexOf("|"));
    const nd = state.nodeData.find(function(x) {
      return x.node.sku === sku;
    });
    if (!nd) return;
    let bb;
    try {
      bb = this.getBBox();
    } catch (_) {
      return;
    }
    if (!(bb.width > 0)) return;
    const fs = parseFloat(getComputedStyle(this).fontSize) || 6;
    const padX = fs * 0.55, padY = fs * 0.22;
    const color = nd.node.online ? nd.color : "#3a3a3a";
    if (glass) {
      const h = bb.height + 2 * padY;
      const geo = {
        x: String(bb.x - padX),
        y: String(bb.y - padY),
        width: String(bb.width + 2 * padX),
        height: String(h),
        rx: String(h / 2)
      };
      const tr0 = this.getAttribute("transform");
      if (tr0) geo.transform = tr0;
      const c = d3.color(color);
      const tint = c ? c.copy({ opacity: 0.32 }).formatRgb() : color;
      const body = glassPiece("rect", "label-box label-glass collapsed-box", Object.assign({ fill: tint, filter: glassFilter || "" }, geo));
      const sheen = glassPiece("rect", "label-box label-glass collapsed-box glass-sheen", Object.assign({
        fill: glassSheen(defs, "label-glass-s" + n++, 0, 0, 0, 0, false),
        stroke: "rgba(255,255,255,0.3)",
        "stroke-width": String(Math.max(0.3, fs * 0.06))
      }, geo));
      this.parentNode.insertBefore(body, this);
      this.parentNode.insertBefore(sheen, this);
      this.style.setProperty("fill", glassText(color, 0.32), "important");
      return;
    }
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("class", "label-box collapsed-box");
    r.setAttribute("x", String(bb.x - padX));
    r.setAttribute("y", String(bb.y - padY));
    r.setAttribute("width", String(bb.width + 2 * padX));
    r.setAttribute("height", String(bb.height + 2 * padY));
    r.setAttribute("rx", String((bb.height + 2 * padY) / 2));
    const tr = this.getAttribute("transform");
    if (tr) r.setAttribute("transform", tr);
    r.setAttribute("fill", boxPaint(defs, color, "label-box-g" + n++, 0, 0, 0, 0, false));
    r.setAttribute("opacity", "0.8");
    if (filter) r.setAttribute("filter", filter);
    this.parentNode.insertBefore(r, this);
    this.style.setProperty("fill", readableOn(color), "important");
  });
}
var PANEL_GLASS = { radius: 16, bezel: 18, scale: 22, blur: 2.5, saturate: 1.5 };
var TAB_GLASS = { radius: 999, bezel: 8, scale: 9, blur: 1.5, saturate: 1.4 };
var SVG_NS = "http://www.w3.org/2000/svg";
var PROFILE = 2.4;
var MAP_EDGE = 320;
var canRefract = /Chrome\//.test(navigator.userAgent);
var glassMaps = /* @__PURE__ */ new Map();
var glassFits = /* @__PURE__ */ new Map();
var glassSerial = 0;
var glassObserver = null;
function glassEdge(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const d = -(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r);
  if (ox > 0 || oy > 0) {
    const l = Math.hypot(ox, oy) || 1;
    return { d, nx: ox / l * Math.sign(px - w / 2), ny: oy / l * Math.sign(py - h / 2) };
  }
  return qx > qy ? { d, nx: Math.sign(px - w / 2), ny: 0 } : { d, nx: 0, ny: Math.sign(py - h / 2) };
}
function glassMap(w, h, r, bezel) {
  const key = w + "|" + h + "|" + r + "|" + bezel;
  const hit = glassMaps.get(key);
  if (hit) return hit;
  const q = Math.min(1, MAP_EDGE / Math.max(w, h));
  const W = Math.max(2, Math.round(w * q)), H = Math.max(2, Math.round(h * q));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d");
  if (!x) return "";
  const im = x.createImageData(W, H);
  const D = im.data;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const e = glassEdge((i + 0.5) / W * w, (j + 0.5) / H * h, w, h, r);
      const m = Math.pow(1 - Math.max(0, Math.min(1, e.d / bezel)), PROFILE);
      const k = (j * W + i) * 4;
      D[k] = 127.5 - 127.5 * e.nx * m;
      D[k + 1] = 127.5 - 127.5 * e.ny * m;
      D[k + 2] = 128;
      D[k + 3] = 255;
    }
  }
  x.putImageData(im, 0, 0);
  const url = c.toDataURL("image/png");
  if (glassMaps.size > 32) glassMaps.clear();
  glassMaps.set(key, url);
  return url;
}
function glassDefs() {
  let svg = document.getElementById("glass-defs");
  if (svg) return svg;
  svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "glass-defs";
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", "position:fixed;width:0;height:0;left:-10px;top:-10px;pointer-events:none");
  document.body.appendChild(svg);
  return svg;
}
function applyGlass(el, s) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (w < 2 || h < 2) return;
  const fitKey = w + "x" + h;
  if (glassFits.get(el) === fitKey) return;
  glassFits.set(el, fitKey);
  const r = Math.min(s.radius, Math.min(w, h) / 2);
  const url = glassMap(w, h, r, s.bezel);
  if (!url) return;
  let id = el.dataset.glassId;
  let f = id ? document.getElementById(id) : null;
  if (!f) {
    id = "glass-filter-" + ++glassSerial;
    f = document.createElementNS(SVG_NS, "filter");
    f.id = id;
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("primitiveUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    glassDefs().appendChild(f);
    el.dataset.glassId = id;
  }
  f.setAttribute("x", "0");
  f.setAttribute("y", "0");
  f.setAttribute("width", String(w));
  f.setAttribute("height", String(h));
  f.innerHTML = '<feImage href="' + url + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="m"/><feGaussianBlur in="SourceGraphic" stdDeviation="' + s.blur + '" result="b"/><feDisplacementMap in="b" in2="m" scale="' + s.scale + '" xChannelSelector="R" yChannelSelector="G"/><feColorMatrix type="saturate" values="' + s.saturate + '"/>';
  el.style.backdropFilter = "url(#" + id + ")";
}
function dropGlass(el) {
  const id = el.dataset.glassId;
  if (id) document.getElementById(id)?.remove();
  delete el.dataset.glassId;
  glassFits.delete(el);
  el.style.backdropFilter = "";
}
function refreshGlass() {
  const els = [
    [document.getElementById("display-panel"), PANEL_GLASS],
    [document.getElementById("display-tab"), TAB_GLASS],
    [document.getElementById("search-palette"), PANEL_GLASS],
    [document.getElementById("scenes-panel"), PANEL_GLASS],
    [document.getElementById("scenes-tab"), TAB_GLASS]
  ];
  const on = settings.glass && canRefract;
  if (on && !glassObserver && typeof ResizeObserver !== "undefined") {
    glassObserver = new ResizeObserver(function() {
      refreshGlass();
    });
  }
  for (const [el, shape] of els) {
    if (!el) continue;
    if (on && glassObserver && !el.dataset.glassObserved) {
      glassObserver.observe(el);
      el.dataset.glassObserved = "1";
    }
    if (on) applyGlass(el, shape);
    else if (el.dataset.glassId) dropGlass(el);
  }
}
var panelEl = null;
function syncPanel() {
  if (!panelEl) return;
  const q = function(sel2) {
    return panelEl.querySelector(sel2);
  };
  q("[data-k=theme]").value = settings.theme;
  q("[data-k=font]").value = settings.font;
  q("[data-k=textScale]").value = String(settings.textScale);
  q("[data-k=paramScale]").value = String(settings.paramScale);
  q("[data-k=weight]").value = String(settings.weight);
  q("[data-k=showText]").checked = settings.showText;
  q("[data-k=glass]").checked = settings.glass;
  q("[data-k=hideAbsent]").checked = settings.hideAbsent;
  q("[data-k=showAddresses]").checked = settings.showAddresses;
  q("[data-k=outputText]").checked = settings.outputText;
  let absent = 0;
  for (let i = 0; i < state.nodes.length; i++) if (!state.nodes[i].online && !state.nodes[i].is_local) absent++;
  q("[data-v=absent]").textContent = absent ? "(" + absent + ")" : "";
  q("[data-k=autoCollapseOver]").value = String(settings.autoCollapseOver);
  q("[data-v=textScale]").textContent = Math.round(settings.textScale * 100) + "%";
  q("[data-v=paramScale]").textContent = Math.round(settings.paramScale * 100) + "%";
  q("[data-v=weight]").textContent = String(settings.weight);
  q("[data-k=lineScale]").value = String(settings.lineScale);
  q("[data-k=ringScale]").value = String(settings.ringScale);
  q("[data-k=connScale]").value = String(settings.connScale);
  q("[data-v=connScale]").textContent = settings.connScale.toFixed(1) + "\xD7";
  q("[data-k=dragExpand]").value = settings.dragExpand;
  q("[data-k=labelBoxes]").value = settings.labelBoxes;
  q("[data-k=maxName]").value = String(settings.maxName);
  q("[data-v=lineScale]").textContent = settings.lineScale.toFixed(1) + "\xD7";
  q("[data-v=ringScale]").textContent = Math.round(settings.ringScale * 100) + "%";
  q("[data-k=videoOn]").checked = settings.videoOn;
  q("[data-k=videoSource]").value = settings.videoSource;
  q("[data-k=videoBright]").value = String(settings.videoBright);
  q("[data-v=videoBright]").textContent = Math.round(settings.videoBright * 100) + "%";
  q("[data-k=videoFit]").value = settings.videoFit;
  q("[data-k=videoLines]").value = settings.videoLines;
  panelEl.querySelectorAll(".dp-video-opt").forEach(function(r) {
    r.style.display = settings.videoOn ? "" : "none";
  });
}
function toggleVideo() {
  settings.videoOn = !settings.videoOn;
  videoSettingsChanged("videoOn");
}
function videoSettingsChanged(k) {
  saveSettings();
  applyVideo();
  if (k === "videoOn" || k === "videoSource") {
    videoChosen = null;
    chooseVideoSource();
  }
  if (k === "videoOn" || k === "videoLines") queueRelayout();
  syncPanel();
  if (panelEl && panelEl.style.display !== "none") pollVideo();
}
var SHORTCUTS = [
  ["view", [
    ["^Ctrl^+wheel", "zoom to cursor"],
    ["wheel \xB7 mid-drag", "pan when zoomed"],
    ["^0^", "reset zoom"],
    ["drag outside ring", "rotate"],
    ["^F^", "fullscreen"],
    ["^T^", "text on / off"],
    ["^H^", "hide absent nodes"],
    ["^I^", "node IP addresses"],
    ["^O^", "output window (in it: ^T^ ^F^)"],
    ["^V^", "video (NDI) inside the ring"]
  ]],
  ["find & edit", [
    ["^Ctrl^+^K^", "search, go to, connect"],
    ["^Enter^", "edit hovered parameter"],
    ["^Esc^", "close editor"],
    ["click group arc", "collapse / expand"]
  ]],
  ["connect", [
    ["drag dot / name", "onto another dot or name"],
    ["rest on glowing group", "opens it"],
    ["drop on glowing group", "links if one match, else opens"],
    ["^Esc^ \xB7 right-click", "cancel drag"],
    ["^Shift^+click line", "remove connection"],
    ["^Shift^+click absent", "flush the node"],
    ["^Ctrl^+^Z^", "undo (connect, disconnect, value)"],
    ["^Ctrl^+^Shift^+^Z^ \xB7 ^Ctrl^+^Y^", "redo"]
  ]],
  ["modes", [
    ["^P^", "high performance"],
    ["^D^", "graphite drawing"],
    ["^M^", "connection style"],
    ["^G^", "debug overlay"]
  ]]
];
function shortcutsHtml() {
  const k = (t) => t.replace(/\^([^^]+)\^/g, "<kbd>$1</kbd>");
  let h = '<details class="dp-keys"><summary>shortcuts</summary>';
  for (const [title, rows] of SHORTCUTS) {
    h += '<div class="dp-kgroup"><div class="dp-khead">' + title + '</div><div class="dp-kgrid">';
    for (const [key, what] of rows) h += "<span>" + k(key) + "</span><span>" + k(what) + "</span>";
    h += "</div></div>";
  }
  return h + "</details>";
}
function initPanel() {
  const tab = document.createElement("button");
  tab.id = "display-tab";
  tab.type = "button";
  tab.title = "Settings: theme, font, text size, mesh-only view, shortcuts";
  tab.textContent = "settings \u25B4";
  document.body.appendChild(tab);
  const p = document.createElement("div");
  p.id = "display-panel";
  p.style.display = "none";
  let themeOpts = '<option value="dataflou">dataflou (default)</option>';
  for (const id in THEMES) themeOpts += '<option value="' + id + '">' + THEMES[id].name + "</option>";
  let fontOpts = "";
  for (let i = 0; i < FONTS.length; i++) fontOpts += '<option value="' + FONTS[i][0] + '">' + FONTS[i][1] + "</option>";
  p.innerHTML = '<div class="dp-head">look</div><div class="dp-row"><label>theme</label><select data-k="theme">' + themeOpts + '</select></div><div class="dp-row"><label>font</label><select data-k="font">' + fontOpts + `</select></div><div class="dp-row"><label>text size</label><input type="range" min="0.5" max="3" step="0.05" data-k="textScale"><span data-v="textScale"></span></div><div class="dp-row"><label title="Size of the parameter names, on top of the text size">param labels</label><input type="range" min="0.5" max="2" step="0.05" data-k="paramScale"><span data-v="paramScale"></span></div><div class="dp-row"><label>weight</label><input type="range" min="100" max="900" step="100" data-k="weight"><span data-v="weight"></span></div><div class="dp-row"><label title="Coloured boxes behind instrument and group names, in the instrument's colour">label boxes</label><select data-k="labelBoxes"><option value="off">off</option><option value="flat">flat</option><option value="gradient">gradient</option><option value="shadow">gradient + shadow</option><option value="glow">glow</option></select></div><div class="dp-head">ring</div><div class="dp-row"><label title="Size of the ring, i.e. the diameter of the centre where connections cross">size</label><input type="range" min="0.3" max="1.6" step="0.02" data-k="ringScale"><span data-v="ringScale"></span></div><div class="dp-row"><label title="Thickness of the ring and of the group arcs">lines</label><input type="range" min="0.5" max="6" step="0.1" data-k="lineScale"><span data-v="lineScale"></span></div><div class="dp-row"><label title="Thickness of the connection lines">connections</label><input type="range" min="0.3" max="8" step="0.1" data-k="connScale"><span data-v="connScale"></span></div><div class="dp-row"><label title="While dragging a connection, how collapsed groups that hide a compatible parameter open">open groups</label><select data-k="dragExpand"><option value="hover">on hover</option><option value="all">all at once</option></select></div><div class="dp-row"><label title="Longer parameter / group names are cut with \u2026 (the full name stays in the tooltip). 0 = never cut.">max name</label><input type="number" min="0" max="200" step="1" data-k="maxName"><span class="dp-unit">characters</span></div><div class="dp-row"><label title="Instruments with more parameters than this start with all their groups collapsed (0 = never)">collapse over</label><input type="number" min="0" max="9999" step="1" data-k="autoCollapseOver"><span class="dp-unit">params</span></div><div class="dp-head">show</div><div class="dp-checks"><label class="dp-check"><input type="checkbox" data-k="showText"> text <kbd>T</kbd></label><label class="dp-check" title="Leave offline nodes off the ring"><input type="checkbox" data-k="hideAbsent"> hide absent <kbd>H</kbd><span data-v="absent" class="dp-count"></span></label><label class="dp-check" title="Each node's IP address and mesh port next to its name (nodes this host is linked to directly)"><input type="checkbox" data-k="showAddresses"> addresses <kbd>I</kbd></label><label class="dp-check"><input type="checkbox" data-k="glass"> liquid glass</label></div><div class="dp-head">output</div><div class="dp-row"><label title="A second, view-only window for a screen or projector: it follows this view (zoom, rotation, groups, theme, video)">window</label><button type="button" data-a="output">open <kbd>O</kbd></button><label class="dp-inline"><input type="checkbox" data-k="outputText"> with text</label></div><div class="dp-row"><label title="An NDI video feed inside the ring, under the connections: from this machine or another one on the network. Needs the ndi-pont bridge running on this host.">video <kbd>V</kbd></label><input type="checkbox" data-k="videoOn"><select data-k="videoSource" title="NDI source"><option value="">automatic</option></select></div><div class="dp-row dp-video-opt"><label title="Dims the video so the connections stay the subject">brightness</label><input type="range" min="0.1" max="1" step="0.05" data-k="videoBright"><span data-v="videoBright"></span></div><div class="dp-row dp-video-opt"><label title="cover fills the circle (crops the sides), contain shows the whole image. Lines: how connections stay visible over the video">fit \xB7 lines</label><select data-k="videoFit"><option value="cover">cover</option><option value="contain">contain</option></select><select data-k="videoLines" title="halo: a contrasting edge under each line (keeps the colours) \xB7 blend: difference, always contrasts but changes the colours \xB7 plain: nothing"><option value="halo">halo</option><option value="blend">blend</option><option value="plain">plain</option></select></div><div class="dp-status" data-s="videoStatus"></div><div class="dp-btns"><button type="button" data-a="collapse">collapse all</button><button type="button" data-a="expand">expand all</button><button type="button" data-a="zoom">reset zoom <kbd>0</kbd></button><button type="button" data-a="fullscreen">fullscreen <kbd>F</kbd></button><button type="button" data-a="reset">defaults</button></div>` + shortcutsHtml();
  document.body.appendChild(p);
  panelEl = p;
  tab.addEventListener("click", function() {
    const open2 = p.style.display === "none";
    p.style.display = open2 ? "block" : "none";
    tab.textContent = open2 ? "settings \u25BE" : "settings \u25B4";
    tab.classList.toggle("open", open2);
    if (open2) syncPanel();
    setVideoPolling(open2);
    refreshGlass();
  });
  p.addEventListener("input", function(e) {
    const el = e.target;
    const k = el.getAttribute("data-k");
    if (!k) return;
    if (k === "font") lastRoom = -1;
    if (k === "videoOn" || k === "videoSource" || k === "videoBright" || k === "videoFit" || k === "videoLines") {
      if (k === "videoOn") settings.videoOn = el.checked;
      else if (k === "videoBright") settings.videoBright = parseFloat(el.value) || DEFAULTS.videoBright;
      else settings[k] = el.value;
      videoSettingsChanged(k);
      return;
    }
    if (k === "theme" || k === "font" || k === "dragExpand" || k === "labelBoxes") {
      settings[k] = el.value;
      if (k === "labelBoxes" || k === "font") queueRelayout();
    } else if (k === "showText") settings.showText = el.checked;
    else if (k === "glass") {
      settings.glass = el.checked;
      if (settings.labelBoxes !== "off") queueRelayout();
    } else if (k === "outputText") settings.outputText = el.checked;
    else if (k === "hideAbsent") {
      setHideAbsent(el.checked);
      return;
    } else if (k === "showAddresses") {
      setShowAddresses(el.checked);
      return;
    } else {
      const v = parseFloat(el.value);
      if (isNaN(v)) return;
      settings[k] = v;
      if (k === "lineScale" || k === "ringScale" || k === "connScale" || k === "maxName" || k === "textScale" || k === "paramScale" || k === "weight") {
        lastRoom = -1;
        queueRelayout();
      }
    }
    saveSettings();
    applyStyle();
    syncPanel();
  });
  p.addEventListener("click", function(e) {
    const a = e.target.closest("button")?.getAttribute("data-a");
    if (!a) return;
    if (a === "collapse") {
      for (let i = 0; i < state.nodes.length; i++) collapseAllOf(state.nodes[i]);
      rerender(true);
    } else if (a === "expand") {
      state.collapsedGroups = {};
      rerender(true);
    } else if (a === "zoom") resetZoom();
    else if (a === "fullscreen") toggleFullscreen();
    else if (a === "output") openOutputWindow();
    else if (a === "reset") {
      settings = Object.assign({}, DEFAULTS);
      saveSettings();
      applyStyle();
      applyVideo();
      syncPanel();
      queueRelayout();
    }
  });
  p.addEventListener("keyup", function(e) {
    e.stopPropagation();
  });
  syncPanel();
}
var channel = null;
try {
  channel = new BroadcastChannel("dataflou-output");
} catch (_) {
}
function openOutputWindow() {
  const w = window.open(location.pathname + "#output", "dataflou-output", "popup,width=1280,height=720");
  if (w) w.focus();
}
function initOutputSender() {
  if (!channel) return;
  const ch = channel;
  let last = "";
  ch.onmessage = function(e) {
    const m = e.data || {};
    if (m.type === "hello") last = "";
    else if (m.type === "outputText") {
      settings.outputText = !!m.on;
      saveSettings();
      syncPanel();
    }
  };
  const tick = function() {
    const msg = {
      type: "view",
      base,
      k: zoomK,
      c: center,
      rot: state.rotationOffset,
      collapsed: state.collapsedGroups,
      settings
    };
    const j = JSON.stringify(msg);
    if (j !== last) {
      last = j;
      ch.postMessage(JSON.parse(j));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function initOutputReceiver() {
  document.body.classList.add("output-mode");
  document.title = "dataflou output";
  settings.showText = hashParams.get("text") === "1";
  applyStyle();
  window.addEventListener("resize", applyViewBox);
  let lastOutText = null;
  let lastCollapsed = "";
  if (channel) {
    const ch = channel;
    ch.onmessage = function(e) {
      const m = e.data || {};
      if (m.type !== "view") return;
      const s = m.settings;
      let showText = settings.showText;
      if (s.outputText !== lastOutText) {
        lastOutText = s.outputText;
        showText = s.outputText;
      }
      const next = Object.assign({}, DEFAULTS, s, { showText });
      const hideChanged = next.hideAbsent !== settings.hideAbsent || next.lineScale !== settings.lineScale || next.ringScale !== settings.ringScale || next.connScale !== settings.connScale || next.labelBoxes !== settings.labelBoxes || next.glass !== settings.glass || next.maxName !== settings.maxName || next.showAddresses !== settings.showAddresses || next.textScale !== settings.textScale || next.paramScale !== settings.paramScale || next.weight !== settings.weight || next.font !== settings.font || next.videoOn !== settings.videoOn || next.videoLines !== settings.videoLines;
      if (JSON.stringify(next) !== JSON.stringify(settings)) {
        settings = next;
        applyStyle();
        applyVideo();
      }
      if (m.base) {
        base = m.base;
        baseLocked = true;
      }
      zoomK = m.k;
      center = m.c;
      applyViewBox();
      if (m.rot !== state.rotationOffset) {
        state.rotationOffset = m.rot;
        if (state.g) state.g.attr("transform", "rotate(" + m.rot + ")");
      }
      const cj = JSON.stringify(m.collapsed);
      if (cj !== lastCollapsed || hideChanged) {
        const animate = lastCollapsed !== "" && cj !== lastCollapsed;
        lastCollapsed = cj;
        state.collapsedGroups = m.collapsed;
        rerender(animate);
      }
    };
    ch.postMessage({ type: "hello" });
  }
  document.addEventListener("keydown", function(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "t" || e.key === "T") {
      settings.showText = !settings.showText;
      applyStyle();
      if (channel) channel.postMessage({ type: "outputText", on: settings.showText });
    } else if (e.key === "f" || e.key === "F") toggleFullscreen();
  });
  document.addEventListener("dblclick", toggleFullscreen);
}
function initDisplay() {
  if (isOutput) {
    initOutputReceiver();
    return;
  }
  initOutputSender();
  if (hashParams.has("video") && !settings.videoOn) {
    settings.videoOn = true;
    saveSettings();
  }
  applyStyle();
  chooseVideoSource();
  initZoom();
  initKeys();
  initIdleCursor();
  initPanel();
  refreshGlass();
}

// ../../../../Projects/124_dataflou/web/src/config.ts
var MAIN_RADIUS = 220;
var ARC_WIDTH = 5;
var PARAM_RADIUS = 3.5;
var PARAM_PAD = 0.06;
var GROUP_LAYER_STEP = 16;
var PARAM_LABEL_GAP = 4;
var ARC_GAP_ANGLE = 5e-3;
var GAP_ANGLE = Math.PI * 0.02;
var VIEWBOX_PAD = 30;
var PULL_DIST = 14;
var SNAP_DIST = 20;
var HIT_WIDTH = 16;
var PARAM_RING_DIAM = 430;
var TRANSITION_DUR = 650;
var EXTEND_DUR = 250;
var RETRACT_DUR = 125;
var SNAP_DUR = 150;
var DROP_FADE_DUR = 300;
var GROUP_FONT_SIZES = [7, 6, 5.5];
var GROUP_LABEL_FILLS = ["#666", "#555", "#4a4a4a"];
var C_CYAN = "#4fc3f7";
var C_RED = "#c44";
var C_GREEN_SUB = "#2a6b3a";
var C_PARAM = "#555";
var C_OFFLINE = "#222";
var C_ERROR = "#c00";
var C_ACTIVE = "#ee4";

// ../../../../Projects/124_dataflou/web/src/curves.ts
function connectionControlPoint(sx, sy, ex, ey) {
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  return { cpx: mx * 0.7, cpy: my * 0.7 };
}
function connectionPath(sx, sy, ex, ey) {
  const { cpx, cpy } = connectionControlPoint(sx, sy, ex, ey);
  return "M" + sx + "," + sy + " Q" + cpx + "," + cpy + " " + ex + "," + ey;
}
function bezierPoint(sx, sy, cpx, cpy, ex, ey, t) {
  const u = 1 - t;
  return {
    x: u * u * sx + 2 * u * t * cpx + t * t * ex,
    y: u * u * sy + 2 * u * t * cpy + t * t * ey
  };
}
function bezierTangent(sx, sy, cpx, cpy, ex, ey, t) {
  const u = 1 - t;
  return {
    tx: 2 * u * (cpx - sx) + 2 * t * (ex - cpx),
    ty: 2 * u * (cpy - sy) + 2 * t * (ey - cpy)
  };
}
function bezierMidpoint(sx, sy, cpx, cpy, ex, ey) {
  return bezierPoint(sx, sy, cpx, cpy, ex, ey, 0.5);
}
function wavePath(sx, sy, ex, ey, cpx, cpy, freq, amplitude, offset, balanced, waveform) {
  const steps = Math.max(40, Math.round(freq * 8));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = bezierPoint(sx, sy, cpx, cpy, ex, ey, t);
    const tan = bezierTangent(sx, sy, cpx, cpy, ex, ey, t);
    const tLen = Math.sqrt(tan.tx * tan.tx + tan.ty * tan.ty) || 1;
    const nx = -tan.ty / tLen;
    const ny = tan.tx / tLen;
    let wave;
    if (waveform === "triangle") {
      const phase = t * freq;
      const frac = phase - Math.floor(phase);
      wave = 4 * Math.abs(frac - 0.5) - 1;
    } else {
      wave = Math.sin(t * freq * Math.PI * 2);
    }
    if (!balanced) {
      wave = wave >= 0 ? wave : wave * 0.3;
    }
    const displacement = wave * amplitude + offset;
    pts.push((p.x + nx * displacement).toFixed(2) + "," + (p.y + ny * displacement).toFixed(2));
  }
  return "M" + pts.join(" L");
}
function sinePath(sx, sy, ex, ey, cpx, cpy, freq, amplitude, offset, balanced) {
  return wavePath(sx, sy, ex, ey, cpx, cpy, freq, amplitude, offset, balanced, "sine");
}
function offsetPath(sx, sy, ex, ey, cpx, cpy, dist) {
  const steps = 30;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = bezierPoint(sx, sy, cpx, cpy, ex, ey, t);
    const tan = bezierTangent(sx, sy, cpx, cpy, ex, ey, t);
    const tLen = Math.sqrt(tan.tx * tan.tx + tan.ty * tan.ty) || 1;
    const nx = -tan.ty / tLen;
    const ny = tan.tx / tLen;
    pts.push((p.x + nx * dist).toFixed(2) + "," + (p.y + ny * dist).toFixed(2));
  }
  return "M" + pts.join(" L");
}
function tickMarks(sx, sy, cpx, cpy, ex, ey, separation, count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const p = bezierPoint(sx, sy, cpx, cpy, ex, ey, t);
    const tan = bezierTangent(sx, sy, cpx, cpy, ex, ey, t);
    const tLen = Math.sqrt(tan.tx * tan.tx + tan.ty * tan.ty) || 1;
    const nx = -tan.ty / tLen;
    const ny = tan.tx / tLen;
    const half = separation / 2;
    result.push({
      x1: p.x + nx * half,
      y1: p.y + ny * half,
      x2: p.x - nx * half,
      y2: p.y - ny * half
    });
  }
  return result;
}
function dragPath(sx, sy, ex, ey) {
  const dx = ex - sx, dy = ey - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const diam = PARAM_RING_DIAM * ringScale();
  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  let nx = -dy, ny = dx;
  const nLen = Math.sqrt(nx * nx + ny * ny) || 1;
  nx /= nLen;
  ny /= nLen;
  if (nx * mx + ny * my > 0) {
    nx = -nx;
    ny = -ny;
  }
  const bow = dist * 0.15;
  const shortCpx = mx + nx * bow;
  const shortCpy = my + ny * bow;
  const longCpx = mx * 0.7;
  const longCpy = my * 0.7;
  const lo = diam * 0.4, hi = diam * 0.5;
  const t = dist <= lo ? 0 : dist >= hi ? 1 : (dist - lo) / (hi - lo);
  const cpx = shortCpx + t * (longCpx - shortCpx);
  const cpy = shortCpy + t * (longCpy - shortCpy);
  return "M" + sx + "," + sy + " Q" + cpx + "," + cpy + " " + ex + "," + ey;
}

// ../../../../Projects/124_dataflou/web/src/util.ts
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var escAttr = esc;
var nameCollator = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
function compareNodes(a, b) {
  return nameCollator.compare(a.label || a.sku, b.label || b.sku) || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0);
}
function wsReady() {
  return !!(state.ws && state.ws.readyState === WebSocket.OPEN);
}
function makeGrpCls(nodeIdx, name) {
  return "grp-n" + nodeIdx + "-" + name.replace(/\s+/g, "_");
}
function parseHex(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16)
  ];
}
function desatRgb(r, g, b, keep) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const nr = Math.round(gray + (r - gray) * keep);
  const ng = Math.round(gray + (g - gray) * keep);
  const nb = Math.round(gray + (b - gray) * keep);
  return "rgb(" + nr + "," + ng + "," + nb + ")";
}
function gc(color) {
  if (!state.graphiteMode) return color;
  if (color.startsWith("#") && color.length >= 7) {
    const [r, g, b] = parseHex(color);
    return desatRgb(r, g, b, 0.1);
  }
  const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) {
    return desatRgb(+m[1], +m[2], +m[3], 0.1);
  }
  return color;
}

// ../../../../Projects/124_dataflou/web/src/conn-strategies.ts
var t0 = performance.now() / 1e3;
function smilBegin() {
  return "-" + (performance.now() / 1e3 - t0).toFixed(3) + "s";
}
var APPROACHES = ["A", "B", "C", "D", "E"];
var MIX_TABLE = [0.15, 0.4, 0.65, 0.85, 1];
function computeConnMetrics(connIdx, src, dest, nodeData) {
  const srcOnline = nodeData[src.nodeIdx].node.online;
  const dstOnline = nodeData[dest.nodeIdx].node.online;
  const offlineConn = !srcOnline || !dstOnline;
  const srcColor = nodeData[src.nodeIdx].color;
  const dstColor = nodeData[dest.nodeIdx].color;
  const srcRate = src.param.rate || 0;
  const destRate = dest.param.rate || 0;
  const underserved = destRate > 0 && srcRate > 0 && srcRate < destRate;
  const srcType = src.param.type || "number";
  const dstType = dest.param.type || "number";
  const typeCast = srcType !== dstType;
  const srcKey = src.sku + "|" + src.path;
  const dstKey = dest.sku + "|" + dest.path;
  const active = !!state.changedParams[srcKey] || !!state.changedParams[dstKey];
  const mix = MIX_TABLE[connIdx % 5];
  const activity = (connIdx * 7 + 3) % 11 / 10;
  let normalizedValue;
  let bipolar = false;
  const p = dest.param;
  if (typeof p.value === "number" && p.range && p.range.min !== void 0 && p.range.max !== void 0) {
    const mn = typeof p.range.min === "number" ? p.range.min : 0;
    const mx = typeof p.range.max === "number" ? p.range.max : 1;
    bipolar = mn < 0;
    if (mx !== mn) {
      normalizedValue = (p.value - mn) / (mx - mn) * 2 - 1;
    } else {
      normalizedValue = 0;
    }
  } else {
    normalizedValue = ((connIdx * 13 + 5) % 21 - 10) / 10;
    bipolar = normalizedValue < 0;
  }
  const cp = connectionControlPoint(src.cx, src.cy, dest.cx, dest.cy);
  return {
    connIdx,
    approach: APPROACHES[(connIdx + (state.drawModeOffset || 0)) % 5],
    active,
    underserved,
    typeCast,
    mix,
    activity,
    normalizedValue,
    bipolar,
    srcColor,
    dstColor,
    offlineConn,
    sx: src.cx,
    sy: src.cy,
    ex: dest.cx,
    ey: dest.cy,
    cpx: cp.cpx,
    cpy: cp.cpy
  };
}
function thermalColor(value) {
  const t = (value + 1) / 2;
  if (t <= 0.5) {
    const u = t * 2;
    const r = Math.round(100 + 155 * u);
    const g = Math.round(100 + 155 * u);
    const b = 255;
    return "rgb(" + r + "," + g + "," + b + ")";
  } else {
    const u = (t - 0.5) * 2;
    const r = 255;
    const g = Math.round(255 - 155 * u);
    const b = Math.round(255 - 155 * u);
    return "rgb(" + r + "," + g + "," + b + ")";
  }
}
function glowColor(value) {
  const t = (value + 1) / 2;
  if (t <= 0.5) {
    const u = t * 2;
    const r = Math.round(80 + 175 * u);
    const g = Math.round(120 + 135 * u);
    const b = 255;
    return "rgb(" + r + "," + g + "," + b + ")";
  } else {
    const u = (t - 0.5) * 2;
    const r = 255;
    const g = Math.round(255 - 95 * u);
    const b = Math.round(255 - 195 * u);
    return "rgb(" + r + "," + g + "," + b + ")";
  }
}
function buildDatum(m, dest, sub) {
  return {
    dest_sku: dest.sku,
    dest_path: dest.path,
    source_sku: sub.sku,
    source_path: sub.path,
    underserved: m.underserved,
    typeCast: m.typeCast,
    connIdx: m.connIdx,
    approach: m.approach,
    active: m.active,
    normalizedValue: m.normalizedValue,
    bipolar: m.bipolar,
    mix: m.mix,
    activity: m.activity,
    restWidth: 1,
    restOpacity: 0.5
  };
}
function renderConnection(connGroup, defs, m, datum) {
  if (m.offlineConn) {
    renderInactive(connGroup, m, datum);
  } else {
    switch (m.approach) {
      case "A":
        renderA(connGroup, defs, m, datum);
        break;
      case "B":
        renderB(connGroup, defs, m, datum);
        break;
      case "C":
        renderC(connGroup, defs, m, datum);
        break;
      case "D":
        renderD(connGroup, defs, m, datum);
        break;
      case "E":
        renderE(connGroup, defs, m, datum);
        break;
    }
  }
  if (m.typeCast) {
    connGroup.selectAll(".sub-line").each(function() {
      const el = d3.select(this);
      if (!el.attr("stroke-dasharray")) {
        el.attr("stroke-dasharray", "1,3");
      }
    });
    const mid = bezierMidpoint(m.sx, m.sy, m.cpx, m.cpy, m.ex, m.ey);
    connGroup.append("path").attr("class", "conn-cast-marker").attr("d", "M0,-3L3,0L0,3L-3,0Z").attr("transform", "translate(" + mid.x + "," + mid.y + ")").attr("fill", "#aaa").attr("opacity", 0.7);
  }
  renderLabel(connGroup, m);
  const hitWidth = m.approach === "D" ? 16 : 10;
  const pathD = connectionPath(m.sx, m.sy, m.ex, m.ey);
  connGroup.append("path").attr("class", "sub-hit").attr("d", pathD).attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", hitWidth).datum(datum);
}
function renderInactive(g, m, datum) {
  const pathD = connectionPath(m.sx, m.sy, m.ex, m.ey);
  datum.restWidth = 0.8;
  datum.restOpacity = 0.3;
  g.append("path").attr("class", "sub-line").attr("d", pathD).attr("fill", "none").attr("stroke", "#444").attr("stroke-width", 0.8).attr("opacity", 0.3).datum(datum);
}
function renderA(g, defs, m, datum) {
  const pathD = connectionPath(m.sx, m.sy, m.ex, m.ey);
  const gradId = "conn-thermal-" + m.connIdx;
  const grad = defs.append("linearGradient").attr("id", gradId).attr("gradientUnits", "userSpaceOnUse").attr("x1", m.sx).attr("y1", m.sy).attr("x2", m.ex).attr("y2", m.ey);
  const midStop = Math.round((m.normalizedValue + 1) / 2 * 100);
  grad.append("stop").attr("offset", "0%").attr("stop-color", gc("#4488ff"));
  grad.append("stop").attr("offset", midStop + "%").attr("stop-color", gc(thermalColor(m.normalizedValue)));
  grad.append("stop").attr("offset", "100%").attr("stop-color", gc("#ff4444"));
  const width = m.active ? 1 + m.activity * 3 : 1 + m.activity * 1.5;
  const opacity = 0.15 + m.mix * 0.85;
  datum.restWidth = width;
  datum.restOpacity = opacity;
  const line = g.append("path").attr("class", "sub-line").attr("d", pathD).attr("fill", "none").attr("stroke", "url(#" + gradId + ")").attr("stroke-width", width).attr("opacity", opacity).datum(datum);
  if (m.underserved) {
    line.attr("stroke-dasharray", "4,2");
  }
  g.append("circle").attr("class", "conn-endpoint").attr("cx", m.sx).attr("cy", m.sy).attr("r", m.active ? 2.5 : 2).attr("fill", gc(m.srcColor)).attr("opacity", m.active ? 0.8 : 0.5);
  g.append("circle").attr("class", "conn-endpoint").attr("cx", m.ex).attr("cy", m.ey).attr("r", m.active ? 2.5 : 2).attr("fill", gc(m.dstColor)).attr("opacity", m.active ? 0.8 : 0.5);
}
function renderB(g, defs, m, datum) {
  const gradId = "conn-grad-tri-" + m.connIdx;
  const grad = defs.append("linearGradient").attr("id", gradId).attr("gradientUnits", "userSpaceOnUse").attr("x1", m.sx).attr("y1", m.sy).attr("x2", m.ex).attr("y2", m.ey);
  grad.append("stop").attr("offset", "0%").attr("stop-color", gc(m.srcColor));
  grad.append("stop").attr("offset", "100%").attr("stop-color", gc(m.dstColor));
  const freq = m.active ? 3 + m.activity * 12 : 3 + m.activity * 5;
  const amplitude = m.active ? 1 + m.mix * 5 : 0.8 + m.mix * 2.5;
  const biasOffset = m.normalizedValue * 3;
  const balanced = !m.underserved;
  const pathD = wavePath(
    m.sx,
    m.sy,
    m.ex,
    m.ey,
    m.cpx,
    m.cpy,
    freq,
    amplitude,
    biasOffset,
    balanced,
    "triangle"
  );
  const opacity = 0.15 + m.mix * 0.85;
  const width = m.active ? 1.2 : 1;
  datum.restWidth = width;
  datum.restOpacity = opacity;
  g.append("path").attr("class", "sub-line").attr("d", pathD).attr("fill", "none").attr("stroke", "url(#" + gradId + ")").attr("stroke-width", width).attr("opacity", opacity).datum(datum);
}
function renderC(g, defs, m, datum) {
  const gradId = "conn-grad-sine-" + m.connIdx;
  const grad = defs.append("linearGradient").attr("id", gradId).attr("gradientUnits", "userSpaceOnUse").attr("x1", m.sx).attr("y1", m.sy).attr("x2", m.ex).attr("y2", m.ey);
  grad.append("stop").attr("offset", "0%").attr("stop-color", gc(m.srcColor));
  grad.append("stop").attr("offset", "100%").attr("stop-color", gc(m.dstColor));
  const freq = m.active ? 2 + m.activity * 14 : 2 + m.activity * 6;
  const amplitude = m.active ? 1 + m.mix * 6 : 1 + m.mix * 3;
  const biasOffset = m.normalizedValue * 4;
  const balanced = !m.underserved;
  const pathD = sinePath(
    m.sx,
    m.sy,
    m.ex,
    m.ey,
    m.cpx,
    m.cpy,
    freq,
    amplitude,
    biasOffset,
    balanced
  );
  const opacity = 0.15 + m.mix * 0.85;
  const width = m.active ? 1.2 : 1;
  datum.restWidth = width;
  datum.restOpacity = opacity;
  g.append("path").attr("class", "sub-line").attr("d", pathD).attr("fill", "none").attr("stroke", "url(#" + gradId + ")").attr("stroke-width", width).attr("opacity", opacity).datum(datum);
}
function renderD(g, defs, m, datum) {
  const separation = 2 + Math.abs(m.normalizedValue) * 8;
  const railWidth = m.active ? 0.5 + m.mix * 2 : 0.5 + m.mix * 1;
  const halfSep = separation / 2;
  const rail1D = offsetPath(m.sx, m.sy, m.ex, m.ey, m.cpx, m.cpy, halfSep);
  const rail2D = offsetPath(m.sx, m.sy, m.ex, m.ey, m.cpx, m.cpy, -halfSep);
  datum.restWidth = railWidth;
  datum.restOpacity = 0.7;
  g.append("path").attr("class", "sub-line").attr("d", rail1D).attr("fill", "none").attr("stroke", gc(m.srcColor)).attr("stroke-width", railWidth).attr("opacity", 0.7).datum(datum);
  const rail2 = g.append("path").attr("class", "sub-line conn-rail-2").attr("d", rail2D).attr("fill", "none").attr("stroke", gc(m.dstColor)).attr("stroke-width", railWidth).attr("opacity", 0.7).datum(datum);
  if (m.underserved) {
    rail2.attr("stroke-dasharray", "4,2");
  }
  const tickCount = m.active ? Math.round(2 + m.activity * 20) : Math.round(2 + m.activity * 8);
  const ticks = tickMarks(m.sx, m.sy, m.cpx, m.cpy, m.ex, m.ey, separation, tickCount);
  for (let i = 0; i < ticks.length; i++) {
    const tk = ticks[i];
    g.append("line").attr("class", "conn-ticks").attr("x1", tk.x1).attr("y1", tk.y1).attr("x2", tk.x2).attr("y2", tk.y2).attr("stroke", "#666").attr("stroke-width", 0.5).attr("opacity", 0.5);
  }
}
function renderE(g, defs, m, datum) {
  const pathD = connectionPath(m.sx, m.sy, m.ex, m.ey);
  const gradId = "conn-grad-glow-" + m.connIdx;
  const grad = defs.append("linearGradient").attr("id", gradId).attr("gradientUnits", "userSpaceOnUse").attr("x1", m.sx).attr("y1", m.sy).attr("x2", m.ex).attr("y2", m.ey);
  grad.append("stop").attr("offset", "0%").attr("stop-color", gc(m.srcColor));
  grad.append("stop").attr("offset", "100%").attr("stop-color", gc(m.dstColor));
  const blurRadius = m.active ? 1 + m.mix * 5 : 1 + m.mix * 2;
  const filterId = "conn-glow-e-" + m.connIdx;
  const filter = defs.append("filter").attr("id", filterId).attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  filter.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", blurRadius.toFixed(1));
  const glowC = gc(glowColor(m.normalizedValue));
  const auraWidth = m.active ? 3 + m.mix * 3 : 2 + m.mix * 2;
  const aura = g.append("path").attr("class", "sub-line conn-glow-aura").attr("d", pathD).attr("fill", "none").attr("stroke", glowC).attr("stroke-width", auraWidth).attr("opacity", 0.6).attr("filter", "url(#" + filterId + ")").datum(datum);
  const pulseDur = m.active ? 2.5 - m.activity * 2.3 : 4 - m.activity * 1.5;
  const anim = document.createElementNS("http://www.w3.org/2000/svg", "animate");
  anim.setAttribute("attributeName", "opacity");
  anim.setAttribute("values", "0.6;0.15;0.6");
  anim.setAttribute("dur", pulseDur.toFixed(1) + "s");
  anim.setAttribute("begin", smilBegin());
  anim.setAttribute("repeatCount", "indefinite");
  aura.node().appendChild(anim);
  const width = m.active ? 1.2 : 1;
  const opacity = m.active ? 0.8 : 0.6;
  datum.restWidth = width;
  datum.restOpacity = opacity;
  const line = g.append("path").attr("class", "sub-line").attr("d", pathD).attr("fill", "none").attr("stroke", "url(#" + gradId + ")").attr("stroke-width", width).attr("opacity", opacity).datum(datum);
  if (m.underserved) {
    line.attr("stroke-dasharray", "4,2");
  }
}
function renderLabel(g, m) {
  const mid = bezierMidpoint(m.sx, m.sy, m.cpx, m.cpy, m.ex, m.ey);
  const tan = bezierTangent(m.sx, m.sy, m.cpx, m.cpy, m.ex, m.ey, 0.5);
  const tLen = Math.sqrt(tan.tx * tan.tx + tan.ty * tan.ty) || 1;
  const nx = -tan.ty / tLen;
  const ny = tan.tx / tLen;
  g.append("text").attr("class", "conn-label").attr("x", mid.x + nx * 6).attr("y", mid.y + ny * 6).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", "5px").attr("fill", "#888").attr("opacity", 0.7).text(m.approach);
}
function strategyPathForDatum(d, sx, sy, ex, ey, isSecondRail) {
  const cp = connectionControlPoint(sx, sy, ex, ey);
  switch (d.approach) {
    case "B": {
      const freq = d.active ? 3 + d.activity * 12 : 3 + d.activity * 5;
      const amplitude = d.active ? 1 + d.mix * 5 : 0.8 + d.mix * 2.5;
      const biasOffset = d.normalizedValue * 3;
      const balanced = !d.underserved;
      return wavePath(
        sx,
        sy,
        ex,
        ey,
        cp.cpx,
        cp.cpy,
        freq,
        amplitude,
        biasOffset,
        balanced,
        "triangle"
      );
    }
    case "C": {
      const freq = d.active ? 2 + d.activity * 14 : 2 + d.activity * 6;
      const amplitude = d.active ? 1 + d.mix * 6 : 1 + d.mix * 3;
      const biasOffset = d.normalizedValue * 4;
      const balanced = !d.underserved;
      return sinePath(
        sx,
        sy,
        ex,
        ey,
        cp.cpx,
        cp.cpy,
        freq,
        amplitude,
        biasOffset,
        balanced
      );
    }
    case "D": {
      const separation = 2 + Math.abs(d.normalizedValue) * 8;
      const side = isSecondRail ? -separation / 2 : separation / 2;
      return offsetPath(sx, sy, ex, ey, cp.cpx, cp.cpy, side);
    }
    default:
      return connectionPath(sx, sy, ex, ey);
  }
}
function getRestWidth(d) {
  return d.restWidth || 1;
}
function getRestOpacity(d) {
  return d.restOpacity || 0.5;
}

// ../../../../Projects/124_dataflou/web/src/connections.ts
function buildConnectionColorMap(allParamData, nodeData) {
  const colorMap = {};
  const lookup = {};
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    lookup[pd.sku + "|" + pd.path] = i;
  }
  for (let i = 0; i < allParamData.length; i++) {
    const dest = allParamData[i];
    const destSubs = dest.param.subs;
    if (!destSubs || destSubs.length === 0) continue;
    for (let si = 0; si < destSubs.length; si++) {
      const sub = destSubs[si];
      const srcKey = sub.sku + "|" + sub.path;
      const srcIdx = lookup[srcKey];
      if (srcIdx === void 0) continue;
      const src = allParamData[srcIdx];
      const destKey = dest.sku + "|" + dest.path;
      if (!colorMap[destKey]) colorMap[destKey] = nodeData[src.nodeIdx].color;
      if (!colorMap[srcKey]) colorMap[srcKey] = nodeData[dest.nodeIdx].color;
    }
  }
  return colorMap;
}
function drawSubscriptionConnections(allParamData, nodeData) {
  if (allParamData.length < 2) return;
  const lookup = {};
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    const key = pd.sku + "|" + pd.path;
    lookup[key] = i;
  }
  const connGroup = state.g.append("g").attr("class", "connections");
  const defs = state.svg.select("defs");
  let connIdx = 0;
  for (let i = 0; i < allParamData.length; i++) {
    const dest = allParamData[i];
    if (!dest.param.subs || dest.param.subs.length === 0) continue;
    for (let si = 0; si < dest.param.subs.length; si++) {
      const sub = dest.param.subs[si];
      const srcKey = sub.sku + "|" + sub.path;
      const srcIdx = lookup[srcKey];
      if (srcIdx === void 0) continue;
      const src = allParamData[srcIdx];
      const metrics = computeConnMetrics(connIdx, src, dest, nodeData);
      const datum = buildDatum(metrics, dest, sub);
      renderConnection(connGroup, defs, metrics, datum);
      connIdx++;
    }
  }
  const k = connScale();
  if (k !== 1) {
    connGroup.selectAll("[stroke-width]").each(function() {
      if (this.classList.contains("sub-hit")) return;
      const w = parseFloat(this.getAttribute("stroke-width") || "");
      if (!isNaN(w)) this.setAttribute("stroke-width", String(w * k));
    });
    connGroup.selectAll(".sub-line").each(function(d) {
      if (d && d.restWidth) d.restWidth *= k;
    });
  }
  overVideo(connGroup);
}
function overVideo(connGroup) {
  const mode = videoLines();
  if (mode === "blend") {
    connGroup.style("mix-blend-mode", "difference");
    return;
  }
  if (mode !== "halo") return;
  const conn = connGroup.node();
  const halos = document.createElementNS("http://www.w3.org/2000/svg", "g");
  halos.setAttribute("class", "conn-halos");
  halos.setAttribute("pointer-events", "none");
  conn.querySelectorAll("[stroke-width]").forEach(function(el) {
    if (el.classList.contains("sub-hit")) return;
    const w = parseFloat(el.getAttribute("stroke-width") || "");
    if (isNaN(w) || w <= 0) return;
    const op = parseFloat(el.getAttribute("opacity") || "1");
    if (op < 0.85) el.style.opacity = "0.85";
    const dark = luminance(getComputedStyle(el).stroke) < 0.3;
    const c = el.cloneNode(false);
    c.removeAttribute("class");
    c.removeAttribute("id");
    c.removeAttribute("marker-start");
    c.removeAttribute("marker-end");
    c.removeAttribute("filter");
    c.style.filter = "";
    c.style.stroke = "";
    c.setAttribute("stroke", dark ? "#fff" : "#000");
    c.setAttribute("stroke-opacity", dark ? "0.45" : "0.55");
    c.setAttribute("opacity", "1");
    c.setAttribute("fill", "none");
    c.setAttribute("stroke-width", String(w * 2.4 + 2));
    c.setAttribute("stroke-linecap", "round");
    halos.appendChild(c);
  });
  conn.parentNode.insertBefore(halos, conn);
}
function luminance(css) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || "");
  if (!m) return 1;
  const lin = function(v) {
    const c = parseInt(v, 10) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
}
function drawPendingLinks(allParamData) {
  if (!state.pendingSubscriptions.length || !state.g) return;
  const at = {};
  for (let i = 0; i < allParamData.length; i++) at[allParamData[i].sku + "|" + allParamData[i].path] = allParamData[i];
  const layer = state.g.append("g").attr("class", "pending-links");
  for (let i = 0; i < state.pendingSubscriptions.length; i++) {
    const p = state.pendingSubscriptions[i];
    const a = at[p.source_sku + "|" + p.source_path], b = at[p.dest_sku + "|" + p.dest_path];
    if (!a || !b) continue;
    layer.append("path").attr("class", "pending-link").attr("d", connectionPath(a.cx, a.cy, b.cx, b.cy)).attr("stroke-width", 1.2 * connScale()).style("animation-delay", -(Date.now() % 600) + "ms");
  }
}
function clearSubLineHighlight() {
  if (state.hoveredSubLine) {
    const d = d3.select(state.hoveredSubLine).datum();
    d3.select(state.hoveredSubLine).classed("sub-line-target", false).style("stroke", null).style("filter", null).attr("stroke-width", d ? getRestWidth(d) : 1).attr("opacity", d ? getRestOpacity(d) : 0.5);
    state.hoveredSubLine = null;
  }
}
function updateSubLineHighlight() {
  const pt = state.svg.node().createSVGPoint();
  pt.x = state.lastMouseClient.x;
  pt.y = state.lastMouseClient.y;
  const svgPt = pt.matrixTransform(state.g.node().getScreenCTM().inverse());
  const nearest = findNearestSubLine(svgPt);
  if (nearest !== state.hoveredSubLine) {
    clearSubLineHighlight();
    if (nearest) {
      d3.select(nearest).classed("sub-line-target", true).style("stroke", C_RED).attr("stroke-width", 3.5 * connScale()).attr("opacity", 1).style("filter", "drop-shadow(0 0 4px rgba(200, 50, 50, 0.6))");
      state.hoveredSubLine = nearest;
    }
  }
}
function findNearestSubLine(svgPt) {
  let nearest = null;
  let nearestDist = Infinity;
  state.g.selectAll(".sub-line").each(function() {
    const dist = distToPath(this, svgPt);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = this;
    }
  });
  return nearestDist <= 12 ? nearest : null;
}
function distToPath(pathEl, pt) {
  const pathLen = pathEl.getTotalLength();
  let best = Infinity;
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const p = pathEl.getPointAtLength(pathLen * i / steps);
    const dx = p.x - pt.x, dy = p.y - pt.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// ../../../../Projects/124_dataflou/web/src/types/messages.ts
var MSG_SNAPSHOT = "snapshot";
var MSG_TOAST = "toast";
var MSG_PERF_MODE = "perf_mode";
var MSG_UNIVERSE = "universe";
var MSG_SET_UNIVERSE = "set_universe";
var MSG_IDENTIFY = "identify";
var MSG_SUBSCRIBE = "subscribe";
var MSG_UNSUBSCRIBE = "unsubscribe";
var MSG_FLUSH = "flush_node";
var MSG_SET_VALUE = "set_value";
var MSG_UPDATE_PARAM = "update_param";
var MSG_DELETE_PARAM = "delete_param";
var MSG_ADD_PARAM = "add_param";
var MSG_SCENE = "scene";

// ../../../../Projects/124_dataflou/web/src/actions.ts
var HISTORY_MAX = 50;
var COALESCE_MS = 1e3;
var undoStack = [];
var redoStack = [];
var coalesce = null;
var listeners = [];
function sameLink(a, b) {
  return a.dest_sku === b.dest_sku && a.dest_path === b.dest_path && a.source_sku === b.source_sku && a.source_path === b.source_path;
}
function nodeParams(sku) {
  const n = state.nodes.find(function(x) {
    return x.sku === sku;
  });
  if (!n) return [];
  const out = [];
  collectParamsWithAncestors(n.params, [], [], out, true);
  return out;
}
function findParam(sku, path) {
  const ps = nodeParams(sku);
  for (let i = 0; i < ps.length; i++) if (ps[i].path === path) return ps[i].param;
  return null;
}
function nodeAvailable(sku) {
  const n = state.nodes.find(function(x) {
    return x.sku === sku;
  });
  return !!n && (n.online || n.is_local);
}
function nodeName(sku) {
  const n = state.nodes.find(function(x) {
    return x.sku === sku;
  });
  return n ? n.label || n.sku.slice(0, 8) : sku.slice(0, 8);
}
function paramName(sku, path) {
  const p = findParam(sku, path);
  return p ? p.label || p.name : path.split("/").pop() || path;
}
function describeLink(l) {
  return paramName(l.source_sku, l.source_path) + " \u2192 " + paramName(l.dest_sku, l.dest_path);
}
function toSendable(v, type) {
  if (v === null || v === void 0) return null;
  if (typeof v === "string" && type === "colour" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) {
    const h = v.slice(1);
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255
    ];
  }
  if (Array.isArray(v)) return v.slice();
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return null;
}
function currentValue(sku, path) {
  const r = recentSent[sku + "|" + path];
  if (r && Date.now() - r.time < RECENT_SENT_MS) return Array.isArray(r.value) ? r.value.slice() : r.value;
  const p = findParam(sku, path);
  return p ? toSendable(p.value, p.type) : null;
}
var recentSent = {};
var RECENT_SENT_MS = 3e3;
function notify(message, at, kind = "info") {
  if (isOutputWindow()) return;
  const toast = document.createElement("div");
  toast.className = "connection-toast" + (kind === "info" ? " info" : "");
  toast.textContent = message;
  const x = at ? at.clientX : window.innerWidth / 2;
  const y = at ? at.clientY : 70;
  toast.style.left = x + "px";
  toast.style.top = y - 30 + "px";
  if (!at) toast.style.transform = "translateX(-50%)";
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.classList.add("fading");
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 500);
  }, kind === "info" ? 2600 : 2e3);
}
function sendSubscribe(l, at) {
  if (!wsReady()) return false;
  state.ws.send(JSON.stringify({
    type: MSG_SUBSCRIBE,
    dest_sku: l.dest_sku,
    dest_path: l.dest_path,
    source_sku: l.source_sku,
    source_path: l.source_path
  }));
  state.pendingSubscriptions = state.pendingSubscriptions.filter(function(p) {
    return !sameLink(p, l);
  });
  const pos = at || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
  state.pendingSubscriptions.push({
    dest_sku: l.dest_sku,
    dest_path: l.dest_path,
    source_sku: l.source_sku,
    source_path: l.source_path,
    time: Date.now(),
    clientX: pos.clientX,
    clientY: pos.clientY
  });
  return true;
}
function sendUnsubscribe(l) {
  if (!wsReady()) return false;
  state.ws.send(JSON.stringify({
    type: MSG_UNSUBSCRIBE,
    dest_sku: l.dest_sku,
    dest_path: l.dest_path,
    source_sku: l.source_sku,
    source_path: l.source_path
  }));
  state.pendingSubscriptions = state.pendingSubscriptions.filter(function(p) {
    return !sameLink(p, l);
  });
  return true;
}
function sendValue(sku, path, value) {
  if (!wsReady()) return false;
  state.ws.send(JSON.stringify({ type: MSG_SET_VALUE, sku, path, value }));
  recentSent[sku + "|" + path] = { value: Array.isArray(value) ? value.slice() : value, time: Date.now() };
  return true;
}
function recordStep(step) {
  undoStack.push(step);
  while (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack.length = 0;
  coalesce = null;
  changed();
}
function subscribeLink(l, at) {
  if (!sendSubscribe(l, at)) return false;
  recordStep({ kind: "link", link: copyLink(l), on: true });
  return true;
}
function unsubscribeLink(l) {
  if (!sendUnsubscribe(l)) return false;
  recordStep({ kind: "link", link: copyLink(l), on: false });
  return true;
}
function setParamValue(sku, path, value) {
  const before = currentValue(sku, path);
  if (!sendValue(sku, path, value)) return false;
  const key = sku + "|" + path;
  const now = Date.now();
  const top = undoStack[undoStack.length - 1];
  const after = Array.isArray(value) ? value.slice() : value;
  if (coalesce && coalesce.key === key && now - coalesce.time < COALESCE_MS && top && top.kind === "value") {
    top.after = after;
    coalesce.time = now;
    return true;
  }
  recordStep({ kind: "value", sku, path, before, after });
  coalesce = { key, time: now };
  return true;
}
function copyLink(l) {
  return { dest_sku: l.dest_sku, dest_path: l.dest_path, source_sku: l.source_sku, source_path: l.source_path };
}
function applyLeaf(s, forward, r) {
  if (s.kind === "link") {
    const subscribe = forward ? s.on : !s.on;
    const l = s.link;
    const missing = [l.dest_sku].concat(subscribe ? [l.source_sku] : []).filter(function(k) {
      return !nodeAvailable(k);
    });
    if (missing.length) {
      r.skipped++;
      for (let i = 0; i < missing.length; i++) r.offline[nodeName(missing[i])] = true;
      return;
    }
    if (subscribe ? sendSubscribe(l) : sendUnsubscribe(l)) r.done++;
    return;
  }
  const v = forward ? s.after : s.before;
  if (v === null) {
    r.skipped++;
    return;
  }
  if (!nodeAvailable(s.sku)) {
    r.skipped++;
    r.offline[nodeName(s.sku)] = true;
    return;
  }
  if (sendValue(s.sku, s.path, v)) r.done++;
}
function apply(step, forward) {
  const r = { done: 0, skipped: 0, offline: {} };
  applyLeaf(step, forward, r);
  return r;
}
function stepLabel(s) {
  if (s.kind === "link") return (s.on ? "connect " : "disconnect ") + describeLink(s.link);
  return "set " + paramName(s.sku, s.path);
}
function report(verb, step, r) {
  let msg = verb + " " + stepLabel(step);
  if (r.skipped) {
    const off = Object.keys(r.offline);
    msg += " \u2014 " + r.skipped + " skipped" + (off.length ? " (offline: " + off.join(", ") + ")" : "");
  }
  notify(msg, void 0, r.skipped && !r.done ? "error" : "info");
}
function undo() {
  const step = undoStack[undoStack.length - 1];
  if (!step) {
    notify("Nothing to undo");
    return false;
  }
  if (!wsReady()) {
    notify("Not connected", void 0, "error");
    return false;
  }
  undoStack.pop();
  redoStack.push(step);
  coalesce = null;
  report("Undo", step, apply(step, false));
  changed();
  return true;
}
function redo() {
  const step = redoStack[redoStack.length - 1];
  if (!step) {
    notify("Nothing to redo");
    return false;
  }
  if (!wsReady()) {
    notify("Not connected", void 0, "error");
    return false;
  }
  redoStack.pop();
  undoStack.push(step);
  coalesce = null;
  report("Redo", step, apply(step, true));
  changed();
  return true;
}
function historyState() {
  const u = undoStack[undoStack.length - 1], r = redoStack[redoStack.length - 1];
  return {
    undo: undoStack.length,
    redo: redoStack.length,
    nextUndo: u ? stepLabel(u) : null,
    nextRedo: r ? stepLabel(r) : null
  };
}
function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  coalesce = null;
  changed();
}
function onHistoryChange(fn) {
  listeners.push(fn);
}
function changed() {
  for (let i = 0; i < listeners.length; i++) listeners[i]();
}
function initHistory() {
  if (isOutputWindow()) return;
  const status = document.getElementById("status");
  const wrap = document.createElement("span");
  wrap.id = "history-btns";
  wrap.innerHTML = '<button type="button" id="undo-btn" disabled>\u21B6 undo</button><button type="button" id="redo-btn" disabled>redo \u21B7</button>';
  if (status) status.appendChild(wrap);
  const ub = wrap.querySelector("#undo-btn");
  const rb = wrap.querySelector("#redo-btn");
  ub.addEventListener("click", function() {
    undo();
    ub.blur();
  });
  rb.addEventListener("click", function() {
    redo();
    rb.blur();
  });
  function refresh() {
    const h = historyState();
    ub.disabled = !h.undo;
    rb.disabled = !h.redo;
    ub.title = h.nextUndo ? "Undo " + h.nextUndo + " (Ctrl+Z) \u2014 " + h.undo + " step" + (h.undo > 1 ? "s" : "") : "Nothing to undo (Ctrl+Z)";
    rb.title = h.nextRedo ? "Redo " + h.nextRedo + " (Ctrl+Shift+Z / Ctrl+Y)" : "Nothing to redo (Ctrl+Shift+Z / Ctrl+Y)";
  }
  onHistoryChange(refresh);
  refresh();
  window.__dataflouActions = {
    subscribeLink,
    unsubscribeLink,
    setParamValue,
    undo,
    redo,
    historyState,
    clearHistory,
    state
  };
  document.addEventListener("keydown", function(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) undo();
    } else if (k === "z" && e.shiftKey || k === "y" && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) redo();
    }
  });
}

// ../../../../Projects/124_dataflou/web/src/drag.ts
var pullDist = PULL_DIST;
var extendDuration = EXTEND_DUR;
var retractDuration = RETRACT_DUR;
var rotateState = null;
var inertiaRaf = null;
function flowOk(pd, reverse) {
  const f = pd.param.flow || "source";
  return reverse ? f === "destination" || f === "bidir" : f === "source" || f === "bidir";
}
function alreadyLinked(pd, start, reverse) {
  const dest = reverse ? pd : start;
  const src = reverse ? start : pd;
  const existing = dest.param.subs || [];
  return existing.some(function(s) {
    return s.sku === src.sku && s.path === src.path;
  });
}
function isDragCandidate(pd, start, reverse) {
  if (pd.isCollapsed) return false;
  if (pd.sku === start.sku && pd.path === start.path) return false;
  if (!flowOk(pd, reverse)) return false;
  return pd.param.type === start.param.type;
}
function startsReverse(pd) {
  return (pd.param.flow || "source") === "source";
}
function expandCollapsedCandidates(dragPd, reverse) {
  const expandedKeys = [];
  const seen = {};
  if (!state.allParamData) return expandedKeys;
  for (let i = 0; i < state.allParamData.length; i++) {
    const pd = state.allParamData[i];
    if (!pd.isCollapsed) continue;
    if (pd.sku === dragPd.sku && pd.path === dragPd.path) continue;
    if (!flowOk(pd, reverse)) continue;
    if (pd.param.type !== dragPd.param.type) continue;
    if (pd.param.error) continue;
    if (alreadyLinked(pd, dragPd, reverse)) continue;
    const groupKey = pd.sku + "|" + pd.collapsedGroupPath;
    if (!seen[groupKey] && state.collapsedGroups[groupKey]) {
      seen[groupKey] = true;
      delete state.collapsedGroups[groupKey];
      expandedKeys.push(groupKey);
    }
  }
  return expandedKeys;
}
function findNearestDropTarget(allParamData, sx, sy, dragStartData, snapDist, pulledPos, reverse = false) {
  let best = null;
  let bestD2 = snapDist * snapDist;
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    if (!isDragCandidate(pd, dragStartData, reverse)) continue;
    const key = pd.sku + "|" + pd.path;
    let pcx = pd.cx, pcy = pd.cy;
    if (pulledPos && pulledPos[key]) {
      pcx = pulledPos[key].cx;
      pcy = pulledPos[key].cy;
    }
    const dx = pcx - sx;
    const dy = pcy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = pd;
    }
  }
  return best;
}
function isValidDropTarget(pd, dragStartData, reverse = false) {
  if (!isDragCandidate(pd, dragStartData, reverse)) return false;
  if (pd.param.error) return false;
  return !alreadyLinked(pd, dragStartData, reverse);
}
function paramUnderPointer(target, allParamData) {
  const el = target;
  if (!el || !el.closest) return null;
  const hit = el.closest(".param-hit, .param-label-hit, .param-shape");
  if (!hit) return null;
  const d = d3.select(hit).datum();
  return d && typeof d.paramIdx === "number" ? allParamData[d.paramIdx] || null : null;
}
var pendingDrag = null;
var DRAG_THRESHOLD_PX = 4;
document.addEventListener("mouseup", function() {
  pendingDrag = null;
});
function pullElement(el, pd) {
  const pp = pulledPoint(pd);
  if (!pp) return null;
  const nx = pp.cx, ny = pp.cy;
  const deg = pd.angle * 180 / Math.PI;
  const tag = el.node().tagName.toLowerCase();
  if (tag === "circle") {
    el.transition().duration(extendDuration).ease(d3.easeBackOut).attr("cx", nx).attr("cy", ny);
  } else {
    el.transition().duration(extendDuration).ease(d3.easeBackOut).attr("transform", "translate(" + nx + "," + ny + ") rotate(" + deg + ")");
  }
  return { cx: nx, cy: ny };
}
function retractElement(el, pd) {
  const deg = pd.angle * 180 / Math.PI;
  const tag = el.node().tagName.toLowerCase();
  if (tag === "circle") {
    el.transition().duration(retractDuration).attr("cx", pd.cx).attr("cy", pd.cy);
  } else {
    el.transition().duration(retractDuration).attr("transform", "translate(" + pd.cx + "," + pd.cy + ") rotate(" + deg + ")");
  }
}
function addTether(pd, pos, key, animate = true) {
  const line = state.g.append("line").attr("class", "pull-segment").attr("x1", animate ? pd.cx : pos.cx).attr("y1", animate ? pd.cy : pos.cy).attr("x2", pd.cx).attr("y2", pd.cy).attr("stroke", C_CYAN).attr("stroke-width", 0.5).attr("opacity", 0.3).datum({ paramKey: key });
  if (animate) {
    line.transition().duration(extendDuration).ease(d3.easeBackOut).attr("x1", pos.cx).attr("y1", pos.cy);
  }
}
function pulledPoint(pd) {
  const r = Math.sqrt(pd.cx * pd.cx + pd.cy * pd.cy);
  if (r < 0.01) return null;
  return { cx: pd.cx * (1 - pullDist / r), cy: pd.cy * (1 - pullDist / r) };
}
function placeShape(el, pd, pos) {
  if (el.node().tagName.toLowerCase() === "circle") el.attr("cx", pos.cx).attr("cy", pos.cy);
  else el.attr("transform", "translate(" + pos.cx + "," + pos.cy + ") rotate(" + pd.angle * 180 / Math.PI + ")");
}
function candidateGroupKeys(start, reverse) {
  const keys = {};
  for (let i = 0; i < state.allParamData.length; i++) {
    const pd = state.allParamData[i];
    if (!pd.isCollapsed || pd.param.error) continue;
    if (pd.sku === start.sku && pd.path === start.path) continue;
    if (!flowOk(pd, reverse) || pd.param.type !== start.param.type) continue;
    if (alreadyLinked(pd, start, reverse)) continue;
    keys[pd.sku + "|" + pd.collapsedGroupPath] = true;
  }
  return keys;
}
function markCandidateGroups(start, reverse) {
  const keys = candidateGroupKeys(start, reverse);
  state.g.selectAll(".collapsed-dot, .collapsed-hit").classed("drag-candidate-group", function(d) {
    return !!(d && keys[d.groupKey]);
  });
}
var SPRING_MS = 380;
var springKey = null;
var springTimer = null;
var springStart = 0;
function springCancel() {
  if (springTimer !== null) {
    window.clearTimeout(springTimer);
    springTimer = null;
  }
  springKey = null;
  if (state.g) state.g.selectAll(".spring-ring").remove();
}
function drawSpringRing() {
  if (!state.g) return;
  state.g.selectAll(".spring-ring").remove();
  if (!springKey) return;
  const dot = state.collapsedDots.find(function(c) {
    return c.sku + "|" + c.groupPath === springKey;
  });
  if (!dot) return;
  const r = 9, len = 2 * Math.PI * r;
  state.g.append("circle").attr("class", "spring-ring").attr("cx", dot.cx).attr("cy", dot.cy).attr("r", r).attr("transform", "rotate(-90," + dot.cx + "," + dot.cy + ")").style("stroke-dasharray", String(len)).style("--spring-len", String(len)).style("animation-duration", SPRING_MS + "ms").style("animation-delay", -(performance.now() - springStart) + "ms");
}
var cancelCurrentDrag = null;
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape" && state.dragState && !state.dragState.retracting && cancelCurrentDrag) {
    e.preventDefault();
    e.stopPropagation();
    cancelCurrentDrag();
  }
}, true);
document.addEventListener("contextmenu", function(e) {
  if (state.dragState && !state.dragState.retracting && cancelCurrentDrag) {
    e.preventDefault();
    cancelCurrentDrag();
  }
}, true);
function springCheck(target) {
  const el = target && target.closest ? target.closest(".drag-candidate-group") : null;
  const d = el ? d3.select(el).datum() : null;
  const key = d && d.groupKey ? d.groupKey : null;
  if (key === springKey) return;
  springCancel();
  springKey = key;
  if (!key) return;
  el.classList.add("spring-arming");
  springStart = performance.now();
  drawSpringRing();
  springTimer = window.setTimeout(function() {
    springTimer = null;
    springKey = null;
    if (state.g) state.g.selectAll(".spring-ring").remove();
    const ds = state.dragState;
    if (!ds || ds.retracting || !state.collapsedGroups[key]) return;
    delete state.collapsedGroups[key];
    (ds.autoExpandedKeys = ds.autoExpandedKeys || []).push(key);
    state._animating = false;
    state.tempExpandedGroup = null;
    if (state._render) state._render();
  }, SPRING_MS);
}
function retractTethers(exceptKeys) {
  state.g.selectAll(".pull-segment").each(function() {
    const seg = d3.select(this);
    const datum = seg.datum();
    if (datum && exceptKeys && exceptKeys[datum.paramKey]) return;
    seg.transition().duration(retractDuration).attr("x1", seg.attr("x2")).attr("y1", seg.attr("y2")).attr("opacity", 0).remove();
  });
}
function setupDragSubscribe(allParamData, nodeData) {
  const paramLookup = {};
  for (let i = 0; i < allParamData.length; i++) {
    paramLookup[allParamData[i].sku + "|" + allParamData[i].path] = i;
  }
  function animateConnectionsToPulled(pulledPos, extending) {
    const dur = extending ? extendDuration : retractDuration;
    const ease = extending ? d3.easeBackOut : d3.easeLinear;
    state.g.selectAll(".sub-line").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const srcPd = allParamData[srcIdx];
      const dstPd = allParamData[dstIdx];
      const sx = extending && srcPulled ? srcPulled.cx : srcPd.cx;
      const sy = extending && srcPulled ? srcPulled.cy : srcPd.cy;
      const ex = extending && dstPulled ? dstPulled.cx : dstPd.cx;
      const ey = extending && dstPulled ? dstPulled.cy : dstPd.cy;
      const isRail2 = el.classed("conn-rail-2");
      el.transition().duration(dur).ease(ease).attr("d", strategyPathForDatum(d, sx, sy, ex, ey, isRail2));
    });
    state.g.selectAll(".sub-hit").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const srcPd = allParamData[srcIdx];
      const dstPd = allParamData[dstIdx];
      const sx = extending && srcPulled ? srcPulled.cx : srcPd.cx;
      const sy = extending && srcPulled ? srcPulled.cy : srcPd.cy;
      const ex = extending && dstPulled ? dstPulled.cx : dstPd.cx;
      const ey = extending && dstPulled ? dstPulled.cy : dstPd.cy;
      el.transition().duration(dur).ease(ease).attr("d", connectionPath(sx, sy, ex, ey));
    });
    state.g.selectAll(".sub-line").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const stroke = el.attr("stroke");
      if (!stroke || !stroke.startsWith("url(#")) return;
      const gradId = stroke.slice(5, -1);
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const srcPd = allParamData[srcIdx];
      const dstPd = allParamData[dstIdx];
      const sx = extending && srcPulled ? srcPulled.cx : srcPd.cx;
      const sy = extending && srcPulled ? srcPulled.cy : srcPd.cy;
      const ex = extending && dstPulled ? dstPulled.cx : dstPd.cx;
      const ey = extending && dstPulled ? dstPulled.cy : dstPd.cy;
      const grad = state.svg.select("#" + gradId);
      if (!grad.empty()) {
        grad.transition().duration(dur).ease(ease).attr("x1", sx).attr("y1", sy).attr("x2", ex).attr("y2", ey);
      }
    });
  }
  function enterRingHover() {
    if (state.ringHover) return;
    const pulledPos = {};
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const pd = allParamData[dd.paramIdx];
      if (!pd || pd.param.error) return;
      if (pd.param.flow !== "destination" && pd.param.flow !== "bidir") return;
      const pos = pullElement(el, pd);
      if (pos) {
        const key = pd.sku + "|" + pd.path;
        pulledPos[key] = pos;
        addTether(pd, pos, key);
      }
    });
    animateConnectionsToPulled(pulledPos, true);
    state.ringHover = { pulledPos };
  }
  function exitRingHover() {
    if (!state.ringHover || state.ringHover.retracting) return;
    animateConnectionsToPulled(state.ringHover.pulledPos, false);
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const pd = allParamData[dd.paramIdx];
      if (!pd) return;
      const key = pd.sku + "|" + pd.path;
      if (state.ringHover.pulledPos[key]) {
        retractElement(el, pd);
      }
    });
    retractTethers(null);
    state.ringHover = { retracting: true, pulledPos: {} };
    setTimeout(function() {
      state.ringHover = null;
    }, retractDuration);
  }
  state.g.selectAll(".param-shape, .param-hit, .param-label-hit").on("mousedown", function(event) {
    if (event.button !== 0 || event.shiftKey) return;
    const d0 = d3.select(this).datum();
    const pd0 = d0 ? allParamData[d0.paramIdx] : null;
    if (!pd0 || pd0.isCollapsed || pd0.param.error) return;
    event.preventDefault();
    pendingDrag = { sku: pd0.sku, path: pd0.path, x: event.clientX, y: event.clientY };
  });
  function beginDrag(savedSku, savedPath) {
    let d = { paramIdx: -1 };
    let pd = null;
    for (let k = 0; k < allParamData.length; k++) {
      if (allParamData[k].sku === savedSku && allParamData[k].path === savedPath && !allParamData[k].isCollapsed) {
        pd = allParamData[k];
        d = { paramIdx: k };
        break;
      }
    }
    if (!pd) return;
    const reverse = startsReverse(pd);
    document.body.style.cursor = "pointer";
    const autoExpandedKeys = dragExpandsAll() ? expandCollapsedCandidates(pd, reverse) : [];
    if (autoExpandedKeys.length > 0) {
      state.ringHover = null;
      state._animating = false;
      if (state._capturePositions) state._collapseAnim = state._capturePositions();
      state._animKeepSecondary = true;
      if (state._render) state._render();
      allParamData = state.allParamData;
      nodeData = state.nodeData;
      pd = null;
      for (let k = 0; k < allParamData.length; k++) {
        if (allParamData[k].sku === savedSku && allParamData[k].path === savedPath && !allParamData[k].isCollapsed) {
          pd = allParamData[k];
          d = { paramIdx: k };
          break;
        }
      }
      if (!pd) return;
    }
    state.g.selectAll(".param-shape").each(function() {
      const dd = d3.select(this).datum();
      if (!dd) return;
      const tpd = allParamData[dd.paramIdx];
      if (tpd && isValidDropTarget(tpd, pd, reverse)) {
        d3.select(this).classed("drag-target", true);
      }
    });
    const validKeys = {};
    state.g.selectAll(".param-shape.drag-target").each(function() {
      const dd = d3.select(this).datum();
      if (!dd) return;
      const tpd = allParamData[dd.paramIdx];
      if (tpd) validKeys[tpd.sku + "|" + tpd.path] = true;
    });
    const dragPulledPos = {};
    const clickedKey = pd.sku + "|" + pd.path;
    let startCx = pd.cx, startCy = pd.cy;
    if (state.ringHover && !state.ringHover.retracting) {
      if (state.ringHover.pulledPos[clickedKey]) {
        startCx = state.ringHover.pulledPos[clickedKey].cx;
        startCy = state.ringHover.pulledPos[clickedKey].cy;
      }
      const hoverPulled = state.ringHover.pulledPos;
      state.g.selectAll(".param-shape").each(function() {
        const el = d3.select(this);
        const dd = el.datum();
        if (!dd) return;
        const tpd = allParamData[dd.paramIdx];
        if (!tpd) return;
        const key = tpd.sku + "|" + tpd.path;
        if (validKeys[key]) {
          if (hoverPulled[key]) dragPulledPos[key] = hoverPulled[key];
        } else if (key !== clickedKey && hoverPulled[key]) {
          retractElement(el, tpd);
        }
      });
      const keepKeys = {};
      for (const k in validKeys) keepKeys[k] = true;
      keepKeys[clickedKey] = true;
      retractTethers(keepKeys);
      state.ringHover = null;
      state.g.selectAll(".param-shape.drag-target").each(function() {
        const el = d3.select(this);
        const dd = el.datum();
        if (!dd) return;
        const tpd = allParamData[dd.paramIdx];
        if (!tpd) return;
        const key = tpd.sku + "|" + tpd.path;
        if (!dragPulledPos[key]) {
          const pos = pullElement(el, tpd);
          if (pos) {
            dragPulledPos[key] = pos;
            addTether(tpd, pos, key);
          }
        }
      });
    } else {
      state.ringHover = null;
      state.g.selectAll(".param-shape.drag-target").each(function() {
        const el = d3.select(this);
        const dd = el.datum();
        if (!dd) return;
        const tpd = allParamData[dd.paramIdx];
        if (!tpd) return;
        const pos = pullElement(el, tpd);
        if (pos) {
          const key = tpd.sku + "|" + tpd.path;
          dragPulledPos[key] = pos;
          addTether(tpd, pos, key);
        }
      });
    }
    state.dragState = {
      startIdx: d.paramIdx,
      startData: pd,
      startCx,
      startCy,
      autoExpandedKeys,
      tempLine: state.g.append("path").attr("class", "drag-line").attr("d", "M" + startCx + "," + startCy + " Q" + startCx + "," + startCy + " " + startCx + "," + startCy).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").attr("opacity", 0.6),
      highlight: state.g.append("circle").attr("class", "drop-highlight").attr("r", 10).attr("fill", "none").attr("stroke", C_CYAN).attr("stroke-width", 2).attr("opacity", 0),
      pulledPos: dragPulledPos,
      reverse,
      startPulled: startCx !== pd.cx || startCy !== pd.cy
    };
    springCancel();
    markCandidateGroups(pd, reverse);
  }
  state.svg.on("mousedown.rotate", function(event) {
    if (state.dragState || state.editingParamKey || event.shiftKey) return;
    if (event.button !== 0) return;
    const targetCls = event.target.getAttribute("class") || "";
    if (/param-shape|param-hit|group-hit|add-param-btn|sub-hit|param-label|collapsed-dot|collapsed-hit/.test(targetCls)) return;
    const pt = state.svg.node().createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgPt = pt.matrixTransform(state.g.node().getScreenCTM().inverse());
    const dist = Math.sqrt(svgPt.x * svgPt.x + svgPt.y * svgPt.y);
    const threshold = state._mainRadius || MAIN_RADIUS;
    if (dist <= threshold) return;
    if (state.ringHover && !state.ringHover.retracting) {
      exitRingHover();
    }
    event.preventDefault();
    if (inertiaRaf) {
      cancelAnimationFrame(inertiaRaf);
      inertiaRaf = null;
    }
    const viewPt = pt.matrixTransform(state.svg.node().getScreenCTM().inverse());
    const startAngle = Math.atan2(viewPt.y, viewPt.x) * 180 / Math.PI;
    rotateState = {
      startAngle,
      startOffset: state.rotationOffset,
      samples: [],
      lastAngle: state.rotationOffset
    };
    document.body.style.cursor = "grabbing";
  });
  d3.select(window).on("mousemove.dragsub", function(event) {
    if (pendingDrag && !state.dragState) {
      const mdx = event.clientX - pendingDrag.x, mdy = event.clientY - pendingDrag.y;
      if (mdx * mdx + mdy * mdy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      const pdg = pendingDrag;
      pendingDrag = null;
      beginDrag(pdg.sku, pdg.path);
      return;
    }
    const pt = state.svg.node().createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    if (rotateState) {
      const viewPt = pt.matrixTransform(state.svg.node().getScreenCTM().inverse());
      const angle = Math.atan2(viewPt.y, viewPt.x) * 180 / Math.PI;
      let delta = angle - rotateState.startAngle;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      state.rotationOffset = rotateState.startOffset + delta;
      state.g.attr("transform", "rotate(" + state.rotationOffset + ")");
      const now = performance.now();
      rotateState.samples.push({ angle: state.rotationOffset, time: now });
      while (rotateState.samples.length > 1 && now - rotateState.samples[0].time > 80) {
        rotateState.samples.shift();
      }
      return;
    }
    const svgPt = pt.matrixTransform(state.g.node().getScreenCTM().inverse());
    if (!state.dragState) {
      const overSvg = !!(event.target && state.svg.node().contains(event.target));
      const dist = overSvg ? Math.sqrt(svgPt.x * svgPt.x + svgPt.y * svgPt.y) : Infinity;
      const threshold = state._mainRadius || MAIN_RADIUS;
      if (dist < threshold && !state.ringHover) {
        enterRingHover();
      } else if (dist >= threshold && state.ringHover && !state.ringHover.retracting) {
        exitRingHover();
      }
      return;
    }
    if (state.dragState.retracting) return;
    springCheck(event.target);
    const sx = state.dragState.startCx;
    const sy = state.dragState.startCy;
    let ex = svgPt.x, ey = svgPt.y;
    const reverse = !!state.dragState.reverse;
    const under = paramUnderPointer(event.target, allParamData);
    const snap = under && isDragCandidate(under, state.dragState.startData, reverse) ? under : findNearestDropTarget(allParamData, svgPt.x, svgPt.y, state.dragState.startData, SNAP_DIST, state.dragState.pulledPos, reverse);
    if (snap) {
      const snapKey = snap.sku + "|" + snap.path;
      const pulled = state.dragState.pulledPos && state.dragState.pulledPos[snapKey];
      ex = pulled ? pulled.cx : snap.cx;
      ey = pulled ? pulled.cy : snap.cy;
      state.dragState.highlight.attr("cx", ex).attr("cy", ey).attr("opacity", 1);
      if (state.dragState.snapTarget !== snap) {
        state.dragState.highlight.interrupt().attr("r", 17).transition().duration(170).ease(d3.easeBackOut).attr("r", 10);
      }
      state.dragState.snapTarget = snap;
      const finalD = connectionPath(sx, sy, ex, ey);
      if (!state.dragState.wasSnapped) {
        state.dragState.tempLine.attr("stroke", C_CYAN).attr("stroke-dasharray", null);
        state.dragState.tempLine.transition().duration(SNAP_DUR).attr("d", finalD);
        state.dragState.wasSnapped = true;
      } else {
        state.dragState.tempLine.attr("d", finalD);
      }
    } else {
      if (state.dragState.wasSnapped) {
        state.dragState.tempLine.interrupt();
        state.dragState.wasSnapped = false;
      }
      state.dragState.tempLine.attr("stroke", "#fff").attr("stroke-dasharray", "3,3");
      state.dragState.highlight.attr("opacity", 0);
      state.dragState.snapTarget = null;
      state.dragState.tempLine.attr("d", dragPath(sx, sy, ex, ey));
    }
  });
  const onUp = function(event) {
    springCancel();
    if (rotateState) {
      const samples = rotateState.samples;
      let velocity = 0;
      if (samples.length >= 2) {
        const first = samples[0], last = samples[samples.length - 1];
        const dt = last.time - first.time;
        if (dt > 5) {
          let dAngle = last.angle - first.angle;
          while (dAngle > 180) dAngle -= 360;
          while (dAngle < -180) dAngle += 360;
          velocity = dAngle / dt * 1e3;
        }
      }
      rotateState = null;
      document.body.style.cursor = "";
      if (Math.abs(velocity) > 15) {
        const friction = 0.95;
        let lastTime = performance.now();
        (function coast() {
          const now = performance.now();
          const dt = (now - lastTime) / 1e3;
          lastTime = now;
          velocity *= friction;
          state.rotationOffset += velocity * dt;
          state.g.attr("transform", "rotate(" + state.rotationOffset + ")");
          if (Math.abs(velocity) > 1) {
            inertiaRaf = requestAnimationFrame(coast);
          } else {
            inertiaRaf = null;
          }
        })();
      }
      return;
    }
    if (!state.dragState || state.dragState.retracting) return;
    let snap = state.dragState.snapTarget || null;
    const tempLine = state.dragState.tempLine;
    const cancelled = !!event.dfCancel;
    if (cancelled) snap = null;
    let openGroupKey = null;
    let openGroupCount = 0;
    if (!snap && !cancelled && event.target && event.target.closest) {
      const gEl = event.target.closest(".drag-candidate-group");
      const gd = gEl ? d3.select(gEl).datum() : null;
      if (gd && gd.groupKey) {
        const start = state.dragState.startData;
        const rev = !!state.dragState.reverse;
        const inGroup = state.allParamData.filter(function(pd) {
          return pd.isCollapsed && pd.sku + "|" + pd.collapsedGroupPath === gd.groupKey && !(pd.sku === start.sku && pd.path === start.path) && flowOk(pd, rev) && pd.param.type === start.param.type && !pd.param.error && !alreadyLinked(pd, start, rev);
        });
        if (inGroup.length === 1) snap = inGroup[0];
        else if (inGroup.length > 1) {
          openGroupKey = gd.groupKey;
          openGroupCount = inGroup.length;
        }
      }
    }
    const startPd = state.dragState.startData;
    const reverseDrag = !!state.dragState.reverse;
    state.dragState.highlight.remove();
    state.g.selectAll(".param-shape.drag-target").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const tpd = allParamData[dd.paramIdx];
      if (!tpd) return;
      retractElement(el, tpd);
    });
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const tpd = allParamData[dd.paramIdx];
      if (!tpd) return;
      const key = tpd.sku + "|" + tpd.path;
      const clickedKey = startPd.sku + "|" + startPd.path;
      if (key === clickedKey && !el.classed("drag-target")) {
        retractElement(el, tpd);
      }
    });
    retractTethers(null);
    const linkedEnds = snap ? [snap, startPd] : [];
    const autoExpandedKeys = (state.dragState.autoExpandedKeys || []).filter(function(k) {
      const bar = k.indexOf("|");
      const sku = k.slice(0, bar), gp = k.slice(bar + 1);
      return !linkedEnds.some(function(e) {
        return e.sku === sku && e.path.indexOf(gp + "/") === 0;
      });
    });
    state.g.selectAll(".drag-candidate-group").classed("drag-candidate-group", false);
    state.dragState = { retracting: true };
    setTimeout(function() {
      state.g.selectAll(".param-shape").classed("drag-target", false);
      state.dragState = null;
      document.body.style.cursor = "";
      if (autoExpandedKeys.length > 0 || openGroupKey) {
        state._animating = false;
        if (state._capturePositions) state._collapseAnim = state._capturePositions();
        for (let i = 0; i < autoExpandedKeys.length; i++) {
          state.collapsedGroups[autoExpandedKeys[i]] = true;
        }
        if (openGroupKey) delete state.collapsedGroups[openGroupKey];
        if (state._render) state._render();
      }
    }, retractDuration);
    if (openGroupKey) showToast(event, openGroupCount + " matches here \u2014 drag again to pick one");
    if (snap) {
      const destPd = reverseDrag ? snap : startPd;
      const srcPd = reverseDrag ? startPd : snap;
      const destType = destPd.param.type;
      const srcType = srcPd.param.type;
      if (destType !== srcType) {
        showToast(event, "Type mismatch: " + srcType + " \u2192 " + destType);
        tempLine.remove();
        return;
      }
      const existing = destPd.param.subs || [];
      if (existing.some(function(s) {
        return s.sku === srcPd.sku && s.path === srcPd.path;
      })) {
        showToast(event, "Already subscribed");
        tempLine.remove();
        return;
      }
      subscribeLink({
        dest_sku: destPd.sku,
        dest_path: destPd.path,
        source_sku: srcPd.sku,
        source_path: srcPd.path
      }, { clientX: event.clientX, clientY: event.clientY });
      const finalD = connectionPath(startPd.cx, startPd.cy, snap.cx, snap.cy);
      tempLine.attr("stroke-dasharray", null).attr("opacity", 0.5).transition().duration(DROP_FADE_DUR).attr("d", finalD).attr("opacity", 0).remove();
    } else {
      const sx0 = startPd.cx, sy0 = startPd.cy;
      tempLine.interrupt().transition().duration(180).ease(d3.easeCubicIn).attr("d", "M" + sx0 + "," + sy0 + " Q" + sx0 + "," + sy0 + " " + sx0 + "," + sy0).attr("opacity", 0).remove();
    }
  };
  cancelCurrentDrag = function() {
    const ev = new MouseEvent("mouseup", { clientX: state.lastMouseClient.x, clientY: state.lastMouseClient.y });
    ev.dfCancel = true;
    onUp(ev);
  };
  d3.select(window).on("mouseup.dragsub", onUp);
  d3.select(window).on("blur.dragsub", function() {
    pendingDrag = null;
    if (state.dragState && !state.dragState.retracting) {
      if (cancelCurrentDrag) cancelCurrentDrag();
    } else if (rotateState) {
      onUp(new MouseEvent("mouseup"));
    }
  });
  if (state.ringHover && state.ringHover.pulledPos && !state.ringHover.retracting) {
    const pulledPos = {};
    for (const key in state.ringHover.pulledPos) {
      const idx = paramLookup[key];
      if (idx === void 0 || allParamData[idx].isCollapsed) continue;
      const pp = pulledPoint(allParamData[idx]);
      if (pp) pulledPos[key] = pp;
    }
    state.ringHover.pulledPos = pulledPos;
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const pd = allParamData[dd.paramIdx];
      if (!pd) return;
      const key = pd.sku + "|" + pd.path;
      const pos = pulledPos[key];
      if (!pos) return;
      const tag = el.node().tagName.toLowerCase();
      const deg = pd.angle * 180 / Math.PI;
      if (tag === "circle") {
        el.attr("cx", pos.cx).attr("cy", pos.cy);
      } else {
        el.attr("transform", "translate(" + pos.cx + "," + pos.cy + ") rotate(" + deg + ")");
      }
    });
    state.g.selectAll(".sub-line").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const sx = srcPulled ? srcPulled.cx : allParamData[srcIdx].cx;
      const sy = srcPulled ? srcPulled.cy : allParamData[srcIdx].cy;
      const ex = dstPulled ? dstPulled.cx : allParamData[dstIdx].cx;
      const ey = dstPulled ? dstPulled.cy : allParamData[dstIdx].cy;
      const isRail2 = el.classed("conn-rail-2");
      el.attr("d", strategyPathForDatum(d, sx, sy, ex, ey, isRail2));
    });
    state.g.selectAll(".sub-hit").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const sx = srcPulled ? srcPulled.cx : allParamData[srcIdx].cx;
      const sy = srcPulled ? srcPulled.cy : allParamData[srcIdx].cy;
      const ex = dstPulled ? dstPulled.cx : allParamData[dstIdx].cx;
      const ey = dstPulled ? dstPulled.cy : allParamData[dstIdx].cy;
      el.attr("d", connectionPath(sx, sy, ex, ey));
    });
    for (const key in pulledPos) {
      const pos = pulledPos[key];
      const idx = paramLookup[key];
      if (idx === void 0) continue;
      const pd = allParamData[idx];
      addTether(pd, pos, key, false);
    }
  }
  if (state.dragState && !state.dragState.retracting && state.dragState.startData) {
    const ds = state.dragState;
    const startKey = ds.startData.sku + "|" + ds.startData.path;
    const sIdx = paramLookup[startKey];
    if (sIdx === void 0 || allParamData[sIdx].isCollapsed) {
      window.setTimeout(function() {
        if (cancelCurrentDrag) cancelCurrentDrag();
      }, 0);
    } else {
      ds.startData = allParamData[sIdx];
      ds.startIdx = sIdx;
      const sp = ds.startPulled ? pulledPoint(ds.startData) : null;
      ds.startCx = sp ? sp.cx : ds.startData.cx;
      ds.startCy = sp ? sp.cy : ds.startData.cy;
    }
    const pulledPos = {};
    ds.pulledPos = pulledPos;
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const pd = allParamData[dd.paramIdx];
      if (!pd) return;
      const key = pd.sku + "|" + pd.path;
      if (isValidDropTarget(pd, ds.startData, !!ds.reverse)) {
        el.classed("drag-target", true);
        const pp = pulledPoint(pd);
        if (pp) {
          pulledPos[key] = pp;
          placeShape(el, pd, pp);
        }
      } else if (key === startKey) {
        placeShape(el, pd, { cx: ds.startCx, cy: ds.startCy });
      }
    });
    markCandidateGroups(ds.startData, !!ds.reverse);
    drawSpringRing();
    state.g.selectAll(".sub-line").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const sx2 = srcPulled ? srcPulled.cx : allParamData[srcIdx].cx;
      const sy2 = srcPulled ? srcPulled.cy : allParamData[srcIdx].cy;
      const ex2 = dstPulled ? dstPulled.cx : allParamData[dstIdx].cx;
      const ey2 = dstPulled ? dstPulled.cy : allParamData[dstIdx].cy;
      const isRail2 = el.classed("conn-rail-2");
      el.attr("d", strategyPathForDatum(d, sx2, sy2, ex2, ey2, isRail2));
    });
    state.g.selectAll(".sub-hit").each(function() {
      const el = d3.select(this);
      const d = el.datum();
      if (!d) return;
      const srcKey = d.source_sku + "|" + d.source_path;
      const dstKey = d.dest_sku + "|" + d.dest_path;
      const srcPulled = pulledPos[srcKey];
      const dstPulled = pulledPos[dstKey];
      if (!srcPulled && !dstPulled) return;
      const srcIdx = paramLookup[srcKey];
      const dstIdx = paramLookup[dstKey];
      if (srcIdx === void 0 || dstIdx === void 0) return;
      const sx2 = srcPulled ? srcPulled.cx : allParamData[srcIdx].cx;
      const sy2 = srcPulled ? srcPulled.cy : allParamData[srcIdx].cy;
      const ex2 = dstPulled ? dstPulled.cx : allParamData[dstIdx].cx;
      const ey2 = dstPulled ? dstPulled.cy : allParamData[dstIdx].cy;
      el.attr("d", connectionPath(sx2, sy2, ex2, ey2));
    });
    for (const key in pulledPos) {
      const pos = pulledPos[key];
      const idx = paramLookup[key];
      if (idx === void 0) continue;
      addTether(allParamData[idx], pos, key, false);
    }
    const sx = ds.startCx;
    const sy = ds.startCy;
    ds.tempLine = state.g.append("path").attr("class", "drag-line").attr("fill", "none").attr("stroke", ds.wasSnapped ? C_CYAN : "#fff").attr("stroke-width", 1).attr("stroke-dasharray", ds.wasSnapped ? null : "3,3").attr("opacity", 0.6);
    const pt = state.svg.node().createSVGPoint();
    pt.x = state.lastMouseClient.x;
    pt.y = state.lastMouseClient.y;
    const svgPt = pt.matrixTransform(state.g.node().getScreenCTM().inverse());
    let ex = svgPt.x, ey = svgPt.y;
    const underEl = document.elementFromPoint(state.lastMouseClient.x, state.lastMouseClient.y);
    const under = paramUnderPointer(underEl, allParamData);
    const snap = under && isDragCandidate(under, ds.startData, !!ds.reverse) ? under : findNearestDropTarget(allParamData, svgPt.x, svgPt.y, ds.startData, SNAP_DIST, pulledPos, !!ds.reverse);
    if (snap) {
      const snapKey = snap.sku + "|" + snap.path;
      const pulled = pulledPos[snapKey];
      ex = pulled ? pulled.cx : snap.cx;
      ey = pulled ? pulled.cy : snap.cy;
    }
    ds.tempLine.attr("d", snap ? connectionPath(sx, sy, ex, ey) : dragPath(sx, sy, ex, ey));
    ds.highlight = state.g.append("circle").attr("class", "drop-highlight").attr("r", 10).attr("fill", "none").attr("stroke", C_CYAN).attr("stroke-width", 2).attr("opacity", snap ? 1 : 0).attr("cx", ex).attr("cy", ey);
    ds.snapTarget = snap;
  }
}
function showToast(event, message) {
  const toast = document.createElement("div");
  toast.className = "connection-toast";
  toast.textContent = message;
  toast.style.left = event.clientX + "px";
  toast.style.top = event.clientY - 30 + "px";
  document.body.appendChild(toast);
  setTimeout(function() {
    toast.classList.add("fading");
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 500);
  }, 2e3);
}

// ../../../../Projects/124_dataflou/web/src/hover.ts
var editingLock = false;
var hoveredParamIdx = -1;
var editorAbort = null;
var tooltipDragState = null;
function setupHover(allParamData, nodeData) {
  state.g.selectAll(".param-hit, .param-label-hit").on("mouseover", function(event) {
    if (editingLock) return;
    const d = d3.select(this).datum();
    if (!d) return;
    const pd = allParamData[d.paramIdx];
    const p = pd.param;
    const ni = pd.nodeIdx;
    const nd = nodeData[ni];
    if (state.dragState) {
      if (!state.dragState.startData) return;
      if (!isDragCandidate(pd, state.dragState.startData, !!state.dragState.reverse)) return;
    }
    clearAllHighlights();
    hoveredParamIdx = d.paramIdx;
    state.hoveredParamIdx = d.paramIdx;
    state.hoverGroupPath = null;
    highlightParam(d.paramIdx);
    for (let k = 0; k < pd.ancestors.length; k++) {
      highlightGroupHeader(makeGrpCls(ni, pd.ancestors[k]));
    }
    const isLocal = nd.node.is_local;
    const html = buildBrowseHtml(pd, nd, isLocal);
    state.tooltip.html(html).style("display", "block");
    const svgRect = state.svg.node().getBoundingClientRect();
    const mx = event.clientX - svgRect.left + 16;
    const my = event.clientY - svgRect.top - 10;
    state.tooltip.style("left", mx + "px").style("top", my + "px");
    clampTooltip();
  }).on("mouseout", function() {
    if (editingLock) return;
    hoveredParamIdx = -1;
    state.hoveredParamIdx = -1;
    state.hoverGroupPath = null;
    clearAllHighlights();
    state.tooltip.style("display", "none");
  });
}
function setupGroupHover() {
  state.g.selectAll(".group-hit").on("mousedown.collapse", function(event) {
    event.preventDefault();
    event.stopPropagation();
    const d = d3.select(this).datum();
    if (!d || !d.groupPath) return;
    const sku = state.nodeData[d.nodeIdx].node.sku;
    const key = sku + "|" + d.groupPath;
    state._animating = false;
    if (state._capturePositions) state._collapseAnim = state._capturePositions();
    if (state.collapsedGroups[key]) {
      delete state.collapsedGroups[key];
    } else {
      state.collapsedGroups[key] = true;
    }
    state.tempExpandedGroup = null;
    state.ringHover = null;
    if (state._render) state._render();
  }).on("mouseover", function() {
    if (editingLock) return;
    const d = d3.select(this).datum();
    if (!d) return;
    clearAllHighlights();
    hoveredParamIdx = -1;
    state.hoveredParamIdx = -1;
    state.tooltip.style("display", "none");
    const fullPath = d.ancestors.concat([d.grpName]);
    const nodeIdx = d.nodeIdx;
    state.hoverGroupPath = { path: fullPath, nodeIdx };
    highlightGroupHeader(d.grpCls);
    for (let k = 0; k < d.ancestors.length; k++) {
      highlightGroupHeader(makeGrpCls(nodeIdx, d.ancestors[k]));
    }
    for (let k = 0; k < state.allParamData.length; k++) {
      const pd = state.allParamData[k];
      if (pd.nodeIdx !== nodeIdx) continue;
      if (pathStartsWith(pd.ancestors, fullPath)) {
        highlightParam(k);
      }
    }
    state.g.selectAll(".group-hit").each(function() {
      const gd = d3.select(this).datum();
      if (!gd || gd.nodeIdx !== nodeIdx) return;
      const gPath = gd.ancestors.concat([gd.grpName]);
      if (gPath.length > fullPath.length && pathStartsWith(gPath, fullPath)) {
        highlightGroupHeader(gd.grpCls);
        d3.select(this).style("opacity", 0.1);
      }
    });
  }).on("mouseout", function() {
    if (editingLock) return;
    state.hoverGroupPath = null;
    clearAllHighlights();
  });
}
function pathStartsWith(arr, prefix) {
  if (prefix.length > arr.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (arr[i] !== prefix[i]) return false;
  }
  return true;
}
function highlightGroupHeader(grpCls) {
  state.g.selectAll(".group-arc." + grpCls).style("opacity", "0.9").style("stroke-width", "2px");
  const lblCls = "grp-lbl-" + grpCls.substring(4);
  state.g.selectAll("." + lblCls).style("fill", "#fff");
}
function highlightParam(paramIdx) {
  state.g.selectAll(".param-shape").each(function() {
    const d = d3.select(this).datum();
    if (d && d.paramIdx === paramIdx) {
      d3.select(this).style("stroke", C_RED).style("stroke-width", "1.5px").style("filter", "drop-shadow(0 0 3px rgba(200, 50, 50, 0.5))");
    }
  });
  state.g.selectAll(".param-hit").each(function() {
    const d = d3.select(this).datum();
    if (d && d.paramIdx === paramIdx) {
      d3.select(this).style("opacity", 0.15);
    }
  });
}
function clearAllHighlights() {
  state.g.selectAll(".group-arc").style("opacity", null).style("stroke-width", null);
  state.g.selectAll(".group-label").style("fill", null);
  state.g.selectAll(".group-hit").style("opacity", null);
  state.g.selectAll(".param-shape").style("stroke", null).style("stroke-width", null).style("filter", null);
  state.g.selectAll(".param-hit").style("opacity", null);
}
function reapplyHoverHighlights() {
  if (state.hoveredParamIdx >= 0 && !editingLock) {
    const lpd = state.allParamData[state.hoveredParamIdx];
    if (lpd) {
      const lnd = state.nodeData[lpd.nodeIdx];
      const html = buildBrowseHtml(lpd, lnd, lnd.node.is_local);
      state.tooltip.html(html);
    }
  }
  if (state.hoveredParamIdx >= 0) {
    const pd = state.allParamData[state.hoveredParamIdx];
    if (pd) {
      highlightParam(state.hoveredParamIdx);
      for (let k = 0; k < pd.ancestors.length; k++) {
        highlightGroupHeader(makeGrpCls(pd.nodeIdx, pd.ancestors[k]));
      }
    }
  }
  if (state.hoverGroupPath) {
    const hp = state.hoverGroupPath;
    for (let k = 0; k <= hp.path.length; k++) {
      if (k > 0) highlightGroupHeader(makeGrpCls(hp.nodeIdx, hp.path[k - 1]));
    }
    for (let k = 0; k < state.allParamData.length; k++) {
      const pd = state.allParamData[k];
      if (pd.nodeIdx !== hp.nodeIdx) continue;
      if (pathStartsWith(pd.ancestors, hp.path)) highlightParam(k);
    }
    state.g.selectAll(".group-hit").each(function() {
      const gd = d3.select(this).datum();
      if (!gd || gd.nodeIdx !== hp.nodeIdx) return;
      const gPath = gd.ancestors.concat([gd.grpName]);
      if (pathStartsWith(gPath, hp.path)) {
        highlightGroupHeader(gd.grpCls);
        if (gPath.length > hp.path.length) {
          d3.select(this).style("opacity", 0.1);
        }
      }
    });
  }
}
function buildBrowseHtml(pd, nd, isLocal) {
  const p = pd.param;
  let html = '<div class="tt-name">' + esc(p.label || p.name);
  html += "</div>";
  const pathParts = pd.ancestors.filter(function(a) {
    return a !== "root";
  });
  pathParts.push(p.name || p.label || "");
  const fullPath = pathParts.filter(Boolean).join("/");
  if (fullPath) html += '<div class="tt-path">' + esc(fullPath) + "</div>";
  html += "<table>";
  if (p.type) html += "<tr><td>type</td><td>" + esc(p.type) + "</td></tr>";
  if (p.value !== void 0 && p.value !== null) {
    let val;
    if (p.type === "colour" && typeof p.value === "string") {
      const rgb = p.value.substring(0, 7);
      val = p.value;
      html += '<tr><td>value</td><td><span style="display:inline-block;width:14px;height:14px;border-radius:2px;vertical-align:middle;margin-right:4px;background:' + rgb + ';border:1px solid #666"></span>' + esc(val) + "</td></tr>";
    } else if (Array.isArray(p.value)) {
      val = p.value.map(function(v) {
        return Number(v).toFixed(4);
      }).join(", ");
      html += "<tr><td>value</td><td>" + esc(val) + (p.unit ? " " + esc(p.unit) : "") + "</td></tr>";
    } else if (typeof p.value === "number") {
      val = Number(p.value).toFixed(4);
      html += "<tr><td>value</td><td>" + esc(val) + (p.unit ? " " + esc(p.unit) : "") + "</td></tr>";
    } else {
      val = String(p.value);
      html += "<tr><td>value</td><td>" + esc(val) + (p.unit ? " " + esc(p.unit) : "") + "</td></tr>";
    }
  }
  if (p.range) {
    const parts = [];
    if (p.range.min !== void 0) parts.push(formatRange(p.range.min));
    if (p.range.max !== void 0) parts.push(formatRange(p.range.max));
    if (parts.length > 0) html += "<tr><td>range</td><td>" + parts.join(" .. ") + "</td></tr>";
  }
  if (p.hardware) html += "<tr><td>hardware</td><td>yes</td></tr>";
  if (nd.node.state) html += "<tr><td>state</td><td>" + esc(nd.node.state) + "</td></tr>";
  html += "</table>";
  html += '<div class="tt-hint">Enter to edit' + (isLocal ? "" : " (remote)") + "</div>";
  return html;
}
function formatRange(v) {
  if (Array.isArray(v)) return "[" + v.map(function(x) {
    return Number(x).toFixed(1);
  }).join(", ") + "]";
  return String(v);
}
function enterEditor() {
  if (hoveredParamIdx < 0) return;
  const pd = state.allParamData[hoveredParamIdx];
  if (!pd) return;
  const nd = state.nodeData[pd.nodeIdx];
  if (!nd) return;
  const isLocal = nd.node.is_local;
  editingLock = true;
  state.editingParamKey = pd.sku + "|" + pd.path;
  state.tooltip.classed("editing", true);
  const p = pd.param;
  let html = '<div class="tt-name">' + esc(p.label || p.name);
  if (!isLocal) html += '<span style="font-size:9px;color:#888;margin-left:6px">(remote)</span>';
  html += '<button class="tt-save-btn">Save</button></div>';
  html += '<div class="tt-path">' + esc(pd.path) + "</div>";
  html += '<div class="tt-editor">';
  html += valueEditorHtml(p);
  html += metaFieldHtml("label", "text", p.label || "");
  html += metaFieldHtml("name", "text", p.name || "");
  html += metaSelectHtml("mode", p.mode || "streaming", ["streaming", "discrete", "polling"]);
  html += metaSelectHtml("flow", p.flow || "source", ["source", "destination", "bidir"]);
  html += metaSelectHtml("access", p.access || "read", ["read", "write", "readwrite"]);
  html += metaFieldHtml("unit", "text", p.unit || "");
  html += metaFieldHtml("rate", "number", p.rate !== void 0 ? p.rate : "");
  html += '<div class="tt-meta-row"><span class="tt-meta-label">ground</span><input type="checkbox" class="tt-meta-input" data-field="ground"' + (p.ground ? " checked" : "") + "></div>";
  html += '<div class="tt-meta-row"><span class="tt-meta-label">hardware</span><input type="checkbox" class="tt-meta-input" data-field="hardware"' + (p.hardware ? " checked" : "") + "></div>";
  html += "</div>";
  html += '<div class="tt-actions">';
  html += '<button class="tt-delete-btn">Delete</button>';
  html += "</div>";
  state.tooltip.html(html);
  clampTooltip();
  wireEditorEvents(pd);
}
function valueEditorHtml(p) {
  let html = "";
  if (p.type === "bool") {
    html += '<div class="tt-val-row"><span class="tt-meta-label">value</span><input type="checkbox" class="tt-val-input" data-comp="-1"' + (p.value ? " checked" : "") + "></div>";
  } else if (p.type === "number") {
    const min = p.range && p.range.min !== void 0 ? p.range.min : 0;
    const max = p.range && p.range.max !== void 0 ? p.range.max : 1;
    const val = p.value !== void 0 && p.value !== null ? p.value : min;
    const step = (max - min) / 500;
    html += '<div class="tt-val-row"><span class="tt-meta-label">value</span><input type="range" class="tt-val-slider" data-comp="-1" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="tt-val-num">' + Number(val).toFixed(2) + "</span>";
    if (p.unit) html += '<span class="tt-val-unit">' + esc(p.unit) + "</span>";
    html += "</div>";
  } else if (p.type === "string") {
    html += '<div class="tt-val-row"><span class="tt-meta-label">value</span><input type="text" class="tt-val-input tt-val-text" data-comp="-1" value="' + escAttr(String(p.value !== void 0 ? p.value : "")) + '"></div>';
  } else if (p.type === "v2" || p.type === "v3" || p.type === "v4") {
    const dim = parseInt(p.type.charAt(1), 10);
    const labels = ["x", "y", "z", "w"];
    const vals = Array.isArray(p.value) ? p.value : new Array(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      let cMin = 0, cMax = 1;
      if (p.range) {
        if (Array.isArray(p.range.min) && p.range.min[i] !== void 0) cMin = p.range.min[i];
        if (Array.isArray(p.range.max) && p.range.max[i] !== void 0) cMax = p.range.max[i];
      }
      const cVal = vals[i] !== void 0 ? vals[i] : cMin;
      const cStep = (cMax - cMin) / 500;
      html += '<div class="tt-val-row"><span class="tt-meta-label">' + labels[i] + '</span><input type="range" class="tt-val-slider" data-comp="' + i + '" min="' + cMin + '" max="' + cMax + '" step="' + cStep + '" value="' + cVal + '"><span class="tt-val-num">' + Number(cVal).toFixed(2) + "</span></div>";
    }
  } else if (p.type === "colour") {
    const hex = typeof p.value === "string" ? p.value : "#000000FF";
    const rgb = hex.substring(0, 7);
    const alpha = hex.length >= 9 ? parseInt(hex.substring(7, 9), 16) : 255;
    html += '<div class="tt-val-row"><span class="tt-meta-label">colour</span><input type="color" class="tt-val-colour" data-comp="-1" value="' + rgb + '"></div>';
    html += '<div class="tt-val-row"><span class="tt-meta-label">alpha</span><input type="range" class="tt-val-alpha" data-comp="3" min="0" max="255" step="1" value="' + alpha + '"><span class="tt-val-num">' + alpha + "</span></div>";
  }
  return html;
}
function metaFieldHtml(field, type, value) {
  return '<div class="tt-meta-row"><span class="tt-meta-label">' + field + '</span><input type="' + type + '" class="tt-meta-input" data-field="' + field + '" value="' + escAttr(String(value)) + '"' + (type === "number" ? ' step="any"' : "") + "></div>";
}
function metaSelectHtml(field, current, options) {
  let html = '<div class="tt-meta-row"><span class="tt-meta-label">' + field + '</span><select class="tt-meta-input" data-field="' + field + '">';
  for (let i = 0; i < options.length; i++) {
    html += '<option value="' + options[i] + '"' + (options[i] === current ? " selected" : "") + ">" + options[i] + "</option>";
  }
  html += "</select></div>";
  return html;
}
function wireEditorEvents(pd) {
  if (editorAbort) editorAbort.abort();
  editorAbort = new AbortController();
  const sig = { signal: editorAbort.signal };
  const tooltipEl = state.tooltip.node();
  const p = pd.param;
  let vecVals = null;
  if (p.type === "v2" || p.type === "v3" || p.type === "v4") {
    const dim = parseInt(p.type.charAt(1), 10);
    vecVals = Array.isArray(p.value) ? p.value.slice() : new Array(dim).fill(0);
  }
  tooltipEl.addEventListener("input", function(e) {
    const slider = e.target.closest(".tt-val-slider");
    if (slider) {
      const numSpan = slider.parentNode.querySelector(".tt-val-num");
      if (numSpan) numSpan.textContent = Number(slider.value).toFixed(2);
      const comp = parseInt(slider.dataset.comp, 10);
      sendValue2(pd, p, comp, parseFloat(slider.value), vecVals);
      return;
    }
    const input2 = e.target.closest(".tt-val-input");
    if (input2) {
      const comp = parseInt(input2.dataset.comp, 10);
      if (p.type === "bool") {
        sendValue2(pd, p, comp, input2.checked, vecVals);
      } else if (p.type === "string") {
        sendValue2(pd, p, comp, input2.value, vecVals);
      }
    }
    const colourPick = e.target.closest(".tt-val-colour");
    const alphaPick = e.target.closest(".tt-val-alpha");
    if (colourPick || alphaPick) {
      const cp = tooltipEl.querySelector(".tt-val-colour");
      const ap = tooltipEl.querySelector(".tt-val-alpha");
      const hex6 = cp ? cp.value : "#000000";
      const a = ap ? parseInt(ap.value, 10) : 255;
      if (ap) {
        const numSpan = ap.parentNode.querySelector(".tt-val-num");
        if (numSpan) numSpan.textContent = String(a);
      }
      const r = parseInt(hex6.substring(1, 3), 16);
      const g = parseInt(hex6.substring(3, 5), 16);
      const b = parseInt(hex6.substring(5, 7), 16);
      sendColourValue(pd, [r, g, b, a]);
    }
  }, sig);
  tooltipEl.addEventListener("change", function(e) {
    const meta = e.target.closest(".tt-meta-input");
    if (!meta) return;
    const field = meta.dataset.field;
    if (!field) return;
    const fields = {};
    if (meta.type === "checkbox") {
      fields[field] = meta.checked;
    } else if (meta.type === "number") {
      fields[field] = parseFloat(meta.value);
    } else {
      fields[field] = meta.value;
    }
    if (wsReady()) {
      state.ws.send(JSON.stringify({
        type: MSG_UPDATE_PARAM,
        sku: pd.sku,
        path: pd.path,
        fields
      }));
    }
    if (field === "name") {
      closeEditor();
    }
  }, sig);
  tooltipEl.addEventListener("click", function(e) {
    if (e.target.closest(".tt-save-btn")) closeEditor();
    if (e.target.closest(".tt-delete-btn")) {
      const name = pd.param.label || pd.param.name;
      if (confirm('Delete "' + name + '"?')) {
        if (wsReady()) {
          state.ws.send(JSON.stringify({
            type: MSG_DELETE_PARAM,
            sku: pd.sku,
            path: pd.path
          }));
        }
        closeEditor();
      }
    }
  }, sig);
}
function sendValue2(pd, p, comp, val, vecVals) {
  let sendVal;
  if (comp >= 0 && vecVals) {
    vecVals[comp] = val;
    sendVal = vecVals.slice();
  } else {
    sendVal = val;
  }
  setParamValue(pd.sku, pd.path, sendVal);
}
function sendColourValue(pd, rgba) {
  setParamValue(pd.sku, pd.path, rgba);
}
function setupAddParam() {
  state.g.selectAll(".add-param-btn").on("mousedown", function(event) {
    event.preventDefault();
    event.stopPropagation();
    const d = d3.select(this).datum();
    if (!d) return;
    showAddParamForm(d, event);
  });
}
function showAddParamForm(d, event) {
  editingLock = true;
  state.tooltip.classed("editing", true);
  let html = '<div class="tt-name">New Parameter';
  html += '<button class="tt-create-btn">Create</button></div>';
  html += '<div class="tt-editor">';
  html += metaFieldHtml("name", "text", "");
  html += metaFieldHtml("label", "text", "");
  html += metaSelectHtml("type", "number", ["number", "bool", "string", "v2", "v3", "v4", "colour"]);
  html += metaSelectHtml("mode", "discrete", ["streaming", "discrete", "polling"]);
  html += metaSelectHtml("flow", "destination", ["source", "destination", "bidir"]);
  html += metaSelectHtml("access", "readwrite", ["read", "write", "readwrite"]);
  html += metaFieldHtml("unit", "text", "");
  html += metaFieldHtml("rate", "number", "");
  html += metaFieldHtml("parent", "text", "");
  html += "</div>";
  html += '<div class="tt-actions">';
  html += '<button class="tt-cancel-btn">Cancel</button>';
  html += "</div>";
  state.tooltip.html(html).style("display", "block");
  const svgRect = state.svg.node().getBoundingClientRect();
  const mx = event.clientX - svgRect.left + 16;
  const my = event.clientY - svgRect.top - 10;
  state.tooltip.style("left", mx + "px").style("top", my + "px");
  clampTooltip();
  const tooltipEl = state.tooltip.node();
  function handler(e) {
    if (e.target.closest(".tt-cancel-btn")) {
      tooltipEl.removeEventListener("click", handler);
      closeEditor();
      return;
    }
    if (e.target.closest(".tt-create-btn")) {
      const nameInput = tooltipEl.querySelector('[data-field="name"]');
      const name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        nameInput?.focus();
        return;
      }
      const get = function(f) {
        const el = tooltipEl.querySelector('[data-field="' + f + '"]');
        return el ? el.value.trim() : "";
      };
      const param = {
        name,
        kind: "param",
        label: get("label") || name,
        type: get("type") || "number",
        mode: get("mode") || "discrete",
        flow: get("flow") || "destination",
        access: get("access") || "readwrite"
      };
      const unit = get("unit");
      if (unit) param.unit = unit;
      const rate = get("rate");
      if (rate) param.rate = parseFloat(rate);
      if (param.type === "number") {
        param.range = { min: 0, max: 1, init: 0 };
      }
      const parentPath = get("parent");
      if (wsReady()) {
        state.ws.send(JSON.stringify({
          type: MSG_ADD_PARAM,
          sku: d.nodeSku,
          parent_path: parentPath,
          param
        }));
      }
      tooltipEl.removeEventListener("click", handler);
      closeEditor();
    }
  }
  tooltipEl.addEventListener("click", handler);
}
function closeEditor() {
  if (!editingLock) return;
  if (editorAbort) {
    editorAbort.abort();
    editorAbort = null;
  }
  tooltipDragState = null;
  editingLock = false;
  hoveredParamIdx = -1;
  state.editingParamKey = null;
  state.tooltip.classed("editing", false);
  state.tooltip.style("display", "none");
  resetHighlights();
}
function checkEditingParam() {
  if (!state.editingParamKey) return;
  let found = false;
  for (let i = 0; i < state.allParamData.length; i++) {
    const pd = state.allParamData[i];
    if (pd.sku + "|" + pd.path === state.editingParamKey) {
      found = true;
      break;
    }
  }
  if (!found) closeEditor();
}
function resetHighlights() {
  state.g.selectAll(".group-arc").attr("stroke-width", 1);
  state.g.selectAll(".group-arc").each(function() {
    d3.select(this).attr("opacity", null);
  });
  state.g.selectAll(".group-wedge").attr("opacity", 0);
  state.g.selectAll(".group-label").attr("fill", null);
  state.g.selectAll(".param-shape").style("stroke", null).style("stroke-width", null).style("filter", null);
}
function initTooltipEditor() {
  setupDrag();
  document.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !editingLock && hoveredParamIdx >= 0) {
      e.preventDefault();
      enterEditor();
    }
    if (e.key === "Escape" && editingLock) {
      closeEditor();
    }
  });
  document.addEventListener("mousedown", function(e) {
    if (!editingLock) return;
    if (tooltipDragState) return;
    const tooltipNode = state.tooltip.node();
    if (tooltipNode && !tooltipNode.contains(e.target)) {
      closeEditor();
    }
  });
}
function clampTooltip() {
  const el = state.tooltip.node();
  if (!el || el.style.display === "none") return;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = parseFloat(el.style.left) || 0;
  let top = parseFloat(el.style.top) || 0;
  if (rect.right > vw - 4) left -= rect.right - vw + 4;
  if (rect.bottom > vh - 4) top -= rect.bottom - vh + 4;
  if (left < 4) left = 4;
  if (top < 4) top = 4;
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function setupDrag() {
  const el = state.tooltip.node();
  el.addEventListener("mousedown", function(e) {
    if (!editingLock) return;
    const tag = e.target.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "button" || tag === "textarea") return;
    if (e.target.closest("button")) return;
    e.preventDefault();
    tooltipDragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: parseFloat(el.style.left) || 0,
      origTop: parseFloat(el.style.top) || 0
    };
  });
  document.addEventListener("mousemove", function(e) {
    if (!tooltipDragState) return;
    const dx = e.clientX - tooltipDragState.startX;
    const dy = e.clientY - tooltipDragState.startY;
    el.style.left = tooltipDragState.origLeft + dx + "px";
    el.style.top = tooltipDragState.origTop + dy + "px";
  });
  document.addEventListener("mouseup", function() {
    tooltipDragState = null;
  });
}

// scripts/dataflou-visualizer-atelier-stub.ts
function initEditor(..._a) {
}
function openForNode(..._a) {
}
function handleAtelierMessage(..._a) {
}
function onConnected() {
}
function onDisconnected() {
}
function updateToggleVisibility() {
}

// ../../../../Projects/124_dataflou/web/src/dashboard.ts
var panels = {};
var dragTarget = null;
var dragState = null;
var activeInputKey = null;
var vecScratch = {};
var nextOffset = 0;
var visEl = null;
function isDashboardOpen(sku) {
  if (sku !== void 0) return !!state.dashboardSkus[sku];
  for (const k in state.dashboardSkus) {
    if (state.dashboardSkus[k]) return true;
  }
  return false;
}
function initDashboard() {
  visEl = document.getElementById("vis");
  if (!visEl) return;
  document.addEventListener("mousemove", function(e) {
    if (!dragState || !dragTarget) return;
    dragTarget.style.left = dragState.origLeft + e.clientX - dragState.startX + "px";
    dragTarget.style.top = dragState.origTop + e.clientY - dragState.startY + "px";
  });
  document.addEventListener("mouseup", function() {
    dragState = null;
    dragTarget = null;
  });
}
function openDashboard(sku) {
  if (!visEl) return;
  if (panels[sku]) {
    visEl.appendChild(panels[sku]);
    return;
  }
  const node = findNode(sku);
  if (!node) return;
  state.dashboardSkus[sku] = true;
  const el = document.createElement("div");
  el.className = "dashboard-panel";
  el.dataset.sku = sku;
  panels[sku] = el;
  el.style.left = 20 + nextOffset * 20 + "px";
  el.style.top = 60 + nextOffset * 20 + "px";
  nextOffset = (nextOffset + 1) % 8;
  buildPanelContent(el, sku, node);
  visEl.appendChild(el);
  wireWidgetEvents(el, sku);
}
function closeDashboard(sku) {
  delete state.dashboardSkus[sku];
  const el = panels[sku];
  if (el && el.parentNode) el.parentNode.removeChild(el);
  delete panels[sku];
  for (const k in vecScratch) {
    if (k.startsWith(sku + "|")) delete vecScratch[k];
  }
}
function toggleDashboard(sku) {
  if (state.dashboardSkus[sku]) {
    closeDashboard(sku);
  } else {
    openDashboard(sku);
  }
}
function updateDashboardValues() {
  for (const sku in panels) {
    if (!state.dashboardSkus[sku]) continue;
    const el = panels[sku];
    const node = findNode(sku);
    if (!node) {
      closeDashboard(sku);
      continue;
    }
    const params = [];
    collectParamsWithAncestors(node.params, [], [], params, true);
    const rows = el.querySelectorAll(".dashboard-row");
    if (rows.length !== params.length) {
      buildPanelContent(el, sku, node);
      wireWidgetEvents(el, sku);
      continue;
    }
    for (let i = 0; i < params.length; i++) {
      const pw = params[i];
      const row = rows[i];
      if (!row) continue;
      if (activeInputKey === sku + "|" + pw.path) continue;
      updateRowValue(row, pw.param, pw.path);
    }
  }
}
function findNode(sku) {
  for (let i = 0; i < state.nodes.length; i++) {
    if (state.nodes[i].sku === sku) return state.nodes[i];
  }
  return null;
}
function isAtelierParam(pw) {
  for (let i = 0; i < pw.ancestors.length; i++) {
    if (pw.ancestors[i] === "atelier") return true;
  }
  return false;
}
function hasSubscription(p) {
  return !!(p.subs && p.subs.length > 0);
}
function buildPanelContent(el, sku, node) {
  const params = [];
  collectParamsWithAncestors(node.params, [], [], params, true);
  let html = '<div class="dashboard-header"><span class="dashboard-title">' + esc(node.label || node.sku) + '</span><span class="dashboard-spacer"></span><button class="dashboard-close">\xD7</button></div>';
  html += '<div class="dashboard-body">';
  for (let i = 0; i < params.length; i++) {
    html += buildWidgetHtml(params[i]);
  }
  if (params.length === 0) {
    html += '<div class="dashboard-empty">no params</div>';
  }
  html += "</div>";
  el.innerHTML = html;
}
function buildWidgetHtml(pw) {
  const p = pw.param;
  const isAtelier = isAtelierParam(pw);
  const hasSub = hasSubscription(p);
  const disabled = isAtelier || hasSub;
  const disabledClass = disabled ? " dashboard-disabled" : "";
  let html = '<div class="dashboard-row' + disabledClass + '" data-path="' + escAttr(pw.path) + '">';
  html += '<div class="dashboard-label-row">';
  html += '<span class="dashboard-label">' + esc(p.label || p.name) + "</span>";
  if (hasSub) html += '<span class="dashboard-badge badge-d">D</span>';
  if (isAtelier) html += '<span class="dashboard-badge badge-a">A</span>';
  html += "</div>";
  html += '<div class="dashboard-widget">';
  html += widgetHtml(p, pw.path, disabled);
  html += "</div>";
  html += "</div>";
  return html;
}
function widgetHtml(p, path, disabled) {
  const dis = disabled ? " disabled" : "";
  let html = "";
  if (p.type === "number") {
    const min = p.range && p.range.min !== void 0 ? p.range.min : 0;
    const max = p.range && p.range.max !== void 0 ? p.range.max : 1;
    const val = p.value !== void 0 && p.value !== null ? p.value : min;
    const step = (max - min) / 500;
    html += '<input type="range" class="dashboard-slider" data-path="' + escAttr(path) + '" data-comp="-1" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"' + dis + '><span class="dashboard-num">' + Number(val).toFixed(2) + "</span>";
    if (p.unit) html += '<span class="dashboard-unit">' + esc(p.unit) + "</span>";
  } else if (p.type === "bool") {
    html += '<input type="checkbox" class="dashboard-check" data-path="' + escAttr(path) + '" data-comp="-1"' + (p.value ? " checked" : "") + dis + ">";
  } else if (p.type === "string") {
    html += '<input type="text" class="dashboard-text" data-path="' + escAttr(path) + '" data-comp="-1" value="' + escAttr(String(p.value !== void 0 ? p.value : "")) + '"' + dis + ">";
  } else if (p.type === "v2" || p.type === "v3" || p.type === "v4") {
    const dim = parseInt(p.type.charAt(1), 10);
    const labels = ["x", "y", "z", "w"];
    const vals = Array.isArray(p.value) ? p.value : new Array(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      let cMin = 0, cMax = 1;
      if (p.range) {
        if (Array.isArray(p.range.min) && p.range.min[i] !== void 0) cMin = p.range.min[i];
        if (Array.isArray(p.range.max) && p.range.max[i] !== void 0) cMax = p.range.max[i];
      }
      const cVal = vals[i] !== void 0 ? vals[i] : cMin;
      const cStep = (cMax - cMin) / 500;
      html += '<div class="dashboard-vec-row"><span class="dashboard-vec-label">' + labels[i] + '</span><input type="range" class="dashboard-slider" data-path="' + escAttr(path) + '" data-comp="' + i + '" min="' + cMin + '" max="' + cMax + '" step="' + cStep + '" value="' + cVal + '"' + dis + '><span class="dashboard-num">' + Number(cVal).toFixed(2) + "</span></div>";
    }
  } else if (p.type === "colour") {
    const hex = typeof p.value === "string" ? p.value : "#000000FF";
    const rgb = hex.substring(0, 7);
    const alpha = hex.length >= 9 ? parseInt(hex.substring(7, 9), 16) : 255;
    html += '<input type="color" class="dashboard-colour" data-path="' + escAttr(path) + '" data-comp="-1" value="' + rgb + '"' + dis + ">";
    html += '<input type="range" class="dashboard-slider dashboard-alpha" data-path="' + escAttr(path) + '" data-comp="3" min="0" max="255" step="1" value="' + alpha + '"' + dis + ">";
    html += '<span class="dashboard-num">' + alpha + "</span>";
  } else {
    const vStr = p.value !== void 0 && p.value !== null ? String(p.value) : "\u2014";
    html += '<span class="dashboard-value-only">' + esc(vStr) + "</span>";
  }
  return html;
}
function updateRowValue(row, p, _path) {
  if (p.type === "number") {
    const slider = row.querySelector(".dashboard-slider");
    const numSpan = row.querySelector(".dashboard-num");
    if (slider && p.value !== void 0 && p.value !== null) {
      slider.value = String(p.value);
      if (numSpan) numSpan.textContent = Number(p.value).toFixed(2);
    }
  } else if (p.type === "bool") {
    const check = row.querySelector(".dashboard-check");
    if (check) check.checked = !!p.value;
  } else if (p.type === "string") {
    const text = row.querySelector(".dashboard-text");
    if (text) text.value = String(p.value !== void 0 ? p.value : "");
  } else if (p.type === "v2" || p.type === "v3" || p.type === "v4") {
    const dim = parseInt(p.type.charAt(1), 10);
    const vals = Array.isArray(p.value) ? p.value : new Array(dim).fill(0);
    const sliders = row.querySelectorAll(".dashboard-slider");
    const nums = row.querySelectorAll(".dashboard-num");
    for (let i = 0; i < dim && i < sliders.length; i++) {
      sliders[i].value = String(vals[i] !== void 0 ? vals[i] : 0);
      if (nums[i]) nums[i].textContent = Number(vals[i] !== void 0 ? vals[i] : 0).toFixed(2);
    }
  } else if (p.type === "colour") {
    const hex = typeof p.value === "string" ? p.value : "#000000FF";
    const colourInput = row.querySelector(".dashboard-colour");
    if (colourInput) colourInput.value = hex.substring(0, 7);
    const alphaInput = row.querySelector(".dashboard-alpha");
    if (alphaInput) {
      const a = hex.length >= 9 ? parseInt(hex.substring(7, 9), 16) : 255;
      alphaInput.value = String(a);
      const numSpan = row.querySelector(".dashboard-num");
      if (numSpan) numSpan.textContent = String(a);
    }
  } else {
    const valEl = row.querySelector(".dashboard-value-only");
    if (valEl) {
      valEl.textContent = p.value !== void 0 && p.value !== null ? String(p.value) : "\u2014";
    }
  }
}
function wireWidgetEvents(el, sku) {
  const closeBtn = el.querySelector(".dashboard-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      closeDashboard(sku);
    });
  }
  el.addEventListener("mousedown", function(e) {
    const target = e.target;
    if (target.closest(".dashboard-header") && target.tagName !== "BUTTON") {
      e.preventDefault();
      dragTarget = el;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: parseFloat(el.style.left) || 0,
        origTop: parseFloat(el.style.top) || 0
      };
      if (visEl) visEl.appendChild(el);
    }
  });
  el.addEventListener("mousedown", function(e) {
    const input2 = e.target.closest("input");
    if (input2 && input2.dataset.path) {
      activeInputKey = sku + "|" + input2.dataset.path;
    }
  });
  el.addEventListener("mouseup", function() {
    activeInputKey = null;
  });
  el.addEventListener("input", function(e) {
    const slider = e.target.closest(".dashboard-slider");
    if (slider) {
      const numSpan = slider.parentElement.querySelector(".dashboard-num") || slider.closest(".dashboard-widget").querySelector(".dashboard-num");
      if (numSpan) numSpan.textContent = Number(slider.value).toFixed(2);
      sendDashboardValue(sku, slider.dataset.path, parseInt(slider.dataset.comp, 10), parseFloat(slider.value));
    }
  });
  el.addEventListener("change", function(e) {
    const check = e.target.closest(".dashboard-check");
    if (check) {
      sendDashboardValue(sku, check.dataset.path, -1, check.checked);
      return;
    }
    const text = e.target.closest(".dashboard-text");
    if (text) {
      sendDashboardValue(sku, text.dataset.path, -1, text.value);
    }
  });
  el.addEventListener("input", function(e) {
    const colourPick = e.target.closest(".dashboard-colour");
    const alphaPick = e.target.closest(".dashboard-alpha");
    if (!colourPick && !alphaPick) return;
    const row = e.target.closest(".dashboard-row");
    if (!row) return;
    const path = row.dataset.path;
    if (!path) return;
    const cp = row.querySelector(".dashboard-colour");
    const ap = row.querySelector(".dashboard-alpha");
    const hex6 = cp ? cp.value : "#000000";
    const a = ap ? parseInt(ap.value, 10) : 255;
    if (ap) {
      const numSpan = row.querySelector(".dashboard-num");
      if (numSpan) numSpan.textContent = String(a);
    }
    const r = parseInt(hex6.substring(1, 3), 16);
    const g = parseInt(hex6.substring(3, 5), 16);
    const b = parseInt(hex6.substring(5, 7), 16);
    sendDashboardColourValue(sku, path, [r, g, b, a]);
  }, true);
}
function sendDashboardValue(sku, path, comp, val) {
  let sendVal;
  if (comp >= 0) {
    const key = sku + "|" + path;
    if (!vecScratch[key]) vecScratch[key] = [];
    vecScratch[key][comp] = val;
    sendVal = vecScratch[key].slice();
  } else {
    sendVal = val;
  }
  setParamValue(sku, path, sendVal);
}
function sendDashboardColourValue(sku, path, rgba) {
  setParamValue(sku, path, rgba);
}

// ../../../../Projects/124_dataflou/web/src/search.ts
var MAX_RESULTS = 60;
var FLOW_ICON = { source: "\u25A0", destination: "\u25CF", bidir: "\u25C6" };
var root = null;
var input = null;
var listEl = null;
var modeEl = null;
var results = [];
var sel = 0;
var connectFrom = null;
var lastQuery = "";
function nodeLabelOf(pd) {
  const nd = state.nodeData[pd.nodeIdx];
  return nd ? nd.node.label || nd.node.sku : pd.sku;
}
function paramItems() {
  const out = [];
  for (let i = 0; i < state.allParamData.length; i++) {
    const pd = state.allParamData[i];
    const p = pd.param;
    const label = p.label || p.name || pd.path;
    const node = nodeLabelOf(pd);
    out.push({
      kind: "param",
      key: pd.sku + "|" + pd.path,
      sku: pd.sku,
      path: pd.path,
      label,
      node,
      flow: p.flow || "source",
      type: p.type || "",
      hay: (label + " " + (p.name || "") + " " + pd.path.replace(/\//g, " ") + " " + node).toLowerCase()
    });
  }
  return out;
}
function nodeItems() {
  const out = [];
  for (let i = 0; i < state.nodeData.length; i++) {
    const n = state.nodeData[i].node;
    const label = n.label || n.sku;
    out.push({ kind: "node", sku: n.sku, label, count: state.nodeData[i].paramCount, hay: (label + " " + n.sku).toLowerCase() });
  }
  return out;
}
var pdIndexOf = null;
var pdIndex = {};
function findPd(key) {
  if (pdIndexOf !== state.allParamData) {
    pdIndex = {};
    for (let i = 0; i < state.allParamData.length; i++) {
      const pd = state.allParamData[i];
      pdIndex[pd.sku + "|" + pd.path] = pd;
    }
    pdIndexOf = state.allParamData;
  }
  return pdIndex[key] || null;
}
function score(it, words) {
  let s = 0;
  const label = it.label.toLowerCase();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const at = it.hay.indexOf(w);
    if (at < 0) return -1;
    s += 10 - Math.min(at, 9);
    if (label.indexOf(w) === 0) s += 25;
    else if (label.indexOf(w) > 0) s += 12;
    if (at === 0 || it.hay.charAt(at - 1) === " ") s += 6;
  }
  if (it.kind === "node") s += 8;
  return s - label.length * 0.05;
}
function partnerOk(a, b) {
  if (a.key === b.key || a.type !== b.type) return false;
  const aSrc = a.flow === "source", bSrc = b.flow === "source";
  const aDst = a.flow === "destination", bDst = b.flow === "destination";
  if (aSrc && bSrc || aDst && bDst) return false;
  const pdB = findPd(b.key);
  if (pdB && pdB.param.error) return false;
  const link2 = direction(a, b);
  const destPd = findPd(link2.dest.key);
  const subs = destPd && destPd.param.subs || [];
  return !subs.some(function(s) {
    return s.sku === link2.src.sku && s.path === link2.src.path;
  });
}
function direction(a, b) {
  if (a.flow === "source" || b.flow === "destination") return { src: a, dest: b };
  return { src: b, dest: a };
}
function compute() {
  const q = (input ? input.value : "").trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  let pool;
  if (connectFrom) {
    const from = connectFrom;
    pool = paramItems().filter(function(b) {
      return partnerOk(from, b);
    });
  } else {
    pool = nodeItems().concat(paramItems());
  }
  if (words.length === 0) {
    results = pool.slice(0, MAX_RESULTS);
  } else {
    const scored = [];
    for (let i = 0; i < pool.length; i++) {
      const s = score(pool[i], words);
      if (s >= 0) scored.push({ it: pool[i], s });
    }
    scored.sort(function(x, y) {
      return y.s - x.s;
    });
    results = scored.slice(0, MAX_RESULTS).map(function(x) {
      return x.it;
    });
  }
  if (sel >= results.length) sel = Math.max(0, results.length - 1);
  draw();
}
function draw() {
  if (!listEl || !modeEl || !input) return;
  if (connectFrom) {
    modeEl.innerHTML = "connect <b>" + esc(connectFrom.label) + '</b> <span class="sp-dim">' + esc(connectFrom.node) + " \xB7 " + esc(connectFrom.type) + "</span> with\u2026";
    modeEl.style.display = "block";
    input.placeholder = "a " + (connectFrom.flow === "source" ? "destination" : connectFrom.flow === "destination" ? "source" : "partner") + " to link";
  } else {
    modeEl.style.display = "none";
    input.placeholder = "search parameters and instruments\u2026";
  }
  let html = "";
  for (let i = 0; i < results.length; i++) {
    const it = results[i];
    const cls = "sp-item" + (i === sel ? " sel" : "");
    if (it.kind === "node") {
      html += '<div class="' + cls + '" data-i="' + i + '"><span class="sp-icon">\u25EF</span><span class="sp-label">' + esc(it.label) + '</span><span class="sp-path">instrument \xB7 ' + it.count + " items</span></div>";
    } else {
      let arrow = "";
      if (connectFrom) {
        const d = direction(connectFrom, it);
        arrow = '<span class="sp-arrow">' + (d.src === connectFrom ? "\u2192" : "\u2190") + "</span>";
      }
      html += '<div class="' + cls + '" data-i="' + i + '">' + arrow + '<span class="sp-icon" title="' + it.flow + '">' + (FLOW_ICON[it.flow] || "\xB7") + '</span><span class="sp-label">' + esc(it.label) + '</span><span class="sp-path">' + esc(it.node) + " / " + esc(it.path) + '</span><span class="sp-type">' + esc(it.type) + "</span></div>";
    }
  }
  if (!html) html = '<div class="sp-empty">' + (connectFrom ? "nothing compatible to link" : "no match") + "</div>";
  listEl.innerHTML = html;
  const s = listEl.querySelector(".sel");
  if (s) s.scrollIntoView({ block: "nearest" });
}
var ping = null;
var PING_MS = 2400;
function reapplySearchPing() {
  if (!ping || !state.g) return;
  const age = Date.now() - ping.start;
  if (age > PING_MS) {
    ping = null;
    return;
  }
  const pd = findPd(ping.key);
  if (!pd) return;
  state.g.append("circle").attr("class", "search-ping").attr("cx", pd.cx).attr("cy", pd.cy).attr("r", 6).style("animation-delay", -age + "ms");
}
function goTo(it) {
  close();
  if (it.kind === "node") {
    const nd = state.nodeData.find(function(n) {
      return n.node.sku === it.sku;
    });
    if (!nd || nd.startAngle === void 0 || nd.endAngle === void 0) return;
    const mid = (nd.startAngle + nd.endAngle) / 2;
    const r2 = (state._mainRadius || 220) + 40;
    const sweep = nd.endAngle - nd.startAngle;
    const k = Math.max(1, Math.min(4, 2.2 / Math.max(sweep, 0.5)));
    zoomTo(Math.cos(mid) * r2 * 0.6, Math.sin(mid) * r2 * 0.6, k);
    return;
  }
  const parts = it.path.split("/");
  let opened = false;
  for (let i = 1; i < parts.length; i++) {
    const gk = it.sku + "|" + parts.slice(0, i).join("/");
    if (state.collapsedGroups[gk]) {
      delete state.collapsedGroups[gk];
      opened = true;
    }
  }
  if (opened && state._render) {
    state._animating = false;
    if (state._capturePositions) state._collapseAnim = state._capturePositions();
    state.tempExpandedGroup = null;
    state.ringHover = null;
    state._render();
  }
  const pd = findPd(it.key);
  if (!pd) return;
  ping = { key: it.key, start: Date.now() };
  reapplySearchPing();
  const r = Math.hypot(pd.cx, pd.cy) || 1;
  const out = 28;
  zoomTo(pd.cx * (1 + out / r), pd.cy * (1 + out / r), 6);
}
function link(a, b) {
  const d = direction(a, b);
  const at = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
  close();
  if (!wsReady()) {
    showToast(at, "Not connected");
    return;
  }
  subscribeLink({
    dest_sku: d.dest.sku,
    dest_path: d.dest.path,
    source_sku: d.src.sku,
    source_path: d.src.path
  }, at);
  showToast(at, d.src.label + " \u2192 " + d.dest.label);
}
function choose(i, connect2) {
  const it = results[i];
  if (!it) return;
  if (connectFrom) {
    if (it.kind === "param") link(connectFrom, it);
    return;
  }
  if (connect2) {
    if (it.kind !== "param") return;
    connectFrom = it;
    lastQuery = input.value;
    input.value = "";
    sel = 0;
    compute();
    return;
  }
  goTo(it);
}
function isSearchOpen() {
  return !!root && root.style.display !== "none";
}
function open() {
  if (!root) build();
  connectFrom = null;
  sel = 0;
  root.style.display = "block";
  input.value = "";
  compute();
  input.focus();
  refreshGlass();
}
function close() {
  if (!root) return;
  root.style.display = "none";
  connectFrom = null;
  if (input) input.blur();
}
function build() {
  root = document.createElement("div");
  root.id = "search-palette";
  root.style.display = "none";
  root.innerHTML = '<div class="sp-mode"></div><input type="text" spellcheck="false" autocomplete="off"><div class="sp-list"></div><div class="sp-foot"><kbd>\u2191</kbd><kbd>\u2193</kbd> choose \xB7 <kbd>Enter</kbd> go to / link \xB7 <kbd>Tab</kbd> connect from \xB7 <kbd>Esc</kbd> back / close</div>';
  document.body.appendChild(root);
  input = root.querySelector("input");
  listEl = root.querySelector(".sp-list");
  modeEl = root.querySelector(".sp-mode");
  input.addEventListener("input", function() {
    sel = 0;
    compute();
  });
  input.addEventListener("keydown", function(e) {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) {
        sel = (sel + 1) % results.length;
        draw();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) {
        sel = (sel - 1 + results.length) % results.length;
        draw();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(sel, false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (!connectFrom) choose(sel, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (connectFrom) {
        connectFrom = null;
        input.value = lastQuery;
        sel = 0;
        compute();
      } else close();
    }
  });
  input.addEventListener("keyup", function(e) {
    e.stopPropagation();
  });
  listEl.addEventListener("mousemove", function(e) {
    const row = e.target.closest(".sp-item");
    if (!row) return;
    const i = parseInt(row.getAttribute("data-i") || "-1", 10);
    if (i >= 0 && i !== sel) {
      sel = i;
      draw();
    }
  });
  listEl.addEventListener("mousedown", function(e) {
    const row = e.target.closest(".sp-item");
    if (!row) return;
    e.preventDefault();
    choose(parseInt(row.getAttribute("data-i") || "-1", 10), e.shiftKey);
  });
  document.addEventListener("mousedown", function(e) {
    if (isSearchOpen() && root && !root.contains(e.target)) close();
  }, true);
}
function initSearch() {
  if (isOutputWindow()) return;
  document.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (isSearchOpen()) close();
      else open();
    }
  });
}

// ../../../../Projects/124_dataflou/web/src/render.ts
function setup() {
  const container = document.getElementById("vis");
  state.svg = d3.select(container).append("svg").attr("viewBox", "-500 -500 1000 1000").attr("preserveAspectRatio", "xMidYMid meet");
  state.g = state.svg.append("g");
  state.tooltip = d3.select(container).append("div").attr("class", "param-tooltip").style("display", "none");
}
function capturePositions() {
  const result = { params: {}, dots: {}, groupLabels: {}, collapsedLabels: {} };
  if (state.allParamData) {
    for (let i = 0; i < state.allParamData.length; i++) {
      const pd = state.allParamData[i];
      result.params[pd.sku + "|" + pd.path] = {
        cx: pd.cx,
        cy: pd.cy,
        angle: pd.angle,
        isCollapsed: !!pd.isCollapsed
      };
    }
  }
  if (state.collapsedDots) {
    for (let i = 0; i < state.collapsedDots.length; i++) {
      const cd = state.collapsedDots[i];
      result.dots[cd.sku + "|" + cd.groupPath] = { cx: cd.cx, cy: cd.cy };
    }
  }
  state.g.selectAll(".group-label").each(function(d) {
    if (!d || !state.nodeData) return;
    const el = d3.select(this);
    const sku = state.nodeData[d.nodeIdx].node.sku;
    const key = sku + "|" + d.groupPath;
    try {
      const bbox = this.getBBox();
      let depth = 0;
      const cls = el.attr("class") || "";
      const dm = cls.match(/depth-(\d+)/);
      if (dm) depth = parseInt(dm[1]);
      result.groupLabels[key] = {
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + bbox.height / 2,
        text: el.select("textPath").text(),
        depth
      };
    } catch (_) {
    }
  });
  state.g.selectAll(".collapsed-label").each(function(d) {
    if (!d || !d.groupKey) return;
    const el = d3.select(this);
    result.collapsedLabels[d.groupKey] = {
      x: parseFloat(el.attr("x")),
      y: parseFloat(el.attr("y")),
      anchor: el.attr("text-anchor") || "start",
      transform: el.attr("transform") || "",
      text: el.text()
    };
  });
  return result;
}
function render() {
  if (state.dragState && state.dragState.retracting) return;
  if (state._animating) return;
  state.g.selectAll("*").remove();
  const defs = state.svg.select("defs").empty() ? state.svg.append("defs") : state.svg.select("defs");
  defs.selectAll("*").remove();
  const rotRad = state.rotationOffset * Math.PI / 180;
  state._render = render;
  state._capturePositions = capturePositions;
  autoCollapseNewNodes();
  const effectiveCollapsed = {};
  for (const k in state.collapsedGroups) effectiveCollapsed[k] = true;
  if (state.tempExpandedGroup) delete effectiveCollapsed[state.tempExpandedGroup];
  const collapsedDots = [];
  const glow = defs.append("filter").attr("id", "conn-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");
  const shownNodes = visibleNodes(state.nodes).slice().sort(compareNodes);
  if (shownNodes.length === 0) {
    state.g.append("text").attr("class", "empty-msg").text(state.nodes.length === 0 ? "no nodes" : "no present nodes");
    return;
  }
  let totalParams = 0;
  const nodeData = [];
  for (let i = 0; i < shownNodes.length; i++) {
    const n = shownNodes[i];
    const pc = Math.max(countDisplayItems(n.params, n.sku, null, effectiveCollapsed), 1);
    const layoutCount = pc + 1;
    nodeData.push({
      node: n,
      paramCount: pc,
      layoutCount,
      // colour by position in the full list, so hiding nodes doesn't recolour the rest
      color: gc(PALETTE[state.nodes.indexOf(n) % PALETTE.length])
    });
    totalParams += layoutCount;
  }
  const gapAngle = GAP_ANGLE;
  const totalGap = gapAngle * shownNodes.length;
  let availableAngle = 2 * Math.PI - totalGap;
  if (availableAngle < Math.PI) availableAngle = Math.PI;
  let currentAngle = -Math.PI / 2;
  for (let i = 0; i < nodeData.length; i++) {
    const nd = nodeData[i];
    nd.startAngle = currentAngle;
    nd.sweep = nd.layoutCount / totalParams * availableAngle;
    nd.endAngle = currentAngle + nd.sweep;
    currentAngle = nd.endAngle + gapAngle;
  }
  const mainRadius = MAIN_RADIUS * ringScale();
  const arcWidth = ARC_WIDTH * lineScale();
  const paramRadius = PARAM_RADIUS;
  const paramPad = PARAM_PAD;
  const groupLayerStep = Math.max(GROUP_LAYER_STEP, groupTitleSize(0) + 9);
  const paramLabelGap = PARAM_LABEL_GAP;
  const labelR = mainRadius + arcWidth / 2 + paramLabelGap;
  let nameExtent = 0;
  const nameScales = [];
  for (let i = 0; i < nodeData.length; i++) {
    const items = [];
    collectDisplayItems(nodeData[i].node.params, nodeData[i].node.sku, null, [], effectiveCollapsed, items);
    let step = Infinity;
    if (items.length > 1) {
      let ps = nodeData[i].startAngle + paramPad, pe = nodeData[i].endAngle - paramPad;
      if (pe <= ps) {
        ps = nodeData[i].startAngle;
        pe = nodeData[i].endAngle;
      }
      step = (pe - ps) / (items.length - 1) * labelR;
    }
    const nameScale = Math.max(0.2, Math.min(1, step / (paramFontSize() * 1.05)));
    nameScales.push(nameScale);
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      let w;
      if (it.kind === "collapsed") {
        w = measureName(shortName(it.groupLabel || it.groupName) + " [" + it.innerParams.length + "]", true);
      } else {
        w = measureName(shortName(it.param.label || it.param.name || ""), false);
        const v = formatParamValue(it.param);
        if (v) w += paramFontSize() + measureName(v, false);
      }
      if (w * nameScale > nameExtent) nameExtent = w * nameScale;
    }
  }
  const groupArcBase = labelR + stableNameRoom(nameExtent) + 6;
  const arcGapAngle = ARC_GAP_ANGLE;
  const paramCircleR = mainRadius - arcWidth / 2;
  state._mainRadius = mainRadius;
  state._innerR = paramCircleR;
  let globalMaxDepth = 0;
  for (let i = 0; i < nodeData.length; i++) {
    const md = maxGroupDepthCollapsed(nodeData[i].node.params, nodeData[i].node.sku, effectiveCollapsed);
    if (md > globalMaxDepth) globalMaxDepth = md;
  }
  const arcGen = d3.arc().innerRadius(mainRadius - arcWidth / 2).outerRadius(mainRadius + arcWidth / 2);
  for (let i = 0; i < nodeData.length; i++) {
    const nd = nodeData[i];
    const topGroups = collectTopGroupsCollapsed(nd.node.params, nd.node.sku, effectiveCollapsed);
    if (topGroups.length <= 1) {
      state.g.append("path").attr("class", "node-arc" + (nd.node.online ? "" : " offline")).attr("data-sku", nd.node.sku).attr("d", arcGen({
        startAngle: nd.startAngle + Math.PI / 2,
        endAngle: nd.endAngle + Math.PI / 2
      })).attr("fill", nd.node.online ? nd.color : "#333").attr("opacity", 0.6);
    } else {
      for (let ti = 0; ti < topGroups.length; ti++) {
        const tg = topGroups[ti];
        let segStart = nd.startAngle + tg.offset / nd.layoutCount * nd.sweep;
        let segEnd = nd.startAngle + (tg.offset + tg.count) / nd.layoutCount * nd.sweep;
        if (ti === topGroups.length - 1) segEnd = nd.endAngle;
        const gapL = ti > 0 ? arcGapAngle / 2 : 0;
        const gapR = ti < topGroups.length - 1 ? arcGapAngle / 2 : 0;
        state.g.append("path").attr("class", "node-arc" + (nd.node.online ? "" : " offline")).attr("data-sku", nd.node.sku).attr("d", arcGen({
          startAngle: segStart + gapL + Math.PI / 2,
          endAngle: segEnd - gapR + Math.PI / 2
        })).attr("fill", nd.node.online ? nd.color : "#333").attr("opacity", 0.6);
      }
    }
  }
  const wedgeLayer = state.g.append("g").attr("class", "wedge-layer");
  const allParamPos = [];
  const allParamData = [];
  const paramLabelGroup = state.g.append("g").attr("class", "param-labels");
  for (let i = 0; i < nodeData.length; i++) {
    const nd = nodeData[i];
    const displayItems = [];
    collectDisplayItems(nd.node.params, nd.node.sku, null, [], effectiveCollapsed, displayItems);
    let padStart = nd.startAngle + paramPad;
    let padEnd = nd.endAngle - paramPad;
    if (padEnd <= padStart) {
      padStart = nd.startAngle;
      padEnd = nd.endAngle;
    }
    const padSweep = padEnd - padStart;
    for (let j = 0; j < displayItems.length; j++) {
      const di = displayItems[j];
      const t = displayItems.length === 1 ? 0.5 : j / (displayItems.length - 1);
      const angle = padStart + t * padSweep;
      const cx = Math.cos(angle) * paramCircleR;
      const cy = Math.sin(angle) * paramCircleR;
      if (di.kind === "collapsed") {
        let hasSubs = false;
        for (let ci = 0; ci < di.innerParams.length; ci++) {
          if (di.innerParams[ci].subs && di.innerParams[ci].subs.length > 0) {
            hasSubs = true;
            break;
          }
        }
        let dotFill = hasSubs ? C_GREEN_SUB : C_PARAM;
        if (!nd.node.online) dotFill = C_OFFLINE;
        const groupKey = nd.node.sku + "|" + di.groupPath;
        state.g.append("circle").attr("class", "collapsed-dot").attr("cx", cx).attr("cy", cy).attr("r", paramRadius + 1).attr("fill", dotFill).attr("stroke", nd.node.online ? nd.color : "#444").attr("stroke-width", 1).attr("opacity", 0.8).style("cursor", "pointer").datum({ groupKey, nodeIdx: i, sku: nd.node.sku, groupPath: di.groupPath });
        const stemDepth = di.ancestors.length > 1 ? di.ancestors.length - 2 : -1;
        const stemR = stemDepth >= 0 ? groupArcBase + (globalMaxDepth - stemDepth) * groupLayerStep : groupArcBase;
        const cText = shortName(di.groupLabel || di.groupName) + " [" + di.innerParams.length + "]";
        const cLabelR = labelR;
        const stemFrom = cLabelR + measureName(cText, true) * nameScales[i] + 3;
        state.g.append("line").attr("class", "collapsed-stem").attr("x1", Math.cos(angle) * Math.min(stemFrom, stemR)).attr("y1", Math.sin(angle) * Math.min(stemFrom, stemR)).attr("x2", Math.cos(angle) * stemR).attr("y2", Math.sin(angle) * stemR).attr("stroke", nd.node.online ? nd.color : "#444").attr("stroke-width", 0.8).attr("opacity", 0.3).style("pointer-events", "none");
        const clx = Math.cos(angle) * cLabelR;
        const cly = Math.sin(angle) * cLabelR;
        const cDeg = angle * 180 / Math.PI;
        const cVisDeg = ((cDeg + state.rotationOffset) % 360 + 540) % 360 - 180;
        let cAnchor, cRotation;
        if (cVisDeg > 90 || cVisDeg < -90) {
          cRotation = cDeg + 180;
          cAnchor = "end";
        } else {
          cRotation = cDeg;
          cAnchor = "start";
        }
        paramLabelGroup.append("text").attr("class", "param-label collapsed-label").attr("x", clx).attr("y", cly).attr("text-anchor", cAnchor).attr("dominant-baseline", "middle").attr("transform", "rotate(" + cRotation + "," + clx + "," + cly + ")").style("pointer-events", "none").datum({ groupKey }).text(cText).each(function() {
          if (nameScales[i] < 1) this.style.fontSize = paramFontSize() * nameScales[i] + "px";
        });
        const hitEndR = Math.max(stemR, stemFrom) + 4;
        state.g.append("line").attr("class", "collapsed-hit").attr("x1", cx).attr("y1", cy).attr("x2", Math.cos(angle) * hitEndR).attr("y2", Math.sin(angle) * hitEndR).attr("stroke", "transparent").attr("stroke-width", 16).style("pointer-events", "stroke").style("cursor", "pointer").datum({ groupKey, nodeIdx: i, sku: nd.node.sku, groupPath: di.groupPath });
        for (let ci = 0; ci < di.innerParams.length; ci++) {
          allParamData.push({
            param: di.innerParams[ci],
            path: di.innerPaths[ci],
            sku: nd.node.sku,
            nodeIdx: i,
            angle,
            cx,
            cy,
            ancestors: di.ancestors,
            isCollapsed: true,
            collapsedGroupPath: di.groupPath
          });
        }
        allParamPos.push({
          angle,
          nodeIdx: i,
          cx,
          cy,
          parentDepth: stemDepth,
          isCollapsed: true,
          groupKey
        });
        collapsedDots.push({
          sku: nd.node.sku,
          groupPath: di.groupPath,
          cx,
          cy,
          nodeIdx: i,
          angle
        });
        continue;
      }
      const p = di.param;
      const ancestors = di.ancestors;
      const paramPath = di.path;
      const paramKey = nd.node.sku + "|" + paramPath;
      const isGrabbable = p.flow === "destination" || p.flow === "bidir";
      const isChanged = !!state.changedParams[paramKey];
      const parentDepth = ancestors.length > 0 ? ancestors.length - 1 : -1;
      allParamPos.push({ angle, nodeIdx: i, cx, cy, parentDepth });
      allParamData.push({
        param: p,
        ancestors,
        path: paramPath,
        sku: nd.node.sku,
        nodeIdx: i,
        angle,
        cx,
        cy
      });
      const hasSubscription2 = p.subs && p.subs.length > 0;
      const flow = p.flow || "source";
      const mode = p.mode || "streaming";
      const access = p.access || "read";
      const hasError = !!p.error;
      let shapeClass = "param-shape";
      if (!nd.node.online) shapeClass += " offline";
      if (isGrabbable) shapeClass += " grabbable";
      if (isChanged) shapeClass += " data-flash";
      if (mode === "discrete") shapeClass += " mode-discrete";
      else if (mode === "polling") shapeClass += " mode-polling";
      if (access === "readwrite" || access === "write") shapeClass += " access-rw";
      if (hasError) shapeClass += " param-error";
      const connectionColor = state._connectionColorMap ? state._connectionColorMap[paramKey] : null;
      let shapeFill;
      if (hasError) {
        shapeFill = C_ERROR;
      } else if (!nd.node.online) {
        shapeFill = C_OFFLINE;
      } else if (hasSubscription2 && isChanged) {
        shapeFill = C_ACTIVE;
      } else if (connectionColor) {
        shapeFill = connectionColor;
      } else if (hasSubscription2) {
        shapeFill = C_GREEN_SUB;
      } else {
        shapeFill = C_PARAM;
      }
      const paramDatum = { paramIdx: allParamData.length - 1 };
      if (flow === "destination") {
        state.g.append("circle").attr("class", shapeClass).attr("cx", cx).attr("cy", cy).attr("r", paramRadius).attr("fill", shapeFill).datum(paramDatum);
      } else if (flow === "bidir") {
        const s = paramRadius;
        const dmDeg = angle * 180 / Math.PI;
        const pts = "0," + -s + " " + s + ",0 0," + s + " " + -s + ",0";
        state.g.append("polygon").attr("class", shapeClass).attr("points", pts).attr("transform", "translate(" + cx + "," + cy + ") rotate(" + dmDeg + ")").attr("fill", shapeFill).datum(paramDatum);
      } else {
        const s = paramRadius * 0.85;
        const sqDeg = angle * 180 / Math.PI;
        state.g.append("rect").attr("class", shapeClass).attr("x", -s).attr("y", -s).attr("width", s * 2).attr("height", s * 2).attr("transform", "translate(" + cx + "," + cy + ") rotate(" + sqDeg + ")").attr("fill", shapeFill).datum(paramDatum);
      }
      if (p.ground) {
        const inR = paramCircleR - paramRadius - 2;
        const outR = paramCircleR - paramRadius;
        state.g.append("line").attr("class", "ground-tick").attr("x1", Math.cos(angle) * inR).attr("y1", Math.sin(angle) * inR).attr("x2", Math.cos(angle) * outR).attr("y2", Math.sin(angle) * outR);
      }
      allParamPos[allParamPos.length - 1].hitColor = nd.color;
      allParamPos[allParamPos.length - 1].hitIdx = allParamData.length - 1;
      allParamPos[allParamPos.length - 1].grabbable = isGrabbable;
      const lx = Math.cos(angle) * labelR;
      const ly = Math.sin(angle) * labelR;
      const deg = angle * 180 / Math.PI;
      const visDeg = ((deg + state.rotationOffset) % 360 + 540) % 360 - 180;
      let anchor, rotation;
      if (visDeg > 90 || visDeg < -90) {
        rotation = deg + 180;
        anchor = "end";
      } else {
        rotation = deg;
        anchor = "start";
      }
      const label = shortName(p.label || p.name || "");
      const valStr = formatParamValue(p);
      let labelClass = "param-label";
      if (!nd.node.online) labelClass += " offline";
      if (hasError) labelClass += " param-error";
      const textEl = paramLabelGroup.append("text").attr("class", labelClass + " param-label-hit").attr("x", lx).attr("y", ly).attr("text-anchor", anchor).attr("dominant-baseline", "middle").attr("transform", "rotate(" + rotation + "," + lx + "," + ly + ")").datum(paramDatum);
      if (nameScales[i] < 1) textEl.node().style.fontSize = paramFontSize() * nameScales[i] + "px";
      textEl.append("tspan").text(label);
      if (valStr) {
        textEl.append("tspan").attr("class", "param-value").attr("dx", "1em").text(valStr);
      }
    }
    let addAngle;
    if (displayItems.length === 0) {
      addAngle = (padStart + padEnd) / 2;
    } else if (displayItems.length === 1) {
      addAngle = padStart + padSweep;
    } else {
      const step = padSweep / (displayItems.length - 1);
      addAngle = padStart + displayItems.length * step;
    }
    allParamPos.push({
      isAddBtn: true,
      angle: addAngle,
      nodeIdx: i,
      cx: Math.cos(addAngle) * paramCircleR,
      cy: Math.sin(addAngle) * paramCircleR,
      nodeSku: nd.node.sku
    });
  }
  state.allParamData = allParamData;
  state.nodeData = nodeData;
  state.collapsedDots = collapsedDots;
  state._connectionColorMap = buildConnectionColorMap(allParamData, nodeData);
  state.g.selectAll(".param-shape").each(function() {
    const el = d3.select(this);
    const d = d3.select(this).datum();
    if (!d) return;
    const pd = allParamData[d.paramIdx];
    if (!pd) return;
    const key = pd.sku + "|" + pd.path;
    const cc = state._connectionColorMap[key];
    const p = pd.param;
    const ndI = nodeData[pd.nodeIdx];
    const hasSubscription2 = p.subs && p.subs.length > 0;
    const hasError = !!p.error;
    const isChanged = !!state.changedParams[key];
    if (hasError || !ndI.node.online || hasSubscription2 && isChanged) return;
    if (cc && hasSubscription2) {
      el.attr("fill", cc);
    }
  });
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    if (pd.isCollapsed) continue;
    const key = pd.sku + "|" + pd.path;
    const flow = pd.param.flow || "source";
    if (flow === "source" && state._connectionColorMap && state._connectionColorMap[key]) {
      state.g.append("circle").attr("class", "source-dot").attr("cx", pd.cx).attr("cy", pd.cy).attr("r", 1.5).attr("fill", "#000").style("pointer-events", "none");
    }
  }
  drawSubscriptionConnections(allParamData, nodeData);
  drawPendingLinks(allParamData);
  for (let i = 0; i < allParamPos.length; i++) {
    const hp = allParamPos[i];
    if (hp.isAddBtn || hp.isCollapsed) continue;
    const nd_h = nodeData[hp.nodeIdx];
    let aStart, aEnd;
    if (i > 0 && !allParamPos[i - 1].isAddBtn && allParamPos[i - 1].nodeIdx === hp.nodeIdx) {
      aStart = (allParamPos[i - 1].angle + hp.angle) / 2;
    } else {
      aStart = nd_h.startAngle;
    }
    if (i < allParamPos.length - 1 && !allParamPos[i + 1].isAddBtn && allParamPos[i + 1].nodeIdx === hp.nodeIdx) {
      aEnd = (hp.angle + allParamPos[i + 1].angle) / 2;
    } else {
      aEnd = nd_h.endAngle;
    }
    const outerR = hp.parentDepth !== void 0 && hp.parentDepth >= 0 ? groupArcBase + (globalMaxDepth - hp.parentDepth) * groupLayerStep : groupArcBase;
    const hitGen = d3.arc().innerRadius(mainRadius + arcWidth / 2).outerRadius(outerR);
    state.g.append("path").attr("class", "param-hit").attr("d", hitGen({
      startAngle: aStart + Math.PI / 2,
      endAngle: aEnd + Math.PI / 2
    })).attr("fill", hp.hitColor).style("pointer-events", "fill").style("cursor", hp.grabbable ? "pointer" : "default").datum({ paramIdx: hp.hitIdx });
  }
  for (let i = 0; i < allParamPos.length; i++) {
    const ap = allParamPos[i];
    if (!ap.isAddBtn) continue;
    state.g.append("circle").attr("class", "add-param-btn").attr("cx", ap.cx).attr("cy", ap.cy).attr("r", paramRadius).attr("fill", "#111").attr("stroke", "#888").attr("stroke-width", 0.6).attr("opacity", 0.5).style("cursor", "pointer").datum({ nodeIdx: ap.nodeIdx, nodeSku: ap.nodeSku });
    state.g.append("text").attr("class", "add-param-label").attr("x", ap.cx).attr("y", ap.cy).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", "5px").attr("fill", "#888").attr("opacity", 0.6).style("pointer-events", "none").text("+");
  }
  let groupPathIdx = 0;
  for (let i = 0; i < nodeData.length; i++) {
    const nd = nodeData[i];
    const groups = [];
    collectGroupsCollapsed(nd.node.params, 0, 0, [], nd.node.sku, null, effectiveCollapsed, groups);
    const nodeMid = (nd.startAngle + nd.endAngle) / 2;
    const visNodeMid = ((nodeMid + rotRad) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    const nodeFlip = visNodeMid > 0 && visNodeMid < Math.PI;
    for (let j = 0; j < groups.length; j++) {
      const grp = groups[j];
      if (grp.collapsed) continue;
      const ringR = groupArcBase + (globalMaxDepth - grp.depth) * groupLayerStep;
      const gStart = nd.startAngle + grp.offset / nd.layoutCount * nd.sweep;
      const gEnd = nd.startAngle + (grp.offset + grp.count) / nd.layoutCount * nd.sweep;
      const largeArc = gEnd - gStart > Math.PI ? 1 : 0;
      const x1 = Math.cos(gStart) * ringR, y1 = Math.sin(gStart) * ringR;
      const x2 = Math.cos(gEnd) * ringR, y2 = Math.sin(gEnd) * ringR;
      const grpColor = nd.node.online ? nd.color : "#444";
      const grpOpacity = Math.max(0.2, 0.6 - grp.depth * 0.15);
      const grpCls = makeGrpCls(i, grp.name);
      const grpDatum = { nodeIdx: i, grpCls, grpName: grp.name, ancestors: grp.ancestors, groupPath: grp.groupPath };
      state.g.append("path").attr("class", "group-arc " + grpCls).attr("d", "M " + x1 + " " + y1 + " A " + ringR + " " + ringR + " 0 " + largeArc + " 1 " + x2 + " " + y2).attr("fill", "none").attr("stroke", grpColor).attr("stroke-width", 1).attr("opacity", grpOpacity).style("pointer-events", "none").datum(grpDatum);
      const wedgeGen = d3.arc().innerRadius(mainRadius + arcWidth / 2).outerRadius(ringR);
      wedgeLayer.append("path").attr("class", "group-wedge " + grpCls).attr("d", wedgeGen({
        startAngle: gStart + Math.PI / 2,
        endAngle: gEnd + Math.PI / 2
      })).attr("fill", grpColor).attr("opacity", 0).style("pointer-events", "none");
      const hitWidth = HIT_WIDTH;
      const hitArcGen = d3.arc().innerRadius(ringR).outerRadius(ringR + hitWidth);
      const grpHitEl = state.g.append("path").attr("class", "group-hit " + grpCls).attr("d", hitArcGen({
        startAngle: gStart + Math.PI / 2,
        endAngle: gEnd + Math.PI / 2
      })).attr("fill", grpColor).style("pointer-events", "fill").style("cursor", "pointer").datum(grpDatum);
      const grpFontSize = groupTitleSize(grp.depth);
      const gLabelR = ringR + 5 + (nodeFlip ? grpFontSize * 0.6 : 0);
      let sa, ea;
      if (nodeFlip) {
        sa = gEnd;
        ea = gStart;
      } else {
        sa = gStart;
        ea = gEnd;
      }
      const gx1 = Math.cos(sa) * gLabelR;
      const gy1 = Math.sin(sa) * gLabelR;
      const gx2 = Math.cos(ea) * gLabelR;
      const gy2 = Math.sin(ea) * gLabelR;
      const gLargeArc = Math.abs(ea - sa) > Math.PI ? 1 : 0;
      const gSweepFlag = nodeFlip ? 0 : 1;
      const gPathD = "M " + gx1 + " " + gy1 + " A " + gLabelR + " " + gLabelR + " 0 " + gLargeArc + " " + gSweepFlag + " " + gx2 + " " + gy2;
      const gPathId = "group-path-" + groupPathIdx++;
      defs.append("path").attr("id", gPathId).attr("d", gPathD);
      const grpLabelDatum = { nodeIdx: i, grpCls, grpName: grp.name, ancestors: grp.ancestors, groupPath: grp.groupPath };
      const grpLabelEl = state.g.append("text").attr("class", "group-label depth-" + grp.depth + " grp-lbl-" + makeGrpCls(i, grp.name).substring(4)).style("pointer-events", "none").datum(grpLabelDatum);
      const grpTp = grpLabelEl.append("textPath").attr("href", "#" + gPathId).attr("startOffset", "50%").attr("text-anchor", "middle").text(grp.name);
      grpHitEl.append("title").text(grp.name);
      fitCurvedTitle(
        grpLabelEl.node(),
        grpTp.node(),
        grp.name,
        gLabelR * Math.abs(gEnd - gStart),
        grpFontSize,
        "group-label depth-" + Math.min(grp.depth, 2)
      );
    }
  }
  const nodeLabelR = groupArcBase + (globalMaxDepth + 1) * groupLayerStep + Math.max(10, nodeTitleSize() * 0.6 + 4);
  for (let i = 0; i < nodeData.length; i++) {
    const nd = nodeData[i];
    const midAngle = (nd.startAngle + nd.endAngle) / 2;
    const arcSweep = nd.sweep * 0.8;
    const arcStart = midAngle - arcSweep / 2;
    const arcEnd = midAngle + arcSweep / 2;
    const visMidAngle = ((midAngle + rotRad) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    const flip = visMidAngle > 0 && visMidAngle < Math.PI;
    let sa, ea;
    if (flip) {
      sa = arcEnd;
      ea = arcStart;
    } else {
      sa = arcStart;
      ea = arcEnd;
    }
    const x1 = Math.cos(sa) * nodeLabelR;
    const y1 = Math.sin(sa) * nodeLabelR;
    const x2 = Math.cos(ea) * nodeLabelR;
    const y2 = Math.sin(ea) * nodeLabelR;
    const largeArc = Math.abs(ea - sa) > Math.PI ? 1 : 0;
    const sweepFlag = flip ? 0 : 1;
    const pathD = "M " + x1 + " " + y1 + " A " + nodeLabelR + " " + nodeLabelR + " 0 " + largeArc + " " + sweepFlag + " " + x2 + " " + y2;
    const pathId = "label-path-" + i;
    defs.append("path").attr("id", pathId).attr("d", pathD);
    const nodeLabel2 = nd.node.label || nd.node.sku;
    let nlClass = "node-label";
    if (!nd.node.online) nlClass += " offline";
    if (nd.node.is_local) nlClass += " local";
    const nlDatum = { nodeIdx: i, sku: nd.node.sku, online: nd.node.online, isLocal: nd.node.is_local };
    const nlText = state.g.append("text").attr("class", nlClass).style("pointer-events", "auto").datum(nlDatum);
    if (!nd.node.online && !nd.node.is_local) {
      nlText.style("cursor", "default").on("mousedown", function(event) {
        if (!event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        const d = d3.select(this).datum();
        if (d && state._flushNode) state._flushNode(d.sku);
      });
    }
    const nlTp = nlText.append("textPath").attr("href", "#" + pathId).attr("startOffset", "50%").attr("text-anchor", "middle").text(nodeLabel2);
    fitCurvedTitle(nlText.node(), nlTp.node(), nodeLabel2, nodeLabelR * arcSweep, nodeTitleSize(), "node-label");
    if (showAddresses() && nd.node.address) {
      const addrText = nd.node.address + (nd.node.port ? ":" + nd.node.port : "");
      const aSize = nodeAddrSize();
      const addrR = flip ? nodeLabelR + aSize * 1.7 : nodeLabelR + nodeTitleSize() * 1.05;
      const ax1 = Math.cos(sa) * addrR, ay1 = Math.sin(sa) * addrR;
      const ax2 = Math.cos(ea) * addrR, ay2 = Math.sin(ea) * addrR;
      const addrPathId = "addr-path-" + i;
      defs.append("path").attr("id", addrPathId).attr("d", "M " + ax1 + " " + ay1 + " A " + addrR + " " + addrR + " 0 " + largeArc + " " + sweepFlag + " " + ax2 + " " + ay2);
      const addrEl = state.g.append("text").attr("class", "node-addr" + (nd.node.online || nd.node.is_local ? "" : " offline"));
      const addrTp = addrEl.append("textPath").attr("href", "#" + addrPathId).attr("startOffset", "50%").attr("text-anchor", "middle").text(addrText);
      fitCurvedTitle(addrEl.node(), addrTp.node(), addrText, addrR * arcSweep, aSize, "node-addr");
      addrEl.append("title").text((nd.node.is_local ? "this host" : nd.node.label || nd.node.sku) + " \u2014 " + addrText + (nd.node.port ? " (mesh port)" : ""));
    }
    {
      let tip = nd.node.sku;
      if (nd.node.version) tip += "\nv" + nd.node.version;
      if (state.coreVersion && nd.node.is_local) tip += "\ncore v" + state.coreVersion;
      nlText.append("title").text(tip);
    }
    let hasAtelier = false;
    if (nd.node.params && nd.node.params.children) {
      for (let ci = 0; ci < nd.node.params.children.length; ci++) {
        if (nd.node.params.children[ci].name === "atelier") {
          hasAtelier = true;
          break;
        }
      }
    }
    if (hasAtelier) {
      const iconAngle = flip ? arcEnd + 0.03 : arcStart - 0.03;
      const iconR = nodeLabelR;
      const ix = Math.cos(iconAngle) * iconR;
      const iy = Math.sin(iconAngle) * iconR;
      const isEditing = state.editingSku === nd.node.sku;
      state.g.append("circle").attr("class", "atelier-icon" + (isEditing ? " editing" : "")).attr("cx", ix).attr("cy", iy).attr("r", 3.5).datum({ sku: nd.node.sku }).style("cursor", "pointer").on("mousedown", function(event) {
        event.preventDefault();
        event.stopPropagation();
        const d = d3.select(this).datum();
        if (d) openForNode(d.sku);
      });
      state.g.append("text").attr("class", "atelier-icon-label" + (isEditing ? " editing" : "")).attr("x", ix).attr("y", iy).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", "5px").style("pointer-events", "none").text("\u2726");
    }
    {
      const dashAngle = flip ? arcStart - 0.03 : arcEnd + 0.03;
      const dashR = nodeLabelR;
      const dx = Math.cos(dashAngle) * dashR;
      const dy = Math.sin(dashAngle) * dashR;
      const isOpen = isDashboardOpen(nd.node.sku);
      state.g.append("circle").attr("class", "dashboard-icon" + (isOpen ? " active" : "")).attr("cx", dx).attr("cy", dy).attr("r", 3.5).datum({ sku: nd.node.sku }).style("cursor", "pointer").on("mousedown", function(event) {
        event.preventDefault();
        event.stopPropagation();
        const d = d3.select(this).datum();
        if (d) toggleDashboard(d.sku);
      });
      state.g.append("text").attr("class", "dashboard-icon-label" + (isOpen ? " active" : "")).attr("x", dx).attr("y", dy).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", "5px").style("pointer-events", "none").text("L");
    }
  }
  setupHover(allParamData, nodeData);
  setupAddParam();
  setupGroupHover();
  state.g.selectAll(".collapsed-dot, .collapsed-hit").on("mousedown", function(event) {
    event.preventDefault();
    event.stopPropagation();
    const d = d3.select(this).datum();
    if (!d || !d.groupKey) return;
    state._animating = false;
    state._collapseAnim = capturePositions();
    delete state.collapsedGroups[d.groupKey];
    state.tempExpandedGroup = null;
    state.ringHover = null;
    render();
  });
  setupDragSubscribe(allParamData, nodeData);
  const paramLabelGroupEl = state.g.select(".param-labels");
  paramLabelGroupEl.style("display", "none");
  const bbox = state.g.node().getBBox();
  paramLabelGroupEl.style("display", null);
  const pad = VIEWBOX_PAD;
  const maxDim = Math.max(bbox.width, bbox.height);
  const bboxCx = bbox.x + bbox.width / 2;
  const bboxCy = bbox.y + bbox.height / 2;
  setBaseViewBox(
    bboxCx - maxDim / 2 - pad,
    bboxCy - maxDim / 2 - pad,
    maxDim + 2 * pad,
    maxDim + 2 * pad
  );
  if (state.rotationOffset) {
    state.g.attr("transform", "rotate(" + state.rotationOffset + ")");
  }
  reapplyHoverHighlights();
  state.hoveredSubLine = null;
  state.hoveredFlushEl = null;
  if (state.shiftHeld) {
    updateSubLineHighlight();
    if (state._reapplyFlush) state._reapplyFlush();
  }
  if (state._collapseAnim) {
    const animData = state._collapseAnim;
    state._collapseAnim = null;
    animateTransition(animData);
  }
  applyIdentify();
  decorateLabels();
  reapplySearchPing();
}
var IDENTIFY_MS = 2400;
var IDENTIFY_BLINK_MS = 400;
var identifyTimer = null;
function identifyNode(sku) {
  state.identifying[sku] = Date.now();
  applyIdentify();
}
function invertColor(c) {
  const rgb = c ? d3.color(c)?.rgb() : null;
  return rgb ? d3.rgb(255 - rgb.r, 255 - rgb.g, 255 - rgb.b).formatHex() : null;
}
function applyIdentify() {
  const now = Date.now();
  for (const sku of Object.keys(state.identifying)) {
    if (now - state.identifying[sku] >= IDENTIFY_MS) delete state.identifying[sku];
  }
  const active = Object.keys(state.identifying).length > 0;
  if (active && identifyTimer === null) {
    identifyTimer = window.setInterval(applyIdentify, 100);
  } else if (!active && identifyTimer !== null) {
    window.clearInterval(identifyTimer);
    identifyTimer = null;
  }
  if (!state.g) return;
  state.g.selectAll(".node-label").each(function(d) {
    const start = d ? state.identifying[d.sku] : void 0;
    const sel2 = d3.select(this).classed("node-identify", start !== void 0);
    if (start !== void 0) sel2.style("animation-delay", -(now - start) + "ms");
    else sel2.style("animation-delay", null);
  });
  state.g.selectAll(".node-arc").each(function() {
    const sku = this.getAttribute("data-sku");
    const start = sku ? state.identifying[sku] : void 0;
    const on = start !== void 0 && Math.floor((now - start) / IDENTIFY_BLINK_MS) % 2 === 0;
    const inverted = on ? invertColor(this.getAttribute("fill")) : null;
    const sel2 = d3.select(this);
    if (inverted) sel2.style("fill", inverted).style("opacity", "1");
    else sel2.style("fill", null).style("opacity", null);
  });
}
function animateTransition(oldState) {
  const dur = TRANSITION_DUR;
  state._animating = true;
  const allPd = state.allParamData;
  const ease = d3.easeCubicInOut;
  const newPosMap = {};
  for (let i = 0; i < allPd.length; i++) {
    const pd = allPd[i];
    newPosMap[pd.sku + "|" + pd.path] = { cx: pd.cx, cy: pd.cy };
  }
  const keepSecondary = !!state._animKeepSecondary;
  state._animKeepSecondary = false;
  const fadeItems = [];
  if (!keepSecondary) {
    state.g.selectAll(
      ".node-arc, .param-label:not(.collapsed-label), .node-label, .group-arc, .collapsed-stem, .collapsed-hit, .ground-tick, .source-dot, .add-param-btn, .add-param-label"
    ).each(function() {
      const el = d3.select(this);
      fadeItems.push({ el, op: el.attr("opacity") });
      el.attr("opacity", 0);
    });
    state.g.selectAll(".group-label").each(function(d) {
      if (!d) return;
      const el = d3.select(this);
      const sku = state.nodeData[d.nodeIdx].node.sku;
      const dotKey = sku + "|" + d.groupPath;
      if (oldState.dots[dotKey]) {
        el.attr("opacity", 0).transition().duration(dur).ease(ease).attr("opacity", null);
      }
    });
    state.g.selectAll(".collapsed-label").each(function(d) {
      if (!d || !d.groupKey) return;
      const el = d3.select(this);
      if (!oldState.dots[d.groupKey]) {
        el.attr("opacity", 0).transition().duration(dur).ease(ease).attr("opacity", null);
      }
    });
  }
  state.g.selectAll(".param-shape").each(function() {
    const el = d3.select(this);
    const d = d3.select(this).datum();
    if (!d || !allPd[d.paramIdx]) return;
    const pd = allPd[d.paramIdx];
    const key = pd.sku + "|" + pd.path;
    const old = oldState.params[key];
    if (!old) return;
    const tag = this.tagName.toLowerCase();
    if (tag === "circle") {
      el.attr("cx", old.cx).attr("cy", old.cy);
      const tr = el.transition().duration(dur).ease(ease).attr("cx", pd.cx).attr("cy", pd.cy);
      if (old.isCollapsed) {
        el.attr("opacity", 0);
        tr.attr("opacity", null);
      }
    } else {
      const oldDeg = old.angle * 180 / Math.PI;
      const newDeg = pd.angle * 180 / Math.PI;
      el.attr("transform", "translate(" + old.cx + "," + old.cy + ") rotate(" + oldDeg + ")");
      const tr = el.transition().duration(dur).ease(ease).attr("transform", "translate(" + pd.cx + "," + pd.cy + ") rotate(" + newDeg + ")");
      if (old.isCollapsed) {
        el.attr("opacity", 0);
        tr.attr("opacity", null);
      }
    }
  });
  state.g.selectAll(".collapsed-dot").each(function(d) {
    const el = d3.select(this);
    if (!d) return;
    const newCx = parseFloat(el.attr("cx"));
    const newCy = parseFloat(el.attr("cy"));
    const newR = parseFloat(el.attr("r"));
    const newOp = parseFloat(el.attr("opacity"));
    const oldDot = oldState.dots[d.groupKey];
    if (oldDot) {
      el.attr("cx", oldDot.cx).attr("cy", oldDot.cy).transition().duration(dur).ease(ease).attr("cx", newCx).attr("cy", newCy);
    } else {
      el.attr("r", 0).attr("opacity", 0).transition().duration(dur).ease(d3.easeBackOut).attr("r", newR).attr("opacity", newOp);
    }
  });
  state.g.selectAll(".sub-line").each(function(d) {
    const el = d3.select(this);
    if (!d) return;
    const srcKey = d.source_sku + "|" + d.source_path;
    const dstKey = d.dest_sku + "|" + d.dest_path;
    const oldSrc = oldState.params[srcKey];
    const oldDst = oldState.params[dstKey];
    const newSrc = newPosMap[srcKey];
    const newDst = newPosMap[dstKey];
    if (!oldSrc || !oldDst || !newSrc || !newDst) return;
    const oldD = connectionPath(oldSrc.cx, oldSrc.cy, oldDst.cx, oldDst.cy);
    const newD = connectionPath(newSrc.cx, newSrc.cy, newDst.cx, newDst.cy);
    el.attr("d", oldD).transition().duration(dur).ease(ease).attr("d", newD);
    const stroke = el.attr("stroke") || "";
    const gradMatch = stroke.match(/url\(#(conn-(?:thermal|grad-tri|grad-sine|grad-glow|grad)-\d+)\)/);
    if (gradMatch) {
      const grad = state.svg.select("#" + gradMatch[1]);
      if (!grad.empty()) {
        grad.attr("x1", oldSrc.cx).attr("y1", oldSrc.cy).attr("x2", oldDst.cx).attr("y2", oldDst.cy).transition().duration(dur).ease(ease).attr("x1", newSrc.cx).attr("y1", newSrc.cy).attr("x2", newDst.cx).attr("y2", newDst.cy);
      }
    }
  });
  state.g.selectAll(".sub-hit").each(function(d) {
    const el = d3.select(this);
    if (!d) return;
    const srcKey = d.source_sku + "|" + d.source_path;
    const dstKey = d.dest_sku + "|" + d.dest_path;
    const oldSrc = oldState.params[srcKey];
    const oldDst = oldState.params[dstKey];
    const newSrc = newPosMap[srcKey];
    const newDst = newPosMap[dstKey];
    if (!oldSrc || !oldDst || !newSrc || !newDst) return;
    const oldD = connectionPath(oldSrc.cx, oldSrc.cy, oldDst.cx, oldDst.cy);
    const newD = connectionPath(newSrc.cx, newSrc.cy, newDst.cx, newDst.cy);
    el.attr("d", oldD).transition().duration(dur).ease(ease).attr("d", newD);
  });
  for (const key in oldState.params) {
    const old = oldState.params[key];
    if (old.isCollapsed) continue;
    let target = null;
    for (let i = 0; i < allPd.length; i++) {
      if (allPd[i].sku + "|" + allPd[i].path === key && allPd[i].isCollapsed) {
        target = allPd[i];
        break;
      }
    }
    if (target) {
      state.g.append("circle").attr("class", "anim-ghost").attr("cx", old.cx).attr("cy", old.cy).attr("r", 3.5).attr("fill", "#555").attr("opacity", 0.6).style("pointer-events", "none").transition().duration(dur).ease(d3.easeCubicIn).attr("cx", target.cx).attr("cy", target.cy).attr("r", 1).attr("opacity", 0).remove();
    }
  }
  for (const key in oldState.dots) {
    let still = false;
    for (let i = 0; i < state.collapsedDots.length; i++) {
      if (state.collapsedDots[i].sku + "|" + state.collapsedDots[i].groupPath === key) {
        still = true;
        break;
      }
    }
    if (!still) {
      const od = oldState.dots[key];
      state.g.append("circle").attr("class", "anim-ghost").attr("cx", od.cx).attr("cy", od.cy).attr("r", 4.5).attr("fill", "#555").attr("opacity", 0.8).style("pointer-events", "none").transition().duration(dur * 0.7).ease(d3.easeCubicIn).attr("r", 0).attr("opacity", 0).remove();
    }
  }
  if (!keepSecondary) {
    const newDotKeys = {};
    for (let i = 0; i < state.collapsedDots.length; i++) {
      newDotKeys[state.collapsedDots[i].sku + "|" + state.collapsedDots[i].groupPath] = true;
    }
    for (const key in oldState.groupLabels) {
      if (newDotKeys[key]) {
        const gl = oldState.groupLabels[key];
        const fontSize = GROUP_FONT_SIZES[Math.min(gl.depth, 2)];
        const fill = GROUP_LABEL_FILLS[Math.min(gl.depth, 2)];
        state.g.append("text").attr("class", "anim-ghost").attr("x", gl.cx).attr("y", gl.cy).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("font-size", fontSize + "px").attr("fill", fill).attr("letter-spacing", "0.1em").attr("opacity", 1).style("pointer-events", "none").text(gl.text).transition().duration(dur * 0.7).ease(ease).attr("opacity", 0).remove();
      }
    }
    for (const key in oldState.collapsedLabels) {
      if (!newDotKeys[key]) {
        const cl = oldState.collapsedLabels[key];
        state.g.append("text").attr("class", "anim-ghost").attr("x", cl.x).attr("y", cl.y).attr("text-anchor", cl.anchor).attr("dominant-baseline", "middle").attr("transform", cl.transform).attr("font-size", "6px").attr("fill", "#777").attr("letter-spacing", "0.05em").attr("opacity", 1).style("pointer-events", "none").text(cl.text).transition().duration(dur * 0.7).ease(ease).attr("opacity", 0).remove();
      }
    }
  }
  if (!keepSecondary) {
    for (let i = 0; i < fadeItems.length; i++) {
      const fi = fadeItems[i];
      const tgt = fi.op != null ? parseFloat(fi.op) : 1;
      fi.el.transition().delay(dur * 0.5).duration(dur * 0.5).attr("opacity", tgt);
    }
  }
  setTimeout(function() {
    state._animating = false;
  }, dur + 150);
}

// ../../../../Projects/124_dataflou/web/src/debug.ts
var debugEl = null;
function initDebugOverlay() {
  debugEl = document.createElement("div");
  debugEl.id = "debug-overlay";
  document.body.appendChild(debugEl);
  debugEl.addEventListener("click", function(e) {
    if (!e.shiftKey) return;
    const row = e.target.closest("tr[data-sub]");
    if (!row) return;
    const sub = JSON.parse(row.dataset.sub);
    if (wsReady()) {
      unsubscribeLink({
        dest_sku: sub.dest_sku,
        dest_path: sub.dest_path,
        source_sku: sub.source_sku,
        source_path: sub.source_path
      });
    }
  });
}
function updateDebugOverlay() {
  if (!debugEl) return;
  if (!state.debugOverlay) {
    debugEl.style.display = "none";
    return;
  }
  debugEl.style.display = "block";
  const lookup = {};
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    const params = [];
    collectParamsWithAncestors(n.params, [], [], params, true);
    for (let j = 0; j < params.length; j++) {
      const key = n.sku + "|" + params[j].path;
      lookup[key] = {
        param: params[j].param,
        sku: n.sku,
        path: params[j].path,
        label: (n.label || n.sku) + "/" + params[j].path,
        nodeIdx: i
      };
    }
  }
  const nodeColors = {};
  for (let i = 0; i < state.nodes.length; i++) {
    nodeColors[state.nodes[i].sku] = PALETTE[i % PALETTE.length];
  }
  const groups = {};
  for (const key in lookup) {
    const entry = lookup[key];
    const p = entry.param;
    if (!p.subs || p.subs.length === 0) continue;
    for (let si = 0; si < p.subs.length; si++) {
      const sub = p.subs[si];
      const srcKey = sub.sku + "|" + sub.path;
      const srcEntry = lookup[srcKey];
      const srcVal = srcEntry ? formatParamValue(srcEntry.param) : "?";
      const srcLabel = srcEntry ? srcEntry.label : sub.sku + "/" + sub.path;
      const destNode = state.nodes[entry.nodeIdx];
      const destSku = entry.sku;
      if (!groups[destSku]) {
        groups[destSku] = {
          label: destNode ? destNode.label || destNode.sku : destSku,
          color: nodeColors[destSku] || "#888",
          rows: []
        };
      }
      groups[destSku].rows.push({
        srcLabel,
        srcVal,
        srcColor: nodeColors[sub.sku] || "#888",
        dstVal: formatParamValue(p),
        dstPath: entry.path,
        dstColor: groups[destSku].color,
        subData: {
          dest_sku: entry.sku,
          dest_path: entry.path,
          source_sku: sub.sku,
          source_path: sub.path
        }
      });
    }
  }
  const groupKeys = Object.keys(groups);
  if (groupKeys.length === 0) {
    debugEl.innerHTML = '<div style="color:#888">no subscriptions</div>';
    return;
  }
  let html = "";
  for (let gi = 0; gi < groupKeys.length; gi++) {
    const grp = groups[groupKeys[gi]];
    html += '<div class="dest-header" style="color:' + grp.color + '">' + esc(grp.label) + "</div>";
    html += '<table style="border-collapse:collapse;width:100%">';
    for (let r = 0; r < grp.rows.length; r++) {
      const row = grp.rows[r];
      const match = row.srcVal === row.dstVal;
      const dstValColor = row.dstVal === "" || row.dstVal === "?" ? "#f55" : match ? "#4a9" : "#fa0";
      html += "<tr data-sub='" + esc(JSON.stringify(row.subData)) + `' style="position:relative"><td style="padding:2px 6px"><span class="src-swatch" style="background:` + row.srcColor + '"></span>' + esc(row.srcLabel) + '</td><td style="padding:2px 4px;text-align:right;color:#8cf">' + (row.srcVal || "-") + '</td><td style="padding:2px 4px;text-align:center;color:#555">&rarr;</td><td style="padding:2px 4px;text-align:right;color:' + dstValColor + '">' + (row.dstVal || "-") + '</td><td style="padding:2px 6px">' + esc(row.dstPath) + '</td><td style="width:4px;padding:0"><div class="dst-band" style="background:' + row.dstColor + '"></div></td></tr>';
    }
    html += "</table>";
  }
  debugEl.innerHTML = html;
}

// ../../../../Projects/124_dataflou/web/src/universe.ts
var RECENT_KEY = "dataflou.universes";
var RECENT_MAX = 8;
function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch (_) {
    return [];
  }
}
function remember(name) {
  if (isOutputWindow()) return;
  const list = [name, ...loadRecent().filter((s) => s !== name)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (_) {
  }
}
function showUniverse(name) {
  if (state.universe !== name) remember(name);
  state.universe = name;
  const el = document.getElementById("universe");
  if (el && !el.querySelector("input")) el.textContent = "universe: " + name;
}
function startEditing(el) {
  if (el.querySelector("input")) return;
  const input2 = document.createElement("input");
  input2.type = "text";
  input2.maxLength = 32;
  input2.spellcheck = false;
  input2.value = state.universe || "";
  input2.setAttribute("list", "universe-list");
  const list = document.createElement("datalist");
  list.id = "universe-list";
  const names = ["default", ...loadRecent()].filter((s, i, a) => a.indexOf(s) === i);
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    list.appendChild(opt);
  }
  el.textContent = "universe: ";
  el.appendChild(input2);
  el.appendChild(list);
  input2.focus();
  input2.select();
  let done = false;
  function finish(apply2) {
    if (done) return;
    done = true;
    const name = input2.value.trim();
    el.textContent = "universe: " + (state.universe || "");
    if (apply2 && name && name !== state.universe && wsReady())
      state.ws.send(JSON.stringify({ type: MSG_SET_UNIVERSE, universe: name }));
  }
  input2.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input2.addEventListener("keyup", (e) => e.stopPropagation());
  input2.addEventListener("blur", () => finish(false));
  input2.addEventListener("click", (e) => e.stopPropagation());
}
function initUniverseSelector() {
  const el = document.getElementById("universe");
  if (el) el.addEventListener("click", () => startEditing(el));
}

// ../../../../Projects/124_dataflou/web/src/host.ts
var LOOPBACK = /^(localhost|127\.|\[?::1\]?$)/;
var shown = "";
function pagePort() {
  return location.port || (location.protocol === "https:" ? "443" : "80");
}
function showHostAddress(ips) {
  const el = document.getElementById("host-ip");
  if (!el) return;
  let list = ips && ips.length ? ips : [];
  if (!list.length && !LOOPBACK.test(location.hostname)) list = [location.hostname];
  const key = list.join(",");
  if (key === shown) return;
  shown = key;
  if (!list.length) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  const port = pagePort();
  el.textContent = "host: " + list[0] + ":" + port;
  el.dataset.url = location.protocol + "//" + list[0] + ":" + port + "/";
  el.title = "Address of the computer hosting this visualizer: open it from another computer on the network. Click to copy the link." + (list.length > 1 ? "\nOther addresses: " + list.slice(1).join(", ") : "");
}
function copy(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}
function initHostAddress() {
  const el = document.getElementById("host-ip");
  if (!el) return;
  el.addEventListener("click", function() {
    const url = el.dataset.url;
    if (!url) return;
    const label = el.textContent;
    copy(url).then(
      function() {
        el.textContent = "copied " + url;
      },
      function() {
        el.textContent = url;
      }
    ).then(function() {
      setTimeout(function() {
        el.textContent = label;
      }, 1500);
    });
  });
}

// ../../../../Projects/124_dataflou/web/src/dialog.ts
function confirmDialog(message, okLabel, onConfirm) {
  const backdrop = document.createElement("div");
  backdrop.className = "confirm-backdrop";
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  const msg = document.createElement("div");
  msg.className = "confirm-msg";
  msg.textContent = message;
  dialog.appendChild(msg);
  const btns = document.createElement("div");
  btns.className = "confirm-btns";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "confirm-cancel";
  cancelBtn.textContent = "Cancel";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "confirm-ok";
  confirmBtn.textContent = okLabel;
  btns.appendChild(cancelBtn);
  btns.appendChild(confirmBtn);
  dialog.appendChild(btns);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  confirmBtn.focus();
  function close2() {
    document.removeEventListener("keydown", onKey);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }
  function onKey(e) {
    if (e.key === "Escape") close2();
    else if (e.key === "Enter") {
      e.preventDefault();
      close2();
      onConfirm();
    }
  }
  cancelBtn.addEventListener("click", close2);
  confirmBtn.addEventListener("click", function() {
    close2();
    onConfirm();
  });
  backdrop.addEventListener("click", function(e) {
    if (e.target === backdrop) close2();
  });
  document.addEventListener("keydown", onKey);
}

// ../../../../Projects/124_dataflou/web/src/scenes.ts
var SLOTS = 16;
var tabEl = null;
var panelEl2 = null;
var storeMode = false;
var drawn = "";
function esc2(s) {
  return s.replace(/[&<>"]/g, function(c) {
    return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
  });
}
function nodeLabel(n) {
  return n.label || n.sku.slice(0, 8);
}
function currentSlot() {
  const local = state.nodes.find(function(n) {
    return n.is_local;
  });
  return local && local.scene ? local.scene.current : 0;
}
function send(op, slot) {
  if (!wsReady()) {
    notify("Not connected", void 0, "error");
    return;
  }
  state.ws.send(JSON.stringify({ type: MSG_SCENE, op, slot }));
}
function setStoreMode(on) {
  storeMode = on;
  drawn = "";
  draw2();
}
function askStore(slot) {
  const online = state.nodes.filter(function(n) {
    return n.online && n.scene;
  }).length;
  confirmDialog("Store scene " + slot + ": each of the " + online + " online node" + (online === 1 ? "" : "s") + " replaces its slot " + slot + " with its current connections.", "Store", function() {
    send("store", slot);
    setStoreMode(false);
  });
}
function onSlot(slot) {
  if (storeMode) askStore(slot);
  else send("recall", slot);
}
function nodeLine(n, cur) {
  const label = nodeLabel(n);
  if (!n.scene) return n.online ? { label, text: "no scenes (older node)", cls: "old" } : null;
  const s = n.scene;
  const parts = [];
  let cls = s.state;
  if (cur && s.current !== cur) {
    parts.push(s.current ? "on scene " + s.current : "no cue yet");
    cls = "behind";
  } else if (s.state !== "applied") parts.push(s.state);
  if (s.skipped) parts.push(s.skipped + " skipped");
  if (!n.online) {
    parts.push("offline");
    cls += " offline";
  }
  if (!parts.length) return null;
  return { label, text: parts.join(" \xB7 "), cls };
}
function draw2() {
  if (!panelEl2 || !tabEl) return;
  const cur = currentSlot();
  tabEl.textContent = (cur ? "scene " + cur : "scenes") + (panelEl2.style.display === "none" ? " \u25B4" : " \u25BE");
  if (panelEl2.style.display === "none") return;
  const nodes = state.nodes.filter(function(n) {
    return n.scene || n.online;
  }).sort(compareNodes);
  const holders = [];
  for (let i = 0; i < SLOTS; i++) holders.push([]);
  const counts = { none: 0, applied: 0, modified: 0, missing: 0 };
  const lines = [];
  let skipped = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.scene) {
      for (let k = 0; k < n.scene.slots.length; k++) {
        const slot = n.scene.slots[k];
        if (slot >= 1 && slot <= SLOTS) holders[slot - 1].push(nodeLabel(n));
      }
      if (n.online) counts[n.scene.state]++;
      skipped += n.scene.skipped;
    }
    const l = nodeLine(n, cur);
    if (l) lines.push(l);
  }
  const key = JSON.stringify([cur, storeMode, holders, counts, lines, nodes.length]);
  if (key === drawn) return;
  drawn = key;
  let sum = "";
  if (cur) {
    const bits = [];
    if (counts.applied) bits.push(counts.applied + " applied");
    if (counts.modified) bits.push(counts.modified + " modified");
    if (counts.missing) bits.push(counts.missing + " missing");
    if (skipped) bits.push(skipped + " skipped");
    sum = bits.join(" \xB7 ");
  } else {
    sum = "no scene recalled in this universe yet";
  }
  let grid = "";
  for (let i = 0; i < SLOTS; i++) {
    const slot = i + 1;
    const h = holders[i];
    const cls = "sc-slot" + (h.length ? " held" : "") + (slot === cur ? " current" : "");
    const title = (storeMode ? "Store scene " + slot : "Recall scene " + slot) + "\n" + (h.length ? "Held by: " + h.join(", ") : "No node holds it yet");
    grid += '<button type="button" class="' + cls + '" data-slot="' + slot + '" title="' + esc2(title) + '"><b>' + slot + "</b><small>" + (h.length ? h.length + "/" + nodes.length : "\xB7") + "</small></button>";
  }
  let list = "";
  for (let i = 0; i < lines.length; i++) {
    list += '<div class="sc-node sc-st-' + lines[i].cls.split(" ").join(" sc-st-") + '"><span>' + esc2(lines[i].label) + "</span><span>" + esc2(lines[i].text) + "</span></div>";
  }
  panelEl2.classList.toggle("store-mode", storeMode);
  panelEl2.innerHTML = '<div class="sc-head"><span class="sc-title">' + (cur ? "scene " + cur : "scenes") + '</span><button type="button" class="sc-store" title="Each online node saves its current connections into the slot you pick">' + (storeMode ? "cancel" : "store\u2026") + '</button></div><div class="sc-sum">' + esc2(sum) + '</div><div class="sc-grid">' + grid + '</div><div class="sc-nodes">' + (list || '<div class="sc-node sc-st-ok"><span>' + (cur ? "every node applied scene " + cur : "") + "</span></div>") + '</div><div class="sc-hint">' + (storeMode ? "pick the slot to store into \xB7 Esc cancels" : "click a slot to recall it on every node \xB7 each node applies its own connections") + "</div>";
}
function updateScenes() {
  draw2();
}
function onSceneMessage(m) {
  if (m.op === "recall") {
    notify("Scene " + m.slot + " recalled" + (m.state === "missing" ? " (no slot on this node)" : m.skipped ? " (" + m.skipped + " skipped here)" : ""));
  } else if (m.op === "store") {
    notify("Scene " + m.slot + " stored");
  }
}
function initScenes() {
  if (isOutputWindow()) return;
  const tab = document.createElement("button");
  tab.id = "scenes-tab";
  tab.type = "button";
  tab.title = "Scenes: recall or store the connections of every node";
  document.body.appendChild(tab);
  const panel = document.createElement("div");
  panel.id = "scenes-panel";
  panel.style.display = "none";
  document.body.appendChild(panel);
  tabEl = tab;
  panelEl2 = panel;
  tab.addEventListener("click", function() {
    const open2 = panel.style.display === "none";
    panel.style.display = open2 ? "" : "none";
    tab.classList.toggle("open", open2);
    if (!open2) storeMode = false;
    drawn = "";
    draw2();
    refreshGlass();
    tab.blur();
  });
  panel.addEventListener("click", function(e) {
    const el = e.target.closest("button");
    if (!el) return;
    if (el.classList.contains("sc-store")) setStoreMode(!storeMode);
    else if (el.dataset.slot) onSlot(Number(el.dataset.slot));
    el.blur();
  });
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && storeMode && !document.querySelector(".confirm-backdrop")) setStoreMode(false);
  });
  draw2();
}

// ../../../../Projects/124_dataflou/web/src/ws.ts
var wsSnapCount = 0;
var wsRateTimer = 0;
function startWsRateTracking() {
  if (wsRateTimer) return;
  wsRateTimer = window.setInterval(function() {
    state.wsRate = wsSnapCount;
    wsSnapCount = 0;
  }, 1e3);
}
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(proto + "//" + location.host + "/ws");
  state.ws.onopen = function() {
    if (state.wasConnected) {
      location.reload();
      return;
    }
    state.wasConnected = true;
    state.statusEl.firstChild.textContent = "connected ";
    state.statusEl.className = "connected";
    onConnected();
  };
  state.ws.onclose = function() {
    state.statusEl.firstChild.textContent = "disconnected \u2014 reconnecting... ";
    state.statusEl.className = "error";
    onDisconnected();
    setTimeout(connect, 2e3);
  };
  state.ws.onerror = function() {
    state.statusEl.firstChild.textContent = "connection error ";
    state.statusEl.className = "error";
  };
  state.ws.onmessage = function(e) {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    if (msg.type && msg.type.startsWith("atelier.")) {
      handleAtelierMessage(msg);
      return;
    }
    if (msg.type === "reload") {
      location.reload();
      return;
    }
    if (msg.type === MSG_SNAPSHOT) {
      wsSnapCount++;
      startWsRateTracking();
      const oldMap = buildValueMap(state.nodes);
      state.nodes = msg.nodes || [];
      const newMap = buildValueMap(state.nodes);
      state.changedParams = findChangedParams(oldMap, newMap);
      if (msg.core_version) state.coreVersion = msg.core_version;
      if (typeof msg.perf_mode === "boolean") showPerfMode(msg.perf_mode);
      if (typeof msg.universe === "string") showUniverse(msg.universe);
      showHostAddress(Array.isArray(msg.host_ips) ? msg.host_ips : null);
      if (msg.atelier_version) state.atelierVersion = msg.atelier_version;
      if (msg.clients !== void 0) {
        const verEl2 = document.getElementById("ver");
        if (verEl2) {
          let ver = "web v" + VERSION;
          if (state.coreVersion) ver += " \xB7 core v" + state.coreVersion;
          if (state.atelierVersion) ver += " \xB7 atelier v" + state.atelierVersion;
          ver += " \xB7 " + msg.clients + " ws";
          verEl2.textContent = ver;
        }
      }
      checkPendingSubscriptions();
      render();
      updateDebugOverlay();
      checkEditingParam();
      updateDashboardValues();
      updateToggleVisibility();
      updateScenes();
    } else if (msg.type === MSG_PERF_MODE) {
      showPerfMode(msg.enabled === true);
    } else if (msg.type === MSG_UNIVERSE) {
      if (typeof msg.universe === "string") showUniverse(msg.universe);
    } else if (msg.type === MSG_SCENE) {
      onSceneMessage(msg);
    } else if (msg.type === MSG_IDENTIFY) {
      identifyNode(msg.sku);
    } else if (msg.type === MSG_TOAST) {
      showToast({ clientX: window.innerWidth / 2, clientY: 60 }, msg.msg || "Error");
    }
  };
}
var PENDING_GIVE_UP_MS = 15e3;
function checkPendingSubscriptions() {
  if (state.pendingSubscriptions.length === 0) return;
  const now = Date.now();
  const remaining = [];
  const existingSubs = {};
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    const params = [];
    collectParamsWithAncestors(n.params, [], [], params, true);
    for (let j = 0; j < params.length; j++) {
      const p = params[j].param;
      const pSubs = p.subs;
      if (!pSubs) continue;
      for (let si = 0; si < pSubs.length; si++) {
        const s = pSubs[si];
        const key = n.sku + "|" + params[j].path + ">" + s.sku + "|" + s.path;
        existingSubs[key] = true;
      }
    }
  }
  for (let i = 0; i < state.pendingSubscriptions.length; i++) {
    const pending = state.pendingSubscriptions[i];
    const subKey = pending.dest_sku + "|" + pending.dest_path + ">" + pending.source_sku + "|" + pending.source_path;
    if (existingSubs[subKey]) {
      continue;
    }
    if (now - pending.time > PENDING_GIVE_UP_MS) {
      const dest = state.nodes.find(function(n) {
        return n.sku === pending.dest_sku;
      });
      const who = dest ? dest.label || dest.sku : "the instrument";
      showToast(
        { clientX: pending.clientX, clientY: pending.clientY },
        dest && !dest.online ? who + " is offline: link not made" : who + " did not confirm the link (no answer)"
      );
      continue;
    }
    remaining.push(pending);
  }
  state.pendingSubscriptions = remaining;
}
function showPerfMode(enabled) {
  state.perfMode = enabled;
  const el = document.getElementById("perf-toggle");
  if (!el) return;
  el.textContent = enabled ? "high performance: on \u2014 values paused" : "high performance: off";
  el.classList.toggle("active", enabled);
}
function requestPerfMode(enabled) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify({ type: MSG_PERF_MODE, enabled }));
}

// ../../../../Projects/124_dataflou/web/src/main.ts
setup();
initDebugOverlay();
initTooltipEditor();
initDashboard();
initUniverseSelector();
initHostAddress();
initEditor();
initDisplay();
initSearch();
initHistory();
initScenes();
var fpsEl = document.createElement("span");
fpsEl.id = "fps-indicator";
var verEl = document.getElementById("ver");
if (verEl && verEl.parentNode) {
  verEl.parentNode.insertBefore(fpsEl, verEl);
}
var fpsFrames = 0;
var fpsLast = performance.now();
(function fpsLoop() {
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 1e3) {
    state.fps = fpsFrames;
    fpsFrames = 0;
    fpsLast = now;
    fpsEl.textContent = state.fps + " fps \xB7 " + state.wsRate + " ws/s \xB7 ";
  }
  requestAnimationFrame(fpsLoop);
})();
function clearFlushHighlight() {
  if (state.hoveredFlushSku) {
    if (state.hoveredFlushEl) {
      d3.select(state.hoveredFlushEl).style("fill", null).style("cursor", null);
    }
    state.hoveredFlushSku = null;
    state.hoveredFlushEl = null;
  }
}
function applyFlushHighlight(el) {
  d3.select(el).style("fill", C_RED).style("cursor", "pointer");
  state.hoveredFlushEl = el;
}
function updateFlushHighlight() {
  if (!state.g) return;
  const pt = state.svg.node().createSVGPoint();
  pt.x = state.lastMouseClient.x;
  pt.y = state.lastMouseClient.y;
  const svgPt = pt.matrixTransform(state.g.node().getScreenCTM().inverse());
  let nearestSku = null;
  let nearestEl = null;
  let nearestDist = Infinity;
  state.g.selectAll(".node-label").each(function() {
    const d = d3.select(this).datum();
    if (!d || d.online || d.isLocal) return;
    const bbox = this.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const dx = svgPt.x - cx, dy = svgPt.y - cy;
    if (svgPt.x >= bbox.x - 8 && svgPt.x <= bbox.x + bbox.width + 8 && svgPt.y >= bbox.y - 8 && svgPt.y <= bbox.y + bbox.height + 8) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestSku = d.sku;
        nearestEl = this;
      }
    }
  });
  if (nearestSku !== state.hoveredFlushSku) {
    clearFlushHighlight();
    if (nearestSku) {
      state.hoveredFlushSku = nearestSku;
      applyFlushHighlight(nearestEl);
    }
  }
}
function reapplyFlushHighlight() {
  if (!state.hoveredFlushSku || !state.shiftHeld) return;
  state.hoveredFlushEl = null;
  state.g.selectAll(".node-label").each(function() {
    const d = d3.select(this).datum();
    if (d && d.sku === state.hoveredFlushSku) {
      applyFlushHighlight(this);
    }
  });
}
state._reapplyFlush = reapplyFlushHighlight;
state._flushNode = function(sku) {
  clearFlushHighlight();
  confirmDialog("Flush node \u201C" + sku + "\u201D from world?", "Flush", function() {
    if (wsReady()) {
      state.ws.send(JSON.stringify({ type: MSG_FLUSH, sku }));
    }
  });
};
document.addEventListener("mousemove", function(event) {
  state.lastMouseClient.x = event.clientX;
  state.lastMouseClient.y = event.clientY;
  if (!event.shiftKey || !(event.target instanceof Element && event.target.closest("#vis"))) {
    clearSubLineHighlight();
    clearFlushHighlight();
    return;
  }
  updateSubLineHighlight();
  updateFlushHighlight();
});
document.addEventListener("click", function(event) {
  if (!event.shiftKey) return;
  if (!(event.target instanceof Element && event.target.closest("#vis"))) return;
  if (state.hoveredSubLine) {
    const data = d3.select(state.hoveredSubLine).datum();
    if (data && wsReady()) {
      unsubscribeLink({
        dest_sku: data.dest_sku,
        dest_path: data.dest_path,
        source_sku: data.source_sku,
        source_path: data.source_path
      });
    }
    clearSubLineHighlight();
  }
});
document.addEventListener("keydown", function(event) {
  if (event.key === "Shift") {
    state.shiftHeld = true;
    const under = document.elementFromPoint(state.lastMouseClient.x, state.lastMouseClient.y);
    if (!under || !under.closest("#vis")) return;
    updateSubLineHighlight();
    updateFlushHighlight();
  }
});
document.addEventListener("keyup", function(event) {
  if (isOutputWindow()) return;
  if (isTyping(event) && event.key !== "Shift") return;
  if (event.key === "Shift") {
    state.shiftHeld = false;
    clearSubLineHighlight();
    clearFlushHighlight();
  }
  if (event.key === "g" || event.key === "G") {
    state.debugOverlay = !state.debugOverlay;
    updateDebugOverlay();
  }
  if (event.key === "m" || event.key === "M") {
    state.drawModeOffset = (state.drawModeOffset + 1) % 5;
    if (state._render) state._render();
  }
  if (event.key === "p" || event.key === "P") {
    requestPerfMode(!state.perfMode);
  }
  if (event.key === "d" || event.key === "D") {
    state.graphiteMode = !state.graphiteMode;
    document.body.classList.toggle("graphite", state.graphiteMode);
    if (state._render) state._render();
  }
});
document.getElementById("perf-toggle")?.addEventListener("click", () => {
  requestPerfMode(!state.perfMode);
});
connect();
