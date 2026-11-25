// ../../../../Projects/124_dataflou/web/src/state.ts
var VERSION = "66";
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
  lastStructureKey: "",
  flashFlip: false,
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
  openGroups: [],
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

// ../../../../Projects/124_dataflou/web/src/okcolor.ts
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function fromLinear(c) {
  return c <= 31308e-7 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function rgbToOklab(r, g, b) {
  const lr = toLinear(r / 255), lg = toLinear(g / 255), lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}
function oklabToLinear(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}
function css(linear) {
  return "#" + linear.map((v) => {
    const c = Math.round(255 * Math.min(1, Math.max(0, fromLinear(v))));
    return (c < 16 ? "0" : "") + c.toString(16);
  }).join("");
}
function oklab(L, a, b) {
  return css(oklabToLinear(L, a, b));
}
function oklch(L, C, hue) {
  const h = hue * Math.PI / 180;
  const inside = (c2) => oklabToLinear(L, c2 * Math.cos(h), c2 * Math.sin(h)).every((v) => v >= -5e-4 && v <= 1.0005);
  let c = C;
  if (!inside(c)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 18; i++) {
      c = (lo + hi) / 2;
      if (inside(c)) lo = c;
      else hi = c;
    }
    c = lo;
  }
  return oklab(L, c * Math.cos(h), c * Math.sin(h));
}
function okMix(from, to, t) {
  const a = rgbToOklab(from[0], from[1], from[2]);
  const b = rgbToOklab(to[0], to[1], to[2]);
  return oklab(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
function okIndexColor(index) {
  return oklch(0.74, 0.14, (250 + index * 137.508) % 360);
}

// ../../../../Projects/124_dataflou/web/src/poly.ts
function polyGroups(nodes) {
  const out = {};
  const walk = function(node, sku, path) {
    if (node.kind !== "group" || !node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.kind !== "group") continue;
      const childPath = path ? path + "/" + child.name : child.name;
      if (child.slots && child.slots > 0) {
        out[sku + "|" + childPath] = { path: childPath, slots: child.slots, taken: takenSlots(child) };
      } else {
        walk(child, sku, childPath);
      }
    }
  };
  for (let i = 0; i < nodes.length; i++) walk(nodes[i].params, nodes[i].sku, "");
  return out;
}
function takenSlots(group) {
  const taken = [];
  const slots = group.children || [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.kind !== "group" || !slot.children) continue;
    for (let j = 0; j < slot.children.length; j++) {
      const p = slot.children[j];
      if (p.kind === "param" && isGate(p) && (p.value === true || p.value === 1)) {
        taken.push(parseInt(slot.name, 10));
        break;
      }
    }
  }
  return taken;
}
function isGate(p) {
  if (p.role) return p.role === "gate";
  return p.name === "on" && (p.type === void 0 || p.type === "bool");
}
function polyPlace(groups, sku, path) {
  const segs = path.split("/");
  for (let i = segs.length - 2; i >= 1; i--) {
    const key2 = sku + "|" + segs.slice(0, i).join("/");
    if (groups[key2]) return { group: groups[key2], key: key2, slot: parseInt(segs[i], 10) };
  }
  return null;
}
function polyCount(group) {
  return takenSlots(group).length + "/" + (group.slots || 0);
}

// ../../../../Projects/124_dataflou/web/src/util.ts
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

// ../../../../Projects/124_dataflou/web/src/arrays.ts
var STRIP_CELLS = 16;
var LIST_EDIT_MAX = 32;
var BARS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
function isArray(p) {
  return !!p && p.type === "array";
}
function elemType(p) {
  return p.of || "float";
}
function arraySize(p) {
  if (typeof p.size === "number") return p.size;
  return Array.isArray(p.value) ? p.value.length : 0;
}
function arrayShape(p) {
  return arraySize(p) + "\xD7" + elemType(p);
}
function arrayElems(p) {
  return Array.isArray(p.value) ? p.value : [];
}
function elemRange(p) {
  const of = elemType(p);
  let lo = 0, hi = of === "byte" ? 255 : of === "int" ? 127 : 1;
  if (p.range && typeof p.range.min === "number") lo = p.range.min;
  if (p.range && typeof p.range.max === "number") hi = p.range.max;
  return [lo, hi];
}
function elemLevel(p, v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const c = hexRgba(v);
    return c ? Math.max(c[0], c[1], c[2]) / 255 : 0;
  }
  if (typeof v !== "number" || isNaN(v)) return 0;
  const [lo, hi] = elemRange(p);
  if (hi === lo) return 0;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}
