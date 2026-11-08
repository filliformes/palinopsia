// ../124_dataflou/web/src/state.ts
var VERSION = "57";
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

// ../124_dataflou/web/src/params.ts
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
  const changed = {};
  for (const key in newMap) {
    if (!(key in oldMap)) continue;
    if (JSON.stringify(oldMap[key]) !== JSON.stringify(newMap[key])) {
      changed[key] = true;
    }
  }
  return changed;
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

// ../124_dataflou/web/src/config.ts
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
var COLLAPSED_HIT_EXTRA = 20;
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

// ../124_dataflou/web/src/curves.ts
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
  const diam = PARAM_RING_DIAM;
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

// ../124_dataflou/web/src/util.ts
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var escAttr = esc;
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

// ../124_dataflou/web/src/conn-strategies.ts
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

// ../124_dataflou/web/src/connections.ts
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
      d3.select(nearest).classed("sub-line-target", true).style("stroke", C_RED).attr("stroke-width", 3.5).attr("opacity", 1).style("filter", "drop-shadow(0 0 4px rgba(200, 50, 50, 0.6))");
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

// ../124_dataflou/web/src/types/messages.ts
var MSG_SNAPSHOT = "snapshot";
var MSG_TOAST = "toast";
var MSG_PERF_MODE = "perf_mode";
var MSG_IDENTIFY = "identify";
var MSG_SUBSCRIBE = "subscribe";
var MSG_UNSUBSCRIBE = "unsubscribe";
var MSG_FLUSH = "flush_node";
var MSG_SET_VALUE = "set_value";
var MSG_UPDATE_PARAM = "update_param";
var MSG_DELETE_PARAM = "delete_param";
var MSG_ADD_PARAM = "add_param";