function hexRgba(s) {
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  const h = s.slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255
  ];
}
function hex2(n) {
  const k = Math.max(0, Math.min(255, Math.round(n)));
  return (k < 16 ? "0" : "") + k.toString(16).toUpperCase();
}
function rgbaHex(c) {
  return "#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) + hex2(c[3] === void 0 ? 255 : c[3]);
}
function stripCells(p, max = STRIP_CELLS) {
  const v = arrayElems(p);
  if (v.length <= max) return v;
  const out = [];
  for (let c = 0; c < max; c++) {
    const a = Math.floor(c * v.length / max), b = Math.floor((c + 1) * v.length / max);
    let best = v[a], bestLevel = elemLevel(p, best);
    for (let i = a + 1; i < b; i++) {
      const l = elemLevel(p, v[i]);
      if (l > bestLevel) {
        best = v[i];
        bestLevel = l;
      }
    }
    out.push(best);
  }
  return out;
}
function cellChar(p, v) {
  const of = elemType(p);
  if (of === "bool") return v ? "\u25CF" : "\u25CB";
  if (of === "colour") return "\u25A0";
  return BARS.charAt(Math.min(BARS.length - 1, Math.floor(elemLevel(p, v) * BARS.length)));
}
function arrayText(p) {
  const cells = stripCells(p);
  if (!cells.length) return arrayShape(p);
  return arrayShape(p) + " " + cells.map(function(v) {
    return cellChar(p, v);
  }).join("");
}
function colourCells(p) {
  if (elemType(p) !== "colour") return null;
  return stripCells(p).map(function(v) {
    return typeof v === "string" ? v.substring(0, 7) : "#000000";
  });
}
function stripHtml(p, selected = -1, max = 64) {
  const v = arrayElems(p);
  const cells = stripCells(p, max);
  const one = cells.length === v.length;
  const of = elemType(p);
  let h = '<span class="arr-strip arr-' + escAttr(of) + '">';
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const attr = (one ? ' data-elem="' + i + '"' : "") + ' title="' + (one ? String(i + 1) + ": " + escAttr(elemText(p, c)) : "") + '"' + (one && i === selected ? ' data-sel="1"' : "");
    if (of === "colour") {
      const col = typeof c === "string" ? c.substring(0, 7) : "#000000";
      h += '<span class="arr-cell arr-swatch"' + attr + ' style="background:' + escAttr(col) + '"></span>';
    } else if (of === "bool") {
      h += '<span class="arr-cell arr-dot' + (c ? " on" : "") + '"' + attr + "></span>";
    } else {
      const pct = Math.round(elemLevel(p, c) * 100);
      h += '<span class="arr-cell arr-bar"' + attr + '><span style="height:' + Math.max(pct, 4) + '%"></span></span>';
    }
  }
  return h + "</span>";
}
function elemText(p, v) {
  if (v === void 0 || v === null) return "";
  if (typeof v === "number") {
    const of = elemType(p);
    return of === "float" ? String(Number(v.toFixed(4))) : String(Math.round(v));
  }
  return String(v);
}
function listText(p) {
  return arrayElems(p).map(function(v) {
    return typeof v === "boolean" ? v ? "1" : "0" : elemText(p, v);
  }).join(", ");
}
function parseList(p, text) {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return null;
  const of = elemType(p);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (of === "bool") {
      if (/^(true|on|1|yes)$/i.test(s)) out.push(true);
      else if (/^(false|off|0|no)$/i.test(s)) out.push(false);
      else return null;
    } else if (of === "colour") {
      const c = hexRgba(s.charAt(0) === "#" ? s : "#" + s);
      if (!c) return null;
      out.push(rgbaHex(c));
    } else {
      const n = parseFloat(s);
      if (isNaN(n)) return null;
      out.push(of === "float" ? n : Math.round(n));
    }
  }
  return out.slice(0, Math.max(1, arraySize(p)));
}
function elemDefault(p) {
  const of = elemType(p);
  if (of === "bool") return false;
  if (of === "colour") return "#000000FF";
  return elemRange(p)[0];
}
function elemScalarType(p) {
  const of = elemType(p);
  return of === "bool" || of === "colour" ? of : "number";
}
function splitElement(path) {
  const m = /^(.+)\/([1-9][0-9]*)$/.exec(path);
  return m ? { parent: m[1], n: parseInt(m[2], 10) } : null;
}
function elementOf(root2, path) {
  const e = splitElement(path);
  if (!e || !root2) return null;
  let node = root2;
  const segs = e.parent.split("/").filter(Boolean);
  for (let i = 0; i < segs.length && node; i++) {
    if (node.kind !== "group" || !node.children) return null;
    const seg = segs[i];
    node = node.children.find(function(c) {
      return (c.name || c.label) === seg;
    });
  }
  if (!node || node.kind !== "param" || node.type !== "array") return null;
  if (typeof node.size === "number" && e.n > node.size) return null;
  return { array: node, parent: e.parent, n: e.n };
}
function drawnSourceKey(d) {
  if (splitElement(d.source_path)) {
    const n = state.nodes.find(function(x) {
      return x.sku === d.source_sku;
    });
    const e = n ? elementOf(n.params, d.source_path) : null;
    if (e) return d.source_sku + "|" + e.parent;
  }
  return d.source_sku + "|" + d.source_path;
}
function elementIndex(lookup, sku, path, paramAt) {
  const e = splitElement(path);
  if (!e) return null;
  const idx = lookup[sku + "|" + e.parent];
  if (idx === void 0 || !isArray(paramAt(idx))) return null;
  return { idx, n: e.n };
}

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
      const key2 = n.sku + "|" + params[j].path;
      map[key2] = params[j].param.value;
    }
  }
  return map;
}
function findChangedParams(oldMap, newMap) {
  const changed2 = {};
  for (const key2 in newMap) {
    if (!(key2 in oldMap)) continue;
    if (JSON.stringify(oldMap[key2]) !== JSON.stringify(newMap[key2])) {
      changed2[key2] = true;
    }
  }
  return changed2;
}
function formatParamValue(p) {
  if (p.type === "array") return arrayText(p);
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
        innerPaths,
        polyCount: pnode.slots ? polyCount(pnode) : void 0
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
function collectInnerLeaves(groupNode, groupPath, params, paths2) {
  if (!groupNode.children) return;
  for (let i = 0; i < groupNode.children.length; i++) {
    const child = groupNode.children[i];
    if (child.kind === "param") {
      paths2.push(groupPath + "/" + (child.name || child.label));
      params.push(child);
    } else if (child.kind === "group") {
      collectInnerLeaves(child, groupPath + "/" + (child.name || child.label), params, paths2);
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
  activeOver: 16,
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
  let css2 = "";
  const fam = s.font === "default" ? null : "'" + s.font + "', 'SF Mono', 'Fira Code', monospace";
  if (fam) css2 += "body, .param-tooltip, #vis svg text { font-family: " + fam + "; }\n";
  css2 += "#vis svg text { font-weight: " + s.weight + "; }\n";
  css2 += "#vis .node-label { font-size: " + nodeTitleSize() + "px; }\n";
  css2 += "#vis .node-addr { font-size: " + nodeAddrSize() + "px; }\n";
  css2 += "#vis .group-label { font-size: " + groupTitleSize(0) + "px; }\n";
  css2 += "#vis .group-label.depth-1 { font-size: " + groupTitleSize(1) + "px; }\n";
  css2 += "#vis .group-label.depth-2 { font-size: " + groupTitleSize(2) + "px; }\n";
  css2 += "#vis .param-label { font-size: " + 6 * pk + "px; }\n";
  css2 += "#vis .group-arc { stroke-width: " + s.lineScale + "; }\n";
  css2 += "#vis .collapsed-stem { stroke-width: " + 0.8 * s.lineScale + "; }\n";
  css2 += "#vis { --conn-w: " + (s.connScale > 0 ? s.connScale : 1) + "; }\n";
  const t = THEMES[s.theme];
  if (t) {
    css2 += "body { background: rgb(" + t.bg + "); color: rgb(" + t.text + "); }\n";
    css2 += "#status { color: rgb(" + t.muted + "); }\n";
    css2 += "#status.connected { color: rgb(" + t.success + "); }\n";
    css2 += "#vis .node-label { fill: rgb(" + t.text + "); }\n";
    css2 += "#vis .node-label.offline { fill: rgb(" + t.muted + " / 0.45); }\n";
    css2 += "#vis .node-addr { fill: rgb(" + t.muted + "); }\n";
    css2 += "#vis .group-label { fill: rgb(" + t.muted + "); }\n";
    css2 += "#vis .group-label.depth-1 { fill: rgb(" + t.muted + " / 0.85); }\n";
    css2 += "#vis .group-label.depth-2 { fill: rgb(" + t.muted + " / 0.7); }\n";
    css2 += "#vis .param-label { fill: rgb(" + t.text + " / 0.62); }\n";
    css2 += "#vis .param-label.offline { fill: rgb(" + t.muted + " / 0.4); }\n";
    css2 += "#vis .param-value { fill: rgb(" + t.muted + "); }\n";
    css2 += "#vis .collapsed-label { fill: rgb(" + t.text + " / 0.55) !important; }\n";
    css2 += "#vis .drop-highlight { stroke: rgb(" + t.accent + "); }\n";
    css2 += '#vis .drag-line[stroke="#fff"] { stroke: rgb(' + t.text + "); }\n";
    const bgSum = t.bg.split(" ").reduce(function(acc, v) {
      return acc + +v;
    }, 0);
    if (bgSum > 384) css2 += "html[data-glass='on'] #display-tab, html[data-glass='on'] #scenes-tab { color: rgb(" + t.text + "); text-shadow: none; }\n";
    css2 += ".param-tooltip .tt-name { color: rgb(" + t.text + "); }\n";
    css2 += ".param-tooltip .tt-path, .param-tooltip .tt-hint, .param-tooltip td:first-child { color: rgb(" + t.muted + "); }\n";
    css2 += ".param-tooltip td:last-child { color: rgb(" + t.text + " / 0.85); }\n";
    css2 += ".param-tooltip, .dashboard-panel { background: rgb(" + t.panel + " / 0.92); color: rgb(" + t.text + "); border-color: rgb(" + t.border + "); }\n";
    css2 += "#display-panel, #display-tab, #search-palette, #history-btns, #scenes-panel, #scenes-tab, #link-inspector { --dp-bg: " + t.panel + "; --dp-text: " + t.text + "; --dp-muted: " + t.muted + "; --dp-border: " + t.border + "; --dp-accent: " + t.accent + "; }\n";
  }
  styleEl.textContent = css2;
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
function activeOver() {
  return settings.activeOver;
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
var populationsSeen = {};
function collapsePopulations(pnode, sku, parentPath) {
  if (!pnode || pnode.kind === "param" || !pnode.children) return;
  for (let i = 0; i < pnode.children.length; i++) {
    const c = pnode.children[i];
    if (c.kind !== "group") continue;
    const name = c.name || c.label || "";
    const path = parentPath ? parentPath + "/" + name : name;
    const key2 = sku + "|" + path;
    if (c.slots && !populationsSeen[key2]) {
      populationsSeen[key2] = true;
      state.collapsedGroups[key2] = true;
      for (let k = 0; k < (c.children || []).length; k++)
        if (c.children[k].kind === "group") state.collapsedGroups[key2 + "/" + c.children[k].name] = true;
    }
    collapsePopulations(c, sku, path);
  }
}
function autoCollapseNewNodes() {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    collapsePopulations(n.params, n.sku, null);
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
var FIT_HOLD_MS = 3e3;
var FIT_RETRACT_TAU = 700;
var fitTarget = base;
var fitted = false;
var fitSnap = false;
var fitHoldFrom = 0;
var fitAnim = null;
var fitWait = null;
var fitLast = 0;
function fitHolds(outer, inner) {
  const e = 0.5;
  return inner.x >= outer.x - e && inner.y >= outer.y - e && inner.x + inner.w <= outer.x + outer.w + e && inner.y + inner.h <= outer.y + outer.h + e;
}
function fitRetract(now) {
  fitAnim = null;
  fitWait = null;
  if (baseLocked) return;
  const wait = fitHoldFrom + FIT_HOLD_MS - now;
  if (wait > 0) {
    fitWait = window.setTimeout(function() {
      fitWait = null;
      fitAnim = requestAnimationFrame(fitRetract);
    }, wait);
    return;
  }
  const dt = fitLast ? Math.min(50, now - fitLast) : 16;
  fitLast = now;
  const a = 1 - Math.exp(-dt / FIT_RETRACT_TAU);
  const t = fitTarget;
  const next = {
    x: base.x + (t.x - base.x) * a,
    y: base.y + (t.y - base.y) * a,
    w: base.w + (t.w - base.w) * a,
    h: base.h + (t.h - base.h) * a
  };
  const done = Math.abs(next.w - t.w) < 0.5 && Math.abs(next.x - t.x) < 0.5 && Math.abs(next.y - t.y) < 0.5;
  base = done ? t : next;
  applyViewBox();
  applyVideo();
  if (!done) fitAnim = requestAnimationFrame(fitRetract);
  else fitLast = 0;
}
function fitStop() {
  if (fitAnim !== null) {
    cancelAnimationFrame(fitAnim);
    fitAnim = null;
  }
  if (fitWait !== null) {
    clearTimeout(fitWait);
    fitWait = null;
  }
  fitLast = 0;
}
function setBaseViewBox(x, y, w, h) {
  if (!baseLocked) {
    const t = { x, y, w, h };
    fitTarget = t;
    if (!fitted || fitSnap) {
      fitted = true;
      fitSnap = false;
      fitStop();
      base = t;
    } else if (!fitHolds(base, t)) {
      const x0 = Math.min(base.x, t.x), y0 = Math.min(base.y, t.y);
      const x1 = Math.max(base.x + base.w, t.x + t.w), y1 = Math.max(base.y + base.h, t.y + t.h);
      const d = Math.max(x1 - x0, y1 - y0);
      base = { x: (x0 + x1 - d) / 2, y: (y0 + y1 - d) / 2, w: d, h: d };
      fitStop();
      fitHoldFrom = performance.now();
      fitAnim = requestAnimationFrame(fitRetract);
    } else if (fitAnim === null && fitWait === null && !fitHolds(t, base)) {
      fitHoldFrom = performance.now();
      fitAnim = requestAnimationFrame(fitRetract);
    }
  }
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
    const names2 = e.sources || [];
    if (settings.videoSource && names2.indexOf(settings.videoSource) < 0) names2.push(settings.videoSource);
    const want = "|" + names2.join("|");
    if (sel2.getAttribute("data-list") !== want) {
      sel2.setAttribute("data-list", want);
      let h = '<option value="">automatic</option>';
      for (let i = 0; i < names2.length; i++) h += '<option value="' + names2[i].replace(/"/g, "&quot;") + '">' + names2[i].replace(/</g, "&lt;") + "</option>";
      sel2.innerHTML = h;
    }
    sel2.value = settings.videoSource;
    if (!settings.videoOn) st.textContent = names2.length ? names2.length + " NDI source" + (names2.length > 1 ? "s" : "") + " found" : "no NDI source found";
    else if (e.source) st.textContent = e.source + (e.taille ? " \xB7 " + e.taille[0] + "\xD7" + e.taille[1] : "") + " \xB7 " + e.ips + " fps";
    else st.textContent = names2.length ? "connecting\u2026" : "no NDI source found";
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
  const key2 = [settings.font, settings.weight, settings.textScale, settings.paramScale].join("|");
  if (key2 !== widthCacheKey) {
    widthCache.clear();
    widthCacheKey = key2;
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
    let span2 = Math.atan2(pE.y, pE.x) - aS;
    span2 = dir > 0 ? (span2 % TAU + TAU) % TAU : -((-span2 % TAU + TAU) % TAU);
    const pad = fs * 0.12 / rb;
    const s0 = aS - dir * pad, s1 = aS + span2 + dir * pad;
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
function glassEdge(px2, py2, w, h, r) {
  const qx = Math.abs(px2 - w / 2) - (w / 2 - r);
  const qy = Math.abs(py2 - h / 2) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  const d = -(Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r);
  if (ox > 0 || oy > 0) {
    const l = Math.hypot(ox, oy) || 1;
    return { d, nx: ox / l * Math.sign(px2 - w / 2), ny: oy / l * Math.sign(py2 - h / 2) };
  }
  return qx > qy ? { d, nx: Math.sign(px2 - w / 2), ny: 0 } : { d, nx: 0, ny: Math.sign(py2 - h / 2) };
}
function glassMap(w, h, r, bezel) {
  const key2 = w + "|" + h + "|" + r + "|" + bezel;
  const hit = glassMaps.get(key2);
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
  glassMaps.set(key2, url);
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
  q("[data-k=activeOver]").value = String(settings.activeOver);
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
    for (const [key2, what] of rows) h += "<span>" + k(key2) + "</span><span>" + k(what) + "</span>";
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
  p.innerHTML = '<div class="dp-head">look</div><div class="dp-row"><label>theme</label><select data-k="theme">' + themeOpts + '</select></div><div class="dp-row"><label>font</label><select data-k="font">' + fontOpts + `</select></div><div class="dp-row"><label>text size</label><input type="range" min="0.5" max="3" step="0.05" data-k="textScale"><span data-v="textScale"></span></div><div class="dp-row"><label title="Size of the parameter names, on top of the text size">param labels</label><input type="range" min="0.5" max="2" step="0.05" data-k="paramScale"><span data-v="paramScale"></span></div><div class="dp-row"><label>weight</label><input type="range" min="100" max="900" step="100" data-k="weight"><span data-v="weight"></span></div><div class="dp-row"><label title="Coloured boxes behind instrument and group names, in the instrument's colour">label boxes</label><select data-k="labelBoxes"><option value="off">off</option><option value="flat">flat</option><option value="gradient">gradient</option><option value="shadow">gradient + shadow</option><option value="glow">glow</option></select></div><div class="dp-head">ring</div><div class="dp-row"><label title="Size of the ring, i.e. the diameter of the centre where connections cross">size</label><input type="range" min="0.3" max="1.6" step="0.02" data-k="ringScale"><span data-v="ringScale"></span></div><div class="dp-row"><label title="Thickness of the ring and of the group arcs">lines</label><input type="range" min="0.5" max="6" step="0.1" data-k="lineScale"><span data-v="lineScale"></span></div><div class="dp-row"><label title="Thickness of the connection lines">connections</label><input type="range" min="0.3" max="8" step="0.1" data-k="connScale"><span data-v="connScale"></span></div><div class="dp-row"><label title="While dragging a connection, how collapsed groups that hide a compatible parameter open">open groups</label><select data-k="dragExpand"><option value="hover">on hover</option><option value="all">all at once</option></select></div><div class="dp-row"><label title="Longer parameter / group names are cut with \u2026 (the full name stays in the tooltip). 0 = never cut.">max name</label><input type="number" min="0" max="200" step="1" data-k="maxName"><span class="dp-unit">characters</span></div><div class="dp-row"><label title="Instruments with more parameters than this start with all their groups collapsed (0 = never)">collapse over</label><input type="number" min="0" max="9999" step="1" data-k="autoCollapseOver"><span class="dp-unit">params</span></div><div class="dp-row"><label title="A population with more slots than this shows only its live ones (a slot gone stays 3 s); Shift+click a population's arc to switch it (0 = always all)">active over</label><input type="number" min="0" max="255" step="1" data-k="activeOver"><span class="dp-unit">slots</span></div><div class="dp-head">show</div><div class="dp-checks"><label class="dp-check"><input type="checkbox" data-k="showText"> text <kbd>T</kbd></label><label class="dp-check" title="Leave offline nodes off the ring"><input type="checkbox" data-k="hideAbsent"> hide absent <kbd>H</kbd><span data-v="absent" class="dp-count"></span></label><label class="dp-check" title="Each node's IP address and mesh port next to its name (nodes this host is linked to directly)"><input type="checkbox" data-k="showAddresses"> addresses <kbd>I</kbd></label><label class="dp-check"><input type="checkbox" data-k="glass"> liquid glass</label></div><div class="dp-head">output</div><div class="dp-row"><label title="A second, view-only window for a screen or projector: it follows this view (zoom, rotation, groups, theme, video)">window</label><button type="button" data-a="output">open <kbd>O</kbd></button><label class="dp-inline"><input type="checkbox" data-k="outputText"> with text</label></div><div class="dp-row"><label title="An NDI video feed inside the ring, under the connections: from this machine or another one on the network. Needs the ndi-pont bridge running on this host.">video <kbd>V</kbd></label><input type="checkbox" data-k="videoOn"><select data-k="videoSource" title="NDI source"><option value="">automatic</option></select></div><div class="dp-row dp-video-opt"><label title="Dims the video so the connections stay the subject">brightness</label><input type="range" min="0.1" max="1" step="0.05" data-k="videoBright"><span data-v="videoBright"></span></div><div class="dp-row dp-video-opt"><label title="cover fills the circle (crops the sides), contain shows the whole image. Lines: how connections stay visible over the video">fit \xB7 lines</label><select data-k="videoFit"><option value="cover">cover</option><option value="contain">contain</option></select><select data-k="videoLines" title="halo: a contrasting edge under each line (keeps the colours) \xB7 blend: difference, always contrasts but changes the colours \xB7 plain: nothing"><option value="halo">halo</option><option value="blend">blend</option><option value="plain">plain</option></select></div><div class="dp-status" data-s="videoStatus"></div><div class="dp-btns"><button type="button" data-a="collapse">collapse all</button><button type="button" data-a="expand">expand all</button><button type="button" data-a="zoom">reset zoom <kbd>0</kbd></button><button type="button" data-a="fullscreen">fullscreen <kbd>F</kbd></button><button type="button" data-a="reset">defaults</button></div>` + shortcutsHtml();
  document.body.appendChild(p);
  panelEl = p;
  tab.addEventListener("click", function() {
    const open3 = p.style.display === "none";
    p.style.display = open3 ? "block" : "none";
    tab.textContent = open3 ? "settings \u25BE" : "settings \u25B4";
    tab.classList.toggle("open", open3);
    if (open3) syncPanel();
    setVideoPolling(open3);
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
      if (k === "lineScale" || k === "ringScale" || k === "connScale" || k === "maxName" || k === "activeOver" || k === "textScale" || k === "paramScale" || k === "weight") {
        lastRoom = -1;
        fitSnap = true;
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
  let running = false;
  const tick2 = function() {
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
    requestAnimationFrame(tick2);
  };
  ch.onmessage = function(e) {
    const m = e.data || {};
    if (m.type === "hello") {
      last = "";
      if (!running) {
        running = true;
        requestAnimationFrame(tick2);
      }
    } else if (m.type === "outputText") {
      settings.outputText = !!m.on;
      saveSettings();
      syncPanel();
    }
  };
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
var TRANSITION_FAST = 200;
var SPRING_MS = 160;
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
var flat = /* @__PURE__ */ new Map();
function pathPoints(d) {
  let out = flat.get(d);
  if (out) return out;
  out = [];
  const re = /([MLQCZ])([^MLQCZ]*)/gi;
  let m;
  let x = 0, y = 0, x0 = 0, y0 = 0;
  while (m = re.exec(d)) {
    const c = m[1].toUpperCase();
    const a = m[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
    if (c === "M" || c === "L") {
      for (let i = 0; i + 1 < a.length; i += 2) {
        x = a[i];
        y = a[i + 1];
        if (c === "M" && i === 0) {
          x0 = x;
          y0 = y;
        }
        out.push(x, y);
      }
    } else if (c === "Q") {
      for (let i = 0; i + 3 < a.length; i += 4) {
        for (let k = 1; k <= 16; k++) {
          const t = k / 16, u = 1 - t;
          out.push(u * u * x + 2 * u * t * a[i] + t * t * a[i + 2], u * u * y + 2 * u * t * a[i + 1] + t * t * a[i + 3]);
        }
        x = a[i + 2];
        y = a[i + 3];
      }
    } else if (c === "C") {
      for (let i = 0; i + 5 < a.length; i += 6) {
        for (let k = 1; k <= 16; k++) {
          const t = k / 16, u = 1 - t;
          out.push(
            u * u * u * x + 3 * u * u * t * a[i] + 3 * u * t * t * a[i + 2] + t * t * t * a[i + 4],
            u * u * u * y + 3 * u * u * t * a[i + 1] + 3 * u * t * t * a[i + 3] + t * t * t * a[i + 5]
          );
        }
        x = a[i + 4];
        y = a[i + 5];
      }
    } else if (c === "Z") {
      out.push(x0, y0);
      x = x0;
      y = y0;
    }
  }
  if (flat.size > 4e3) flat.clear();
  flat.set(d, out);
  return out;
}
function pathDistance(d, px2, py2) {
  const p = pathPoints(d);
  if (p.length < 2) return Infinity;
  let best = (p[0] - px2) * (p[0] - px2) + (p[1] - py2) * (p[1] - py2);
  for (let i = 2; i + 1 < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px2 - ax) * dx + (py2 - ay) * dy) / l2)) : 0;
    const qx = ax + t * dx - px2, qy = ay + t * dy - py2;
    const d2 = qx * qx + qy * qy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// ../../../../Projects/124_dataflou/web/src/canvaslayer.ts
var FLASH_MS = 400;
var FLASH_RGB = "255, 240, 80";
var glow = null;
var lines = null;
var gctx = null;
var lctx = null;
var linesDirty = true;
var raf = 0;
var lastView = "";
var viewChanged = 0;
var animatedLines = false;
var sprites = /* @__PURE__ */ new Map();
var spritesUsed = /* @__PURE__ */ new Map();
var flashes = [];
var paths = /* @__PURE__ */ new Map();
function canvasActive() {
  return !!lctx;
}
var viewListeners = [];
function onViewChange(f) {
  viewListeners.push(f);
}
function initCanvasLayer() {
  const svg = state.svg && state.svg.node();
  if (!svg || !svg.parentNode) return;
  const make = function(cls) {
    const c = document.createElement("canvas");
    c.className = "ring-canvas " + cls;
    svg.parentNode.insertBefore(c, svg.nextSibling);
    return c;
  };
  lines = make("ring-lines");
  glow = make("ring-glow");
  gctx = glow.getContext("2d");
  lctx = lines.getContext("2d");
  if (!gctx || !lctx) {
    glow.remove();
    lines.remove();
    glow = lines = null;
    gctx = lctx = null;
    return;
  }
  document.body.classList.add("canvas-cables");
  new MutationObserver(function(rs) {
    for (let i = 0; i < rs.length; i++) {
      if (touchesLines(rs[i].target)) {
        linesDirty = true;
        break;
      }
    }
    schedule();
  }).observe(svg, { attributes: true, childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", function() {
    linesDirty = true;
    schedule();
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(function() {
    linesDirty = true;
    schedule();
  }).observe(svg);
  schedule();
}
function touchesLines(n) {
  const el = n.nodeType === 1 ? n : n.parentNode;
  if (!el) return false;
  if (el === state.svg.node() || el === state.g.node()) return true;
  return !!el.closest(".connections, .conn-halos, .pending-links, defs, .drag-line, .drop-highlight");
}
function flashParam(el) {
  if (!gctx) return;
  for (let i = 0; i < flashes.length; i++) {
    if (flashes[i].el === el) {
      flashes[i].t0 = performance.now();
      schedule();
      return;
    }
  }
  flashes.push({ el, t0: performance.now() });
  schedule();
}
function schedule() {
  if (!raf && lctx) raf = requestAnimationFrame(frame);
}
function frame(now) {
  raf = 0;
  const svg = state.svg && state.svg.node();
  const g = state.g && state.g.node();
  if (!svg || !g || !glow || !lines || !gctx || !lctx) return;
  const rect = svg.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  for (const c of [glow, lines]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      linesDirty = true;
    }
    const s = c.style;
    const l = rect.left + "px", t = rect.top + "px", cw = rect.width + "px", ch = rect.height + "px";
    if (s.left !== l || s.top !== t || s.width !== cw || s.height !== ch) {
      s.left = l;
      s.top = t;
      s.width = cw;
      s.height = ch;
    }
  }
  const ctm = g.getScreenCTM();
  if (!ctm) return;
  const M = [
    ctm.a * dpr,
    ctm.b * dpr,
    ctm.c * dpr,
    ctm.d * dpr,
    (ctm.e - rect.left) * dpr,
    (ctm.f - rect.top) * dpr
  ];
  const view = M.map(function(v) {
    return v.toFixed(3);
  }).join(",");
  if (view !== lastView) {
    lastView = view;
    viewChanged = now;
    linesDirty = true;
    for (let i = 0; i < viewListeners.length; i++) viewListeners[i]();
  }
  const conn2 = g.querySelector(":scope > .connections");
  const blend = conn2 ? conn2.style.mixBlendMode : "";
  if (lines.style.mixBlendMode !== blend) {
    lines.style.mixBlendMode = blend;
    glow.style.mixBlendMode = blend;
  }
  let more = false;
  if (linesDirty || animatedLines) {
    linesDirty = false;
    animatedLines = drawLines(lctx, g, M, now);
    more = more || animatedLines;
  }
  more = drawGlow(gctx, conn2, M, now) || more;
  if (more) schedule();
}
function drawLines(ctx, g, M, now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
  const noText = document.body.classList.contains("no-text");
  let animated = false;
  const layers = g.querySelectorAll(":scope > .conn-halos, :scope > .connections, :scope > .pending-links");
  for (let li = 0; li < layers.length; li++) {
    const kids = layers[li].children;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      const cls = el.classList;
      if (cls.contains("sub-hit")) continue;
      if (cls.contains("conn-glow-aura") && !el.style.filter) continue;
      if (cls.contains("pending-link")) {
        drawPending(ctx, el, M, scale, now);
        animated = true;
        continue;
      }
      if (el.tagName === "text") {
        if (!noText) drawText(ctx, el, M);
        continue;
      }
      drawShape(ctx, el, M, scale, 1);
    }
  }
  if (!document.body.classList.contains("output-mode")) {
    const drag2 = g.querySelectorAll(":scope > .drag-line, :scope > .drop-highlight");
    for (let i = 0; i < drag2.length; i++) drawStyled(ctx, drag2[i], M);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowColor = "transparent";
  return animated;
}
function path2d(d) {
  let p = paths.get(d);
  if (!p) {
    if (paths.size > 4e3) paths.clear();
    p = new Path2D(d);
    paths.set(d, p);
  }
  return p;
}
function num(el, a, dflt = 0) {
  const v = el.getAttribute(a);
  if (v === null) return dflt;
  const n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}
function applyTransform(ctx, t) {
  if (!t) return;
  const re = /(translate|rotate|scale)\s*\(([^)]*)\)/g;
  let m;
  while (m = re.exec(t)) {
    const a = m[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
    if (m[1] === "translate") ctx.translate(a[0] || 0, a[1] || 0);
    else if (m[1] === "scale") ctx.scale(a[0], a.length > 1 ? a[1] : a[0]);
    else {
      const r = (a[0] || 0) * Math.PI / 180;
      if (a.length >= 3) {
        ctx.translate(a[1], a[2]);
        ctx.rotate(r);
        ctx.translate(-a[1], -a[2]);
      } else ctx.rotate(r);
    }
  }
}
function setMat(ctx, M) {
  ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
}
function paint(ctx, v) {
  if (!v || v === "none" || v === "transparent") return null;
  if (v.indexOf("url(") !== 0) return v;
  const id = v.replace(/^url\(\s*["']?#?/, "").replace(/["']?\s*\)$/, "");
  const gr = document.getElementById(id);
  if (!gr || gr.tagName !== "linearGradient") return null;
  const cg = ctx.createLinearGradient(num(gr, "x1"), num(gr, "y1"), num(gr, "x2"), num(gr, "y2"));
  const stops = gr.children;
  for (let i = 0; i < stops.length; i++) {
    const o = stops[i].getAttribute("offset") || "0";
    const off = o.endsWith("%") ? parseFloat(o) / 100 : parseFloat(o);
    try {
      cg.addColorStop(Math.max(0, Math.min(1, off || 0)), stops[i].getAttribute("stop-color") || "#000");
    } catch (_) {
    }
  }
  return cg;
}
function dashes(v) {
  if (!v || v === "none") return [];
  return v.split(/[\s,]+/).filter(Boolean).map(parseFloat).filter(function(n) {
    return !isNaN(n);
  });
}
function opacityOf(el) {
  if (el.classList.contains("sub-line-target")) return 1;
  const s = el.style.opacity;
  if (s) return parseFloat(s);
  return num(el, "opacity", 1);
}
function shadow(ctx, el, scale) {
  const f = el.style.filter;
  const color = f && f.indexOf("drop-shadow") === 0 ? /rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(f) : null;
  const lens = color ? f.replace(color[0], "").match(/-?[\d.]+px/g) : null;
  if (color && lens && lens.length >= 3) {
    ctx.shadowColor = color[0];
    ctx.shadowBlur = parseFloat(lens[2]) * scale;
  } else ctx.shadowColor = "transparent";
}
function drawShape(ctx, el, M, scale, alpha) {
  const tag = el.tagName;
  if (tag === "use") {
    const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";
    const ref = href ? document.getElementById(href.slice(1)) : null;
    if (!ref) return;
    setMat(ctx, M);
    applyTransform(ctx, el.getAttribute("transform"));
    const t = ctx.getTransform();
    drawShape(ctx, ref, [t.a, t.b, t.c, t.d, t.e, t.f], scale, alpha * opacityOf(el));
    return;
  }
  const target = el.classList.contains("sub-line-target");
  const stroke = paint(ctx, target ? "#c44" : el.style.stroke || el.getAttribute("stroke"));
  const fill = tag === "line" ? null : paint(ctx, el.style.fill || el.getAttribute("fill"));
  if (!stroke && !fill) return;
  setMat(ctx, M);
  applyTransform(ctx, el.getAttribute("transform"));
  ctx.globalAlpha = alpha * opacityOf(el);
  shadow(ctx, el, scale);
  let p;
  if (tag === "path") p = path2d(el.getAttribute("d") || "");
  else if (tag === "circle") {
    p = new Path2D();
    p.arc(num(el, "cx"), num(el, "cy"), Math.max(0, num(el, "r")), 0, 2 * Math.PI);
  } else if (tag === "line") {
    p = new Path2D();
    p.moveTo(num(el, "x1"), num(el, "y1"));
    p.lineTo(num(el, "x2"), num(el, "y2"));
  } else return;
  const base2 = ctx.globalAlpha;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.globalAlpha = base2 * num(el, "fill-opacity", 1);
    ctx.fill(p);
  }
  if (stroke) {
    ctx.globalAlpha = base2 * num(el, "stroke-opacity", 1);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = num(el, "stroke-width", 1);
    ctx.lineCap = el.getAttribute("stroke-linecap") || "butt";
    ctx.lineJoin = "miter";
    ctx.setLineDash(dashes(el.getAttribute("stroke-dasharray")));
    ctx.stroke(p);
  }
}
function drawStyled(ctx, el, M) {
  const cs = getComputedStyle(el);
  const stroke = paint(ctx, cs.stroke);
  const op = parseFloat(cs.opacity);
  if (!stroke || !(op > 0)) return;
  setMat(ctx, M);
  ctx.globalAlpha = op;
  ctx.shadowColor = "transparent";
  let p;
  if (el.tagName === "circle") {
    p = new Path2D();
    p.arc(num(el, "cx"), num(el, "cy"), Math.max(0, num(el, "r")), 0, 2 * Math.PI);
  } else p = path2d(el.getAttribute("d") || "");
  ctx.strokeStyle = stroke;
  ctx.lineWidth = num(el, "stroke-width", 1);
  ctx.lineCap = "butt";
  ctx.setLineDash(dashes(cs.strokeDasharray.replace(/px/g, "")));
  ctx.stroke(p);
}
var textFont = "";
function drawText(ctx, el, M) {
  if (!textFont) {
    const cs = getComputedStyle(el);
    textFont = cs.fontWeight + " " + (el.getAttribute("font-size") || "5px") + " " + cs.fontFamily;
  }
  setMat(ctx, M);
  ctx.globalAlpha = opacityOf(el);
  ctx.shadowColor = "transparent";
  ctx.font = textFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = document.body.classList.contains("graphite") ? "#555" : el.getAttribute("fill") || "#888";
  ctx.fillText(el.textContent || "", num(el, "x"), num(el, "y"));
}
var restyle = new MutationObserver(function() {
  textFont = "";
  linesDirty = true;
  schedule();
});
restyle.observe(document.head, { childList: true, subtree: true, characterData: true });
restyle.observe(document.body, { attributes: true, attributeFilter: ["class"] });
function drawPending(ctx, el, M, scale, now) {
  setMat(ctx, M);
  ctx.globalAlpha = 0.75;
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = num(el, "stroke-width", 1);
  ctx.lineCap = "butt";
  ctx.setLineDash([4, 3]);
  ctx.lineDashOffset = 14 * (now % 600 / 600);
  ctx.stroke(path2d(el.getAttribute("d") || ""));
  ctx.lineDashOffset = 0;
}
var glowEmpty = true;
function drawGlow(ctx, conn2, M, now) {
  const auras = conn2 ? conn2.querySelectorAll(":scope > .conn-glow-aura") : null;
  if (glowEmpty && !flashes.length && !(auras && auras.length)) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  glowEmpty = !flashes.length && !(auras && auras.length);
  let animated = false;
  const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
  if (auras) {
    for (let i = 0; i < auras.length; i++) {
      const el = auras[i];
      if (el.style.filter) continue;
      const s = sprite(el, scale, now);
      if (!s) continue;
      const k = 1 / s.scale;
      ctx.setTransform(M[0] * k, M[1] * k, M[2] * k, M[3] * k, M[4], M[5]);
      ctx.globalAlpha = el.style.opacity ? parseFloat(el.style.opacity) : pulse(el, now);
      ctx.drawImage(s.canvas, s.x, s.y);
      animated = true;
    }
  }
  sprites = spritesUsed;
  spritesUsed = /* @__PURE__ */ new Map();
  animated = drawFlashes(ctx, M, now) || animated;
  ctx.globalAlpha = 1;
  return animated;
}
function pulse(el, now) {
  const dur = parseFloat(el.getAttribute("data-pulse") || "0");
  if (!(dur > 0)) return num(el, "opacity", 0.6);
  const t = now / 1e3 % dur / dur;
  return t < 0.5 ? 0.6 - 0.45 * (t * 2) : 0.15 + 0.45 * ((t - 0.5) * 2);
}
function sprite(el, scale, now) {
  const d = el.getAttribute("d") || "";
  const color = el.getAttribute("stroke") || "#fff";
  const width = num(el, "stroke-width", 1);
  const f = el.getAttribute("filter");
  const fid = f ? f.replace(/^url\(\s*["']?#?/, "").replace(/["']?\s*\)$/, "") : "";
  const blurEl = fid ? document.getElementById(fid) : null;
  const sd = blurEl && blurEl.firstElementChild ? num(blurEl.firstElementChild, "stdDeviation", 0) : 0;
  const key2 = d + "|" + color + "|" + width + "|" + sd;
  const old = sprites.get(key2) || spritesUsed.get(key2);
  if (old && (Math.abs(old.scale / scale - 1) < 1e-3 || now - viewChanged < 150)) {
    spritesUsed.set(key2, old);
    return old;
  }
  const pts = pathPoints(d);
  if (pts.length < 2) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    x1 = Math.max(x1, pts[i]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  const margin = (3 * sd + width) * scale + 2;
  x0 = Math.floor(x0 * scale - margin);
  y0 = Math.floor(y0 * scale - margin);
  const cw = Math.ceil(x1 * scale + margin) - x0, ch = Math.ceil(y1 * scale + margin) - y0;
  if (cw <= 0 || ch <= 0 || cw * ch > 16e6) return old || null;
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const sc = c.getContext("2d");
  if (!sc) return null;
  const off = cw + 100;
  sc.setTransform(scale, 0, 0, scale, -x0 - off, -y0);
  sc.shadowOffsetX = off;
  sc.shadowColor = color;
  sc.shadowBlur = 2 * sd * scale;
  sc.strokeStyle = color;
  sc.lineWidth = width;
  sc.stroke(path2d(d));
  const s = { canvas: c, x: x0, y: y0, scale };
  spritesUsed.set(key2, s);
  return s;
}
function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
function drawFlashes(ctx, M, now) {
  let live = false;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const t = (now - f.t0) / FLASH_MS;
    if (t >= 1 || !f.el.isConnected) {
      flashes.splice(i, 1);
      continue;
    }
    live = true;
    if (t < 0) continue;
    const el = f.el;
    setMat(ctx, M);
    applyTransform(ctx, el.getAttribute("transform"));
    const p = new Path2D();
    const tag = el.tagName;
    if (tag === "circle") p.arc(num(el, "cx"), num(el, "cy"), num(el, "r"), 0, 2 * Math.PI);
    else if (tag === "rect") p.rect(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"));
    else if (tag === "polygon") {
      const pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(parseFloat);
      for (let k = 0; k + 1 < pts.length; k += 2) {
        if (k === 0) p.moveTo(pts[k], pts[k + 1]);
        else p.lineTo(pts[k], pts[k + 1]);
      }
      p.closePath();
    }
    const cls = el.classList;
    ctx.setLineDash(cls.contains("mode-polling") ? [0.5, 1.5] : cls.contains("mode-discrete") ? [2, 1.5] : cls.contains("grabbable") ? [1.5, 1.5] : []);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(" + FLASH_RGB + ", " + (0.95 * (1 - easeOut(t))).toFixed(3) + ")";
    ctx.lineWidth = 2.5;
    ctx.stroke(p);
  }
  ctx.setLineDash([]);
  return live;
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
      normalizedValue = Math.max(-1, Math.min(1, (p.value - mn) / (mx - mn) * 2 - 1));
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
function divergingColor(value, cold, hot) {
  const white = [255, 255, 255];
  const t = Math.min(1, Math.max(-1, value));
  return t <= 0 ? okMix(cold, white, t + 1) : okMix(white, hot, t);
}
function thermalColor(value) {
  return divergingColor(value, [100, 100, 255], [255, 100, 100]);
}
function glowColor(value) {
  return divergingColor(value, [80, 120, 255], [255, 160, 60]);
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
  if (canvasActive()) {
    aura.attr("data-pulse", pulseDur.toFixed(1));
  } else {
    const anim = document.createElementNS("http://www.w3.org/2000/svg", "animate");
    anim.setAttribute("attributeName", "opacity");
    anim.setAttribute("values", "0.6;0.15;0.6");
    anim.setAttribute("dur", pulseDur.toFixed(1) + "s");
    anim.setAttribute("begin", smilBegin());
    anim.setAttribute("repeatCount", "indefinite");
    aura.node().appendChild(anim);
  }
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
  if (m.element) {
    g.append("text").attr("class", "conn-label conn-element").attr("x", mid.x + nx * 6).attr("y", mid.y + ny * 6).attr("text-anchor", "middle").attr("dominant-baseline", "central").attr("font-size", "5px").attr("fill", "#cde").attr("opacity", 0.95).text(m.approach + " [" + m.element + "]");
    return;
  }
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

// ../../../../Projects/124_dataflou/web/src/conns.ts
function joinPath(a, b) {
  return a && b ? a + "/" + b : a || b;
}
function nodeBySku(sku) {
  return state.nodes.find(function(n) {
    return n.sku === sku;
  });
}
function resolve(root2, path) {
  if (!root2) return null;
  if (!path) return root2;
  let at = root2;
  const segs = path.split("/");
  for (let i = 0; i < segs.length; i++) {
    if (at.kind !== "group" || !at.children) return null;
    let next = null;
    for (let j = 0; j < at.children.length; j++) {
      if (at.children[j].name === segs[i]) {
        next = at.children[j];
        break;
      }
    }
    if (!next) return null;
    at = next;
  }
  return at;
}
function resolveIn(sku, path) {
  const n = nodeBySku(sku);
  return n ? resolve(n.params, path) : null;
}
function slotsOf(n) {
  return n && n.kind === "group" && n.slots ? n.slots : 0;
}
function eachPairing(destRoot, srcRoot, d, s, f) {
  const di = d.indexOf("*"), si = s.indexOf("*");
  if (di < 0 || si < 0) {
    f(d, s);
    return;
  }
  const dPop = d.slice(0, di).replace(/\/$/, ""), sPop = s.slice(0, si).replace(/\/$/, "");
  const n = Math.min(slotsOf(resolve(destRoot, dPop)), slotsOf(srcRoot ? resolve(srcRoot, sPop) : null));
  for (let k = 1; k <= n; k++)
    eachPairing(destRoot, srcRoot, d.slice(0, di) + k + d.slice(di + 1), s.slice(0, si) + k + s.slice(si + 1), f);
}
function ingest(nodes) {
  const bySku = {};
  for (let i = 0; i < nodes.length; i++) bySku[nodes[i].sku] = nodes[i];
  for (let i = 0; i < nodes.length; i++) {
    const conns = nodes[i].connections;
    if (!conns) continue;
    for (let ci = 0; ci < conns.length; ci++) {
      const c = conns[ci];
      const srcNode = bySku[c.sku];
      if (c.pick) {
        ingestPick(nodes[i], srcNode, c);
        continue;
      }
      for (let li = 0; li < c.links.length; li++) {
        const l = c.links[li];
        if (unfed(l) || !c.poly && l.dest.indexOf("*") < 0) continue;
        const d = c.poly ? joinPath(joinPath(c.dest, "*"), l.dest) : joinPath(c.dest, l.dest);
        const s = c.poly ? joinPath(joinPath(c.source, "*"), l.source) : joinPath(c.source, l.source);
        eachPairing(nodes[i].params, srcNode ? srcNode.params : null, d, s, function(dp, sp) {
          const p = resolve(nodes[i].params, dp);
          if (!p || p.kind !== "param") return;
          const subs = p.subs || (p.subs = []);
          if (subs.some(function(x) {
            return x.sku === c.sku && x.path === sp;
          })) return;
          subs.push({ sku: c.sku, path: sp, id: c.id, poly: true });
        });
      }
    }
  }
}
var liveSince = {};
var seen = 0;
function gateOf(slot) {
  if (slot.kind !== "group" || !slot.children) return null;
  for (let i = 0; i < slot.children.length; i++) {
    const c = slot.children[i];
    if (c.kind === "param" && roleOf(c) === "gate") return c;
  }
  return null;
}
function idOf(slot) {
  if (slot.kind !== "group" || !slot.children) return null;
  for (let i = 0; i < slot.children.length; i++) {
    const c = slot.children[i];
    if (c.kind === "param" && roleOf(c) === "id" && typeof c.value === "number") return c.value;
  }
  return null;
}
function slotLive(slot) {
  const g = gateOf(slot);
  return g ? g.value === true || g.value === 1 : true;
}
function splitPick(source) {
  const i = source.indexOf("/*");
  if (i < 0 || source.length > i + 2 && source[i + 2] !== "/") return null;
  return { pop: source.slice(0, i), within: source.slice(i + 3) };
}
function pickedSlot(srcSku, pop, popPath, pick) {
  if (!pop || pop.kind !== "group" || !pop.slots || !pop.children) return 0;
  const live = [];
  for (let i = 0; i < pop.children.length; i++) {
    const slot = pop.children[i];
    const k = parseInt(slot.name, 10);
    const key2 = srcSku + "|" + popPath + "/" + slot.name;
    if (!slotLive(slot)) {
      delete liveSince[key2];
      continue;
    }
    if (liveSince[key2] === void 0) liveSince[key2] = ++seen;
    if (pick.id !== void 0) {
      if (idOf(slot) === pick.id) return k;
      continue;
    }
    live.push({ k, since: liveSince[key2] });
  }
  if (pick.rank === void 0 || pick.rank === 0) return 0;
  live.sort(function(a, b) {
    return a.since - b.since || a.k - b.k;
  });
  const at = pick.rank > 0 ? pick.rank - 1 : live.length + pick.rank;
  return at >= 0 && at < live.length ? live[at].k : 0;
}
function describePick(p) {
  if (p.id !== void 0) return "id " + p.id;
  if (p.rank === 1) return "oldest";
  if (p.rank === -1) return "newest";
  return "rank " + p.rank;
}
function ingestPick(destNode, srcNode, c) {
  const sp = splitPick(c.source);
  if (!sp || !c.pick) return;
  const pop = srcNode ? resolve(srcNode.params, sp.pop) : null;
  const k = pickedSlot(c.sku, pop, sp.pop, c.pick);
  for (let li = 0; li < c.links.length; li++) {
    const l = c.links[li];
    if (unfed(l)) continue;
    const p = resolve(destNode.params, joinPath(c.dest, l.dest));
    if (!p || p.kind !== "param") continue;
    const subs = (p.subs || []).filter(function(x) {
      return x.id !== c.id;
    });
    subs.push({
      sku: c.sku,
      path: joinPath(joinPath(joinPath(sp.pop, String(k || 1)), sp.within), l.source),
      id: c.id,
      pick: c.pick,
      idle: !k
    });
    p.subs = subs;
  }
}
function connectionById(destSku, id) {
  const n = nodeBySku(destSku);
  const list = n && n.connections || [];
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function connectionByEnds(destSku, dest, srcSku, source) {
  const n = nodeBySku(destSku);
  const list = n && n.connections || [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.dest === dest && c.sku === srcSku && c.source === source) return c;
  }
  return null;
}
function linkOf(destSku, destPath, srcSku, srcPath, id) {
  const n = nodeBySku(destSku);
  const list = n && n.connections || [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (id ? c.id !== id : c.sku !== srcSku) continue;
    let rel, slot = 0;
    if (c.dest === destPath) rel = "";
    else if (destPath.indexOf(c.dest + "/") === 0) rel = destPath.slice(c.dest.length + 1);
    else continue;
    if (c.poly) {
      const bar = rel.indexOf("/");
      if (bar < 0) continue;
      slot = parseInt(rel.slice(0, bar), 10);
      rel = rel.slice(bar + 1);
    }
    for (let li = 0; li < c.links.length; li++) {
      const l = c.links[li];
      if (l.dest !== rel) continue;
      const from = joinPath(c.poly ? joinPath(c.source, String(slot)) : c.source, l.source);
      if (!id && from !== srcPath) continue;
      return { conn: c, link: l, slot };
    }
  }
  return null;
}
function isGroupConnection(destSku, c) {
  const d = resolveIn(destSku, c.dest);
  return d ? d.kind === "group" : !!c.poly || c.links.some(function(l) {
    return l.dest !== "";
  });
}
function unfed(l) {
  return !!l.chosen && !l.source;
}
function templateParams(sku, groupPath, poly) {
  let g = resolveIn(sku, groupPath.replace(/\/\*(?=\/|$)/g, "/1"));
  if (g && poly) g = resolve(g, "1");
  const out = [];
  const walk = function(n, prefix) {
    if (n.kind === "param") {
      out.push({ rel: prefix, param: n });
      return;
    }
    const cs = n.children || [];
    for (let i = 0; i < cs.length; i++) walk(cs[i], joinPath(prefix, cs[i].name));
  };
  if (g && g.kind === "group") walk(g, "");
  return out;
}
function roleOf(p) {
  if (p.role) return p.role;
  if (isGate(p)) return "gate";
  return p.name === "id" ? "id" : "";
}
function takesValues(p) {
  return p.flow === "destination" || p.flow === "bidir";
}
function wouldLink(destSku, destPath, srcSku, srcPath) {
  const d0 = resolveIn(destSku, destPath), s0 = resolveIn(srcSku, srcPath);
  if (!d0 || !s0 || d0.kind !== "group" || s0.kind !== "group") return { links: 0, poly: false };
  const poly = slotsOf(d0) > 0 && slotsOf(s0) > 0;
  const src = templateParams(srcSku, srcPath, poly);
  const bySrc = {};
  for (let i = 0; i < src.length; i++) bySrc[src[i].rel] = src[i].param;
  const dest = templateParams(destSku, destPath, poly);
  let links = 0;
  for (let i = 0; i < dest.length; i++) {
    const p = dest[i].param;
    if (!takesValues(p)) continue;
    if (bySrc[dest[i].rel]) {
      links++;
      continue;
    }
    const r = poly ? roleOf(p) : "";
    if (r && src.some(function(s) {
      return roleOf(s.param) === r;
    })) links++;
  }
  return { links, poly };
}
function sourceValues(c, l) {
  if (unfed(l)) return [];
  if (!c.poly) {
    const p = resolveIn(c.sku, joinPath(c.source, l.source));
    return p && p.kind === "param" ? [p] : [];
  }
  const g = resolveIn(c.sku, c.source);
  const out = [];
  const n = slotsOf(g);
  for (let k = 1; k <= n; k++) {
    const slot = resolve(g, String(k));
    if (!slot || slot.kind !== "group" || !slotOpen(slot)) continue;
    const p = resolve(slot, l.source);
    if (p && p.kind === "param") out.push(p);
  }
  return out;
}
function slotOpen(slot) {
  const cs = slot.kind === "group" ? slot.children || [] : [];
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    if (p.kind === "param" && isGate(p)) return p.value === true || p.value === 1;
  }
  return false;
}

// ../../../../Projects/124_dataflou/web/src/transform.ts
function curveAt(pts, free, t) {
  if (!pts || pts.length < 2) return t;
  const n = pts.length;
  const x = function(k) {
    return pts[k][0];
  };
  const y = function(k) {
    return pts[k][1];
  };
  if (t <= x(0)) return y(0);
  if (t >= x(n - 1)) return y(n - 1);
  let i = 0;
  while (i + 1 < n - 1 && t > x(i + 1)) ++i;
  const h = x(i + 1) - x(i);
  if (h <= 0) return y(i + 1);
  const seg = function(k) {
    const dx = x(k + 1) - x(k);
    return dx > 0 ? (y(k + 1) - y(k)) / dx : 0;
  };
  const tangent = function(k) {
    if (k === 0) return seg(0);
    if (k === n - 1) return seg(n - 2);
    const a = seg(k - 1), b = seg(k);
    if (!free && a * b <= 0) return 0;
    return (a + b) * 0.5;
  };
  let m0 = tangent(i), m1 = tangent(i + 1);
  if (!free) {
    const d = seg(i);
    if (d === 0) {
      m0 = m1 = 0;
    } else {
      const a = m0 / d, b = m1 / d;
      const r = a * a + b * b;
      if (r > 9) {
        const k = 3 / Math.sqrt(r);
        m0 = k * a * d;
        m1 = k * b * d;
      }
    }
  }
  const u = (t - x(i)) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y(i) + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y(i + 1) + (u3 - u2) * h * m1;
}
function logSpan(log, lo, hi) {
  return log && lo > 0 && hi > 0;
}
function toUnit(v, lo, hi, log = false) {
  if (hi === lo) return v;
  let t = logSpan(log, lo, hi) && v > 0 ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return t;
}
function fromUnit(t, lo, hi, log = false) {
  if (hi === lo) return t;
  if (t <= 0) return lo;
  if (t >= 1) return hi;
  return logSpan(log, lo, hi) ? lo * Math.exp(t * Math.log(hi / lo)) : lo + t * (hi - lo);
}
function components(type) {
  switch (type || "number") {
    case "bool":
    case "number":
      return 1;
    case "v2":
      return 2;
    case "v3":
      return 3;
    case "v4":
    case "colour":
      return 4;
    default:
      return 0;
  }
}
function rangeOf(p, i) {
  const t = p.type || "number";
  if (t === "bool" || t === "colour") return [0, 1];
  const r = p.range;
  if (!r) return [0, 0];
  const pick = function(v) {
    if (Array.isArray(v)) return typeof v[i] === "number" ? v[i] : 0;
    return typeof v === "number" ? v : 0;
  };
  return [pick(r.min), pick(r.max)];
}
function componentOf(p, i) {
  const v = p.value;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return typeof v[i] === "number" ? v[i] : null;
  if (typeof v === "string" && p.type === "colour" && /^#[0-9a-fA-F]{6}/.test(v)) {
    const h = v.slice(1);
    const k = h.length >= 8 || i < 3 ? parseInt(h.slice(i * 2, i * 2 + 2), 16) : 255;
    return isNaN(k) ? null : k / 255;
  }
  return null;
}
function isLog(p) {
  return p.nature === "log";
}
function axisIn(src, dest, i, a) {
  if (a && a.in) return a.in;
  const sc = components(src.type);
  return rangeOf(src, i < sc ? i : Math.max(0, sc - 1));
}
function axisOut(dest, i, a) {
  if (a && a.out) return a.out;
  return rangeOf(dest, i);
}
function throughAxis(src, dest, i, a) {
  const sc = components(src.type);
  if (!sc || !components(dest.type)) return null;
  const v = componentOf(src, i < sc ? i : sc - 1);
  if (v === null) return null;
  const [lo, hi] = axisIn(src, dest, i, a);
  const x = toUnit(v, lo, hi, isLog(src));
  const y = a ? curveAt(a.curve, !!a.free, x) : x;
  if (dest.type === "bool") return { x, y, out: y >= 0.5 };
  const [olo, ohi] = axisOut(dest, i, a);
  return { x, y, out: fromUnit(y, olo, ohi, isLog(dest)) };
}
function axisPlain(a) {
  return !a || !a.in && !a.out && (!a.curve || a.curve.length < 2);
}
function linkPlain(axes) {
  return !axes || axes.every(axisPlain);
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
      const srcIdx = sourceIndex(lookup, allParamData, sub);
      if (srcIdx === void 0) continue;
      const src = allParamData[srcIdx];
      const srcKey = src.sku + "|" + src.path;
      const destKey = dest.sku + "|" + dest.path;
      if (!colorMap[destKey]) colorMap[destKey] = nodeData[src.nodeIdx].color;
      if (!colorMap[srcKey]) colorMap[srcKey] = nodeData[dest.nodeIdx].color;
    }
  }
  return colorMap;
}
function drawSubscriptionConnections(allParamData, nodeData, before = null) {
  if (allParamData.length < 2) return;
  const lookup = {};
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    const key2 = pd.sku + "|" + pd.path;
    lookup[key2] = i;
  }
  const connGroup = d3.select(document.createElementNS("http://www.w3.org/2000/svg", "g")).attr("class", "connections");
  const defs = state.svg.select("defs");
  let connIdx = 0;
  const groups = polyGroups(state.nodes);
  const drawn2 = {};
  for (let i = 0; i < allParamData.length; i++) {
    const dest = allParamData[i];
    if (!dest.param.subs || dest.param.subs.length === 0) continue;
    for (let si = 0; si < dest.param.subs.length; si++) {
      const sub = dest.param.subs[si];
      const srcIdx = sourceIndex(lookup, allParamData, sub);
      if (srcIdx === void 0) continue;
      const src = allParamData[srcIdx];
      const metrics = computeConnMetrics(connIdx, src, dest, nodeData);
      const elem = src.path !== sub.path ? elementIndex(lookup, sub.sku, sub.path, function(k2) {
        return allParamData[k2].param;
      }) : null;
      if (elem) {
        metrics.element = elem.n;
        metrics.typeCast = elemScalarType(src.param) !== (dest.param.type || "number");
      }
      const datum = buildDatum(metrics, dest, sub);
      datum.conn = sub.id;
      const place = sub.id ? linkOf(dest.sku, dest.path, sub.sku, sub.path, sub.id) : null;
      const both = !!(src.isCollapsed && dest.isCollapsed);
      if (sub.pick && sub.idle) {
        const pp = polyPlace(groups, src.sku, src.path);
        const key2 = dest.sku + "|" + sub.id + "|idle|" + (both ? src.collapsedGroupPath + ">" + dest.collapsedGroupPath : dest.path);
        if (pp && !drawn2[key2]) {
          drawn2[key2] = true;
          datum.whole = both;
          renderPoly(connGroup, metrics, datum, pp.group, 0);
          connIdx++;
        }
        continue;
      }
      const at = sub.poly ? polyPlace(groups, dest.sku, dest.path) : null;
      const from = sub.poly ? polyPlace(groups, src.sku, src.path) : null;
      if (at && from) {
        const taken = from.group.taken;
        if (both) {
          const key2 = from.key + ">" + at.key;
          if (!drawn2[key2]) {
            drawn2[key2] = true;
            datum.whole = true;
            renderPoly(connGroup, metrics, datum, from.group, taken.length);
            if (place && connTransformed(sub.id, dest.sku)) transformMarker(connGroup, metrics);
          }
        } else if (metrics.offlineConn) {
          renderPoly(connGroup, metrics, datum, from.group, 0);
        } else if (taken.indexOf(from.slot) < 0) {
          renderPoly(connGroup, metrics, datum, from.group, 0);
        } else {
          renderConnection(connGroup, defs, metrics, datum);
        }
        if (!both && place && !linkPlain(place.link.axes)) transformMarker(connGroup, metrics);
        connIdx++;
        continue;
      }
      if (both && place && isGroupConnection(dest.sku, place.conn)) {
        const key2 = dest.sku + "|" + sub.id + "|" + src.collapsedGroupPath + ">" + dest.collapsedGroupPath;
        if (!drawn2[key2]) {
          drawn2[key2] = true;
          datum.whole = true;
          renderConnection(connGroup, defs, metrics, datum);
          if (connTransformed(sub.id, dest.sku)) transformMarker(connGroup, metrics);
          connIdx++;
        }
        continue;
      }
      renderConnection(connGroup, defs, metrics, datum);
      if (place && !linkPlain(place.link.axes)) transformMarker(connGroup, metrics);
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
  state.g.node().insertBefore(connGroup.node(), before);
  overVideo(connGroup);
}
function overVideo(connGroup) {
  const mode = videoLines();
  if (mode === "blend") {
    connGroup.style("mix-blend-mode", "difference");
    return;
  }
  if (mode !== "halo") return;
  const conn2 = connGroup.node();
  const halos = document.createElementNS("http://www.w3.org/2000/svg", "g");
  halos.setAttribute("class", "conn-halos");
  halos.setAttribute("pointer-events", "none");
  conn2.querySelectorAll("[stroke-width]").forEach(function(el) {
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
  conn2.parentNode.insertBefore(halos, conn2);
}
function renderPoly(g, m, datum, group, taken) {
  const pathD = connectionPath(m.sx, m.sy, m.ex, m.ey);
  const dormant = m.offlineConn;
  const strands = dormant ? 1 : Math.max(1, Math.min(taken, group.slots));
  const width = dormant ? 1 : taken === 0 ? 0.8 : 0.9;
  const opacity = dormant ? 0.55 : taken === 0 ? 0.6 : 0.95;
  datum.restWidth = width;
  datum.restOpacity = opacity;
  const id = "poly-line-" + ++polyLineId;
  const line = g.append("path").attr("class", "sub-line").attr("id", id).attr("d", pathD).attr("fill", "none").attr("stroke", dormant ? "#3c3c3c" : taken === 0 ? "#6a6a6a" : m.srcColor).attr("stroke-width", width).attr("stroke-linecap", "round").attr("opacity", opacity).datum(datum);
  if (dormant) line.attr("stroke-dasharray", "7,6");
  if (strands > 1) {
    const dx = m.ex - m.sx, dy = m.ey - m.sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const gap = 1.9 * connScale();
    for (let k = 1; k < strands; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * gap;
      const shade = 0.45 + 0.5 * (k * 0.618 % 1);
      g.append("use").attr("class", "poly-strand").attr("href", "#" + id).attr("transform", "translate(" + nx * off + "," + ny * off + ")").attr("opacity", shade).style("pointer-events", "none");
    }
  }
  g.append("path").attr("class", "sub-hit").attr("d", pathD).attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 10).datum(datum);
}
var polyLineId = 0;
function connTransformed(id, destSku) {
  const c = connectionById(destSku, id);
  return !!c && c.links.some(function(l) {
    return !linkPlain(l.axes);
  });
}
function transformMarker(g, m) {
  const cp = connectionControlPoint(m.sx, m.sy, m.ex, m.ey);
  const p = bezierPoint(m.sx, m.sy, cp.cpx, cp.cpy, m.ex, m.ey, 0.62);
  const t = bezierTangent(m.sx, m.sy, cp.cpx, cp.cpy, m.ex, m.ey, 0.62);
  const deg = Math.atan2(t.ty, t.tx) * 180 / Math.PI;
  g.append("path").attr("class", "conn-transform-marker").attr("d", "M-3.5,2 C-1,2 1,-2 3.5,-2").attr("transform", "translate(" + p.x + "," + p.y + ") rotate(" + deg + ")").attr("fill", "none").attr("stroke", "#bbb").attr("stroke-width", 0.9).attr("stroke-linecap", "round").attr("opacity", 0.75);
}
function luminance(css2) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css2 || "");
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
    const a = endAt(at, allParamData, p.source_sku, p.source_path), b = endAt(at, allParamData, p.dest_sku, p.dest_path);
    if (!a || !b) continue;
    layer.append("path").attr("class", "pending-link").attr("d", connectionPath(a.cx, a.cy, b.cx, b.cy)).attr("stroke-width", 1.2 * connScale()).style("animation-delay", -(Date.now() % 600) + "ms");
  }
}
function endAt(at, all, sku, path) {
  if (at[sku + "|" + path]) return at[sku + "|" + path];
  const m = /^(.+)\/[1-9][0-9]*$/.exec(path);
  if (m && at[sku + "|" + m[1]] && at[sku + "|" + m[1]].param.type === "array") return at[sku + "|" + m[1]];
  const dots = state.collapsedDots;
  for (let i = 0; i < dots.length; i++) {
    const d = dots[i];
    if (d.sku === sku && (d.groupPath === path || path.indexOf(d.groupPath + "/") === 0)) return d;
  }
  const inside = all.filter(function(pd) {
    return pd.sku === sku && pd.path.indexOf(path + "/") === 0;
  });
  return inside.length ? inside[Math.floor(inside.length / 2)] : null;
}
function sourceIndex(lookup, all, sub) {
  const i = lookup[sub.sku + "|" + sub.path];
  if (i !== void 0) return i;
  const e = elementIndex(lookup, sub.sku, sub.path, function(k) {
    return all[k].param;
  });
  return e ? e.idx : void 0;
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
  return pathDistance(pathEl.getAttribute("d") || "", pt.x, pt.y);
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
var MSG_UNSUBSCRIBE_ID = "unsubscribe_id";
var MSG_LINK_EDIT = "link_edit";
var MSG_FLUSH = "flush_node";
var MSG_FORGET_OFFLINE = "forget_offline";
var MSG_SET_VALUE = "set_value";
var MSG_UPDATE_PARAM = "update_param";
var MSG_DELETE_PARAM = "delete_param";
var MSG_ADD_PARAM = "add_param";
var MSG_LOCATE = "locate";
var MSG_HALT = "halt";
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
var READ_ONLY_TEXT = "read-only: set by its node";
function isReadOnly(p) {
  return !!p && p.access === "read";
}
function paramReadOnly(sku, path) {
  return isReadOnly(findParam(sku, path));
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
  if (p) return p.label || p.name;
  const n = state.nodes.find(function(x) {
    return x.sku === sku;
  });
  const e = n ? elementOf(n.params, path) : null;
  if (e) return (e.array.label || e.array.name) + "[" + e.n + "]";
  return path.split("/").pop() || path;
}
function describeLink(l) {
  return paramName(l.source_sku, l.source_path) + " \u2192 " + paramName(l.dest_sku, l.dest_path);
}
function describeEnds(e) {
  return describeLink({ dest_sku: e.dest_sku, dest_path: e.dest, source_sku: e.sku, source_path: e.source });
}
function endsOf(destSku, c) {
  const e = { dest_sku: destSku, dest: c.dest, sku: c.sku, source: c.source };
  if (c.pick) e.pick = { ...c.pick };
  return e;
}
function sameEnds(a, b) {
  return a.dest_sku === b.dest_sku && a.dest === b.dest && a.sku === b.sku && a.source === b.source;
}
function linkState(l) {
  return { source: l.source, chosen: !!l.chosen, axes: copyAxes(l.axes || []) };
}
function copyAxes(axes) {
  return axes.map(function(a) {
    const o = {};
    if (a.in) o.in = [a.in[0], a.in[1]];
    if (a.out) o.out = [a.out[0], a.out[1]];
    if (a.curve) o.curve = a.curve.map(function(p) {
      return [p[0], p[1]];
    });
    if (a.free) o.free = true;
    return o;
  });
}
function copyLinks(links) {
  return links.map(function(l) {
    const o = { dest: l.dest, source: l.source };
    if (l.chosen) o.chosen = true;
    if (l.axes) o.axes = copyAxes(l.axes);
    return o;
  });
}
function toSendable(v, type) {
  if (v === null || v === void 0) return null;
  if (type === "array") return Array.isArray(v) ? v.slice() : null;
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
  const m = {
    type: MSG_SUBSCRIBE,
    dest_sku: l.dest_sku,
    dest_path: l.dest_path,
    source_sku: l.source_sku,
    source_path: l.source_path
  };
  if (l.pick) m.pick = { ...l.pick };
  state.ws.send(JSON.stringify(m));
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
function sendUnsubscribeId(destSku, id) {
  if (!wsReady()) return false;
  state.ws.send(JSON.stringify({ type: MSG_UNSUBSCRIBE_ID, dest_sku: destSku, id }));
  return true;
}
function sendLinkState(e, linkDest, st) {
  const c = connectionByEnds(e.dest_sku, e.dest, e.sku, e.source);
  if (!c || !wsReady()) return false;
  const msg = { type: MSG_LINK_EDIT, dest_sku: e.dest_sku, id: c.id, dest: linkDest };
  if (st.chosen) msg.source = st.source;
  else msg.reset = true;
  msg.axes = st.axes;
  state.ws.send(JSON.stringify(msg));
  return true;
}
function sendLinkAxes(destSku, id, linkDest, axes) {
  if (!wsReady()) return false;
  state.ws.send(JSON.stringify({ type: MSG_LINK_EDIT, dest_sku: destSku, id, dest: linkDest, axes }));
  return true;
}
function sendValue(sku, path, value) {
  if (!wsReady() || paramReadOnly(sku, path)) return false;
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
function removeConnection(destSku, c) {
  if (!sendUnsubscribeId(destSku, c.id)) return false;
  recordStep({ kind: "conn", ends: endsOf(destSku, c), links: copyLinks(c.links), on: false });
  return true;
}
function editLink(e, linkDest, before, after) {
  if (!sendLinkState(e, linkDest, after)) return false;
  recordLinkEdit(e, linkDest, before, after);
  return true;
}
function recordLinkEdit(e, linkDest, before, after) {
  recordStep({
    kind: "edit",
    ends: { dest_sku: e.dest_sku, dest: e.dest, sku: e.sku, source: e.source },
    link: linkDest,
    before,
    after
  });
}
function disconnectCable(d) {
  const at = linkOf(d.dest_sku, d.dest_path, d.source_sku, d.source_path, d.conn);
  if (!at) return unsubscribeLink(d);
  const c = at.conn;
  if (c.poly || d.whole || !isGroupConnection(d.dest_sku, c)) return removeConnection(d.dest_sku, c);
  const before = linkState(at.link);
  return editLink(
    endsOf(d.dest_sku, c),
    at.link.dest,
    before,
    { source: "", chosen: true, axes: before.axes }
  );
}
function setParamValue(sku, path, value) {
  if (paramReadOnly(sku, path)) {
    notify(paramName(sku, path) + " is " + READ_ONLY_TEXT, void 0, "error");
    return false;
  }
  const before = currentValue(sku, path);
  if (!sendValue(sku, path, value)) return false;
  const key2 = sku + "|" + path;
  const now = Date.now();
  const top = undoStack[undoStack.length - 1];
  const after = Array.isArray(value) ? value.slice() : value;
  if (coalesce && coalesce.key === key2 && now - coalesce.time < COALESCE_MS && top && top.kind === "value") {
    top.after = after;
    coalesce.time = now;
    return true;
  }
  recordStep({ kind: "value", sku, path, before, after });
  coalesce = { key: key2, time: now };
  return true;
}
function copyLink(l) {
  const o = { dest_sku: l.dest_sku, dest_path: l.dest_path, source_sku: l.source_sku, source_path: l.source_path };
  if (l.pick) o.pick = { ...l.pick };
  return o;
}
var restores = [];
var RESTORE_GIVE_UP_MS = 15e3;
function checkRestores() {
  if (!restores.length) return;
  const now = Date.now();
  restores = restores.filter(function(r) {
    const c = connectionByEnds(r.ends.dest_sku, r.ends.dest, r.ends.sku, r.ends.source);
    if (!c) return now - r.time < RESTORE_GIVE_UP_MS;
    for (let i = 0; i < r.links.length; i++) {
      const l = r.links[i];
      if (!l.chosen && !(l.axes && l.axes.length)) continue;
      sendLinkState(r.ends, l.dest, linkState(l));
    }
    return false;
  });
}
function applyLeaf(s, forward, r) {
  if (s.kind === "conn") {
    const make = forward ? s.on : !s.on;
    const e = s.ends;
    const missing = [e.dest_sku].concat(make ? [e.sku] : []).filter(function(k) {
      return !nodeAvailable(k);
    });
    if (missing.length) {
      r.skipped++;
      for (let i = 0; i < missing.length; i++) r.offline[nodeName(missing[i])] = true;
      return;
    }
    const l = { dest_sku: e.dest_sku, dest_path: e.dest, source_sku: e.sku, source_path: e.source };
    if (e.pick) l.pick = { ...e.pick };
    if (make) {
      if (!sendSubscribe(l)) return;
      restores = restores.filter(function(x) {
        return !sameEnds(x.ends, e);
      });
      restores.push({ ends: e, links: s.links, time: Date.now() });
      r.done++;
      return;
    }
    const c = connectionByEnds(e.dest_sku, e.dest, e.sku, e.source);
    if (c ? sendUnsubscribeId(e.dest_sku, c.id) : sendUnsubscribe(l)) r.done++;
    return;
  }
  if (s.kind === "edit") {
    if (!nodeAvailable(s.ends.dest_sku)) {
      r.skipped++;
      r.offline[nodeName(s.ends.dest_sku)] = true;
      return;
    }
    if (sendLinkState(s.ends, s.link, forward ? s.after : s.before)) r.done++;
    else r.skipped++;
    return;
  }
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
  else r.skipped++;
}
function apply(step, forward) {
  const r = { done: 0, skipped: 0, offline: {} };
  applyLeaf(step, forward, r);
  return r;
}
function stepLabel(s) {
  if (s.kind === "link") return (s.on ? "connect " : "disconnect ") + describeLink(s.link);
  if (s.kind === "conn") return (s.on ? "connect " : "disconnect ") + describeEnds(s.ends);
  if (s.kind === "edit") return "edit " + (s.link || paramName(s.ends.dest_sku, s.ends.dest)) + " of " + describeEnds(s.ends);
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
    disconnectCable,
    editLink,
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

// ../../../../Projects/124_dataflou/web/src/pickmenu.ts
function instanceOf(sku, path) {
  const segs = path.split("/");
  for (let i = segs.length - 1; i >= 1; i--) {
    const pop = resolveIn(sku, segs.slice(0, i).join("/"));
    if (pop && pop.kind === "group" && pop.slots && /^\d+$/.test(segs[i]))
      return { pop: segs.slice(0, i).join("/"), slot: segs[i], within: segs.slice(i + 1).join("/") };
  }
  return null;
}
function liveId(sku, e) {
  const slot = resolveIn(sku, e.pop + "/" + e.slot);
  if (!slot || slot.kind !== "group" || !slot.children) return null;
  let id = null, live = false;
  for (let i = 0; i < slot.children.length; i++) {
    const c = slot.children[i];
    if (c.kind !== "param") continue;
    if ((c.role === "id" || !c.role && c.name === "id") && typeof c.value === "number") id = c.value;
    if ((c.role === "gate" || !c.role && c.name === "on" && c.type === "bool") && (c.value === true || c.value === 1)) live = true;
  }
  return live ? id : null;
}
var open = null;
function closePickMenu() {
  if (open) open.remove();
  open = null;
}
function pickMenu(at, sku, e, then) {
  closePickMenu();
  const star = e.pop + "/*" + (e.within ? "/" + e.within : "");
  const concrete = e.pop + "/" + e.slot + (e.within ? "/" + e.within : "");
  const pop = resolveIn(sku, e.pop);
  const ids = pop && pop.kind === "group" ? pop.ids : void 0;
  const id = liveId(sku, e);
  const choices = [];
  if (id !== null) choices.push({ label: "id " + id, hint: ids === "source" ? "this one, wherever it is" : "this one while it lives", path: star, pick: { id } });
  choices.push({ label: "newest", hint: "the last one that came", path: star, pick: { rank: -1 } });
  choices.push({ label: "oldest", hint: "the first one still there", path: star, pick: { rank: 1 } });
  choices.push({ label: "slot " + e.slot, hint: "whatever is in it", path: concrete });
  const menu = document.createElement("div");
  menu.className = "pick-menu";
  const title = document.createElement("div");
  title.className = "pick-title";
  title.textContent = (e.pop.split("/").pop() || e.pop) + ": which one?";
  menu.appendChild(title);
  choices.forEach(function(c) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="pick-label"></span><span class="pick-hint"></span>';
    b.firstChild.textContent = c.label;
    b.lastChild.textContent = c.hint;
    b.addEventListener("click", function(ev) {
      ev.stopPropagation();
      closePickMenu();
      then(c.path, c.pick);
    });
    menu.appendChild(b);
  });
  menu.style.left = at.clientX + "px";
  menu.style.top = at.clientY + "px";
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - 8 - r.width) + "px";
  if (r.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - 8 - r.height) + "px";
  open = menu;
  const away = function(ev) {
    if (open !== menu) {
      cleanup();
      return;
    }
    if (ev instanceof KeyboardEvent && ev.key !== "Escape") return;
    if (ev instanceof MouseEvent && menu.contains(ev.target)) return;
    closePickMenu();
    cleanup();
  };
  const cleanup = function() {
    document.removeEventListener("mousedown", away, true);
    document.removeEventListener("keydown", away, true);
  };
  setTimeout(function() {
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", away, true);
  }, 0);
}
function takesPick(destSku, destPath) {
  if (instanceOf(destSku, destPath)) return false;
  const d = resolveIn(destSku, destPath);
  return !!d && !(d.kind === "group" && d.slots);
}

// ../../../../Projects/124_dataflou/web/src/groupdrag.ts
var THRESHOLD_PX = 4;
var armed = null;
var drag = null;
function isGroupDragging() {
  return !!drag;
}
function armGroupDrag(d, event, open3) {
  if (event.button !== 0 || event.shiftKey) return;
  armed = { d, x: event.clientX, y: event.clientY, open: open3 };
}
function key(sku, path) {
  return sku + "|" + path;
}
var raised = {};
function raiseDots(keys) {
  if (!state.g) return;
  const was = raised;
  raised = {};
  state.g.selectAll(".group-pull").remove();
  state.g.selectAll(".collapsed-dot").each(function(d) {
    if (!d || !keys[d.groupKey]) return;
    const dot = state.collapsedDots.find(function(c) {
      return key(c.sku, c.groupPath) === d.groupKey;
    });
    const r = dot ? Math.sqrt(dot.cx * dot.cx + dot.cy * dot.cy) : 0;
    if (!dot || r < 0.01) return;
    const pos = { cx: dot.cx * (1 - PULL_DIST / r), cy: dot.cy * (1 - PULL_DIST / r) };
    raised[d.groupKey] = pos;
    const el = d3.select(this);
    const tether = state.g.insert("line", function() {
      return el.node();
    }).attr("class", "group-pull").attr("x1", dot.cx).attr("y1", dot.cy).attr("x2", dot.cx).attr("y2", dot.cy).attr("stroke", C_CYAN).attr("stroke-width", 0.5).attr("opacity", 0.3).style("pointer-events", "none");
    if (was[d.groupKey]) {
      el.attr("cx", pos.cx).attr("cy", pos.cy);
      tether.attr("x1", pos.cx).attr("y1", pos.cy);
    } else {
      el.transition().duration(EXTEND_DUR).ease(d3.easeBackOut).attr("cx", pos.cx).attr("cy", pos.cy);
      tether.transition().duration(EXTEND_DUR).ease(d3.easeBackOut).attr("x1", pos.cx).attr("y1", pos.cy);
    }
  });
}
function lowerDots() {
  if (state.g) {
    state.g.selectAll(".collapsed-dot").each(function(d) {
      const dot = d && raised[d.groupKey] ? state.collapsedDots.find(function(c) {
        return key(c.sku, c.groupPath) === d.groupKey;
      }) : void 0;
      if (dot) d3.select(this).transition().duration(RETRACT_DUR).attr("cx", dot.cx).attr("cy", dot.cy);
    });
    state.g.selectAll(".group-pull").transition().duration(RETRACT_DUR).attr("opacity", 0).remove();
  }
  raised = {};
}
function dotOf(groupKey) {
  const at = function(c) {
    return key(c.sku, c.groupPath) === groupKey;
  };
  const dot = state.collapsedDots.find(at);
  const pulled = dot && raised[groupKey] ? raised[groupKey] : dot && state.ringHover && !state.ringHover.retracting && state.ringHover.pulledDots ? state.ringHover.pulledDots[groupKey] : void 0;
  if (dot && pulled) return { sku: dot.sku, groupPath: dot.groupPath, nodeIdx: dot.nodeIdx, angle: dot.angle, cx: pulled.cx, cy: pulled.cy };
  return dot || state.openGroups.find(at);
}
function groupUnder(target) {
  const el = target && target.closest ? target.closest(".collapsed-dot, .collapsed-hit, .group-hit") : null;
  if (!el) return null;
  if (!el.classList.contains("group-hit")) return d3.select(el).datum().groupKey;
  const g = d3.select(el).datum();
  const nd = state.nodeData[g.nodeIdx];
  return nd ? key(nd.node.sku, g.groupPath) : null;
}
function pairing(from, to) {
  if (from.sku === to.sku && (from.groupPath === to.groupPath || to.groupPath.indexOf(from.groupPath + "/") === 0 || from.groupPath.indexOf(to.groupPath + "/") === 0)) return null;
  const a = { sku: from.sku, path: from.groupPath }, b = { sku: to.sku, path: to.groupPath };
  const listens = wouldLink(a.sku, a.path, b.sku, b.path).links;
  const feeds = wouldLink(b.sku, b.path, a.sku, a.path).links;
  if (!listens && !feeds) return null;
  const p = listens >= feeds ? { dest: a, src: b } : { dest: b, src: a };
  return connectionByEnds(p.dest.sku, p.dest.path, p.src.sku, p.src.path) ? null : p;
}
function svgPoint(clientX, clientY) {
  if (!state.svg || !state.g) return null;
  const m = state.g.node().getScreenCTM();
  if (!m) return null;
  const pt = state.svg.node().createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const q = pt.matrixTransform(m.inverse());
  return { x: q.x, y: q.y };
}
function springs(from, c) {
  const g = resolveIn(c.sku, c.groupPath);
  if (!g || g.kind !== "group" || !g.slots) return false;
  if (from.sku === c.sku && (from.groupPath.indexOf(c.groupPath + "/") === 0 || c.groupPath.indexOf(from.groupPath + "/") === 0)) return false;
  const first = { sku: c.sku, groupPath: c.groupPath + "/1", cx: 0, cy: 0, nodeIdx: c.nodeIdx, angle: 0 };
  return !!(wouldLink(from.sku, from.groupPath, first.sku, first.groupPath).links || wouldLink(first.sku, first.groupPath, from.sku, from.groupPath).links);
}
function aim(ds) {
  ds.targets = {};
  ds.springs = {};
  const all = state.collapsedDots.concat(state.openGroups);
  for (let i = 0; i < all.length; i++) {
    const k = key(all[i].sku, all[i].groupPath);
    const p = pairing(ds.from, all[i]);
    if (p) ds.targets[k] = p;
    else if (i < state.collapsedDots.length && springs(ds.from, all[i])) ds.springs[k] = true;
  }
}
function begin(d) {
  drag = { from: d, targets: {}, springs: {}, opened: [], spring: null, snap: null, line: null, ring: null };
  document.body.style.cursor = "pointer";
  restoreGroupDrag();
}
function springCancel(ds) {
  if (ds.spring) window.clearTimeout(ds.spring.timer);
  ds.spring = null;
  if (state.g) state.g.selectAll(".spring-arming").classed("spring-arming", false);
}
function springAt(ds, k) {
  if (ds.spring && ds.spring.key === k) return;
  springCancel(ds);
  if (!k || !ds.springs[k]) return;
  state.g.selectAll(".collapsed-dot").classed("spring-arming", function(d) {
    return !!(d && d.groupKey === k);
  });
  ds.spring = { key: k, timer: window.setTimeout(function() {
    if (drag !== ds || !state.collapsedGroups[k]) return;
    ds.spring = null;
    delete state.collapsedGroups[k];
    ds.opened.push(k);
    renderOpening();
  }, SPRING_MS) };
}
function closeOpened(ds) {
  springCancel(ds);
  for (let i = 0; i < ds.opened.length; i++) state.collapsedGroups[ds.opened[i]] = true;
  if (ds.opened.length) renderOpening();
}
function restoreGroupDrag() {
  if (!drag || !state.g) return;
  const ds = drag;
  const from = dotOf(ds.from.groupKey);
  if (!from) {
    cancel();
    return;
  }
  aim(ds);
  state.g.selectAll(".collapsed-dot").classed("drag-candidate-group", function(d) {
    return !!(d && (ds.targets[d.groupKey] || ds.springs[d.groupKey]));
  });
  const come = {};
  for (const k in ds.targets) come[k] = true;
  for (const k in ds.springs) come[k] = true;
  delete come[ds.from.groupKey];
  raiseDots(come);
  state.g.selectAll(".group-arc").classed("drag-candidate-group", function(g) {
    const nd = g ? state.nodeData[g.nodeIdx] : void 0;
    return !!(nd && ds.targets[key(nd.node.sku, g.groupPath)]);
  });
  ds.line = state.g.append("path").attr("class", "drag-line").attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").attr("opacity", 0.6);
  ds.ring = state.g.append("circle").attr("class", "drop-highlight").attr("r", 10).attr("fill", "none").attr("stroke", C_CYAN).attr("stroke-width", 2).attr("opacity", 0);
  const x = state.lastMouseClient.x, y = state.lastMouseClient.y;
  ds.snap = null;
  follow(x, y, document.elementFromPoint(x, y));
}
function follow(clientX, clientY, target) {
  if (!drag || !drag.line || !drag.ring) return;
  const from = dotOf(drag.from.groupKey);
  const p = svgPoint(clientX, clientY);
  if (!from || !p) return;
  let snap = null;
  const under = groupUnder(target);
  let spring = under && drag.springs[under] ? under : null;
  if (!spring) {
    let best = SNAP_DIST * SNAP_DIST;
    for (const k in drag.springs) {
      const c = dotOf(k);
      if (!c) continue;
      const d2 = (c.cx - p.x) * (c.cx - p.x) + (c.cy - p.y) * (c.cy - p.y);
      if (d2 < best) {
        best = d2;
        spring = k;
      }
    }
  }
  springAt(drag, spring);
  if (under && drag.targets[under]) snap = under;
  else {
    let best = SNAP_DIST * SNAP_DIST;
    for (const k in drag.targets) {
      const c = dotOf(k);
      if (!c) continue;
      const d2 = (c.cx - p.x) * (c.cx - p.x) + (c.cy - p.y) * (c.cy - p.y);
      if (d2 < best) {
        best = d2;
        snap = k;
      }
    }
  }
  const to = snap ? dotOf(snap) : void 0;
  if (to) {
    if (drag.snap !== snap) {
      drag.ring.interrupt().attr("r", 17).transition().duration(170).ease(d3.easeBackOut).attr("r", 10);
      drag.line.attr("stroke", C_CYAN).attr("stroke-dasharray", null).attr("opacity", 0.8);
    }
    drag.ring.attr("cx", to.cx).attr("cy", to.cy).attr("opacity", 1);
    drag.line.attr("d", connectionPath(from.cx, from.cy, to.cx, to.cy));
  } else {
    drag.ring.attr("opacity", 0);
    drag.line.attr("stroke", "#fff").attr("stroke-dasharray", "3,3").attr("opacity", 0.6).attr("d", dragPath(from.cx, from.cy, p.x, p.y));
  }
  drag.snap = to ? snap : null;
}
function clearMarks(ring) {
  lowerDots();
  if (!state.g) return;
  state.g.selectAll(".drag-candidate-group").classed("drag-candidate-group", false);
  if (ring) ring.remove();
  document.body.style.cursor = "";
}
function cancel() {
  if (!drag) return;
  const ds = drag;
  clearMarks(ds.ring);
  if (ds.line) ds.line.remove();
  drag = null;
  closeOpened(ds);
}
function drop(event) {
  if (!drag) return;
  follow(event.clientX, event.clientY, event.target);
  const ds = drag;
  drag = null;
  clearMarks(ds.ring);
  const line = ds.line;
  const from = dotOf(ds.from.groupKey);
  const p = ds.snap ? ds.targets[ds.snap] : null;
  const to = ds.snap ? dotOf(ds.snap) : void 0;
  closeOpened(ds);
  if (p && to && from && line) {
    const at = { clientX: event.clientX, clientY: event.clientY };
    const inst = takesPick(p.dest.sku, p.dest.path) ? instanceOf(p.src.sku, p.src.path) : null;
    if (inst) {
      pickMenu(at, p.src.sku, inst, function(sourcePath, pick) {
        subscribeLink({
          dest_sku: p.dest.sku,
          dest_path: p.dest.path,
          source_sku: p.src.sku,
          source_path: sourcePath,
          pick
        }, at);
      });
    } else {
      subscribeLink({ dest_sku: p.dest.sku, dest_path: p.dest.path, source_sku: p.src.sku, source_path: p.src.path }, at);
    }
    line.transition().duration(DROP_FADE_DUR).attr("opacity", 0).remove();
    return;
  }
  const underKey = groupUnder(event.target);
  const under = underKey ? dotOf(underKey) : void 0;
  if (under && underKey !== ds.from.groupKey) {
    const a = { sku: ds.from.sku, path: ds.from.groupPath }, b = { sku: under.sku, path: under.groupPath };
    const linked = connectionByEnds(a.sku, a.path, b.sku, b.path) || connectionByEnds(b.sku, b.path, a.sku, a.path);
    showToast(event, linked ? "Already connected" : "No parameter names in common");
  }
  if (line && from) {
    line.interrupt().transition().duration(SNAP_DUR).ease(d3.easeCubicIn).attr("d", "M" + from.cx + "," + from.cy + " Q" + from.cx + "," + from.cy + " " + from.cx + "," + from.cy).attr("opacity", 0).remove();
  } else if (line) line.remove();
}
window.addEventListener("mousemove", function(e) {
  if (armed && !drag) {
    const dx = e.clientX - armed.x, dy = e.clientY - armed.y;
    if (dx * dx + dy * dy < THRESHOLD_PX * THRESHOLD_PX) return;
    const d = armed.d;
    begin(d);
    armed = null;
  }
  if (drag) follow(e.clientX, e.clientY, e.target);
});
window.addEventListener("mouseup", function(e) {
  if (armed) {
    const open3 = armed.open;
    armed = null;
    open3();
    return;
  }
  drop(e);
});
window.addEventListener("blur", function() {
  armed = null;
  cancel();
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape" && drag) {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }
}, true);
document.addEventListener("contextmenu", function(e) {
  if (drag) {
    e.preventDefault();
    cancel();
  }
}, true);

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
function openDown(key2, out) {
  for (const k in state.collapsedGroups)
    if (k === key2 || k.indexOf(key2 + "/") === 0) {
      delete state.collapsedGroups[k];
      out.push(k);
    }
}
function expandCollapsedCandidates(dragPd, reverse) {
  const expandedKeys = [];
  const seen2 = {};
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
    if (!seen2[groupKey] && state.collapsedGroups[groupKey]) {
      seen2[groupKey] = true;
      openDown(groupKey, expandedKeys);
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
    const key2 = pd.sku + "|" + pd.path;
    let pcx = pd.cx, pcy = pd.cy;
    if (pulledPos && pulledPos[key2]) {
      pcx = pulledPos[key2].cx;
      pcy = pulledPos[key2].cy;
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
function addTether(pd, pos, key2, animate = true) {
  const line = state.g.append("line").attr("class", "pull-segment").attr("x1", animate ? pd.cx : pos.cx).attr("y1", animate ? pd.cy : pos.cy).attr("x2", pd.cx).attr("y2", pd.cy).attr("stroke", C_CYAN).attr("stroke-width", 0.5).attr("opacity", 0.3).datum({ paramKey: key2 });
  if (animate) {
    line.transition().duration(extendDuration).ease(d3.easeBackOut).attr("x1", pos.cx).attr("y1", pos.cy);
  }
}
function pulledPoint(pd) {
  const r = Math.sqrt(pd.cx * pd.cx + pd.cy * pd.cy);
  if (r < 0.01) return null;
  return { cx: pd.cx * (1 - pullDist / r), cy: pd.cy * (1 - pullDist / r) };
}
function eachPulledDot(f) {
  const inner = {};
  const takes = {};
  for (let i = 0; i < state.allParamData.length; i++) {
    const pd = state.allParamData[i];
    if (!pd.isCollapsed || pd.param.error) continue;
    const g = pd.sku + "|" + pd.collapsedGroupPath;
    (inner[g] || (inner[g] = [])).push(pd.sku + "|" + pd.path);
    if (pd.param.flow === "destination" || pd.param.flow === "bidir") takes[g] = true;
  }
  state.g.selectAll(".collapsed-dot").each(function() {
    const d = d3.select(this).datum();
    if (!d || !takes[d.groupKey]) return;
    const dot = state.collapsedDots.find(function(c) {
      return c.sku + "|" + c.groupPath === d.groupKey;
    });
    const pos = dot ? pulledPoint(dot) : null;
    if (dot && pos) f(d3.select(this), d.groupKey, pos, inner[d.groupKey] || []);
  });
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
  raiseDots(keys);
}
var springKey = null;
var springTimer = null;
var springStart = 0;
function springCancel2() {
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
  const key2 = d && d.groupKey ? d.groupKey : null;
  if (key2 === springKey) return;
  springCancel2();
  springKey = key2;
  if (!key2) return;
  el.classList.add("spring-arming");
  springStart = performance.now();
  drawSpringRing();
  springTimer = window.setTimeout(function() {
    springTimer = null;
    springKey = null;
    if (state.g) state.g.selectAll(".spring-ring").remove();
    const ds = state.dragState;
    if (!ds || ds.retracting || !state.collapsedGroups[key2]) return;
    openDown(key2, ds.autoExpandedKeys = ds.autoExpandedKeys || []);
    renderOpening();
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
function snapCables(pulledPos) {
  const all = state.allParamData;
  const lookup = {};
  for (let i = 0; i < all.length; i++) lookup[all[i].sku + "|" + all[i].path] = i;
  const ends = function(d) {
    const srcKey = drawnSourceKey(d);
    const dstKey = d.dest_sku + "|" + d.dest_path;
    const srcPulled = pulledPos[srcKey];
    const dstPulled = pulledPos[dstKey];
    if (!srcPulled && !dstPulled) return null;
    const srcIdx = lookup[srcKey];
    const dstIdx = lookup[dstKey];
    if (srcIdx === void 0 || dstIdx === void 0) return null;
    return {
      sx: srcPulled ? srcPulled.cx : all[srcIdx].cx,
      sy: srcPulled ? srcPulled.cy : all[srcIdx].cy,
      ex: dstPulled ? dstPulled.cx : all[dstIdx].cx,
      ey: dstPulled ? dstPulled.cy : all[dstIdx].cy
    };
  };
  state.g.selectAll(".sub-line").each(function(d) {
    const e = d ? ends(d) : null;
    if (!e) return;
    const isRail2 = this.classList.contains("conn-rail-2");
    this.setAttribute("d", strategyPathForDatum(d, e.sx, e.sy, e.ex, e.ey, isRail2));
  });
  state.g.selectAll(".sub-hit").each(function(d) {
    const e = d ? ends(d) : null;
    if (e) this.setAttribute("d", connectionPath(e.sx, e.sy, e.ex, e.ey));
  });
}
function snapCablesToPulled() {
  if (!state.g) return;
  const ds = state.dragState;
  if (ds && !ds.retracting && ds.pulledPos) snapCables(ds.pulledPos);
  else if (state.ringHover && !state.ringHover.retracting && state.ringHover.pulledPos) snapCables(state.ringHover.pulledPos);
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
      const srcKey = drawnSourceKey(d);
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
      const srcKey = drawnSourceKey(d);
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
      const srcKey = drawnSourceKey(d);
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
        const key2 = pd.sku + "|" + pd.path;
        pulledPos[key2] = pos;
        addTether(pd, pos, key2);
      }
    });
    const pulledDots = {};
    eachPulledDot(function(el, groupKey, pos, inner) {
      const dot = state.collapsedDots.find(function(c) {
        return c.sku + "|" + c.groupPath === groupKey;
      });
      el.transition().duration(extendDuration).ease(d3.easeBackOut).attr("cx", pos.cx).attr("cy", pos.cy);
      addTether({ cx: dot.cx, cy: dot.cy }, pos, groupKey);
      pulledDots[groupKey] = pos;
      for (let i = 0; i < inner.length; i++) pulledPos[inner[i]] = pos;
    });
    animateConnectionsToPulled(pulledPos, true);
    state.ringHover = { pulledPos, pulledDots };
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
      const key2 = pd.sku + "|" + pd.path;
      if (state.ringHover.pulledPos[key2]) {
        retractElement(el, pd);
      }
    });
    const dots = state.ringHover.pulledDots || {};
    state.g.selectAll(".collapsed-dot").each(function() {
      const d = d3.select(this).datum();
      const dot = d && dots[d.groupKey] ? state.collapsedDots.find(function(c) {
        return c.sku + "|" + c.groupPath === d.groupKey;
      }) : void 0;
      if (dot) d3.select(this).transition().duration(retractDuration).attr("cx", dot.cx).attr("cy", dot.cy);
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
        const key2 = tpd.sku + "|" + tpd.path;
        if (validKeys[key2]) {
          if (hoverPulled[key2]) dragPulledPos[key2] = hoverPulled[key2];
        } else if (key2 !== clickedKey && hoverPulled[key2]) {
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
        const key2 = tpd.sku + "|" + tpd.path;
        if (!dragPulledPos[key2]) {
          const pos = pullElement(el, tpd);
          if (pos) {
            dragPulledPos[key2] = pos;
            addTether(tpd, pos, key2);
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
          const key2 = tpd.sku + "|" + tpd.path;
          dragPulledPos[key2] = pos;
          addTether(tpd, pos, key2);
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
    springCancel2();
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
      if (isGroupDragging()) return;
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
    springCancel2();
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
      const key2 = tpd.sku + "|" + tpd.path;
      const clickedKey = startPd.sku + "|" + startPd.path;
      if (key2 === clickedKey && !el.classed("drag-target")) {
        retractElement(el, tpd);
      }
    });
    retractTethers(null);
    const autoExpandedKeys = state.dragState.autoExpandedKeys || [];
    state.g.selectAll(".drag-candidate-group").classed("drag-candidate-group", false);
    lowerDots();
    state.dragState = { retracting: true };
    setTimeout(function() {
      state.g.selectAll(".param-shape").classed("drag-target", false);
      state.dragState = null;
      document.body.style.cursor = "";
      if (autoExpandedKeys.length > 0 || openGroupKey) {
        for (let i = 0; i < autoExpandedKeys.length; i++) {
          state.collapsedGroups[autoExpandedKeys[i]] = true;
        }
        if (openGroupKey) delete state.collapsedGroups[openGroupKey];
        renderOpening();
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
      const at = { clientX: event.clientX, clientY: event.clientY };
      const inst = takesPick(destPd.sku, destPd.path) ? instanceOf(srcPd.sku, srcPd.path) : null;
      if (inst) {
        pickMenu(at, srcPd.sku, inst, function(sourcePath, pick) {
          subscribeLink({
            dest_sku: destPd.sku,
            dest_path: destPd.path,
            source_sku: srcPd.sku,
            source_path: sourcePath,
            pick
          }, at);
        });
      } else {
        subscribeLink({
          dest_sku: destPd.sku,
          dest_path: destPd.path,
          source_sku: srcPd.sku,
          source_path: srcPd.path
        }, at);
      }
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
    for (const key2 in state.ringHover.pulledPos) {
      const idx = paramLookup[key2];
      if (idx === void 0 || allParamData[idx].isCollapsed) continue;
      const pp = pulledPoint(allParamData[idx]);
      if (pp) pulledPos[key2] = pp;
    }
    const pulledDots = {};
    eachPulledDot(function(el, groupKey, pos, inner) {
      el.attr("cx", pos.cx).attr("cy", pos.cy);
      pulledDots[groupKey] = pos;
      for (let i = 0; i < inner.length; i++) pulledPos[inner[i]] = pos;
    });
    state.ringHover.pulledPos = pulledPos;
    state.ringHover.pulledDots = pulledDots;
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const pd = allParamData[dd.paramIdx];
      if (!pd) return;
      const key2 = pd.sku + "|" + pd.path;
      const pos = pulledPos[key2];
      if (!pos) return;
      const tag = el.node().tagName.toLowerCase();
      const deg = pd.angle * 180 / Math.PI;
      if (tag === "circle") {
        el.attr("cx", pos.cx).attr("cy", pos.cy);
      } else {
        el.attr("transform", "translate(" + pos.cx + "," + pos.cy + ") rotate(" + deg + ")");
      }
    });
    snapCables(pulledPos);
    for (const key2 in pulledPos) {
      const pos = pulledPos[key2];
      const idx = paramLookup[key2];
      if (idx === void 0) continue;
      const pd = allParamData[idx];
      addTether(pd, pos, key2, false);
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
      const key2 = pd.sku + "|" + pd.path;
      if (isValidDropTarget(pd, ds.startData, !!ds.reverse)) {
        el.classed("drag-target", true);
        const pp = pulledPoint(pd);
        if (pp) {
          pulledPos[key2] = pp;
          placeShape(el, pd, pp);
        }
      } else if (key2 === startKey) {
        placeShape(el, pd, { cx: ds.startCx, cy: ds.startCy });
      }
    });
    markCandidateGroups(ds.startData, !!ds.reverse);
    drawSpringRing();
    snapCables(pulledPos);
    for (const key2 in pulledPos) {
      const pos = pulledPos[key2];
      const idx = paramLookup[key2];
      if (idx === void 0) continue;
      addTether(allParamData[idx], pos, key2, false);
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

// ../../../../Projects/124_dataflou/web/src/slots.ts
var LINGER_MS = 3e3;
var STORE_KEY2 = "dataflou.populationView";
var chosen = {};
try {
  chosen = JSON.parse(localStorage.getItem(STORE_KEY2) || "{}") || {};
} catch (_) {
  chosen = {};
}
var lastLive = {};
var expiry;
var lastVisible = "";
function slotLive2(slot) {
  if (slot.kind !== "group" || !slot.children) return false;
  for (let i = 0; i < slot.children.length; i++) {
    const p = slot.children[i];
    if (p.kind === "param" && isGate(p)) return p.value === true || p.value === 1;
  }
  return false;
}
function join(a, b) {
  return a ? a + "/" + b : b;
}
function populationMode(sku, path, slots) {
  const m = chosen[sku + "|" + path];
  if (m) return m;
  const over = activeOver();
  return over > 0 && slots > over ? "active" : "all";
}
function toggleMode(sku, path, slots) {
  const key2 = sku + "|" + path;
  chosen[key2] = populationMode(sku, path, slots) === "active" ? "all" : "active";
  try {
    localStorage.setItem(STORE_KEY2, JSON.stringify(chosen));
  } catch (_) {
  }
}
function noteLive(nodes) {
  const now = Date.now();
  const walk = function(n, sku, path) {
    if (n.kind !== "group" || !n.children) return;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      const p = join(path, c.name);
      if (n.slots && slotLive2(c)) lastLive[sku + "|" + p] = now;
      walk(c, sku, p);
    }
  };
  for (let i = 0; i < nodes.length; i++) if (nodes[i].params) walk(nodes[i].params, nodes[i].sku, "");
}
function shown(sku, slotPath, slot, now) {
  if (slotLive2(slot)) return true;
  const at = lastLive[sku + "|" + slotPath];
  return at !== void 0 && now - at < LINGER_MS;
}
function viewNode(n) {
  const now = Date.now();
  let soonest = Infinity;
  const filter = function(g, path) {
    if (g.kind !== "group" || !g.children) return g;
    const active = !!g.slots && populationMode(n.sku, path, g.slots) === "active";
    const kids = [];
    let changed2 = false;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      const p = join(path, c.name);
      if (active && c.kind === "group" && !shown(n.sku, p, c, now)) {
        changed2 = true;
        continue;
      }
      if (active && c.kind === "group" && !slotLive2(c)) {
        const at = lastLive[n.sku + "|" + p];
        if (at !== void 0) soonest = Math.min(soonest, at + LINGER_MS);
      }
      const f = filter(c, p);
      if (f !== c) changed2 = true;
      kids.push(f);
    }
    return changed2 ? { ...g, children: kids } : g;
  };
  const params = n.params ? filter(n.params, "") : n.params;
  if (soonest !== Infinity) schedule2(soonest - now);
  return params === n.params ? n : { ...n, params };
}
function slotsKey(nodes) {
  const out = [];
  const walk = function(n, sku, path) {
    if (n.kind !== "group" || !n.children) return;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      const p = join(path, c.name);
      if (n.slots) out.push(sku + "|" + p);
      walk(c, sku, p);
    }
  };
  for (let i = 0; i < nodes.length; i++) {
    const v = viewNode(nodes[i]);
    if (v.params) walk(v.params, v.sku, "");
  }
  return out.join(",");
}
function animateIfSlotsChange() {
  const key2 = slotsKey(state.nodes);
  if (key2 === lastVisible) return;
  const first = lastVisible === "";
  lastVisible = key2;
  if (first || state._animating || state.dragState || !state._capturePositions) return;
  state._collapseAnim = state._capturePositions();
  state._animKeepSecondary = true;
  state._animDur = TRANSITION_FAST;
}
function schedule2(ms) {
  if (expiry !== void 0) return;
  expiry = window.setTimeout(function() {
    expiry = void 0;
    animateIfSlotsChange();
    if (state._render) state._render();
  }, Math.max(50, ms + 20));
}
function liveCount(sku, path, g) {
  if (!g.slots || populationMode(sku, path, g.slots) !== "active") return "";
  let live = 0;
  for (let i = 0; i < (g.children || []).length; i++) if (slotLive2(g.children[i])) live++;
  return " \xB7 " + live + "/" + g.slots;
}

// ../../../../Projects/124_dataflou/web/src/stamps.ts
var DUE_MARK = "\u25F7";
var DUE_SUFFIX = " " + DUE_MARK;
var clock = null;
function noteMeshTime(ms) {
  if (typeof ms === "number" && isFinite(ms) && ms > 0) clock = { ms, at: performance.now() };
}
function meshNow() {
  return clock ? clock.ms + (performance.now() - clock.at) : null;
}
function stampOf(p) {
  return typeof p.stamp === "number" && p.stamp > 0 ? p.stamp : null;
}
function isDue(p) {
  const s = stampOf(p), now = meshNow();
  return s !== null && now !== null && s > now;
}
function withDue(p, str) {
  return isDue(p) ? str + DUE_SUFFIX : str;
}
function span(ms) {
  const a = Math.abs(ms);
  if (a < 1e3) return Math.round(a) + " ms";
  if (a < 6e4) return (a / 1e3).toFixed(a < 1e4 ? 2 : 1) + " s";
  if (a < 36e5) return (a / 6e4).toFixed(1) + " min";
  return (a / 36e5).toFixed(1) + " h";
}
function stampText(p) {
  const s = stampOf(p);
  if (s === null) return "";
  const now = meshNow();
  if (now === null) return "mesh " + (s / 1e3).toFixed(3) + " s";
  const d = s - now;
  if (Math.abs(d) < 5) return "now";
  return d > 0 ? "in " + span(d) + " " + DUE_MARK + " held" : span(d) + " ago";
}
function stampTitle(p) {
  const s = stampOf(p);
  return s === null ? "" : "True at mesh time " + (s / 1e3).toFixed(3) + " s, as its source dated it";
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
    const key2 = sku + "|" + d.groupPath;
    state._animating = false;
    if (state._capturePositions) state._collapseAnim = state._capturePositions();
    const full = state.nodes.find(function(n) {
      return n.sku === sku;
    });
    const g = full ? resolve(full.params, d.groupPath) : null;
    if (event.shiftKey && g && g.kind === "group" && g.slots) {
      toggleMode(sku, d.groupPath, g.slots);
    } else if (state.collapsedGroups[key2]) {
      delete state.collapsedGroups[key2];
    } else {
      state.collapsedGroups[key2] = true;
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
    if (isArray(p)) {
      html += "<tr><td>value</td><td>" + esc(arrayShape(p)) + " " + stripHtml(p) + "</td></tr>";
      if (arraySize(p) <= LIST_EDIT_MAX)
        html += '<tr><td></td><td class="tt-arr-list-text">' + esc(listText(p)) + (p.unit ? " " + esc(p.unit) : "") + "</td></tr>";
    } else if (p.type === "colour" && typeof p.value === "string") {
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
  const st = stampText(p);
  if (st) html += '<tr title="' + escAttr(stampTitle(p)) + '"><td>time</td><td class="tt-stamp">' + esc(st) + "</td></tr>";
  if (p.range) {
    const parts = [];
    if (p.range.min !== void 0) parts.push(formatRange(p.range.min));
    if (p.range.max !== void 0) parts.push(formatRange(p.range.max));
    if (parts.length > 0) html += "<tr><td>range</td><td>" + parts.join(" .. ") + "</td></tr>";
  }
  if (p.hardware) html += "<tr><td>hardware</td><td>yes</td></tr>";
  if (p.merge || p.subs && p.subs.length > 1)
    html += "<tr><td>merge</td><td>" + esc(p.merge || "ltp") + "</td></tr>";
  if (nd.node.state) html += "<tr><td>state</td><td>" + esc(nd.node.state) + "</td></tr>";
  html += "</table>";
  if (isReadOnly(p)) html += '<div class="tt-readonly">' + READ_ONLY_TEXT + "</div>";
  html += '<div class="tt-hint">Enter to edit' + (isLocal ? "" : " (remote)") + "</div>";
  return html;
}
function updateHoverStamp() {
  if (editingLock || state.hoveredParamIdx < 0 || !state.tooltip) return;
  const pd = state.allParamData[state.hoveredParamIdx];
  const cell = state.tooltip.node() && state.tooltip.node().querySelector(".tt-stamp");
  if (!pd || !cell) return;
  const p = paramNow(pd);
  const st = stampText(p);
  if (st && cell.textContent !== st) cell.textContent = st;
}
function paramNow(pd) {
  const node = state.nodes.find(function(n) {
    return n.sku === pd.sku;
  });
  const p = node ? resolve(node.params, pd.path) : null;
  return p && p.kind === "param" ? p : pd.param;
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
  const ro = isReadOnly(p);
  if (ro) html += '<div class="tt-readonly">' + READ_ONLY_TEXT + "</div>";
  html += valueEditorHtml(p, ro);
  html += metaFieldHtml("label", "text", p.label || "");
  html += metaFieldHtml("name", "text", p.name || "");
  html += metaSelectHtml("mode", p.mode || "streaming", ["streaming", "discrete", "polling"]);
  html += metaSelectHtml("flow", p.flow || "source", ["source", "destination", "bidir"]);
  html += metaSelectHtml("access", p.access || "readwrite", ["read", "write", "readwrite"]);
  if (p.flow === "destination" || p.flow === "bidir") html += mergeSelectHtml(p, isEditable(nd.node));
  html += metaFieldHtml("unit", "text", p.unit || "");
  html += metaFieldHtml("rate", "number", p.rate !== void 0 ? p.rate : "");
  const g = Array.isArray(p.ground) ? p.ground[0] === p.ground[1] ? String(p.ground[0]) : p.ground[0] + " " + p.ground[1] : "";
  html += '<div class="tt-meta-row" title="Seconds back to init when no longer fed: one time, or up then down; 0: at once; empty: the value stays"><span class="tt-meta-label">ground</span><input type="text" class="tt-meta-input" data-field="ground" placeholder="s" value="' + g + '"></div>';
  html += '<div class="tt-meta-row"><span class="tt-meta-label">hardware</span><input type="checkbox" class="tt-meta-input" data-field="hardware"' + (p.hardware ? " checked" : "") + "></div>";
  html += "</div>";
  html += '<div class="tt-actions">';
  html += '<button class="tt-delete-btn">Delete</button>';
  html += "</div>";
  state.tooltip.html(html);
  clampTooltip();
  wireEditorEvents(pd);
}
function valueEditorHtml(p, readOnly) {
  let html = valueControlsHtml(p);
  if (readOnly) html = '<div class="tt-val-readonly" title="' + READ_ONLY_TEXT + '">' + html.replace(/<(input|button)\b/g, "<$1 disabled") + "</div>";
  return html;
}
function valueControlsHtml(p) {
  let html = "";
  if (isArray(p)) {
    html += '<div class="tt-arr">' + arrayEditorInner(p, 0) + "</div>";
  } else if (p.type === "bool") {
    html += '<div class="tt-val-row"><span class="tt-meta-label">value</span><input type="checkbox" class="tt-val-input" data-comp="-1"' + (p.value ? " checked" : "") + "></div>";
  } else if (p.type === "number") {
    const min = p.range && p.range.min !== void 0 ? p.range.min : 0;
    const max = p.range && p.range.max !== void 0 ? p.range.max : 1;
    const val = p.value !== void 0 && p.value !== null ? p.value : min;
    const step = (max - min) / 500;
    html += '<div class="tt-val-row"><span class="tt-meta-label">value</span><input type="range" class="tt-val-slider" data-comp="-1" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="tt-val-num">' + Number(val).toFixed(2) + "</span>";
    if (p.unit) html += '<span class="tt-val-unit">' + esc(p.unit) + "</span>";
    html += "</div>";
  } else if (p.type === "trigger") {
    html += '<div class="tt-val-row"><span class="tt-meta-label">fire</span><button class="tt-val-fire">fire</button><span class="tt-val-num">' + (typeof p.value === "number" ? p.value : 0) + "</span></div>";
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
function arrayEditorInner(p, sel2) {
  const n = arraySize(p);
  const v = arrayElems(p);
  const of = elemType(p);
  let html = '<div class="tt-val-row"><span class="tt-meta-label">array</span><span class="tt-val-num tt-arr-shape">' + esc(arrayShape(p)) + "</span>" + stripHtml(p, sel2) + "</div>";
  html += '<div class="tt-val-row"><span class="tt-meta-label">element</span><input type="number" class="tt-arr-index" min="1" max="' + n + '" step="1" value="' + (sel2 + 1) + '">';
  const x = v[sel2];
  if (of === "bool") {
    html += '<input type="checkbox" class="tt-arr-check"' + (x ? " checked" : "") + ">";
  } else if (of === "colour") {
    const c = typeof x === "string" && hexRgba(x) || [0, 0, 0, 255];
    html += '<input type="color" class="tt-arr-colour" value="' + rgbaHex(c).substring(0, 7).toLowerCase() + '"><input type="range" class="tt-val-slider tt-arr-alpha" min="0" max="255" step="1" value="' + c[3] + '" title="alpha"><span class="tt-val-num">' + c[3] + "</span>";
  } else {
    const [lo, hi] = elemRange(p);
    const step = of === "float" ? (hi - lo) / 500 : 1;
    const val = typeof x === "number" ? x : lo;
    html += '<input type="range" class="tt-val-slider tt-arr-slider" min="' + Math.min(lo, hi) + '" max="' + Math.max(lo, hi) + '" step="' + Math.abs(step) + '" value="' + val + '"><span class="tt-val-num">' + esc(elemText(p, val)) + "</span>";
    if (p.unit) html += '<span class="tt-val-unit">' + esc(p.unit) + "</span>";
  }
  html += "</div>";
  if (n <= LIST_EDIT_MAX)
    html += '<div class="tt-val-row" title="The whole array: fewer values set the first ones, one alone sets every element"><span class="tt-meta-label">list</span><input type="text" class="tt-val-text tt-arr-list" value="' + escAttr(listText(p)) + '"></div>';
  return html;
}
function isEditable(node) {
  return Array.isArray(node.features) && node.features.indexOf("editable") >= 0;
}
function mergeSelectHtml(p, editable) {
  const t = p.type || "number";
  const merges = t === "number" || t === "colour" || t === "bool" || t === "array";
  const cur2 = p.merge || "ltp";
  const tip = !merges ? "A " + t + " always takes the last value (ltp): htp and avg are for numbers, colours, bools and arrays" : !editable ? "Several links into this destination combine by its merge (ltp, htp, avg). Its host sets it (Max: @merge; a library or a board: its code or config); this node does not take an edit from the page" : "Several links into this destination: ltp, the last value wins (default); htp, the highest (per channel for a colour, OR for a bool); avg, the mean. Saved in its node\u2019s config";
  let html = '<div class="tt-meta-row" title="' + escAttr(tip) + '"><span class="tt-meta-label">merge</span>';
  if (!merges || !editable) return html + '<span class="tt-meta-fixed">' + esc(merges ? cur2 : "ltp") + "</span></div>";
  html += '<select class="tt-meta-input" data-field="merge">';
  for (const m of ["ltp", "htp", "avg"])
    html += '<option value="' + m + '"' + (m === cur2 ? " selected" : "") + ">" + m + "</option>";
  return html + "</select></div>";
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
  const ro = isReadOnly(p);
  if (isArray(p)) wireArrayEditor(tooltipEl, pd, ro, sig);
  tooltipEl.addEventListener("click", function(e) {
    if (!ro && e.target.closest(".tt-val-fire")) setParamValue(pd.sku, pd.path, true);
  }, sig);
  tooltipEl.addEventListener("input", function(e) {
    if (ro && e.target.closest(".tt-val-readonly")) return;
    if (e.target.closest(".tt-arr")) return;
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
    if (field === "ground") {
      const t = meta.value.trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);
      fields.ground = t.length === 0 || t.some(isNaN) ? null : t.length === 1 ? t[0] : [t[0], t[1]];
    } else if (meta.type === "checkbox") {
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
function wireArrayEditor(tooltipEl, pd, ro, sig) {
  const p = pd.param;
  const n = arraySize(p);
  const vals = arrayElems(p).slice();
  let sel2 = 0;
  const box = tooltipEl.querySelector(".tt-arr");
  if (!box) return;
  const view = function() {
    return Object.assign({}, p, { value: vals.slice() });
  };
  const redraw = function() {
    box.innerHTML = arrayEditorInner(view(), sel2);
  };
  const redrawStrip = function() {
    const strip = box.querySelector(".arr-strip");
    if (strip) strip.outerHTML = stripHtml(view(), sel2);
    const list = box.querySelector(".tt-arr-list");
    if (list && document.activeElement !== list) list.value = listText(view());
  };
  const send3 = function(v) {
    if (!ro) setParamValue(pd.sku, pd.path, Array.isArray(v) ? v.slice() : v);
  };
  const setElem = function(v) {
    while (vals.length < n) vals.push(elemDefault(p));
    vals[sel2] = v;
    redrawStrip();
    send3(vals);
  };
  box.addEventListener("click", function(e) {
    const cell = e.target.closest(".arr-cell[data-elem]");
    if (!cell) return;
    sel2 = parseInt(cell.dataset.elem, 10) || 0;
    redraw();
  }, sig);
  box.addEventListener("input", function(e) {
    if (ro) return;
    const t = e.target;
    if (t.classList.contains("tt-arr-slider")) {
      const x = elemType(p) === "float" ? parseFloat(t.value) : Math.round(parseFloat(t.value));
      const num2 = t.parentNode.querySelector(".tt-val-num");
      if (num2) num2.textContent = elemText(p, x);
      setElem(x);
    } else if (t.classList.contains("tt-arr-colour") || t.classList.contains("tt-arr-alpha")) {
      const cp = box.querySelector(".tt-arr-colour");
      const ap = box.querySelector(".tt-arr-alpha");
      const rgb = hexRgba(cp ? cp.value : "#000000") || [0, 0, 0, 255];
      const a = ap ? parseInt(ap.value, 10) : 255;
      const num2 = ap ? ap.parentNode.querySelector(".tt-val-num") : null;
      if (num2) num2.textContent = String(a);
      setElem(rgbaHex([rgb[0], rgb[1], rgb[2], a]));
    }
  }, sig);
  box.addEventListener("change", function(e) {
    const t = e.target;
    if (t.classList.contains("tt-arr-index")) {
      const k = parseInt(t.value, 10);
      sel2 = isNaN(k) ? 0 : Math.max(0, Math.min(n - 1, k - 1));
      redraw();
    } else if (ro) {
      return;
    } else if (t.classList.contains("tt-arr-check")) {
      setElem(t.checked);
    } else if (t.classList.contains("tt-arr-list")) {
      const list = parseList(p, t.value);
      t.classList.toggle("tt-bad", !list);
      if (!list) return;
      if (list.length === 1 && n > 1) {
        for (let i = 0; i < n; i++) vals[i] = list[0];
        send3(list[0]);
      } else {
        for (let i = 0; i < list.length; i++) vals[i] = list[i];
        send3(vals);
      }
      redraw();
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
  html += metaSelectHtml("type", "number", ["number", "bool", "string", "v2", "v3", "v4", "colour", "trigger"]);
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

// ../../../../Projects/124_dataflou/web/src/signals.ts
var REPEAT_MS = 500;
var HOLD_MS = 1500;
var asked = null;
var timer;
var halted = false;
var located = /* @__PURE__ */ new Set();
function send(msg) {
  if (wsReady()) state.ws.send(JSON.stringify(msg));
}
function locate(sku, path, ms) {
  send({ type: MSG_LOCATE, sku, path, ms });
}
function tick() {
  const pd = state.hoveredParamIdx >= 0 ? state.allParamData[state.hoveredParamIdx] : void 0;
  const want = pd ? { sku: pd.sku, path: pd.path } : null;
  if (asked && (!want || want.sku !== asked.sku || want.path !== asked.path)) {
    locate(asked.sku, asked.path, 0);
    asked = null;
  }
  if (want) {
    locate(want.sku, want.path, HOLD_MS);
    asked = want;
  }
}
function stop() {
  if (timer !== void 0) window.clearInterval(timer);
  timer = void 0;
  if (asked) locate(asked.sku, asked.path, 0);
  asked = null;
}
function requestHalt(on) {
  send({ type: MSG_HALT, on });
}
function showHalt(on) {
  halted = on;
  const el = document.getElementById("halt-toggle");
  if (!el) return;
  el.textContent = on ? "HALTED \u2014 lift" : "halt";
  el.classList.toggle("active", on);
  document.body.classList.toggle("halted", on);
}
function onLocate(path, on) {
  if (on) located.add(path);
  else located.delete(path);
  reapplyLocating();
}
function reapplyLocating() {
  if (!state.g) return;
  const local = state.nodes.find(function(n) {
    return n.is_local;
  });
  state.g.selectAll(".param-shape").each(function() {
    const d = d3.select(this).datum();
    const pd = d ? state.allParamData[d.paramIdx] : void 0;
    const on = !!(pd && local && pd.sku === local.sku && located.has(pd.path));
    this.classList.toggle("locating", on);
  });
}
function initSignals() {
  document.getElementById("halt-toggle")?.addEventListener("click", function() {
    requestHalt(!halted);
  });
  document.addEventListener("keydown", function(e) {
    if (isTyping(e)) return;
    if (e.key === "Escape" && e.shiftKey) {
      requestHalt(!halted);
      return;
    }
    if (e.key === "Alt" && timer === void 0) {
      tick();
      timer = window.setInterval(tick, REPEAT_MS);
    }
  });
  document.addEventListener("keyup", function(e) {
    if (e.key === "Alt") stop();
  });
  window.addEventListener("blur", stop);
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
  const readOnly = isReadOnly(p);
  const disabled = isAtelier || hasSub || readOnly;
  const disabledClass = isAtelier || hasSub ? " dashboard-disabled" : readOnly ? " dashboard-readonly" : "";
  let html = '<div class="dashboard-row' + disabledClass + '" data-path="' + escAttr(pw.path) + '"' + (readOnly ? ' title="' + READ_ONLY_TEXT + '"' : "") + ">";
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
  if (isArray(p)) {
    html += '<div class="dashboard-array" title="' + escAttr(arrayShape(p)) + '"><span class="dashboard-num">' + esc(arrayShape(p)) + "</span>" + stripHtml(p) + "</div>";
  } else if (p.type === "number") {
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
    html += '<span class="dashboard-vec-label" title="alpha (opacity)">\u03B1</span>';
    html += '<input type="range" class="dashboard-slider dashboard-alpha" data-path="' + escAttr(path) + '" data-comp="3" min="0" max="255" step="1" value="' + alpha + '" title="alpha (opacity)"' + dis + ">";
    html += '<span class="dashboard-num">' + alpha + "</span>";
  } else {
    const vStr = p.value !== void 0 && p.value !== null ? String(p.value) : "\u2014";
    html += '<span class="dashboard-value-only">' + esc(vStr) + "</span>";
  }
  return html;
}
function updateRowValue(row, p, _path) {
  if (isArray(p)) {
    const strip = row.querySelector(".arr-strip");
    if (strip) strip.outerHTML = stripHtml(p);
  } else if (p.type === "number") {
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
    if (e.target === el && el.style.maxHeight !== "none") {
      el.style.height = el.offsetHeight + "px";
      el.style.maxHeight = "none";
    }
  });
  el.addEventListener("mousedown", function(e) {
    const input2 = e.target.closest("input");
    if (input2 && input2.dataset.path) {
      activeInputKey = sku + "|" + input2.dataset.path;
    }
  });
  el.addEventListener("mouseup", function() {
    if (activeInputKey) delete vecScratch[activeInputKey];
    activeInputKey = null;
  });
  el.addEventListener("input", function(e) {
    const slider = e.target.closest(".dashboard-slider");
    if (slider && !slider.classList.contains("dashboard-alpha")) {
      const numSpan = slider.parentElement.querySelector(".dashboard-num") || slider.closest(".dashboard-widget").querySelector(".dashboard-num");
      if (numSpan) numSpan.textContent = Number(slider.value).toFixed(2);
      const row = slider.closest(".dashboard-row");
      sendDashboardValue(
        sku,
        slider.dataset.path,
        parseInt(slider.dataset.comp, 10),
        parseFloat(slider.value),
        row
      );
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
function sendDashboardValue(sku, path, comp, val, row = null) {
  let sendVal;
  if (comp >= 0) {
    const key2 = sku + "|" + path;
    if (!vecScratch[key2]) {
      vecScratch[key2] = [];
      if (row) {
        row.querySelectorAll(".dashboard-slider").forEach(function(s) {
          const input2 = s;
          vecScratch[key2][parseInt(input2.dataset.comp, 10)] = parseFloat(input2.value);
        });
      }
    }
    vecScratch[key2][comp] = val;
    sendVal = vecScratch[key2].slice();
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
function findPd(key2) {
  if (pdIndexOf !== state.allParamData) {
    pdIndex = {};
    for (let i = 0; i < state.allParamData.length; i++) {
      const pd = state.allParamData[i];
      pdIndex[pd.sku + "|" + pd.path] = pd;
    }
    pdIndexOf = state.allParamData;
  }
  return pdIndex[key2] || null;
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
function open2() {
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
      else open2();
    }
  });
}

// ../../../../Projects/124_dataflou/web/src/render.ts
function collapsedName(it) {
  return shortName(it.groupLabel || it.groupName) + " " + (it.polyCount || "[" + it.innerParams.length + "]");
}
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
    const key2 = sku + "|" + d.groupPath;
    try {
      const bbox = this.getBBox();
      let depth = 0;
      const cls = el.attr("class") || "";
      const dm = cls.match(/depth-(\d+)/);
      if (dm) depth = parseInt(dm[1]);
      result.groupLabels[key2] = {
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
function structureKey(nodes) {
  return JSON.stringify(nodes, function(k, v) {
    return k === "mem" || k === "link" || k === "value" ? void 0 : v;
  }) + "\n" + slotsKey(nodes);
}
var memGauges = /* @__PURE__ */ new Map();
function memFraction(mem) {
  if (!mem || mem[1] === null) return null;
  const total = mem[0] + mem[1];
  return total > 0 ? mem[0] / total : null;
}
function kb(n) {
  return n < 1024 ? n + " B" : Math.round(n / 1024) + " KB";
}
function memText(mem) {
  if (!mem) return "";
  return "\nmemory: " + kb(mem[0]) + " used" + (mem[1] === null ? "" : ", " + kb(mem[1]) + " left");
}
function setMemGauge(g, f) {
  const a = g.a0 + g.sweep * Math.min(1, Math.max(5e-3, f)) * (g.flip ? -1 : 1);
  const x1 = Math.cos(g.a0) * g.r, y1 = Math.sin(g.a0) * g.r;
  const x2 = Math.cos(a) * g.r, y2 = Math.sin(a) * g.r;
  const d = "M " + x1 + " " + y1 + " A " + g.r + " " + g.r + " 0 0 " + (g.flip ? 0 : 1) + " " + x2 + " " + y2;
  if (d === g.d) return;
  g.d = d;
  g.el.setAttribute("d", d);
  g.el.setAttribute("stroke", f > 0.9 ? C_ERROR : f > 0.75 ? "#d9a13b" : "#5fae6e");
}
function updateMemGauges() {
  for (const node of state.nodes) {
    const g = memGauges.get(node.sku);
    const f = memFraction(node.mem);
    if (g && f !== null) {
      setMemGauge(g, f);
      const tip = "memory" + memText(node.mem).slice(8);
      if (tip === g.tip) continue;
      g.tip = tip;
      const t = g.el.parentNode && g.el.parentNode.querySelector("title");
      if (t) t.textContent = tip;
    }
  }
}
function paramFill(p, online, key2, isChanged) {
  const hasSub = !!(p.subs && p.subs.length > 0);
  const cc = state._connectionColorMap ? state._connectionColorMap[key2] : null;
  if (p.error) return C_ERROR;
  if (!online) return C_OFFLINE;
  if (hasSub && isChanged) return C_ACTIVE;
  if (cc) return cc;
  return hasSub ? C_GREEN_SUB : C_PARAM;
}
var shapeSlots = [];
var valueSlots = [];
function valueSig(p, str) {
  const cols = colourCells(p);
  return cols ? str + cols.join("") : str;
}
function setValueText(tspan, p, str) {
  const due = str.endsWith(DUE_SUFFIX);
  const base2 = due ? str.slice(0, -DUE_SUFFIX.length) : str;
  const cols = colourCells(p);
  if (!cols) tspan.textContent = base2;
  else {
    tspan.textContent = arrayShape(p) + " ";
    for (let k = 0; k < cols.length; k++) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      t.setAttribute("fill", cols[k]);
      t.textContent = "\u25A0";
      tspan.appendChild(t);
    }
  }
  if (due) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    t.setAttribute("class", "param-due");
    t.textContent = DUE_SUFFIX;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = "Due later: its destinations take it at its time";
    t.appendChild(title);
    tspan.appendChild(t);
  }
}
var countLabels = [];
var liveLabels = [];
var nameRoom = 0;
var connEnds = {};
var connActive = false;
var polyTaken = "";
var connStale = false;
var valuesQueued = false;
var pendingChanged = {};
var offscreen = false;
function queueValues(snapshot = true) {
  if (snapshot) for (const k in state.changedParams) pendingChanged[k] = true;
  if (valuesQueued) return;
  valuesQueued = true;
  requestAnimationFrame(function() {
    valuesQueued = false;
    const changed2 = pendingChanged;
    pendingChanged = {};
    if (!updateValues(changed2)) {
      state.lastStructureKey = "";
      render();
    }
  });
}
onViewChange(function() {
  if (offscreen && !valuesQueued) queueValues(false);
});
function viewTest() {
  const svg = state.svg && state.svg.node();
  const vb = svg && svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width) return function() {
    return true;
  };
  const r = state.rotationOffset * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
  const m = nameRoom + 20;
  const box = svg.getBoundingClientRect();
  const k = Math.max(vb.width / Math.max(1, box.width), vb.height / Math.max(1, box.height));
  const sx = Math.max(0, (box.width * k - vb.width) / 2), sy = Math.max(0, (box.height * k - vb.height) / 2);
  const x0 = vb.x - sx - m, x1 = vb.x + vb.width + sx + m, y0 = vb.y - sy - m, y1 = vb.y + vb.height + sy + m;
  return function(x, y) {
    const X = x * c - y * sn, Y = x * sn + y * c;
    return X >= x0 && X <= x1 && Y >= y0 && Y <= y1;
  };
}
function updateValues(changed2) {
  const byKey = {};
  const online = {};
  const walk = function(sku, n, prefix) {
    if (!n || n.kind !== "group" || !n.children) return;
    for (const c of n.children) {
      const path = prefix ? prefix + "/" + c.name : c.name;
      if (c.kind === "param") byKey[sku + "|" + path] = c;
      else walk(sku, c, path);
    }
  };
  for (const node of state.nodes) {
    online[node.sku] = node.online;
    walk(node.sku, node.params, "");
  }
  const pds = state.allParamData || [];
  for (const pd of pds) {
    const np = byKey[pd.sku + "|" + pd.path];
    if (!np) return false;
    pd.param = np;
  }
  const inView = viewTest();
  offscreen = false;
  const seen2 = function(x, y) {
    if (inView(x, y)) return true;
    offscreen = true;
    return false;
  };
  const canvas = canvasActive();
  state.flashFlip = !state.flashFlip;
  const flashOn = state.flashFlip ? "data-flash2" : "data-flash";
  const flashOff = state.flashFlip ? "data-flash" : "data-flash2";
  for (const sl of shapeSlots) {
    const pd = pds[sl.idx];
    if (!pd || !seen2(pd.cx, pd.cy)) continue;
    const key2 = pd.sku + "|" + pd.path;
    const isChanged = !!changed2[key2];
    if (canvas) {
      if (isChanged) flashParam(sl.el);
    } else {
      sl.el.classList.remove(flashOff);
      sl.el.classList.toggle(flashOn, isChanged);
    }
    const fill = paramFill(pd.param, online[pd.sku] !== false, key2, isChanged);
    if (fill !== sl.fill) {
      sl.fill = fill;
      sl.el.setAttribute("fill", fill);
    }
  }
  for (let i = 0; i < valueSlots.length; i++) {
    const vs = valueSlots[i];
    if (!vs) continue;
    const pd = pds[i];
    const str = withDue(pd.param, formatParamValue(pd.param));
    const sig = valueSig(pd.param, str);
    if (sig === vs.str || !seen2(pd.cx, pd.cy)) continue;
    if (str.length > vs.len) {
      const w = (vs.name + (str ? paramFontSize() + measureName(str, false) : 0)) * vs.scale;
      if (w > nameRoom) return false;
      vs.len = str.length;
    }
    vs.str = sig;
    if (!vs.tspan) {
      vs.tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      vs.tspan.setAttribute("class", "param-value");
      vs.tspan.setAttribute("dx", "1em");
      vs.text.appendChild(vs.tspan);
    }
    setValueText(vs.tspan, pd.param, str);
  }
  for (const cl of countLabels) {
    const full = state.nodes.find(function(x) {
      return x.sku === cl.sku;
    });
    const grp = full ? resolve(full.params, cl.path) : null;
    if (!grp || grp.kind !== "group") continue;
    const text = cl.head + " " + polyCount(grp);
    if (text === cl.text) continue;
    const w = measureName(text, true) * cl.scale;
    if (w > nameRoom) return false;
    cl.text = text;
    cl.el.textContent = text;
    if (cl.stem) {
      const from = Math.min(cl.labelR + w + 3, cl.stemR);
      cl.stem.setAttribute("x1", String(Math.cos(cl.angle) * from));
      cl.stem.setAttribute("y1", String(Math.sin(cl.angle) * from));
    }
  }
  for (const ll of liveLabels) {
    const full = state.nodes.find(function(x) {
      return x.sku === ll.sku;
    });
    const grp = full ? resolve(full.params, ll.path) : null;
    const str = grp && grp.kind === "group" ? liveCount(ll.sku, ll.path, grp) : "";
    if (str === ll.str) continue;
    ll.str = str;
    ll.text.style.fontSize = "";
    ll.text.style.display = "";
    ll.tp.textContent = ll.name + str;
    fitCurvedTitle(ll.text, ll.tp, ll.name, ll.len, ll.size, ll.cls);
  }
  updateMemGauges();
  const taken = polyKey();
  let redraw = connStale || connActive || taken !== polyTaken;
  if (!redraw) {
    for (const k in changed2) if (connEnds[k]) {
      redraw = true;
      break;
    }
  }
  if (redraw) connStale = !redrawConnections(changed2);
  return true;
}
function polyKey() {
  const gs = polyGroups(state.nodes);
  let out = "";
  for (const k in gs) out += k + ":" + gs[k].taken.join(",") + ";";
  return out;
}
function noteConnections(changed2) {
  connEnds = {};
  connActive = false;
  polyTaken = polyKey();
  if (!state.g) return;
  state.g.selectAll(".connections .sub-line").each(function(d) {
    if (!d) return;
    const a = drawnSourceKey(d), b = d.dest_sku + "|" + d.dest_path;
    connEnds[a] = connEnds[b] = true;
    if (changed2[a] || changed2[b]) connActive = true;
  });
}
function redrawConnections(changed2) {
  if (!state.g || !state.svg || state._animating) return false;
  if (state.dragState && state.dragState.retracting || state.ringHover && state.ringHover.retracting) return false;
  const old = state.g.select(":scope > .connections");
  if (old.empty()) return true;
  const moving = function(el) {
    return !!el.__transition;
  };
  const svgEl = state.svg.node();
  const busy = svgEl.querySelectorAll(".connections .sub-line, .connections .sub-hit, defs linearGradient");
  for (let i = 0; i < busy.length; i++) if (moving(busy[i])) return false;
  const before = old.node().nextSibling;
  state.g.selectAll(":scope > .conn-halos").remove();
  old.remove();
  state.svg.select("defs").selectAll('[id^="conn-thermal-"], [id^="conn-grad-"], [id^="conn-glow-e-"]').remove();
  const saved = state.changedParams;
  state.changedParams = changed2;
  drawSubscriptionConnections(state.allParamData, state.nodeData, before);
  state.changedParams = saved;
  noteConnections(changed2);
  snapCablesToPulled();
  state.hoveredSubLine = null;
  if (state.shiftHeld) updateSubLineHighlight();
  return true;
}
function render() {
  if (state.dragState && state.dragState.retracting || state._animating) {
    state.lastStructureKey = "";
    return;
  }
  state.g.selectAll("*").remove();
  memGauges.clear();
  shapeSlots = [];
  valueSlots = [];
  countLabels = [];
  liveLabels = [];
  connEnds = {};
  connActive = false;
  connStale = false;
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
  const glow2 = defs.append("filter").attr("id", "conn-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow2.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
  const merge = glow2.append("feMerge");
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
    const n = viewNode(shownNodes[i]);
    const pc = Math.max(countDisplayItems(n.params, n.sku, null, effectiveCollapsed), 1);
    const layoutCount = pc + 1;
    nodeData.push({
      node: n,
      paramCount: pc,
      layoutCount,
      // colour by position in the full list, so hiding nodes doesn't recolour the rest
      color: gc(okIndexColor(state.nodes.indexOf(shownNodes[i])))
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
        w = measureName(collapsedName(it), true);
      } else {
        w = measureName(shortName(it.param.label || it.param.name || ""), false);
        const v = withDue(it.param, formatParamValue(it.param));
        if (v) w += paramFontSize() + measureName(v, false);
      }
      if (w * nameScale > nameExtent) nameExtent = w * nameScale;
    }
  }
  nameRoom = stableNameRoom(nameExtent);
  const groupArcBase = labelR + nameRoom + 6;
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
        const dotEl = state.g.append("circle").attr("class", "collapsed-dot").attr("cx", cx).attr("cy", cy).attr("r", paramRadius + 1).attr("fill", dotFill).attr("stroke", nd.node.online ? nd.color : "#444").attr("stroke-width", 1).attr("opacity", 0.8).style("cursor", "pointer").datum({ groupKey, nodeIdx: i, sku: nd.node.sku, groupPath: di.groupPath });
        const stemDepth = di.ancestors.length > 1 ? di.ancestors.length - 2 : -1;
        const stemR = stemDepth >= 0 ? groupArcBase + (globalMaxDepth - stemDepth) * groupLayerStep : groupArcBase;
        const cText = collapsedName(di);
        const cLabelR = labelR;
        const stemFrom = cLabelR + measureName(cText, true) * nameScales[i] + 3;
        const stemEl = state.g.append("line").attr("class", "collapsed-stem").attr("x1", Math.cos(angle) * Math.min(stemFrom, stemR)).attr("y1", Math.sin(angle) * Math.min(stemFrom, stemR)).attr("x2", Math.cos(angle) * stemR).attr("y2", Math.sin(angle) * stemR).attr("stroke", nd.node.online ? nd.color : "#444").attr("stroke-width", 0.8).attr("opacity", 0.3).style("pointer-events", "none");
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
        const cLabel = paramLabelGroup.append("text").attr("class", "param-label collapsed-label").attr("x", clx).attr("y", cly).attr("text-anchor", cAnchor).attr("dominant-baseline", "middle").attr("transform", "rotate(" + cRotation + "," + clx + "," + cly + ")").style("pointer-events", "none").datum({ groupKey }).text(cText).each(function() {
          if (nameScales[i] < 1) this.style.fontSize = paramFontSize() * nameScales[i] + "px";
        });
        if (di.polyCount !== void 0) {
          countLabels.push({
            el: cLabel.node(),
            sku: nd.node.sku,
            path: di.groupPath,
            head: shortName(di.groupLabel || di.groupName),
            text: cText,
            scale: nameScales[i],
            stem: stemEl.node(),
            angle,
            labelR: cLabelR,
            stemR
          });
        }
        const hitEndR = Math.max(stemR, stemFrom) + 4;
        state.g.insert("line", function() {
          return dotEl.node();
        }).attr("class", "collapsed-hit").attr("x1", cx).attr("y1", cy).attr("x2", Math.cos(angle) * hitEndR).attr("y2", Math.sin(angle) * hitEndR).attr("stroke", "transparent").attr("stroke-width", 16).style("pointer-events", "stroke").style("cursor", "pointer").datum({ groupKey, nodeIdx: i, sku: nd.node.sku, groupPath: di.groupPath });
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
      const access = p.access || "readwrite";
      const hasError = !!p.error;
      let shapeClass = "param-shape";
      if (!nd.node.online) shapeClass += " offline";
      if (isGrabbable) shapeClass += " grabbable";
      if (isChanged && !canvasActive()) shapeClass += " data-flash";
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
      let shapeEl;
      if (flow === "destination") {
        shapeEl = state.g.append("circle").attr("class", shapeClass).attr("cx", cx).attr("cy", cy).attr("r", paramRadius).attr("fill", shapeFill).datum(paramDatum);
      } else if (flow === "bidir") {
        const s = paramRadius;
        const dmDeg = angle * 180 / Math.PI;
        const pts = "0," + -s + " " + s + ",0 0," + s + " " + -s + ",0";
        shapeEl = state.g.append("polygon").attr("class", shapeClass).attr("points", pts).attr("transform", "translate(" + cx + "," + cy + ") rotate(" + dmDeg + ")").attr("fill", shapeFill).datum(paramDatum);
      } else {
        const s = paramRadius * 0.85;
        const sqDeg = angle * 180 / Math.PI;
        shapeEl = state.g.append("rect").attr("class", shapeClass).attr("x", -s).attr("y", -s).attr("width", s * 2).attr("height", s * 2).attr("transform", "translate(" + cx + "," + cy + ") rotate(" + sqDeg + ")").attr("fill", shapeFill).datum(paramDatum);
      }
      if (isChanged && canvasActive()) flashParam(shapeEl.node());
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
      const valStr = withDue(p, formatParamValue(p));
      let labelClass = "param-label";
      if (!nd.node.online) labelClass += " offline";
      if (hasError) labelClass += " param-error";
      const textEl = paramLabelGroup.append("text").attr("class", labelClass + " param-label-hit").attr("x", lx).attr("y", ly).attr("text-anchor", anchor).attr("dominant-baseline", "middle").attr("transform", "rotate(" + rotation + "," + lx + "," + ly + ")").datum(paramDatum);
      if (nameScales[i] < 1) textEl.node().style.fontSize = paramFontSize() * nameScales[i] + "px";
      textEl.append("tspan").text(label);
      const valueEl = valStr ? textEl.append("tspan").attr("class", "param-value").attr("dx", "1em") : null;
      if (valueEl) setValueText(valueEl.node(), p, valStr);
      valueSlots[allParamData.length - 1] = {
        text: textEl.node(),
        tspan: valueEl ? valueEl.node() : null,
        str: valueSig(p, valStr),
        len: valStr.length,
        name: measureName(label, false),
        scale: nameScales[i]
      };
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
  state.openGroups = [];
  state._connectionColorMap = buildConnectionColorMap(allParamData, nodeData);
  state.g.selectAll(".param-shape").each(function() {
    const el = d3.select(this);
    const d = d3.select(this).datum();
    if (!d) return;
    const pd = allParamData[d.paramIdx];
    if (!pd) return;
    const key2 = pd.sku + "|" + pd.path;
    const cc = state._connectionColorMap[key2];
    const p = pd.param;
    const ndI = nodeData[pd.nodeIdx];
    const hasSubscription2 = p.subs && p.subs.length > 0;
    const hasError = !!p.error;
    const isChanged = !!state.changedParams[key2];
    if (hasError || !ndI.node.online || hasSubscription2 && isChanged) return;
    if (cc && hasSubscription2) {
      el.attr("fill", cc);
    }
  });
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    if (pd.isCollapsed) continue;
    const key2 = pd.sku + "|" + pd.path;
    const flow = pd.param.flow || "source";
    if (flow === "source" && state._connectionColorMap && state._connectionColorMap[key2]) {
      state.g.append("circle").attr("class", "source-dot").attr("cx", pd.cx).attr("cy", pd.cy).attr("r", 1.5).attr("fill", "#000").style("pointer-events", "none");
    }
  }
  state.g.selectAll(".param-shape").each(function(d) {
    if (d) shapeSlots.push({ el: this, idx: d.paramIdx, fill: this.getAttribute("fill") || "" });
  });
  drawSubscriptionConnections(allParamData, nodeData);
  noteConnections(state.changedParams);
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
      const gMid = (gStart + gEnd) / 2;
      state.openGroups.push({
        sku: nd.node.sku,
        groupPath: grp.groupPath,
        nodeIdx: i,
        angle: gMid,
        cx: Math.cos(gMid) * ringR,
        cy: Math.sin(gMid) * ringR
      });
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
      const live = liveCountOf(nd.node, grp.groupPath);
      const grpTp = grpLabelEl.append("textPath").attr("href", "#" + gPathId).attr("startOffset", "50%").attr("text-anchor", "middle").text(grp.name + live);
      grpHitEl.append("title").text(grp.name);
      const grpLen = gLabelR * Math.abs(gEnd - gStart), grpLblCls = "group-label depth-" + Math.min(grp.depth, 2);
      fitCurvedTitle(grpLabelEl.node(), grpTp.node(), grp.name, grpLen, grpFontSize, grpLblCls);
      if (live) liveLabels.push({
        text: grpLabelEl.node(),
        tp: grpTp.node(),
        sku: nd.node.sku,
        path: grp.groupPath,
        name: grp.name,
        str: live,
        len: grpLen,
        size: grpFontSize,
        cls: grpLblCls
      });
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
      if (nd.node.role === "source") tip += "\nsource only";
      if (nd.node.role === "satellite") tip += "\nsatellite";
      if (nd.node.max_frame) tip += "\ntakes frames up to " + nd.node.max_frame + " bytes";
      tip += memText(nd.node.mem);
      if (nd.node.link) tip += "\nstreams here: " + nd.node.link[0] + " packets, " + nd.node.link[1] + " lost, " + nd.node.link[2] + " late" + (nd.node.link[3] !== null ? ", " + nd.node.link[3].toFixed(1) + " ms" : "");
      nlText.append("title").text(tip);
    }
    {
      const f = memFraction(nd.node.mem);
      if (f !== null && (nd.node.online || nd.node.is_local)) {
        const r = nodeLabelR - Math.max(3, nodeTitleSize() * 0.45);
        const gg = state.g.append("g").attr("class", "mem-gauge");
        gg.append("path").attr("d", "M " + Math.cos(sa) * r + " " + Math.sin(sa) * r + " A " + r + " " + r + " 0 " + largeArc + " " + sweepFlag + " " + Math.cos(ea) * r + " " + Math.sin(ea) * r).attr("fill", "none").attr("stroke", "currentColor").attr("stroke-opacity", 0.15).attr("stroke-width", 2);
        const fill = gg.append("path").attr("fill", "none").attr("stroke-width", 2).attr("stroke-linecap", "round");
        gg.append("title").text("memory" + memText(nd.node.mem).slice(8));
        const g = { r, a0: sa, sweep: Math.abs(ea - sa), flip, el: fill.node() };
        memGauges.set(nd.node.sku, g);
        setMemGauge(g, f);
      } else {
        memGauges.delete(nd.node.sku);
      }
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
    armGroupDrag(d, event, function() {
      state._animating = false;
      state._collapseAnim = capturePositions();
      delete state.collapsedGroups[d.groupKey];
      state.tempExpandedGroup = null;
      state.ringHover = null;
      render();
    });
  });
  setupDragSubscribe(allParamData, nodeData);
  restoreGroupDrag();
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
  reapplyLocating();
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
function liveCountOf(n, groupPath) {
  const full = state.nodes.find(function(x) {
    return x.sku === n.sku;
  });
  const g = full ? resolve(full.params, groupPath) : null;
  return g && g.kind === "group" ? liveCount(n.sku, groupPath, g) : "";
}
function renderOpening() {
  state._animating = false;
  if (state._capturePositions) state._collapseAnim = state._capturePositions();
  state._animKeepSecondary = true;
  state._animDur = TRANSITION_FAST;
  state.tempExpandedGroup = null;
  if (state._render) state._render();
}
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
  const dur = state._animDur || TRANSITION_DUR;
  state._animDur = 0;
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
    const key2 = pd.sku + "|" + pd.path;
    const old = oldState.params[key2];
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
    const srcKey = drawnSourceKey(d);
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
    const srcKey = drawnSourceKey(d);
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
  for (const key2 in oldState.params) {
    const old = oldState.params[key2];
    if (old.isCollapsed) continue;
    let target = null;
    for (let i = 0; i < allPd.length; i++) {
      if (allPd[i].sku + "|" + allPd[i].path === key2 && allPd[i].isCollapsed) {
        target = allPd[i];
        break;
      }
    }
    if (target) {
      state.g.append("circle").attr("class", "anim-ghost").attr("cx", old.cx).attr("cy", old.cy).attr("r", 3.5).attr("fill", "#555").attr("opacity", 0.6).style("pointer-events", "none").transition().duration(dur).ease(d3.easeCubicIn).attr("cx", target.cx).attr("cy", target.cy).attr("r", 1).attr("opacity", 0).remove();
    }
  }
  for (const key2 in oldState.dots) {
    let still = false;
    for (let i = 0; i < state.collapsedDots.length; i++) {
      if (state.collapsedDots[i].sku + "|" + state.collapsedDots[i].groupPath === key2) {
        still = true;
        break;
      }
    }
    if (!still) {
      const od = oldState.dots[key2];
      state.g.append("circle").attr("class", "anim-ghost").attr("cx", od.cx).attr("cy", od.cy).attr("r", 4.5).attr("fill", "#555").attr("opacity", 0.8).style("pointer-events", "none").transition().duration(dur * 0.7).ease(d3.easeCubicIn).attr("r", 0).attr("opacity", 0).remove();
    }
  }
  if (!keepSecondary) {
    const newDotKeys = {};
    for (let i = 0; i < state.collapsedDots.length; i++) {
      newDotKeys[state.collapsedDots[i].sku + "|" + state.collapsedDots[i].groupPath] = true;
    }
    for (const key2 in oldState.groupLabels) {
      if (newDotKeys[key2]) {
        const gl = oldState.groupLabels[key2];
        const fontSize = GROUP_FONT_SIZES[Math.min(gl.depth, 2)];
        const fill = GROUP_LABEL_FILLS[Math.min(gl.depth, 2)];
        state.g.append("text").attr("class", "anim-ghost").attr("x", gl.cx).attr("y", gl.cy).attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("font-size", fontSize + "px").attr("fill", fill).attr("letter-spacing", "0.1em").attr("opacity", 1).style("pointer-events", "none").text(gl.text).transition().duration(dur * 0.7).ease(ease).attr("opacity", 0).remove();
      }
    }
    for (const key2 in oldState.collapsedLabels) {
      if (!newDotKeys[key2]) {
        const cl = oldState.collapsedLabels[key2];
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

// ../../../../Projects/124_dataflou/web/src/forget.ts
var button = null;
function initForgetOffline() {
  button = document.getElementById("forget-offline");
  if (!button) return;
  button.addEventListener("click", function() {
    const n = offlineCount();
    if (n === 0) return;
    confirmDialog("Forget the " + n + " offline node" + (n === 1 ? "" : "s") + " across the mesh? They come back if they reappear.", "Forget", function() {
      if (wsReady()) state.ws.send(JSON.stringify({ type: MSG_FORGET_OFFLINE, mesh: true }));
    });
  });
}
function offlineCount() {
  let n = 0;
  for (const node of state.nodes) if (!node.online && !node.is_local) n++;
  return n;
}
function updateForgetOffline() {
  if (!button) return;
  const n = offlineCount();
  button.style.display = n > 0 ? "" : "none";
  const text = "forget offline (" + n + ")";
  if (button.textContent !== text) button.textContent = text;
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
      disconnectCable({
        dest_sku: sub.dest_sku,
        dest_path: sub.dest_path,
        source_sku: sub.source_sku,
        source_path: sub.source_path,
        conn: sub.conn
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
      const key2 = n.sku + "|" + params[j].path;
      lookup[key2] = {
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
    nodeColors[state.nodes[i].sku] = okIndexColor(i);
  }
  const groups = {};
  for (const key2 in lookup) {
    const entry = lookup[key2];
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
          source_path: sub.path,
          conn: sub.id
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
  if (el && !el.querySelector("input") && el.textContent !== "universe: " + name) el.textContent = "universe: " + name;
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
  const names2 = ["default", ...loadRecent()].filter((s, i, a) => a.indexOf(s) === i);
  for (const name of names2) {
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
var shown2 = "";
function pagePort() {
  return location.port || (location.protocol === "https:" ? "443" : "80");
}
var incompatible = [];
function versionOf(n) {
  if (n.core_ver) return "core " + n.core_ver;
  if (n.core_major) return "core " + n.core_major + ".x";
  if (n.proto) return "protocol " + n.proto;
  return "another version";
}
function ago(s) {
  if (s === void 0) return "";
  if (s < 60) return s + " s ago";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  return Math.round(s / 3600) + " h ago";
}
function renderIncompatiblePanel() {
  const panel2 = document.getElementById("incompatible-panel");
  if (!panel2 || panel2.style.display === "none") return;
  let html = '<div class="ip-head">Seen on the network, not talked to: another version of dataflou. Update them to core ' + (state.coreVersion ? String(state.coreVersion).split(".")[0] : "") + ".x to bring them in.</div>";
  for (const n of incompatible) {
    html += '<div class="ip-node"><div class="ip-name">' + esc(n.label || n.sku) + (n.product && n.product !== n.label ? ' <span class="ip-dim">' + esc(n.product) + "</span>" : "") + "</div><div>" + esc(versionOf(n)) + (n.proto && (n.core_ver || n.core_major) ? ' <span class="ip-dim">(protocol ' + n.proto + ")</span>" : "") + (n.address ? " \xB7 " + esc(n.address + (n.port ? ":" + n.port : "")) : "") + (n.seen_s !== void 0 ? ' \xB7 <span class="ip-dim">seen ' + ago(n.seen_s) + "</span>" : "") + '</div><div class="ip-dim ip-sku">' + esc(n.sku) + "</div></div>";
  }
  panel2.innerHTML = html;
}
function showIncompatible(list) {
  const el = document.getElementById("incompatible");
  if (!el) return;
  incompatible = list || [];
  const panel2 = document.getElementById("incompatible-panel");
  if (incompatible.length === 0) {
    el.style.display = "none";
    if (panel2) panel2.style.display = "none";
    return;
  }
  el.style.display = "";
  el.textContent = incompatible.length + " on another version";
  el.title = "Click for details";
  if (!el.dataset.wired) {
    el.dataset.wired = "1";
    el.addEventListener("click", function() {
      const p = document.getElementById("incompatible-panel");
      if (!p) return;
      p.style.display = p.style.display === "none" ? "" : "none";
      renderIncompatiblePanel();
    });
    document.addEventListener("keydown", function(e) {
      const p = document.getElementById("incompatible-panel");
      if (e.key === "Escape" && p) p.style.display = "none";
    });
  }
  renderIncompatiblePanel();
}
function showHostAddress(ips) {
  const el = document.getElementById("host-ip");
  if (!el) return;
  let list = ips && ips.length ? ips : [];
  if (!list.length && !LOOPBACK.test(location.hostname)) list = [location.hostname];
  const key2 = list.join(",");
  if (key2 === shown2) return;
  shown2 = key2;
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
function send2(op, slot) {
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
    send2("store", slot);
    setStoreMode(false);
  });
}
function onSlot(slot) {
  if (storeMode) askStore(slot);
  else send2("recall", slot);
}
function nodeLine(n, cur2) {
  const label = nodeLabel(n);
  if (!n.scene) return n.online ? { label, text: "no scenes (older node)", cls: "old" } : null;
  const s = n.scene;
  const parts = [];
  let cls = s.state;
  if (cur2 && s.current !== cur2) {
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
  const cur2 = currentSlot();
  const tab = (cur2 ? "scene " + cur2 : "scenes") + (panelEl2.style.display === "none" ? " \u25B4" : " \u25BE");
  if (tabEl.textContent !== tab) tabEl.textContent = tab;
  if (panelEl2.style.display === "none") return;
  const nodes = state.nodes.filter(function(n) {
    return n.scene || n.online;
  }).sort(compareNodes);
  const holders = [];
  for (let i = 0; i < SLOTS; i++) holders.push([]);
  const counts = { none: 0, applied: 0, modified: 0, missing: 0 };
  const lines2 = [];
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
    const l = nodeLine(n, cur2);
    if (l) lines2.push(l);
  }
  const key2 = JSON.stringify([cur2, storeMode, holders, counts, lines2, nodes.length]);
  if (key2 === drawn) return;
  drawn = key2;
  let sum = "";
  if (cur2) {
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
    const cls = "sc-slot" + (h.length ? " held" : "") + (slot === cur2 ? " current" : "");
    const title = (storeMode ? "Store scene " + slot : "Recall scene " + slot) + "\n" + (h.length ? "Held by: " + h.join(", ") : "No node holds it yet");
    grid += '<button type="button" class="' + cls + '" data-slot="' + slot + '" title="' + esc2(title) + '"><b>' + slot + "</b><small>" + (h.length ? h.length + "/" + nodes.length : "\xB7") + "</small></button>";
  }
  let list = "";
  for (let i = 0; i < lines2.length; i++) {
    list += '<div class="sc-node sc-st-' + lines2[i].cls.split(" ").join(" sc-st-") + '"><span>' + esc2(lines2[i].label) + "</span><span>" + esc2(lines2[i].text) + "</span></div>";
  }
  panelEl2.classList.toggle("store-mode", storeMode);
  panelEl2.innerHTML = '<div class="sc-head"><span class="sc-title">' + (cur2 ? "scene " + cur2 : "scenes") + '</span><button type="button" class="sc-store" title="Each online node saves its current connections into the slot you pick">' + (storeMode ? "cancel" : "store\u2026") + '</button></div><div class="sc-sum">' + esc2(sum) + '</div><div class="sc-grid">' + grid + '</div><div class="sc-nodes">' + (list || '<div class="sc-node sc-st-ok"><span>' + (cur2 ? "every node applied scene " + cur2 : "") + "</span></div>") + '</div><div class="sc-hint">' + (storeMode ? "pick the slot to store into \xB7 Esc cancels" : "click a slot to recall it on every node \xB7 each node applies its own connections") + "</div>";
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
  const panel2 = document.createElement("div");
  panel2.id = "scenes-panel";
  panel2.style.display = "none";
  document.body.appendChild(panel2);
  tabEl = tab;
  panelEl2 = panel2;
  tab.addEventListener("click", function() {
    const open3 = panel2.style.display === "none";
    panel2.style.display = open3 ? "" : "none";
    tab.classList.toggle("open", open3);
    if (!open3) storeMode = false;
    drawn = "";
    draw2();
    refreshGlass();
    tab.blur();
  });
  panel2.addEventListener("click", function(e) {
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

// ../../../../Projects/124_dataflou/web/src/inspector.ts
var CURVE_POINTS_MAX = 16;
var SEND_MS = 100;
var ECHO_MS = 2500;
var panel = null;
var cur = null;
var openLink = null;
var axis = 0;
var drawnKey = "";
var draft = null;
var dragging = null;
var sendTimer = 0;
var lastSend = 0;
function conn() {
  if (!cur) return null;
  const c = connectionById(cur.destSku, cur.id) || connectionByEnds(cur.destSku, cur.ends.dest, cur.ends.sku, cur.ends.source);
  if (c) cur.id = c.id;
  return c;
}
function isParamConn(c) {
  return !isGroupConnection(cur.destSku, c);
}
function destParam(c, rel) {
  const p = resolveIn(cur.destSku, joinPath(c.poly ? joinPath(c.dest, "1") : c.dest, rel));
  return p && p.kind === "param" ? p : null;
}
function sourceParam(c, rel) {
  const p = resolveIn(c.sku, joinPath(c.poly ? joinPath(c.source, "1") : c.source, rel));
  return p && p.kind === "param" ? p : null;
}
function findLink(c, rel) {
  for (let i = 0; i < c.links.length; i++) if (c.links[i].dest === rel) return c.links[i];
  return null;
}
function rowsOf(c) {
  if (isParamConn(c)) return c.links.length ? [{ dest: "", link: c.links[0], param: destParam(c, "") }] : [];
  const rows = [];
  const seen2 = {};
  const tpl = templateParams(cur.destSku, c.dest, !!c.poly);
  for (let i = 0; i < tpl.length; i++) {
    const p = tpl[i].param;
    const l = findLink(c, tpl[i].rel);
    if (!l && p.flow !== "destination" && p.flow !== "bidir") continue;
    rows.push({ dest: tpl[i].rel, link: l, param: p });
    seen2[tpl[i].rel] = true;
  }
  for (let i = 0; i < c.links.length; i++) {
    if (!seen2[c.links[i].dest]) rows.push({ dest: c.links[i].dest, link: c.links[i], param: null });
  }
  return rows;
}
function nameOf(sku, path) {
  const n = resolveIn(sku, path);
  const own = n ? n.label || n.name : path.split("/").pop() || path;
  const node = nodeBySku(sku);
  return own + " (" + (node ? node.label || node.sku.slice(0, 8) : sku.slice(0, 8)) + ")";
}
function fmt(v) {
  if (!isFinite(v)) return "";
  const a = Math.abs(v);
  return String(+v.toFixed(a >= 1e3 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3));
}
function axisNames(p) {
  return p && p.type === "colour" ? ["r", "g", "b", "a"] : ["x", "y", "z", "w"];
}
function shownAxes(l, dc) {
  const src = draft && draft.link === l.dest ? draft.axes : copyAxes(l.axes || []);
  const out = [];
  for (let i = 0; i < Math.max(dc, 1); i++) out.push(src[i] || {});
  return out;
}
function normAxes(axes) {
  const out = axes.map(function(a) {
    const o = {};
    if (a.in) o.in = a.in;
    if (a.out) o.out = a.out;
    if (a.curve && a.curve.length >= 2 && !straightPts(a.curve)) {
      o.curve = a.curve;
      if (a.free) o.free = true;
    }
    return o;
  });
  return out.every(axisPlain) ? [] : out;
}
function straightPts(pts) {
  return pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
}
function axesKey(axes) {
  return JSON.stringify(normAxes(axes || []), function(_k, v) {
    return typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v;
  });
}
function openInspector(d) {
  const at = linkOf(d.dest_sku, d.dest_path, d.source_sku, d.source_path, d.conn);
  if (!at) {
    notify("This link has no connection record (a node before core 9.1?)");
    return;
  }
  const c = at.conn;
  cur = { destSku: d.dest_sku, id: c.id, ends: endsOf(d.dest_sku, c) };
  const param = !isGroupConnection(d.dest_sku, c);
  openLink = param ? "" : d.whole ? null : at.link.dest;
  axis = 0;
  draft = null;
  dragging = null;
  drawnKey = "";
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "link-inspector";
    document.body.appendChild(panel);
    wirePanel(panel);
  }
  panel.style.display = "";
  updateInspector();
}
function closeInspector() {
  cur = null;
  draft = null;
  dragging = null;
  if (panel) panel.style.display = "none";
}
function updateInspector() {
  if (!panel || !cur) return;
  const c = conn();
  if (!c) {
    closeInspector();
    return;
  }
  if (draft && !dragging) {
    const l = findLink(c, draft.link);
    if (!l || axesKey(l.axes) === axesKey(draft.axes) || Date.now() - draft.time > ECHO_MS) draft = null;
  }
  const key2 = keyOf(c);
  const busy = !!dragging || isEditingField();
  if (key2 !== drawnKey && !busy) {
    drawnKey = key2;
    build2(c);
  }
  drawLive(c);
}
function keyOf(c) {
  const links = c.links.map(function(l) {
    const axes = draft && draft.link === l.dest ? draft.axes : l.axes;
    return [l.dest, l.source, !!l.chosen, axesKey(axes)];
  });
  return JSON.stringify([
    c.id,
    c.dest,
    c.sku,
    c.source,
    !!c.poly,
    links,
    openLink,
    axis,
    names(cur.destSku, c.dest, !!c.poly),
    names(c.sku, c.source, !!c.poly)
  ]);
}
function names(sku, path, poly) {
  return templateParams(sku, path, poly).map(function(t) {
    return t.rel;
  }).join(",");
}
function isEditingField() {
  const a = document.activeElement;
  return !!(panel && a && panel.contains(a) && (a.tagName === "SELECT" || a.tagName === "INPUT" && a.type !== "checkbox"));
}
function build2(c) {
  const p = panel;
  const rows = rowsOf(c);
  if (openLink === null && rows.length === 1) openLink = rows[0].dest;
  let h = '<div class="li-head"><span class="li-title">' + esc(nameOf(c.sku, c.source)) + ' <span class="li-arrow">\u2192</span> ' + esc(nameOf(cur.destSku, c.dest)) + '</span><button type="button" class="li-close" title="Close (Esc)">\xD7</button></div>';
  h += '<div class="li-sub">' + esc(kindText(c)) + '<span class="li-count"></span></div>';
  h += '<div class="li-rows">';
  for (let i = 0; i < rows.length; i++) h += rowHtml(c, rows[i]);
  if (!rows.length) h += '<div class="li-empty">no links: nothing matches by name</div>';
  h += "</div>";
  const open3 = openLink !== null ? rows.find(function(r) {
    return r.dest === openLink;
  }) : void 0;
  if (open3 && open3.link) h += editorHtml(c, open3.link);
  else if (open3) h += '<div class="li-hint">choose a source to make this link</div>';
  h += '<div class="li-foot"><button type="button" class="li-remove">disconnect</button>' + (isParamConn(c) ? "" : '<span class="li-hint">click a row to edit its curve</span>') + "</div>";
  p.innerHTML = h;
  if (open3 && open3.link) wireCurve(c, open3.link);
}
function kindText(c) {
  if (c.pick) return "instance: " + describePick(c.pick) + (isParamConn(c) ? "" : " \xB7 " + c.links.length + " link" + (c.links.length === 1 ? "" : "s"));
  if (isParamConn(c)) return "param";
  if (!c.poly) return "group \xB7 " + c.links.length + " link" + (c.links.length === 1 ? "" : "s");
  const g = resolveIn(cur.destSku, c.dest);
  const full = g && g.kind === "group" && g.full === "refuse" ? " \xB7 full: refuses" : "";
  return "poly" + full;
}
function roleOf2(p) {
  if (!p) return "";
  if (p.role) return p.role;
  if (isGate(p)) return "gate";
  return p.name === "id" ? "id" : "";
}
function rowHtml(c, r) {
  const l = r.link;
  const cls = "li-row" + (r.dest === openLink ? " open" : "") + (!l || unfed(l) ? " unfed" : "") + (l && !linkPlain(l.axes) ? " shaped" : "");
  let h = '<div class="' + cls + '" data-link="' + esc(r.dest) + '">';
  h += '<span class="li-caret">' + (r.dest === openLink ? "\u25BE" : "\u25B8") + "</span>";
  if (isParamConn(c)) {
    const sp = c.source.split("/").pop(), dp = c.dest.split("/").pop();
    h += '<span class="li-dest">' + esc(dp || "") + '</span><span class="li-arrow">\u2190</span><span class="li-src-name">' + esc(sp || "") + "</span>";
  } else {
    h += '<span class="li-dest">' + esc(r.dest) + '</span><span class="li-arrow">\u2190</span>' + sourceMenu(c, r);
  }
  h += thumb(c, r);
  const role = c.poly ? roleOf2(r.param) : "";
  h += '<span class="li-tag">' + esc(role) + "</span></div>";
  return h;
}
var BY_NAME = "name";
var NONE = "none";
function sourceMenu(c, r) {
  const l = r.link;
  const sel2 = !l ? NONE : !l.chosen ? BY_NAME : l.source ? l.source : NONE;
  let h = '<select class="li-src" title="What feeds it: by name, chosen by hand, or nothing">';
  if (l) h += '<option value="' + BY_NAME + '"' + (sel2 === BY_NAME ? " selected" : "") + ">" + esc(!l.chosen && l.source ? l.source + " \xB7 by name" : "by name") + "</option>";
  h += '<option value="' + NONE + '"' + (sel2 === NONE ? " selected" : "") + ">none</option>";
  const src = templateParams(c.sku, c.source, !!c.poly);
  for (let i = 0; i < src.length; i++) {
    const v = src[i].rel;
    h += '<option value="' + esc(v) + '"' + (l && l.chosen && l.source === v ? " selected" : "") + ">" + esc(v) + "</option>";
  }
  return h + "</select>";
}
function thumb(c, r) {
  const W = 30, H = 14;
  let h = '<svg class="li-thumb" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">';
  const l = r.link;
  if (!l || linkPlain(l.axes)) {
    return h + '<path d="M1,' + (H - 1) + "L" + (W - 1) + ',1" class="li-thumb-plain"/></svg>';
  }
  const axes = shownAxes(l, components(r.param ? r.param.type : "number"));
  for (let a = 0; a < axes.length; a++) {
    const ax = axes[a];
    let d = "";
    for (let k = 0; k <= 24; k++) {
      const x = k / 24;
      const y = Math.max(-0.1, Math.min(1.1, curveAt(ax.curve, !!ax.free, x)));
      d += (k ? "L" : "M") + (1 + x * (W - 2)).toFixed(1) + "," + (H - 1 - y * (H - 2)).toFixed(1);
    }
    h += '<path d="' + d + '" class="li-thumb-axis' + (axes.length > 1 ? " li-ax" + a : "") + '"/>';
  }
  return h + "</svg>";
}
var CW = 280;
var CH = 150;
var CP = 9;
function px(x) {
  return CP + x * (CW - 2 * CP);
}
function py(y) {
  return CH - CP - y * (CH - 2 * CP);
}
function editorHtml(c, l) {
  const dp = destParam(c, l.dest), sp = sourceParam(c, l.source);
  const dc = components(dp ? dp.type : "number");
  if (axis >= dc) axis = 0;
  const axes = shownAxes(l, dc);
  const a = axes[axis];
  let h = '<div class="li-editor">';
  h += '<div class="li-ed-head"><span>' + esc((l.dest || (c.dest.split("/").pop() || "")) + " \u2190 " + (l.source || (unfed(l) ? "none" : c.source.split("/").pop() || ""))) + "</span>";
  if (dc > 1) {
    const names2 = axisNames(dp);
    h += '<span class="li-axes">';
    for (let i = 0; i < dc; i++) {
      h += '<button type="button" class="li-axis li-ax' + i + (i === axis ? " on" : "") + (axisPlain(axes[i]) ? "" : " shaped") + '" data-axis="' + i + '">' + names2[i] + "</button>";
    }
    h += "</span>";
  }
  h += "</div>";
  if (sp && dp) {
    const dIn = axisIn(sp, dp, axis, void 0), dOut = axisOut(dp, axis, void 0);
    h += rangeRow("in", a.in, dIn, isLog(sp) ? " log" : "", "Input range (default: the source\u2019s)");
    if (dp.type !== "bool") h += rangeRow("out", a.out, dOut, isLog(dp) ? " log" : "", "Output range (default: the destination\u2019s)");
    else h += '<div class="li-range"><label>out</label><span class="li-hint">on from 0.5</span></div>';
  }
  h += '<svg class="li-curve" viewBox="0 0 ' + CW + " " + CH + '"></svg>';
  h += '<div class="li-ctl"><label title="Monotone never turns back; free may swing past its points"><input type="checkbox" class="li-free"' + (a.free ? " checked" : "") + '> free</label><button type="button" class="li-straight" title="Remove the curve\u2019s points">straight</button><button type="button" class="li-reset" title="This axis: straight, default ranges">reset</button><span class="li-live"></span></div>';
  h += '<div class="li-hint">click: a point \xB7 drag: move \xB7 double-click or drag out: remove</div>';
  return h + "</div>";
}
function rangeRow(which, set, def, note, title) {
  const v = function(i) {
    return set ? fmt(set[i]) : "";
  };
  return '<div class="li-range" title="' + title + '"><label>' + which + '</label><input type="number" step="any" data-range="' + which + '" data-end="0" value="' + v(0) + '" placeholder="' + fmt(def[0]) + '"><span class="li-dots">\u2026</span><input type="number" step="any" data-range="' + which + '" data-end="1" value="' + v(1) + '" placeholder="' + fmt(def[1]) + '"><span class="li-hint">' + note + "</span></div>";
}
function drawCurve(c, l) {
  const svg = panel && panel.querySelector(".li-curve");
  if (!svg) return;
  const dp = destParam(c, l.dest);
  const dc = components(dp ? dp.type : "number");
  const a = shownAxes(l, dc)[axis];
  const pts = dragging ? effectivePts() : a.curve && a.curve.length >= 2 ? a.curve : [[0, 0], [1, 1]];
  const free = !!a.free;
  let h = '<rect x="' + CP + '" y="' + CP + '" width="' + (CW - 2 * CP) + '" height="' + (CH - 2 * CP) + '" class="li-box"/>';
  for (let k = 1; k < 4; k++) {
    h += '<path class="li-grid" d="M' + px(k / 4) + "," + py(0) + "V" + py(1) + "M" + px(0) + "," + py(k / 4) + "H" + px(1) + '"/>';
  }
  h += '<path class="li-diag" d="M' + px(0) + "," + py(0) + "L" + px(1) + "," + py(1) + '"/>';
  let d = "";
  for (let k = 0; k <= 120; k++) {
    const x = k / 120;
    const y = Math.max(-0.05, Math.min(1.05, curveAt(pts, free, x)));
    d += (k ? "L" : "M") + px(x).toFixed(1) + "," + py(y).toFixed(1);
  }
  h += '<path class="li-line' + (dc > 1 ? " li-ax" + axis : "") + '" d="' + d + '"/>';
  for (let i = 0; i < pts.length; i++) {
    h += '<circle class="li-pt' + (i === 0 || i === pts.length - 1 ? " end" : "") + '" data-i="' + i + '" cx="' + px(pts[i][0]) + '" cy="' + py(pts[i][1]) + '" r="4.5"/>';
  }
  if (dragging && dragging.removing) {
    const p = dragging.pts[dragging.idx];
    h += '<circle class="li-pt gone" cx="' + px(p[0]) + '" cy="' + py(Math.max(0, Math.min(1, p[1]))) + '" r="4.5"/>';
  }
  h += '<g class="li-live-dots"></g>';
  svg.innerHTML = h;
}
function drawLive(c) {
  if (!panel) return;
  const count = panel.querySelector(".li-count");
  if (count) {
    if (c.poly) {
      const g = resolveIn(c.sku, c.source);
      const n = g && g.kind === "group" ? takenSlots(g).length : 0;
      count.textContent = " \xB7 " + (n ? "\u25CF".repeat(Math.min(n, 8)) + " " + n : "no instance");
    } else count.textContent = "";
  }
  const l = openLink !== null ? findLink(c, openLink) : null;
  const layer = panel.querySelector(".li-live-dots");
  const text = panel.querySelector(".li-live");
  if (!l || !layer) return;
  const dp = destParam(c, l.dest);
  if (!dp) return;
  const a = shownAxes(l, components(dp.type))[axis];
  const vals = sourceValues(c, l);
  let h = "";
  let last = null;
  const shownA = dragging ? Object.assign({}, a, { curve: effectivePts() }) : a;
  for (let i = 0; i < vals.length; i++) {
    const t = throughAxis(vals[i], dp, axis, shownA);
    if (!t) continue;
    last = t;
    const x = Math.max(0, Math.min(1, t.x));
    const y = Math.max(-0.05, Math.min(1.05, t.y));
    h += '<path class="li-tick" d="M' + px(x) + "," + py(0) + "v4M" + px(0) + "," + py(y) + 'h-4"/><circle class="li-val" cx="' + px(x) + '" cy="' + py(y) + '" r="2.6"/>';
  }
  layer.innerHTML = h;
  if (text) {
    if (!vals.length) text.textContent = unfed(l) ? "unfed" : "no value";
    else if (vals.length > 1) text.textContent = vals.length + " instances";
    else if (last) text.textContent = "\u2192 " + (typeof last.out === "boolean" ? last.out ? "on" : "off" : fmt(last.out));
    else text.textContent = "";
  }
}
function effectivePts() {
  if (!dragging) return [];
  return dragging.removing ? dragging.pts.filter(function(_p, i) {
    return i !== dragging.idx;
  }) : dragging.pts;
}
function setAxis(l, dc, f) {
  const axes = shownAxes(l, dc).map(function(x) {
    return copyAxes([x])[0];
  });
  f(axes[axis]);
  draft = { link: l.dest, axes, time: Date.now() };
  return axes;
}
function sendDraft() {
  if (sendTimer) {
    window.clearTimeout(sendTimer);
    sendTimer = 0;
  }
  lastSend = Date.now();
  if (!cur || !draft) return;
  sendLinkAxes(cur.destSku, cur.id, draft.link, normAxes(draft.axes));
}
function sendSoon() {
  const wait = SEND_MS - (Date.now() - lastSend);
  if (wait <= 0) sendDraft();
  else if (!sendTimer) sendTimer = window.setTimeout(sendDraft, wait);
}
function record(l, before) {
  if (!cur || !draft || axesKey(before) === axesKey(draft.axes)) return;
  const st = linkState(l);
  const b = { source: st.source, chosen: st.chosen, axes: normAxes(before) };
  const a = { source: st.source, chosen: st.chosen, axes: normAxes(draft.axes) };
  recordLinkEdit(cur.ends, l.dest, b, a);
}
function commitAxis(c, l, f) {
  if (!wsReady()) {
    notify("Not connected", void 0, "error");
    return;
  }
  const dp = destParam(c, l.dest);
  const dc = components(dp ? dp.type : "number");
  const before = shownAxes(l, dc);
  setAxis(l, dc, f);
  sendDraft();
  record(l, before);
  drawnKey = "";
  updateInspector();
}
function chooseSource(c, r, v) {
  if (!cur) return;
  const l = r.link;
  const before = l ? linkState(l) : { source: "", chosen: true, axes: [] };
  const after = { source: before.source, chosen: before.chosen, axes: before.axes };
  if (v === BY_NAME) after.chosen = false;
  else {
    after.chosen = true;
    after.source = v === NONE ? "" : v;
  }
  if (after.chosen === before.chosen && after.source === before.source) return;
  if (!editLink(cur.ends, r.dest, before, after)) notify("Not sent: not connected", void 0, "error");
}
function wirePanel(p) {
  p.addEventListener("click", function(e) {
    const t = e.target;
    const c = conn();
    if (!c) return;
    if (t.closest(".li-close")) {
      closeInspector();
      return;
    }
    if (t.closest(".li-remove")) {
      if (cur && removeConnection(cur.destSku, c)) closeInspector();
      return;
    }
    const ax = t.closest(".li-axis");
    if (ax) {
      axis = parseInt(ax.dataset.axis || "0", 10);
      drawnKey = "";
      updateInspector();
      return;
    }
    if (t.closest("select, input, label")) return;
    const row = t.closest(".li-row");
    if (row) {
      const rel = row.dataset.link || "";
      openLink = openLink === rel && !isParamConn(c) ? null : rel;
      axis = 0;
      drawnKey = "";
      updateInspector();
      return;
    }
    const l = openLink !== null ? findLink(c, openLink) : null;
    if (!l) return;
    if (t.closest(".li-straight")) commitAxis(c, l, function(a) {
      delete a.curve;
      delete a.free;
    });
    else if (t.closest(".li-reset")) commitAxis(c, l, function(a) {
      delete a.curve;
      delete a.free;
      delete a.in;
      delete a.out;
    });
  });
  p.addEventListener("change", function(e) {
    const t = e.target;
    const c = conn();
    if (!c) return;
    if (t.classList.contains("li-src")) {
      const row = t.closest(".li-row");
      const rel = row ? row.dataset.link || "" : "";
      const r = rowsOf(c).find(function(x) {
        return x.dest === rel;
      });
      if (r) chooseSource(c, r, t.value);
      t.blur();
      return;
    }
    const l = openLink !== null ? findLink(c, openLink) : null;
    if (!l) return;
    if (t.classList.contains("li-free")) {
      const on = t.checked;
      commitAxis(c, l, function(a) {
        if (on) a.free = true;
        else delete a.free;
      });
      return;
    }
    const which = t.dataset.range;
    if (which) {
      const box = t.closest(".li-range");
      const ins = box.querySelectorAll("input");
      const lo = parseFloat(ins[0].value), hi = parseFloat(ins[1].value);
      const dp = destParam(c, l.dest), sp = sourceParam(c, l.source);
      if (!dp) return;
      const def = which === "in" ? sp ? axisIn(sp, dp, axis, void 0) : [0, 1] : axisOut(dp, axis, void 0);
      t.blur();
      commitAxis(c, l, function(a) {
        if (isNaN(lo) && isNaN(hi)) {
          delete a[which];
          return;
        }
        a[which] = [isNaN(lo) ? def[0] : lo, isNaN(hi) ? def[1] : hi];
      });
    }
  });
  p.addEventListener("keydown", function(e) {
    const t = e.target;
    if (e.key === "Enter" && t.tagName === "INPUT") t.blur();
    if (e.key === "Escape" && t.tagName === "INPUT") {
      t.blur();
      e.stopPropagation();
    }
  });
}
var lastTap = null;
var TAP_MS = 350;
function wireCurve(c, l0) {
  const svg = panel.querySelector(".li-curve");
  if (!svg) return;
  drawCurve(c, l0);
  const rel = l0.dest;
  const at = function(e) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    return [(q.x - CP) / (CW - 2 * CP), (CH - CP - q.y) / (CH - 2 * CP)];
  };
  const current = function() {
    const cc = conn();
    const l = cc ? findLink(cc, rel) : null;
    if (!cc || !l) return null;
    const dp = destParam(cc, l.dest);
    return { c: cc, l, dc: components(dp ? dp.type : "number") };
  };
  svg.addEventListener("pointerdown", function(e) {
    if (e.button !== 0) return;
    const k = current();
    if (!k) return;
    e.preventDefault();
    const a = shownAxes(k.l, k.dc)[axis];
    const pts = (a.curve && a.curve.length >= 2 ? a.curve : [[0, 0], [1, 1]]).map(function(p) {
      return [p[0], p[1]];
    });
    const hit = e.target.closest(".li-pt");
    let idx = hit && hit.dataset.i !== void 0 ? parseInt(hit.dataset.i, 10) : -1;
    const now = Date.now();
    if (idx > 0 && idx < pts.length - 1 && lastTap && lastTap.idx === idx && now - lastTap.time < TAP_MS) {
      lastTap = null;
      const left = pts.filter(function(_p, j) {
        return j !== idx;
      });
      commitAxis(k.c, k.l, function(ax) {
        if (straightPts(left)) delete ax.curve;
        else ax.curve = left;
      });
      return;
    }
    lastTap = idx >= 0 ? { idx, time: now } : null;
    const before = shownAxes(k.l, k.dc);
    if (idx < 0) {
      const [x, y] = at(e);
      if (x <= 0.01 || x >= 0.99 || pts.length >= CURVE_POINTS_MAX) return;
      idx = 1;
      while (idx < pts.length - 1 && pts[idx][0] < x) idx++;
      pts.splice(idx, 0, [x, Math.max(0, Math.min(1, y))]);
      setAxis(k.l, k.dc, function(ax) {
        ax.curve = pts.slice();
      });
      sendSoon();
    }
    dragging = { idx, pts, removing: false, before };
    svg.setPointerCapture(e.pointerId);
    drawCurve(k.c, k.l);
    drawLive(k.c);
  });
  svg.addEventListener("pointermove", function(e) {
    if (!dragging) return;
    const k = current();
    if (!k) return;
    const [x, y] = at(e);
    const i = dragging.idx, pts = dragging.pts;
    const end = i === 0 || i === pts.length - 1;
    dragging.removing = !end && (x < -0.15 || x > 1.15 || y < -0.3 || y > 1.3);
    if (!dragging.removing) {
      if (!end) pts[i][0] = Math.max(pts[i - 1][0] + 0.01, Math.min(pts[i + 1][0] - 0.01, x));
      pts[i][1] = Math.max(0, Math.min(1, y));
    }
    setAxis(k.l, k.dc, function(ax) {
      ax.curve = effectivePts().slice();
    });
    sendSoon();
    drawCurve(k.c, k.l);
    drawLive(k.c);
  });
  const finish = function() {
    if (!dragging) return;
    const k = current();
    const before = dragging.before;
    const pts = effectivePts().map(function(p) {
      return [p[0], p[1]];
    });
    dragging = null;
    if (!k) return;
    const was = axesKey(before);
    setAxis(k.l, k.dc, function(ax) {
      if (straightPts(pts)) delete ax.curve;
      else ax.curve = pts;
    });
    if (axesKey(draft.axes) === was) {
      draft = null;
      drawCurve(k.c, k.l);
      return;
    }
    sendDraft();
    record(k.l, before);
    updateInspector();
  };
  svg.addEventListener("pointerup", finish);
  svg.addEventListener("pointercancel", finish);
}
function initInspector() {
  if (isOutputWindow()) return;
  let down = null;
  const blocked = ".param-shape, .param-hit, .param-label-hit, .collapsed-dot, .collapsed-hit, .group-hit, .group-label, .node-label, .add-param-btn, .atelier-icon, .dashboard-icon";
  const cableAt = function(e) {
    if (!state.svg || !state.g || state.dragState) return null;
    const t = e.target;
    if (!t || !t.closest || !t.closest("#vis svg") || t.closest(blocked)) return null;
    const pt = state.svg.node().createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = state.g.node().getScreenCTM();
    return m ? findNearestSubLine(pt.matrixTransform(m.inverse())) : null;
  };
  document.addEventListener("mousedown", function(e) {
    down = { x: e.clientX, y: e.clientY };
  }, true);
  document.addEventListener("click", function(e) {
    if (e.shiftKey || e.button !== 0) return;
    if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) return;
    const line = cableAt(e);
    if (!line) return;
    const d = d3.select(line).datum();
    if (d) openInspector(d);
  });
  let raf2 = 0;
  document.addEventListener("mousemove", function(e) {
    if (raf2 || e.buttons || e.shiftKey) return;
    raf2 = requestAnimationFrame(function() {
      raf2 = 0;
      if (state.svg) state.svg.classed("cable-hover", !!cableAt(e));
    });
  });
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && cur && !isTyping(e) && !state.dragState) closeInspector();
  });
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
      noteMeshTime(msg.mesh_ms);
      const oldMap = buildValueMap(state.nodes);
      state.nodes = msg.nodes || [];
      ingest(state.nodes);
      const newMap = buildValueMap(state.nodes);
      state.changedParams = findChangedParams(oldMap, newMap);
      if (msg.core_version) state.coreVersion = msg.core_version;
      if (typeof msg.perf_mode === "boolean") showPerfMode(msg.perf_mode);
      if (typeof msg.halted === "boolean") showHalt(msg.halted);
      if (typeof msg.universe === "string") showUniverse(msg.universe);
      showHostAddress(Array.isArray(msg.host_ips) ? msg.host_ips : null);
      showIncompatible(Array.isArray(msg.incompatible) ? msg.incompatible : null);
      if (msg.atelier_version) state.atelierVersion = msg.atelier_version;
      if (msg.clients !== void 0) {
        const verEl2 = document.getElementById("ver");
        if (verEl2) {
          let ver = "web v" + VERSION;
          if (state.coreVersion) ver += " \xB7 core v" + state.coreVersion;
          if (state.atelierVersion) ver += " \xB7 atelier v" + state.atelierVersion;
          ver += " \xB7 " + msg.clients + " ws";
          if (verEl2.textContent !== ver) verEl2.textContent = ver;
        }
      }
      checkPendingSubscriptions();
      checkRestores();
      noteLive(state.nodes);
      const key2 = structureKey(state.nodes);
      if (key2 !== state.lastStructureKey) {
        animateIfSlotsChange();
        state.lastStructureKey = key2;
        render();
      } else {
        queueValues();
      }
      updateDebugOverlay();
      updateForgetOffline();
      checkEditingParam();
      updateHoverStamp();
      updateDashboardValues();
      updateToggleVisibility();
      updateScenes();
      updateInspector();
    } else if (msg.type === MSG_PERF_MODE) {
      showPerfMode(msg.enabled === true, msg.pinned === true);
    } else if (msg.type === MSG_UNIVERSE) {
      if (typeof msg.universe === "string") showUniverse(msg.universe);
    } else if (msg.type === MSG_SCENE) {
      onSceneMessage(msg);
    } else if (msg.type === MSG_HALT) {
      showHalt(msg.on === true);
    } else if (msg.type === MSG_LOCATE) {
      onLocate(msg.path, msg.on === true);
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
        const key2 = n.sku + "|" + params[j].path + ">" + s.sku + "|" + s.path;
        existingSubs[key2] = true;
      }
    }
    const conns = n.connections || [];
    for (let ci = 0; ci < conns.length; ci++) {
      existingSubs[n.sku + "|" + conns[ci].dest + ">" + conns[ci].sku + "|" + conns[ci].source] = true;
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
function showPerfMode(enabled, pinned = false) {
  state.perfMode = enabled;
  const el = document.getElementById("perf-toggle");
  if (!el) return;
  const text = (enabled ? "presentation \u2014 values paused" : "preparation") + (pinned ? " (this node only)" : "");
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle("active", enabled);
}
function requestPerfMode(enabled) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify({ type: MSG_PERF_MODE, enabled }));
}

// ../../../../Projects/124_dataflou/web/src/main.ts
setup();
initCanvasLayer();
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
initInspector();
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
      disconnectCable({
        dest_sku: data.dest_sku,
        dest_path: data.dest_path,
        source_sku: data.source_sku,
        source_path: data.source_path,
        conn: data.conn,
        whole: data.whole
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
initForgetOffline();
initSignals();
document.getElementById("perf-toggle")?.addEventListener("click", () => {
  requestPerfMode(!state.perfMode);
});
connect();