// ../124_dataflou/web/src/hover.ts
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
      const isValidTarget = (pd.sku !== state.dragState.startData.sku || pd.path !== state.dragState.startData.path) && (p.flow === "source" || p.flow === "bidir");
      if (!isValidTarget) return;
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
      sendValue(pd, p, comp, parseFloat(slider.value), vecVals);
      return;
    }
    const input = e.target.closest(".tt-val-input");
    if (input) {
      const comp = parseInt(input.dataset.comp, 10);
      if (p.type === "bool") {
        sendValue(pd, p, comp, input.checked, vecVals);
      } else if (p.type === "string") {
        sendValue(pd, p, comp, input.value, vecVals);
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
function sendValue(pd, p, comp, val, vecVals) {
  let sendVal;
  if (comp >= 0 && vecVals) {
    vecVals[comp] = val;
    sendVal = vecVals.slice();
  } else {
    sendVal = val;
  }
  if (wsReady()) {
    state.ws.send(JSON.stringify({
      type: MSG_SET_VALUE,
      sku: pd.sku,
      path: pd.path,
      value: sendVal
    }));
  }
}
function sendColourValue(pd, rgba) {
  if (wsReady()) {
    state.ws.send(JSON.stringify({
      type: MSG_SET_VALUE,
      sku: pd.sku,
      path: pd.path,
      value: rgba
    }));
  }
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

// ../124_dataflou/web/src/drag.ts
var pullDist = PULL_DIST;
var extendDuration = EXTEND_DUR;
var retractDuration = RETRACT_DUR;
var rotateState = null;
var inertiaRaf = null;
function expandCollapsedCandidates(dragPd) {
  const expandedKeys = [];
  const seen = {};
  if (!state.allParamData) return expandedKeys;
  for (let i = 0; i < state.allParamData.length; i++) {
    const pd = state.allParamData[i];
    if (!pd.isCollapsed) continue;
    if (pd.sku === dragPd.sku && pd.path === dragPd.path) continue;
    if (pd.param.flow !== "source" && pd.param.flow !== "bidir") continue;
    if (pd.param.type !== dragPd.param.type) continue;
    if (pd.param.error) continue;
    const existing = dragPd.param.subs || [];
    if (existing.some(function(s) {
      return s.sku === pd.sku && s.path === pd.path;
    })) continue;
    const groupKey = pd.sku + "|" + pd.collapsedGroupPath;
    if (!seen[groupKey] && state.collapsedGroups[groupKey]) {
      seen[groupKey] = true;
      delete state.collapsedGroups[groupKey];
      expandedKeys.push(groupKey);
    }
  }
  return expandedKeys;
}
function findNearestDropTarget(allParamData, sx, sy, dragStartData, snapDist, pulledPos) {
  let best = null;
  let bestD2 = snapDist * snapDist;
  for (let i = 0; i < allParamData.length; i++) {
    const pd = allParamData[i];
    if (pd.isCollapsed) continue;
    if (pd.sku === dragStartData.sku && pd.path === dragStartData.path) continue;
    if (pd.param.flow !== "source" && pd.param.flow !== "bidir") continue;
    if (pd.param.type !== dragStartData.param.type) continue;
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
function isValidDropTarget(pd, dragStartData) {
  if (pd.isCollapsed) return false;
  if (pd.sku === dragStartData.sku && pd.path === dragStartData.path) return false;
  if (pd.param.flow !== "source" && pd.param.flow !== "bidir") return false;
  if (pd.param.type !== dragStartData.param.type) return false;
  if (pd.param.error) return false;
  const existing = dragStartData.param.subs || [];
  if (existing.some(function(s) {
    return s.sku === pd.sku && s.path === pd.path;
  })) return false;
  return true;
}
function pullElement(el, pd) {
  const r = Math.sqrt(pd.cx * pd.cx + pd.cy * pd.cy);
  if (r < 0.01) return null;
  const nx = pd.cx * (1 - pullDist / r);
  const ny = pd.cy * (1 - pullDist / r);
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
function addTether(pd, pos, key) {
  state.g.append("line").attr("class", "pull-segment").attr("x1", pd.cx).attr("y1", pd.cy).attr("x2", pd.cx).attr("y2", pd.cy).attr("stroke", C_CYAN).attr("stroke-width", 0.5).attr("opacity", 0.3).datum({ paramKey: key }).transition().duration(extendDuration).ease(d3.easeBackOut).attr("x1", pos.cx).attr("y1", pos.cy);
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
  state.g.selectAll(".param-shape, .param-hit").on("mousedown", function(event) {
    let d = d3.select(this).datum();
    let pd = allParamData[d.paramIdx];
    if (pd.param.flow !== "destination" && pd.param.flow !== "bidir") return;
    if (pd.param.error) return;
    event.preventDefault();
    document.body.style.cursor = "pointer";
    const autoExpandedKeys = expandCollapsedCandidates(pd);
    if (autoExpandedKeys.length > 0) {
      const savedSku = pd.sku, savedPath = pd.path;
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
      if (tpd && isValidDropTarget(tpd, pd)) {
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
      pulledPos: dragPulledPos
    };
  });
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
  state.svg.on("mousemove", function(event) {
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
      const dist = Math.sqrt(svgPt.x * svgPt.x + svgPt.y * svgPt.y);
      const threshold = state._mainRadius || MAIN_RADIUS;
      if (dist < threshold && !state.ringHover) {
        enterRingHover();
      } else if (dist >= threshold && state.ringHover && !state.ringHover.retracting) {
        exitRingHover();
      }
      return;
    }
    if (state.dragState.retracting) return;
    const sx = state.dragState.startCx;
    const sy = state.dragState.startCy;
    let ex = svgPt.x, ey = svgPt.y;
    const snap = findNearestDropTarget(allParamData, svgPt.x, svgPt.y, state.dragState.startData, SNAP_DIST, state.dragState.pulledPos);
    if (snap) {
      const snapKey = snap.sku + "|" + snap.path;
      const pulled = state.dragState.pulledPos && state.dragState.pulledPos[snapKey];
      ex = pulled ? pulled.cx : snap.cx;
      ey = pulled ? pulled.cy : snap.cy;
      state.dragState.highlight.attr("cx", ex).attr("cy", ey).attr("opacity", 1);
      state.dragState.snapTarget = snap;
      const finalD = connectionPath(sx, sy, ex, ey);
      if (!state.dragState.wasSnapped) {
        state.dragState.tempLine.attr("stroke", C_CYAN);
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
      state.dragState.tempLine.attr("stroke", "#fff");
      state.dragState.highlight.attr("opacity", 0);
      state.dragState.snapTarget = null;
      state.dragState.tempLine.attr("d", dragPath(sx, sy, ex, ey));
    }
  });
  state.svg.on("mouseup", function(event) {
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
    const snap = state.dragState.snapTarget;
    const tempLine = state.dragState.tempLine;
    const startPd = state.dragState.startData;
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
    const autoExpandedKeys = state.dragState.autoExpandedKeys || [];
    state.dragState = { retracting: true };
    setTimeout(function() {
      state.g.selectAll(".param-shape").classed("drag-target", false);
      state.dragState = null;
      document.body.style.cursor = "";
      if (autoExpandedKeys.length > 0) {
        state._animating = false;
        if (state._capturePositions) state._collapseAnim = state._capturePositions();
        for (let i = 0; i < autoExpandedKeys.length; i++) {
          state.collapsedGroups[autoExpandedKeys[i]] = true;
        }
        if (state._render) state._render();
      }
    }, retractDuration);
    if (snap) {
      const destType = startPd.param.type;
      const srcType = snap.param.type;
      if (destType !== srcType) {
        showToast(event, "Type mismatch: " + srcType + " \u2192 " + destType);
        tempLine.remove();
        return;
      }
      const existing = startPd.param.subs || [];
      if (existing.some(function(s) {
        return s.sku === snap.sku && s.path === snap.path;
      })) {
        showToast(event, "Already subscribed");
        tempLine.remove();
        return;
      }
      if (wsReady()) {
        state.ws.send(JSON.stringify({
          type: MSG_SUBSCRIBE,
          dest_sku: startPd.sku,
          dest_path: startPd.path,
          source_sku: snap.sku,
          source_path: snap.path
        }));
        state.pendingSubscriptions.push({
          dest_sku: startPd.sku,
          dest_path: startPd.path,
          source_sku: snap.sku,
          source_path: snap.path,
          time: Date.now(),
          clientX: event.clientX,
          clientY: event.clientY
        });
      }
      const finalD = connectionPath(startPd.cx, startPd.cy, snap.cx, snap.cy);
      tempLine.attr("stroke-dasharray", null).attr("opacity", 0.5).transition().duration(DROP_FADE_DUR).attr("d", finalD).attr("opacity", 0).remove();
    } else {
      tempLine.remove();
    }
  });
  if (state.ringHover && state.ringHover.pulledPos && !state.ringHover.retracting) {
    const pulledPos = state.ringHover.pulledPos;
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
      addTether(pd, pos, key);
    }
  }
  if (state.dragState && !state.dragState.retracting && state.dragState.startData) {
    const ds = state.dragState;
    const pulledPos = ds.pulledPos || {};
    state.g.selectAll(".param-shape").each(function() {
      const el = d3.select(this);
      const dd = el.datum();
      if (!dd) return;
      const pd = allParamData[dd.paramIdx];
      if (!pd) return;
      if (isValidDropTarget(pd, ds.startData)) {
        el.classed("drag-target", true);
      }
      const key = pd.sku + "|" + pd.path;
      const pos = pulledPos[key];
      if (pos) {
        const tag = el.node().tagName.toLowerCase();
        const deg = pd.angle * 180 / Math.PI;
        if (tag === "circle") {
          el.attr("cx", pos.cx).attr("cy", pos.cy);
        } else {
          el.attr("transform", "translate(" + pos.cx + "," + pos.cy + ") rotate(" + deg + ")");
        }
      }
      const clickedKey = ds.startData.sku + "|" + ds.startData.path;
      if (key === clickedKey && !el.classed("drag-target")) {
        const startPd = ds.startData;
        const r = Math.sqrt(startPd.cx * startPd.cx + startPd.cy * startPd.cy);
        if (r > 0.01) {
          const nx = startPd.cx * (1 - pullDist / r);
          const ny = startPd.cy * (1 - pullDist / r);
          const stag = el.node().tagName.toLowerCase();
          const sdeg = startPd.angle * 180 / Math.PI;
          if (stag === "circle") {
            el.attr("cx", nx).attr("cy", ny);
          } else {
            el.attr("transform", "translate(" + nx + "," + ny + ") rotate(" + sdeg + ")");
          }
        }
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
      addTether(allParamData[idx], pos, key);
    }
    const sx = ds.startCx;
    const sy = ds.startCy;
    ds.tempLine = state.g.append("path").attr("class", "drag-line").attr("fill", "none").attr("stroke", ds.wasSnapped ? C_CYAN : "#fff").attr("stroke-width", 1).attr("stroke-dasharray", ds.wasSnapped ? null : "3,3").attr("opacity", 0.6);
    const pt = state.svg.node().createSVGPoint();
    pt.x = state.lastMouseClient.x;
    pt.y = state.lastMouseClient.y;
    const svgPt = pt.matrixTransform(state.g.node().getScreenCTM().inverse());
    let ex = svgPt.x, ey = svgPt.y;
    const snap = findNearestDropTarget(allParamData, svgPt.x, svgPt.y, ds.startData, SNAP_DIST, pulledPos);
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

// ../124_dataflou/web/src/dashboard.ts
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
    const input = e.target.closest("input");
    if (input && input.dataset.path) {
      activeInputKey = sku + "|" + input.dataset.path;
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
  if (wsReady()) {
    state.ws.send(JSON.stringify({
      type: MSG_SET_VALUE,
      sku,
      path,
      value: sendVal
    }));
  }
}
function sendDashboardColourValue(sku, path, rgba) {
  if (wsReady()) {
    state.ws.send(JSON.stringify({
      type: MSG_SET_VALUE,
      sku,
      path,
      value: rgba
    }));
  }
}

// ../124_dataflou/web/src/render.ts
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
  const effectiveCollapsed = {};
  for (const k in state.collapsedGroups) effectiveCollapsed[k] = true;
  if (state.tempExpandedGroup) delete effectiveCollapsed[state.tempExpandedGroup];
  const collapsedDots = [];
  const glow = defs.append("filter").attr("id", "conn-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  glow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");
  if (state.nodes.length === 0) {
    state.g.append("text").attr("class", "empty-msg").text("no nodes");
    return;
  }
  let totalParams = 0;
  const nodeData = [];
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    const pc = Math.max(countDisplayItems(n.params, n.sku, null, effectiveCollapsed), 1);
    const layoutCount = pc + 1;
    nodeData.push({
      node: n,
      paramCount: pc,
      layoutCount,
      color: gc(PALETTE[i % PALETTE.length])
    });
    totalParams += layoutCount;
  }
  const gapAngle = GAP_ANGLE;
  const totalGap = gapAngle * state.nodes.length;
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
  const mainRadius = MAIN_RADIUS;
  const arcWidth = ARC_WIDTH;
  const paramRadius = PARAM_RADIUS;
  const paramPad = PARAM_PAD;
  const groupLayerStep = GROUP_LAYER_STEP;
  const groupArcBase = mainRadius + arcWidth / 2 + 60;
  const paramLabelGap = PARAM_LABEL_GAP;
  const arcGapAngle = ARC_GAP_ANGLE;
  const paramCircleR = mainRadius - arcWidth / 2;
  state._mainRadius = mainRadius;
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
        state.g.append("line").attr("class", "collapsed-stem").attr("x1", cx).attr("y1", cy).attr("x2", Math.cos(angle) * stemR).attr("y2", Math.sin(angle) * stemR).attr("stroke", nd.node.online ? nd.color : "#444").attr("stroke-width", 0.8).attr("opacity", 0.3).style("pointer-events", "none");
        const cLabelR = stemR + 4;
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
        paramLabelGroup.append("text").attr("class", "param-label collapsed-label").attr("x", clx).attr("y", cly).attr("text-anchor", cAnchor).attr("dominant-baseline", "middle").attr("transform", "rotate(" + cRotation + "," + clx + "," + cly + ")").style("pointer-events", "none").datum({ groupKey }).text(di.groupLabel + " [" + di.innerParams.length + "]");
        const hitEndR = cLabelR + COLLAPSED_HIT_EXTRA;
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
      const labelR = mainRadius + arcWidth / 2 + paramLabelGap;
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
      const label = p.label || p.name;
      const valStr = formatParamValue(p);
      let labelClass = "param-label";
      if (!nd.node.online) labelClass += " offline";
      if (hasError) labelClass += " param-error";
      const textEl = paramLabelGroup.append("text").attr("class", labelClass + " param-label-hit").attr("x", lx).attr("y", ly).attr("text-anchor", anchor).attr("dominant-baseline", "middle").attr("transform", "rotate(" + rotation + "," + lx + "," + ly + ")").datum(paramDatum);
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
      state.g.append("path").attr("class", "group-hit " + grpCls).attr("d", hitArcGen({
        startAngle: gStart + Math.PI / 2,
        endAngle: gEnd + Math.PI / 2
      })).attr("fill", grpColor).style("pointer-events", "fill").style("cursor", "pointer").datum(grpDatum);
      const grpFontSize = GROUP_FONT_SIZES[Math.min(grp.depth, 2)] || 7;
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
      grpLabelEl.append("textPath").attr("href", "#" + gPathId).attr("startOffset", "50%").attr("text-anchor", "middle").text(grp.name);
    }
  }
  const nodeLabelR = groupArcBase + (globalMaxDepth + 1) * groupLayerStep + 10;
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
    const nodeLabel = nd.node.label || nd.node.sku;
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
    nlText.append("textPath").attr("href", "#" + pathId).attr("startOffset", "50%").attr("text-anchor", "middle").text(nodeLabel);
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
  state.svg.attr(
    "viewBox",
    bboxCx - maxDim / 2 - pad + " " + (bboxCy - maxDim / 2 - pad) + " " + (maxDim + 2 * pad) + " " + (maxDim + 2 * pad)
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
    const sel = d3.select(this).classed("node-identify", start !== void 0);
    if (start !== void 0) sel.style("animation-delay", -(now - start) + "ms");
    else sel.style("animation-delay", null);
  });
  state.g.selectAll(".node-arc").each(function() {
    const sku = this.getAttribute("data-sku");
    const start = sku ? state.identifying[sku] : void 0;
    const on = start !== void 0 && Math.floor((now - start) / IDENTIFY_BLINK_MS) % 2 === 0;
    const inverted = on ? invertColor(this.getAttribute("fill")) : null;
    const sel = d3.select(this);
    if (inverted) sel.style("fill", inverted).style("opacity", "1");
    else sel.style("fill", null).style("opacity", null);
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

// ../124_dataflou/web/src/debug.ts
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
      state.ws.send(JSON.stringify({ type: MSG_UNSUBSCRIBE, ...sub }));
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

// ../124_dataflou/web/src/ws.ts
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
      render();
      updateDebugOverlay();
      checkPendingSubscriptions();
      checkEditingParam();
      updateDashboardValues();
      updateToggleVisibility();
    } else if (msg.type === MSG_PERF_MODE) {
      showPerfMode(msg.enabled === true);
    } else if (msg.type === MSG_IDENTIFY) {
      identifyNode(msg.sku);
    } else if (msg.type === MSG_TOAST) {
      showToast({ clientX: window.innerWidth / 2, clientY: 60 }, msg.msg || "Error");
    }
  };
}
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
    if (now - pending.time > 2e3) {
      showToast(
        { clientX: pending.clientX, clientY: pending.clientY },
        "Connection refused by server"
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

// ../124_dataflou/web/src/main.ts
setup();
initDebugOverlay();
initTooltipEditor();
initDashboard();
initEditor();
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
  showConfirmDialog("Flush node \u201C" + sku + "\u201D from world?", function() {
    if (wsReady()) {
      state.ws.send(JSON.stringify({ type: MSG_FLUSH, sku }));
    }
  });
};
function showConfirmDialog(message, onConfirm) {
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
  confirmBtn.textContent = "Flush";
  btns.appendChild(cancelBtn);
  btns.appendChild(confirmBtn);
  dialog.appendChild(btns);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  confirmBtn.focus();
  function close() {
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }
  cancelBtn.addEventListener("click", close);
  confirmBtn.addEventListener("click", function() {
    close();
    onConfirm();
  });
  backdrop.addEventListener("click", function(e) {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", function handler(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", handler);
    }
    if (e.key === "Enter") {
      close();
      onConfirm();
      document.removeEventListener("keydown", handler);
    }
  });
}
document.addEventListener("mousemove", function(event) {
  state.lastMouseClient.x = event.clientX;
  state.lastMouseClient.y = event.clientY;
  if (!event.shiftKey) {
    clearSubLineHighlight();
    clearFlushHighlight();
    return;
  }
  updateSubLineHighlight();
  updateFlushHighlight();
});
document.addEventListener("click", function(event) {
  if (!event.shiftKey) return;
  if (state.hoveredSubLine) {
    const data = d3.select(state.hoveredSubLine).datum();
    if (data && wsReady()) {
      state.ws.send(JSON.stringify({
        type: MSG_UNSUBSCRIBE,
        dest_sku: data.dest_sku,
        dest_path: data.dest_path,
        source_sku: data.source_sku,
        source_path: data.source_path
      }));
    }
    clearSubLineHighlight();
  }
});
document.addEventListener("keydown", function(event) {
  if (event.key === "Shift") {
    state.shiftHeld = true;
    updateSubLineHighlight();
    updateFlushHighlight();
  }
});
document.addEventListener("keyup", function(event) {
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
