import "./chunk-YLJ4XMA6.js";

// node_modules/@lisse/core/dist/chunk-BL6ZAFLB.js
function V(e, t, r, n, s, o, i) {
  let p = e === 0 && t === 0 ? 0 : r >= 0 ? n - r : e / (e + t) * n, g = e === 0 && s === 0 ? 0 : o >= 0 ? i - o : e / (e + s) * i;
  return Math.min(p, g);
}
function st({ topLeftCornerRadius: e, topRightCornerRadius: t, bottomRightCornerRadius: r, bottomLeftCornerRadius: n, width: s, height: o }) {
  if (e === t && t === r && r === n && e > 0 && s > 0 && o > 0) {
    let f = Math.min(s, o) / 2, M = { radius: Math.min(e, f), roundingAndSmoothingBudget: f };
    return { topLeft: M, topRight: M, bottomLeft: M, bottomRight: M };
  }
  let i = (t > e ? 1 : 0) + (n > e ? 1 : 0) + (r > e ? 1 : 0), p = (e >= t ? 1 : 0) + (n > t ? 1 : 0) + (r > t ? 1 : 0), g = (e >= n ? 1 : 0) + (t >= n ? 1 : 0) + (r > n ? 1 : 0), h = (e >= r ? 1 : 0) + (t >= r ? 1 : 0) + (n >= r ? 1 : 0), $ = e, x = t, u = n, c = r, a = -1, m = -1, l = -1, d = -1;
  for (let f = 0; f < 4; f++) {
    let S = i === f ? 0 : p === f ? 1 : g === f ? 2 : 3;
    S === 0 ? (a = V(e, x, m, s, u, l, o), $ = Math.min(e, a)) : S === 1 ? (m = V(t, $, a, s, c, d, o), x = Math.min(t, m)) : S === 2 ? (l = V(n, c, d, s, $, a, o), u = Math.min(n, l)) : (d = V(r, u, l, s, x, m, o), c = Math.min(r, d));
  }
  return { topLeft: { radius: $, roundingAndSmoothingBudget: a }, topRight: { radius: x, roundingAndSmoothingBudget: m }, bottomLeft: { radius: u, roundingAndSmoothingBudget: l }, bottomRight: { radius: c, roundingAndSmoothingBudget: d } };
}
function G(e) {
  return e * Math.PI / 180;
}
function y(e) {
  let t = e * 1e4, r = Math.round(t), n = t - r;
  if (n > 0.4999999 || n < -0.4999999 || !Number.isSafeInteger(r)) return e.toFixed(4);
  let s = e < 0, o = s ? -r : r, i = o % 1e4, p = (o - i) / 1e4, g = i < 10 ? "000" : i < 100 ? "00" : i < 1e3 ? "0" : "";
  return (s ? "-" : "") + p + "." + g + i;
}
var q = { p: 0, pathSegment: () => "" };
function L(e, t) {
  return e === 0 || Number.isNaN(e) ? t : t.charCodeAt(0) === 45 ? t.slice(1) : "-" + t;
}
function k(e, t, r, n, s, o) {
  let i = y(e), p = y(t), g = y(r), h = y(n), $ = y(s), x = y(o);
  return { x1: i, x1n: L(e, i), y1: p, y1n: L(t, p), x2: g, x2n: L(r, g), y2: h, y2n: L(n, h), x3: $, x3n: L(s, $), y3: x, y3n: L(o, x) };
}
function z(e, t) {
  switch (t) {
    case "TR":
      return `c ${e.x1} ${e.y1} ${e.x2} ${e.y2} ${e.x3} ${e.y3}`;
    case "BR":
      return `c ${e.y1n} ${e.x1} ${e.y2n} ${e.x2} ${e.y3n} ${e.x3}`;
    case "BL":
      return `c ${e.x1n} ${e.y1n} ${e.x2n} ${e.y2n} ${e.x3n} ${e.y3n}`;
    case "TL":
      return `c ${e.y1} ${e.x1n} ${e.y2} ${e.x2n} ${e.y3} ${e.x3n}`;
  }
}
function W(e, t) {
  switch (t) {
    case "TR":
      return `a ${e.radius} ${e.radius} 0 0 1 ${e.d} ${e.d}`;
    case "BR":
      return `a ${e.radius} ${e.radius} 0 0 1 ${e.dn} ${e.d}`;
    case "BL":
      return `a ${e.radius} ${e.radius} 0 0 1 ${e.dn} ${e.dn}`;
    case "TL":
      return `a ${e.radius} ${e.radius} 0 0 1 ${e.d} ${e.dn}`;
  }
}
var it = ({ cornerRadius: e, roundingAndSmoothingBudget: t }) => {
  let r = Math.min(e, t);
  if (r <= 0) return q;
  let n = y(r), s = { radius: n, d: n, dn: L(r, n) };
  return { p: r, pathSegment: (o) => W(s, o) };
};
function Y({ cornerRadius: e, cornerSmoothing: t, preserveSmoothing: r, roundingAndSmoothingBudget: n }) {
  if (e <= 0) return { a: 0, b: 0, c: 0, d: 0, p: 0, arcSectionLength: 0, cornerRadius: 0 };
  let s = (1 + t) * e;
  if (!r) {
    let a = n / e - 1;
    t = Math.min(t, a), s = Math.min(s, n);
  }
  let o = 90 * (1 - t), i = Math.sin(G(o / 2)) * e * Math.sqrt(2), p = (90 - o) / 2, g = e * Math.tan(G(p / 2)), h = 45 * t, $ = g * Math.cos(G(h)), x = $ * Math.tan(G(h)), u = (s - i - $ - x) / 3, c = 2 * u;
  if (r && s > n) {
    let a = n - x - i - $, m = a / 6, l = a - m;
    u = Math.min(u, l), c = a - u, s = Math.min(s, n);
  }
  return { a: c, b: u, c: $, d: x, p: s, arcSectionLength: i, cornerRadius: e };
}
var at = ({ cornerRadius: e, smoothing: t, preserveSmoothing: r, roundingAndSmoothingBudget: n }) => {
  let s = Y({ cornerRadius: e, cornerSmoothing: t, preserveSmoothing: r, roundingAndSmoothingBudget: n });
  if (s.cornerRadius <= 0) return q;
  let o = _t(s);
  return { p: s.p, pathSegment: (i) => {
    switch (i) {
      case "TR":
        return `c ${o.a} 0 ${o.ab} 0 ${o.abc} ${o.d} a ${o.r} ${o.r} 0 0 1 ${o.arc} ${o.arc} c ${o.d} ${o.c} ${o.d} ${o.bc} ${o.d} ${o.abc}`;
      case "BR":
        return `c 0 ${o.a} 0 ${o.ab} ${o.dn} ${o.abc} a ${o.r} ${o.r} 0 0 1 ${o.arcn} ${o.arc} c ${o.cn} ${o.d} ${o.bcn} ${o.d} ${o.abcn} ${o.d}`;
      case "BL":
        return `c ${o.an} 0 ${o.abn} 0 ${o.abcn} ${o.dn} a ${o.r} ${o.r} 0 0 1 ${o.arcn} ${o.arcn} c ${o.dn} ${o.cn} ${o.dn} ${o.bcn} ${o.dn} ${o.abcn}`;
      case "TL":
        return `c 0 ${o.an} 0 ${o.abn} ${o.d} ${o.abcn} a ${o.r} ${o.r} 0 0 1 ${o.arc} ${o.arcn} c ${o.c} ${o.dn} ${o.bc} ${o.dn} ${o.abc} ${o.dn}`;
    }
  } };
};
function _t({ cornerRadius: e, a: t, b: r, c: n, d: s, arcSectionLength: o }) {
  let i = t + r, p = i + n, g = r + n, h = y(t), $ = y(i), x = y(p), u = y(n), c = y(g), a = y(s), m = y(o);
  return { a: h, an: L(t, h), ab: $, abn: L(i, $), abc: x, abcn: L(p, x), c: u, cn: L(n, u), bc: c, bcn: L(g, c), d: a, dn: L(s, a), r: y(e), arc: m, arcn: "-" + m };
}
var P = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2];
var tt = P.map((e) => Math.sin(e));
var et = P.map((e) => Math.cos(e));
var ut = [(P[0] + P[1]) / 2, (P[1] + P[2]) / 2, (P[2] + P[3]) / 2];
var Ft = ut.map((e) => Math.sin(e));
var Ot = ut.map((e) => Math.cos(e));
var ct = ({ cornerRadius: e, exponent: t, roundingAndSmoothingBudget: r }) => {
  let n = Math.min(e, r);
  if (n <= 0) return q;
  let s = Number.isFinite(t) ? Math.max(2, t) : 4, o = 2 / s, i = s === 2 ? (u) => u : s === 4 ? Math.sqrt : s === 8 ? (u) => Math.sqrt(Math.sqrt(u)) : (u) => Math.pow(u, o), p = o - 1, g = s === 2 ? () => 1 : s === 4 ? (u) => 1 / Math.sqrt(u) : (u) => Math.pow(u, p), h = P.map((u, c) => c === 0 ? [0, 0] : c === P.length - 1 ? [n, n] : [n * i(tt[c]), n * (1 - i(et[c]))]), $ = P.map((u, c) => {
    if (c === 0) return [1, 0];
    if (c === P.length - 1) return [0, 1];
    let a = o * g(tt[c]) * et[c] * n, m = o * g(et[c]) * tt[c] * n, l = Math.sqrt(a * a + m * m) || 1;
    return [a / l, m / l];
  }), x = [];
  for (let u = 0; u < P.length - 1; u++) {
    let [c, a] = h[u], [m, l] = h[u + 1], [d, f] = $[u], [S, M] = $[u + 1], v = n * i(Ft[u]), b = n * (1 - i(Ot[u])), N = 8 / 3 * (v - (c + m) / 2), B = 8 / 3 * (b - (a + l) / 2), F = S * f - M * d, D = F !== 0 ? (-M * N + S * B) / F : 0, O2 = F !== 0 ? (d * B - f * N) / F : 0, I = c + D * d, R = a + D * f, _ = m - O2 * S, H2 = l - O2 * M, w = I - c, j = R - a, At = _ - c, Et2 = H2 - a, Nt = m - c, It = l - a;
    x.push(k(w, j, At, Et2, Nt, It));
  }
  return { p: n, pathSegment: (u) => {
    let c = z(x[0], u);
    for (let a = 1; a < x.length; a++) c += " " + z(x[a], u);
    return c;
  } };
};
function nt(e, t, r, n) {
  if (n <= 0) return { x: 0, y: 0, theta: e };
  let o = n / 32, i = 0, p = 0;
  for (let h = 1; h <= 32; h++) {
    let $ = (h - 1) * o, x = $ + o, u = ($ + x) / 2, c = e + t * $ + r / 2 * $ * $, a = e + t * x + r / 2 * x * x, m = e + t * u + r / 2 * u * u;
    i += o / 6 * (Math.cos(c) + 4 * Math.cos(m) + Math.cos(a)), p += o / 6 * (Math.sin(c) + 4 * Math.sin(m) + Math.sin(a));
  }
  let g = e + t * n + r / 2 * n * n;
  return { x: i, y: p, theta: g };
}
var qt = 1e-6;
var pt = ({ cornerRadius: e, smoothing: t, roundingAndSmoothingBudget: r }) => {
  if (e <= 0) return q;
  let n = Math.max(0, Math.min(1, t)), s = e, o = Math.PI / 4 * n, i = Math.PI / 2 * s * n, p = i > 0 ? 1 / (s * i) : 0, { x: g, y: h } = i > 0 ? nt(0, 0, p, i) : { x: 0, y: 0 }, { x: $, y: x } = i > 0 ? nt(0, 0, p, i / 2) : { x: 0, y: 0 }, u = g - s * Math.sin(o), c = h + s * Math.cos(o), a = u + c, m = a, l = s, d = g, f = h, S = $, M = x;
  if (a > r && a > 0) {
    let R = r / a;
    m = r, l = s * R, d = g * R, f = h * R, S = $ * R, M = x * R;
  }
  if (m <= 0) return q;
  let v = Math.cos(o), b = Math.sin(o), N = 0, B = 0;
  i > 0 && (b > 1e-12 && (B = 8 / 3 * (f / 2 - M) / b), N = 8 / 3 * (S - d / 2) + B * v);
  let F = Math.PI / 2 - 2 * o, D = Math.abs(F) > qt, O2 = i > 0 ? { head: k(N, 0, d - B * v, f - B * b, d, f), tail: k(B * b, B * v, f, d - N, f, d) } : null, I = null;
  if (D) {
    let R = m - d - f, _ = y(R);
    I = { radius: y(l), d: _, dn: L(R, _) };
  }
  return { p: m, pathSegment: (R) => {
    if (O2 === null) return I === null ? "" : W(I, R);
    let _ = z(O2.head, R), H2 = z(O2.tail, R);
    return I === null ? _ + " " + H2 : _ + " " + W(I, R) + " " + H2;
  } };
};
var mt = 4;
var dt = { arc: it, squircle: at, superellipse: ct, clothoid: pt };
var Te = Object.keys(dt);
function ft(e) {
  return dt[e];
}
var U = /* @__PURE__ */ new Map();
var Z = null;
function Ht(e, t) {
  return e + "|" + t.cornerRadius + "|" + t.smoothing + "|" + t.exponent + "|" + (t.preserveSmoothing ? 1 : 0) + "|" + t.roundingAndSmoothingBudget;
}
function Ut(e) {
  return !Number.isFinite(e.cornerRadius) || !Number.isFinite(e.smoothing) || !Number.isFinite(e.exponent) || !Number.isFinite(e.roundingAndSmoothingBudget);
}
function Dt(e) {
  let t = {};
  return { p: e.p, pathSegment: (r) => {
    let n = t[r];
    if (n !== void 0) return n;
    let s = e.pathSegment(r);
    return t[r] = s, s;
  } };
}
function lt(e, t, r) {
  if (Ut(r)) return t(r);
  let n = Ht(e, r), s = U.get(n);
  if (s) return n !== Z && (U.delete(n), U.set(n, s), Z = n), s;
  let o = Dt(t(r));
  return U.size >= 64 && U.delete(U.keys().next().value), U.set(n, o), Z = n, o;
}
function Be() {
  U.clear(), Z = null;
}
function X(e, t, r, n) {
  let s = Math.min(t, n / e - 1), o = Y({ cornerRadius: e, cornerSmoothing: s, preserveSmoothing: r, roundingAndSmoothingBudget: n }), i = o.a + o.b + o.c;
  return { p: o.p, a: o.a, b: o.b, c: o.c, d: o.d, e: i, ax: o.p - i, ay: e - o.d, R: e };
}
function K({ a: e, b: t, c: r, d: n, e: s, ax: o, ay: i, R: p }) {
  let g = e + t, h = t + r, $ = y(e), x = y(g), u = y(s), c = y(r), a = y(h), m = y(n), l = y(o), d = y(i);
  return { a: $, an: L(e, $), ab: x, abn: L(g, x), e: u, en: L(s, u), c, cn: L(r, c), bc: a, bcn: L(h, a), d: m, dn: L(n, m), r: y(p), ax: l, axn: L(o, l), ay: d, ayn: L(i, d) };
}
function bt(e) {
  let t = K(e);
  return `c ${t.a} 0 ${t.ab} 0 ${t.e} ${t.d} a ${t.r} ${t.r} 0 0 1 ${t.ax} ${t.ay} a ${t.r} ${t.r} 0 0 1 ${t.axn} ${t.ay} c ${t.cn} ${t.d} ${t.bcn} ${t.d} ${t.en} ${t.d}`;
}
function gt(e) {
  let t = K(e);
  return `c ${t.an} 0 ${t.abn} 0 ${t.en} ${t.dn} a ${t.r} ${t.r} 0 0 1 ${t.axn} ${t.ayn} a ${t.r} ${t.r} 0 0 1 ${t.ax} ${t.ayn} c ${t.c} ${t.dn} ${t.bc} ${t.dn} ${t.e} ${t.dn}`;
}
function ht(e) {
  let t = K(e);
  return `c 0 ${t.an} 0 ${t.abn} ${t.d} ${t.en} a ${t.r} ${t.r} 0 0 1 ${t.ay} ${t.axn} a ${t.r} ${t.r} 0 0 1 ${t.ay} ${t.ax} c ${t.d} ${t.c} ${t.d} ${t.bc} ${t.d} ${t.e}`;
}
function $t(e) {
  let t = K(e);
  return `c 0 ${t.a} 0 ${t.ab} ${t.dn} ${t.e} a ${t.r} ${t.r} 0 0 1 ${t.ayn} ${t.ax} a ${t.r} ${t.r} 0 0 1 ${t.ayn} ${t.axn} c ${t.dn} ${t.cn} ${t.dn} ${t.bcn} ${t.dn} ${t.en}`;
}
function xt(e, t, r, n) {
  let s = Y({ cornerRadius: e, cornerSmoothing: t, preserveSmoothing: r, roundingAndSmoothingBudget: n }), o = G(45 * t);
  return { a: s.a, b: s.b, p: s.p, sin: Math.sin(o), cos: Math.cos(o) };
}
var Ct = (e, t, r) => Math.max(0, Math.min(e / t - 1, r));
var T = (e) => y(Object.is(e, -0) ? 0 : e);
function yt(e, t, r, n, s) {
  let o = xt(r, Ct(e / 2, r, n), s, e / 2), i = xt(r, Ct(t / 2, r, n), s, t / 2), p = (u, c, a, m, l, d) => {
    let f = m === 0 ? o : i, S = d === 0 ? o : i, M = u + (a + l) * r, v = c + (m + d) * r, b = M - l * r * f.cos - a * r * f.sin, N = v - d * r * f.cos - m * r * f.sin, B = M - a * r * S.cos - l * r * S.sin, F = v - m * r * S.cos - d * r * S.sin, D = u + a * f.p, O2 = c + m * f.p, I = Math.hypot(B - b, F - N) > 1e-6, R = I ? B : b, _ = I ? F : N, H2 = u + l * S.p, w = c + d * S.p, j = `L ${T(D)} ${T(O2)} `;
    return j += `c ${T(-a * f.a)} ${T(-m * f.a)} ${T(-a * (f.a + f.b))} ${T(-m * (f.a + f.b))} ${T(b - D)} ${T(N - O2)} `, I && (j += `a ${T(r)} ${T(r)} 0 0 1 ${T(B - b)} ${T(F - N)} `), j += `c ${T(H2 - l * (S.a + S.b) - R)} ${T(w - d * (S.a + S.b) - _)} ${T(H2 - l * S.a - R)} ${T(w - d * S.a - _)} ${T(H2 - R)} ${T(w - _)}`, j;
  }, g = p(e, 0, -1, 0, 0, 1), h = p(e, t, 0, -1, -1, 0), $ = p(0, t, 1, 0, 0, -1), x = p(0, 0, 0, 1, 1, 0);
  return `M ${T(o.p)} 0 ${g} ${h} ${$} ${x} Z`;
}
var ze = 0.65;
var Ye = 0.6;
var Gt = 0.65;
var jt = true;
var zt = "squircle";
var C = y;
function Lt(e) {
  return { radius: e.radius, curve: e.curve ?? zt, smoothing: e.smoothing ?? Gt, exponent: e.exponent ?? mt, preserveSmoothing: e.preserveSmoothing ?? jt };
}
function J(e) {
  return Lt(typeof e == "number" ? { radius: e } : e ?? { radius: 0 });
}
function Yt(e) {
  if ("radius" in e) {
    let t = Lt(e);
    return { topLeft: t, topRight: t, bottomRight: t, bottomLeft: t };
  }
  return { topLeft: J(e.topLeft), topRight: J(e.topRight), bottomRight: J(e.bottomRight), bottomLeft: J(e.bottomLeft) };
}
function A(e) {
  return e.length > 0 ? " " + e : "";
}
function E(e, t) {
  let r = ft(e.curve);
  return lt(e.curve, r, { cornerRadius: t.radius, smoothing: e.smoothing, exponent: e.exponent, preserveSmoothing: e.preserveSmoothing, roundingAndSmoothingBudget: t.roundingAndSmoothingBudget });
}
var St = 1e-9;
function Q(e, t, r, n, s) {
  return e.curve === "squircle" && t.curve === "squircle" && Math.abs(r.radius - s) < St && Math.abs(n.radius - s) < St && e.smoothing === t.smoothing && e.preserveSmoothing === t.preserveSmoothing;
}
function rt(e, t, r, n) {
  return (e === r || e.curve === r.curve && e.smoothing === r.smoothing && e.exponent === r.exponent && e.preserveSmoothing === r.preserveSmoothing) && (t === n || t.radius === n.radius && t.roundingAndSmoothingBudget === n.roundingAndSmoothingBudget);
}
function ot(e, t, r) {
  if (e <= 0 || t <= 0) return "M 0 0 H 0 V 0 H 0 Z";
  let n = Yt(r);
  if (n.topLeft.radius <= 0 && n.topRight.radius <= 0 && n.bottomRight.radius <= 0 && n.bottomLeft.radius <= 0) return `M 0 0 H ${e} V ${t} H 0 Z`;
  let s = st({ topLeftCornerRadius: n.topLeft.radius, topRightCornerRadius: n.topRight.radius, bottomRightCornerRadius: n.bottomRight.radius, bottomLeftCornerRadius: n.bottomLeft.radius, width: e, height: t }), o = n.topLeft;
  if (wt(n)) {
    let c = Math.min(o.radius, e / 2, t / 2), a = Math.min(e, t) / 2, m = 1e-9;
    if (c > 0 && a > c + m && a < (1 + o.smoothing) * c - m) return yt(e, t, c, o.smoothing, o.preserveSmoothing);
  }
  let i = e >= t, p = i ? t / 2 : e / 2;
  if (i) {
    let c = Q(n.topRight, n.bottomRight, s.topRight, s.bottomRight, p), a = Q(n.topLeft, n.bottomLeft, s.topLeft, s.bottomLeft, p);
    if (c || a) {
      let m = e / 2, l = c ? X(p, n.topRight.smoothing, n.topRight.preserveSmoothing, m) : null, d = a ? X(p, n.topLeft.smoothing, n.topLeft.preserveSmoothing, m) : null, f = d ? null : E(n.topLeft, s.topLeft), S = l ? null : E(n.topRight, s.topRight), M = l ? null : E(n.bottomRight, s.bottomRight), v = d ? null : E(n.bottomLeft, s.bottomLeft), b = "M " + C(d ? d.p : f.p) + " 0";
      return b += " L " + C(e - (l ? l.p : S.p)) + " 0", l ? b += " " + bt(l) : (b += A(S.pathSegment("TR")), b += " L " + C(e) + " " + C(M.p), b += " L " + C(e) + " " + C(t - M.p), b += A(M.pathSegment("BR"))), d ? (b += " L " + C(d.p) + " " + C(t), b += " " + gt(d)) : (b += " L " + C(e - v.p) + " " + C(t), b += " L " + C(v.p) + " " + C(t), b += A(v.pathSegment("BL")), b += " L 0 " + C(t - f.p), b += " L 0 " + C(f.p), b += A(f.pathSegment("TL"))), b + " Z";
    }
  } else {
    let c = Q(n.topLeft, n.topRight, s.topLeft, s.topRight, p), a = Q(n.bottomLeft, n.bottomRight, s.bottomLeft, s.bottomRight, p);
    if (c || a) {
      let m = t / 2, l = c ? X(p, n.topLeft.smoothing, n.topLeft.preserveSmoothing, m) : null, d = a ? X(p, n.bottomLeft.smoothing, n.bottomLeft.preserveSmoothing, m) : null, f = l ? null : E(n.topLeft, s.topLeft), S = l ? null : E(n.topRight, s.topRight), M = d ? null : E(n.bottomRight, s.bottomRight), v = d ? null : E(n.bottomLeft, s.bottomLeft), b;
      return l ? b = "M 0 " + C(l.p) + " " + ht(l) : (b = "M " + C(f.p) + " 0", b += " L " + C(e - S.p) + " 0", b += A(S.pathSegment("TR"))), b += " L " + C(e) + " " + C(t - (d ? d.p : M.p)), d ? b += " " + $t(d) : (b += A(M.pathSegment("BR")), b += " L " + C(v.p) + " " + C(t), b += A(v.pathSegment("BL"))), l ? b += " L 0 " + C(l.p) : (b += " L 0 " + C(t - f.p), b += " L 0 " + C(f.p), b += A(f.pathSegment("TL"))), b + " Z";
    }
  }
  let g = E(n.topLeft, s.topLeft), h = rt(n.topLeft, s.topLeft, n.topRight, s.topRight) && rt(n.topLeft, s.topLeft, n.bottomRight, s.bottomRight) && rt(n.topLeft, s.topLeft, n.bottomLeft, s.bottomLeft), $ = h ? g : E(n.topRight, s.topRight), x = h ? g : E(n.bottomRight, s.bottomRight), u = h ? g : E(n.bottomLeft, s.bottomLeft);
  return "M " + C(g.p) + " 0 L " + C(e - $.p) + " 0" + A($.pathSegment("TR")) + " L " + C(e) + " " + C(x.p) + " L " + C(e) + " " + C(t - x.p) + A(x.pathSegment("BR")) + " L " + C(e - u.p) + " " + C(t) + " L " + C(u.p) + " " + C(t) + A(u.pathSegment("BL")) + " L 0 " + C(t - g.p) + " L 0 " + C(g.p) + A(g.pathSegment("TL")) + " Z";
}
function wt(e) {
  let t = e.topLeft, r = e.topRight, n = e.bottomRight, s = e.bottomLeft;
  return t.curve === "squircle" && r.curve === "squircle" && r.radius === t.radius && r.smoothing === t.smoothing && r.preserveSmoothing === t.preserveSmoothing && n.curve === "squircle" && n.radius === t.radius && n.smoothing === t.smoothing && n.preserveSmoothing === t.preserveSmoothing && s.curve === "squircle" && s.radius === t.radius && s.smoothing === t.smoothing && s.preserveSmoothing === t.preserveSmoothing;
}
function we(e, t, r) {
  return `path("${ot(e, t, r)}")`;
}
function Mt(e, t = window.getComputedStyle(e)) {
  let r = (h) => h.endsWith("px") ? parseFloat(h) : NaN, n = r(t.width), s = r(t.height);
  if (Number.isNaN(n) || Number.isNaN(s)) return { width: e.offsetWidth, height: e.offsetHeight };
  if (t.boxSizing === "border-box") return { width: n, height: s };
  let o = (parseFloat(t.paddingLeft) || 0) + (parseFloat(t.paddingRight) || 0), i = (parseFloat(t.paddingTop) || 0) + (parseFloat(t.paddingBottom) || 0), p = (parseFloat(t.borderLeftWidth) || 0) + (parseFloat(t.borderRightWidth) || 0), g = (parseFloat(t.borderTopWidth) || 0) + (parseFloat(t.borderBottomWidth) || 0);
  return { width: n + o + p, height: s + i + g };
}
var Rt = "http://www.w3.org/2000/svg";
var kt = 0;
function Ze() {
  return ++kt;
}
function Wt(e, t) {
  let r = e.getBoundingClientRect(), n = t.getBoundingClientRect(), s = Mt(e), o = s.width > 0 && r.width > 0 ? r.width / s.width : 1, i = s.height > 0 && r.height > 0 ? r.height / s.height : 1, p = getComputedStyle(e);
  return { x: (n.left - r.left) / o - (parseFloat(p.borderLeftWidth) || 0) + e.scrollLeft, y: (n.top - r.top) / i - (parseFloat(p.borderTopWidth) || 0) + e.scrollTop };
}
function Ke(e, t) {
  let r;
  return function(s, o, i, p) {
    if (s.setAttribute("width", String(o)), s.setAttribute("height", String(i)), t === e) {
      s.style.left = s.style.top = "0px";
      return;
    }
    r ?? (r = t.offsetParent === e);
    let { x: g, y: h } = r ? p ?? { x: t.offsetLeft, y: t.offsetTop } : Wt(e, t);
    s.style.left = `${g}px`, s.style.top = `${h}px`;
  };
}
function Tt(e) {
  let t = e.replace("#", "");
  return t.length === 3 ? "#" + t[0] + t[0] + t[1] + t[1] + t[2] + t[2] : "#" + t;
}
var vt = /^#?[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
function Je(e) {
  if (!vt.test(e)) return e;
  let t = Tt(e).replace("#", "");
  return `rgb(${parseInt(t.substring(0, 2), 16)},${parseInt(t.substring(2, 4), 16)},${parseInt(t.substring(4, 6), 16)})`;
}
var Qe = { offsetX: 0, offsetY: 0, blur: 0, spread: 0, color: "#000", opacity: 0 };
var Xt = 128;
function tn(e) {
  let t = /* @__PURE__ */ new Map(), r, n = (o) => {
    let i = JSON.stringify(o);
    i !== r && (r = i, t.clear());
  }, s = ((o, i, p, g) => {
    let h = `${o}:${i}:${g}`, $ = t.get(h);
    if ($ !== void 0) return t.delete(h), t.set(h, $), $;
    let x = ot(o, i, p);
    return t.size >= Xt && t.delete(t.keys().next().value), t.set(h, x), x;
  });
  return s.setOptions = n, s._size = () => t.size, e !== void 0 && n(e), s;
}
function en(e, t) {
  if (t === 0) return e;
  if ("radius" in e) return { ...e, radius: Math.max(0, e.radius + t) };
  let r = (n) => {
    if (n !== void 0) return typeof n == "number" ? Math.max(0, n + t) : { ...n, radius: Math.max(0, n.radius + t) };
  };
  return { topLeft: r(e.topLeft), topRight: r(e.topRight), bottomRight: r(e.bottomRight), bottomLeft: r(e.bottomLeft) };
}
function nn(e) {
  if ("radius" in e) return `${e.radius}px`;
  let t = (i) => i === void 0 ? 0 : typeof i == "number" ? i : i.radius, r = t(e.topLeft), n = t(e.topRight), s = t(e.bottomRight), o = t(e.bottomLeft);
  return `${r}px ${n}px ${s}px ${o}px`;
}
function Vt(e) {
  if (!vt.test(e)) return `color-mix(in oklab, ${e}, black 33%)`;
  let t = Tt(e).replace("#", ""), r = parseInt(t.substring(0, 2), 16), n = parseInt(t.substring(2, 4), 16), s = parseInt(t.substring(4, 6), 16);
  if (r === 0 && n === 0 && s === 0) return "#4c4c4c";
  let o = Math.round(r * 2 / 3), i = Math.round(n * 2 / 3), p = Math.round(s * 2 / 3);
  return "#" + (1 << 24 | o << 16 | i << 8 | p).toString(16).slice(1);
}
function rn(e) {
  return typeof e == "object" && e !== null && "type" in e;
}
function Zt(e) {
  let t = (90 - e) * Math.PI / 180;
  return { x1: 0.5 - 0.5 * Math.cos(t), y1: 0.5 + 0.5 * Math.sin(t), x2: 0.5 + 0.5 * Math.cos(t), y2: 0.5 - 0.5 * Math.sin(t) };
}
function Bt(e, t) {
  for (; e.lastChild; ) e.removeChild(e.lastChild);
  for (let r of t) {
    let n = document.createElementNS(Rt, "stop");
    n.setAttribute("offset", String(r.offset)), n.setAttribute("stop-color", r.color), r.opacity !== void 0 && r.opacity !== 1 && n.setAttribute("stop-opacity", String(r.opacity)), e.appendChild(n);
  }
}
function on(e, t, r) {
  let n = t.type === "linear" ? "linearGradient" : "radialGradient", s = document.createElementNS(Rt, n);
  return s.setAttribute("id", r), Pt(s, t), Bt(s, t.stops), e.appendChild(s), s;
}
function sn(e, t) {
  Pt(e, t), Bt(e, t.stops);
}
function Pt(e, t) {
  if (t.type === "linear") {
    let r = Zt(t.angle ?? 0);
    e.setAttribute("x1", String(r.x1)), e.setAttribute("y1", String(r.y1)), e.setAttribute("x2", String(r.x2)), e.setAttribute("y2", String(r.y2));
  } else e.setAttribute("cx", String(t.cx ?? 0.5)), e.setAttribute("cy", String(t.cy ?? 0.5)), e.setAttribute("r", String(t.r ?? 0.5));
}
function an(e) {
  return { ...e, stops: e.stops.map((t) => ({ ...t, color: Vt(t.color) })) };
}

// node_modules/@lisse/core/dist/index.js
function ne(e, r, t, n) {
  e.setAttribute("x", String(-r)), e.setAttribute("y", String(-r)), e.setAttribute("width", String(t + r * 2)), e.setAttribute("height", String(n + r * 2));
}
function X2(e, r, t, n, o) {
  ne(e, t, n, o), ne(r, t, n, o);
}
function ee(e, r, t) {
  let n = document.createElementNS(Rt, "mask");
  n.setAttribute("id", e), t && n.setAttribute("maskUnits", "userSpaceOnUse");
  let o = document.createElementNS(Rt, "rect");
  o.setAttribute("fill", "white");
  let i = document.createElementNS(Rt, "path");
  return i.setAttribute("fill", "none"), i.setAttribute("stroke", "black"), n.appendChild(o), n.appendChild(i), r.appendChild(n), { mask: n, rect: o, knockout: i };
}
function te(e) {
  let r = document.createElementNS(Rt, "g"), t = document.createElementNS(Rt, "path");
  t.setAttribute("fill", "none"), e && t.setAttribute(e.attr, e.value), t.style.display = "none", r.appendChild(t);
  let n = document.createElementNS(Rt, "path");
  return n.setAttribute("fill", "none"), e && n.setAttribute(e.attr, e.value), n.style.display = "none", r.appendChild(n), { group: r, strokePath: t, grooveOverlay: n };
}
function Y2(e, r) {
  let t = r === "main" ? "gradientEl" : "overlayGradientEl";
  e[t]?.remove(), e[t] = null;
}
function re(e, r, t) {
  if (!rn(e)) return Y2(r, t), e;
  let n = t === "main" ? "gradientEl" : "overlayGradientEl", o = t === "main" ? r.gradientId : r.overlayGradientId;
  return r[n] ? sn(r[n], e) : r[n] = on(r.defs, e, o), `url(#${o})`;
}
function oe(e, r, t, n, o) {
  if (!e || e.width <= 0 || e.opacity <= 0) {
    o.strokePath.style.display = "none", o.strokeGroup.removeAttribute("mask"), o.grooveOverlay.style.display = "none", Y2(o, "main"), Y2(o, "overlay");
    return;
  }
  let i = o.strokeMultiplier;
  o.strokePath.style.display = "", o.strokePath.setAttribute("d", r), o.strokePath.setAttribute("stroke", re(e.color, o, "main")), o.strokePath.setAttribute("stroke-width", String(e.width * i)), o.strokePath.setAttribute("stroke-opacity", String(e.opacity));
  let s = e.style ?? "solid";
  switch (o.strokeGroup.removeAttribute("mask"), o.grooveOverlay.style.display = "none", o.strokePath.removeAttribute("stroke-dasharray"), o.strokePath.setAttribute("stroke-linecap", "butt"), s !== "groove" && s !== "ridge" && Y2(o, "overlay"), s) {
    case "dashed": {
      let a = Math.max(0, e.dash ?? e.width * 3), l = Math.max(0, e.gap ?? e.width * 2);
      o.strokePath.setAttribute("stroke-dasharray", `${a} ${l}`), e.lineCap && o.strokePath.setAttribute("stroke-linecap", e.lineCap);
      break;
    }
    case "dotted": {
      let a = Math.max(0, e.dash ?? 0), l = Math.max(0, e.gap ?? e.width * 2);
      o.strokePath.setAttribute("stroke-dasharray", `${a} ${l}`), o.strokePath.setAttribute("stroke-linecap", e.lineCap ?? "round");
      break;
    }
    case "double":
      if (e.width >= 3) {
        let a = Math.round(e.width / 3);
        o.dblKnockout.setAttribute("d", r), o.dblKnockout.setAttribute("stroke-width", String(a * i)), o.dblRect.setAttribute("width", String(t)), o.dblRect.setAttribute("height", String(n)), o.padDblMask && o.padDblMask(e.width, t, n), o.strokeGroup.setAttribute("mask", `url(#${o.dblMaskId})`);
      }
      break;
    case "groove":
    case "ridge": {
      let a = rn(e.color) ? an(e.color) : Vt(e.color);
      s === "groove" && o.strokePath.setAttribute("stroke", re(a, o, "main")), o.grooveOverlay.style.display = "", o.grooveOverlay.setAttribute("d", r), o.grooveOverlay.setAttribute("stroke", re(s === "groove" ? e.color : a, o, "overlay")), o.grooveOverlay.setAttribute("stroke-width", String(e.width * i / 2)), o.grooveOverlay.setAttribute("stroke-opacity", String(e.opacity));
      break;
    }
  }
}
function nt2(e, r) {
  let t = Ze(), n = `sc-ishadow-mask-${t}`, o = document.createElementNS(Rt, "mask");
  o.setAttribute("id", n), o.setAttribute("maskUnits", "userSpaceOnUse");
  let i = document.createElementNS(Rt, "rect");
  i.setAttribute("fill", "white");
  let s = document.createElementNS(Rt, "path");
  s.setAttribute("fill", "black"), o.appendChild(i), o.appendChild(s), e.appendChild(o);
  let a = `sc-ishadow-blur-${t}`, l = document.createElementNS(Rt, "filter");
  l.setAttribute("id", a), l.setAttribute("x", "-200%"), l.setAttribute("y", "-200%"), l.setAttribute("width", "500%"), l.setAttribute("height", "500%"), l.setAttribute("color-interpolation-filters", "sRGB");
  let c = document.createElementNS(Rt, "feGaussianBlur");
  c.setAttribute("stdDeviation", "0"), l.appendChild(c), e.appendChild(l);
  let u = document.createElementNS(Rt, "g"), m = document.createElementNS(Rt, "rect");
  return m.setAttribute("mask", `url(#${n})`), m.style.display = "none", u.appendChild(m), r.appendChild(u), { maskId: n, mask: o, maskRect: i, maskCutout: s, filterId: a, filter: l, feBlur: c, blurGroup: u, rect: m };
}
function it2(e) {
  e.mask.remove(), e.filter.remove(), e.blurGroup.remove();
}
function st2(e, r = e) {
  let t = Ze(), n = `sc-clip-${t}`, o = `sc-mask-${t}`, i = document.createElementNS(Rt, "svg");
  i.style.position = "absolute", i.style.left = "0px", i.style.top = "0px", i.style.pointerEvents = "none", i.style.overflow = "visible", i.style.zIndex = "1", i.setAttribute("aria-hidden", "true"), i.setAttribute("width", "0"), i.setAttribute("height", "0");
  let s = document.createElementNS(Rt, "defs"), a = document.createElementNS(Rt, "clipPath");
  a.setAttribute("id", n);
  let l = document.createElementNS(Rt, "path");
  a.appendChild(l), s.appendChild(a);
  let c = document.createElementNS(Rt, "mask");
  c.setAttribute("id", o), c.setAttribute("maskUnits", "userSpaceOnUse");
  let u = document.createElementNS(Rt, "rect");
  u.setAttribute("fill", "white");
  let m = document.createElementNS(Rt, "path");
  m.setAttribute("fill", "black"), c.appendChild(u), c.appendChild(m), s.appendChild(c);
  let p = `sc-dbl-inner-${t}`, { rect: v, knockout: M } = ee(p, s, false), k2 = `sc-dbl-outer-${t}`, { mask: y2, rect: b, knockout: C2 } = ee(k2, s, true), B = `sc-dbl-middle-${t}`, { mask: T2, rect: V2, knockout: J2 } = ee(B, s, true);
  i.appendChild(s);
  let R = document.createElementNS(Rt, "g");
  R.setAttribute("clip-path", `url(#${n})`), i.appendChild(R);
  let I = [], { group: ue, strokePath: we2, grooveOverlay: xe } = te({ attr: "clip-path", value: `url(#${n})` });
  i.appendChild(ue);
  let { group: ce, strokePath: Ge, grooveOverlay: Me } = te({ attr: "mask", value: `url(#${o})` });
  i.appendChild(ce);
  let { group: pe, strokePath: Be2, grooveOverlay: Pe } = te();
  i.appendChild(pe), e.appendChild(i);
  let Oe = { strokePath: we2, grooveOverlay: xe, strokeGroup: ue, dblMaskId: p, dblKnockout: M, dblRect: v, strokeMultiplier: 2, defs: s, gradientEl: null, gradientId: `sc-grad-inner-${t}`, overlayGradientEl: null, overlayGradientId: `sc-grad-inner-ov-${t}` }, Te2 = { strokePath: Ge, grooveOverlay: Me, strokeGroup: ce, dblMaskId: k2, dblKnockout: C2, dblRect: b, strokeMultiplier: 2, defs: s, gradientEl: null, gradientId: `sc-grad-outer-${t}`, overlayGradientEl: null, overlayGradientId: `sc-grad-outer-ov-${t}`, padDblMask: (A2, w, f) => X2(y2, b, A2, w, f) }, Re = { strokePath: Be2, grooveOverlay: Pe, strokeGroup: pe, dblMaskId: B, dblKnockout: J2, dblRect: V2, strokeMultiplier: 1, defs: s, gradientEl: null, gradientId: `sc-grad-middle-${t}`, overlayGradientEl: null, overlayGradientId: `sc-grad-middle-ov-${t}`, padDblMask: (A2, w, f) => X2(T2, V2, A2, w, f) }, Q2 = tn(), Ie = Ke(e, r);
  return { update(A2, w, f, g, Le) {
    if (f <= 0 || g <= 0) return;
    Ie(i, f, g, Le), i.setAttribute("viewBox", `0 0 ${f} ${g}`), Q2.setOptions(A2);
    let L2 = Q2(f, g, A2, 0);
    l.setAttribute("d", L2), m.setAttribute("d", L2), u.setAttribute("width", String(f)), u.setAttribute("height", String(g)), oe(w.innerBorder, L2, f, g, Oe);
    let N = w.outerBorder;
    N && N.width > 0 && N.opacity > 0 && X2(c, u, N.width, f, g), oe(N, L2, f, g, Te2), oe(w.middleBorder, L2, f, g, Re);
    let F = w.innerShadow, W2 = F == null ? [] : Array.isArray(F) ? F : [F];
    for (; I.length < W2.length; ) I.push(nt2(s, R));
    for (; I.length > W2.length; ) it2(I.pop());
    for (let U2 = 0; U2 < W2.length; U2++) {
      let S = W2[U2], h = I[U2];
      if (S.opacity <= 0) {
        h.rect.style.display = "none";
        continue;
      }
      h.rect.style.display = "";
      let x = S.spread, fe = Math.max(S.blur * 3, 20) + Math.max(Math.abs(S.offsetX), Math.abs(S.offsetY)) + Math.abs(x);
      X2(h.mask, h.maskRect, fe, f, g);
      let Ne = Math.max(1, f - x * 2), $e = Math.max(1, g - x * 2), De = x !== 0 ? en(A2, -x) : A2;
      h.maskCutout.setAttribute("d", Q2(Ne, $e, De, -x)), h.maskCutout.setAttribute("transform", `translate(${S.offsetX + x},${S.offsetY + x})`), S.blur > 0 ? (h.feBlur.setAttribute("stdDeviation", String(S.blur)), h.blurGroup.setAttribute("filter", `url(#${h.filterId})`)) : h.blurGroup.removeAttribute("filter"), ne(h.rect, fe, f, g), h.rect.setAttribute("fill", Je(S.color)), h.rect.setAttribute("fill-opacity", String(S.opacity));
    }
  }, destroy() {
    i.remove();
  } };
}
var P2 = /* @__PURE__ */ new WeakMap();
function dt2(e) {
  let r = P2.get(e) ?? 0;
  if (r > 0) return P2.set(e, r + 1), true;
  let t = getComputedStyle(e).position;
  return t !== "static" && t !== "" ? false : (P2.set(e, 1), e.style.position = "relative", true);
}
function at2(e) {
  let r = P2.get(e);
  r !== void 0 && (r <= 1 ? (P2.delete(e), e.style.position = "") : P2.set(e, r - 1));
}
var z2 = /* @__PURE__ */ new WeakMap();
var ie = /* @__PURE__ */ new WeakMap();
function se(e) {
  let r = z2.get(e) ?? 0;
  r === 0 && ie.set(e, e.style.isolation), z2.set(e, r + 1), e.style.isolation = "isolate";
}
function de(e) {
  let r = z2.get(e);
  r !== void 0 && (r <= 1 ? (z2.delete(e), e.style.isolation = ie.get(e) ?? "", ie.delete(e)) : z2.set(e, r - 1));
}
function lt2(e, r) {
  return Math.ceil(3 * e + Math.abs(r) + 1);
}
function ut2(e, r, t, n) {
  e.setAttribute("x", String(-n)), e.setAttribute("y", String(-n)), e.setAttribute("width", String(r + 2 * n)), e.setAttribute("height", String(t + 2 * n));
}
function ct2(e, r) {
  let t = `sc-shadow-${Ze()}`, n = document.createElementNS(Rt, "filter");
  n.setAttribute("id", t), n.setAttribute("filterUnits", "userSpaceOnUse"), n.setAttribute("color-interpolation-filters", "sRGB");
  let o = document.createElementNS(Rt, "feGaussianBlur");
  o.setAttribute("stdDeviation", "0"), n.appendChild(o), e.appendChild(n);
  let i = document.createElementNS(Rt, "path");
  return r.appendChild(i), { filterId: t, filterEl: n, feBlur: o, pathEl: i };
}
function pt2(e) {
  e.filterEl.remove(), e.pathEl.remove();
}
function ft2(e, r = e) {
  se(e);
  let t = document.createElementNS(Rt, "svg");
  t.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:-1", t.setAttribute("width", "0"), t.setAttribute("height", "0"), t.setAttribute("aria-hidden", "true");
  let n = document.createElementNS(Rt, "defs");
  t.appendChild(n), e.appendChild(t);
  let o = [], i = tn(), s = Ke(e, r);
  return { update(a, l, c, u, m) {
    let p = Array.isArray(l) ? l : [l];
    if (!(c > 0 && u > 0 && p.some((k2) => k2.opacity > 0))) {
      t.style.display = "none";
      return;
    }
    for (s(t, c, u, m); o.length < p.length; ) o.push(ct2(n, t));
    for (; o.length > p.length; ) pt2(o.pop());
    i.setOptions(a);
    let M = false;
    for (let k2 = 0; k2 < p.length; k2++) {
      let y2 = p[k2], b = o[p.length - 1 - k2];
      if (y2.opacity <= 0) {
        b.pathEl.style.display = "none";
        continue;
      }
      let C2 = y2.spread, B = c + C2 * 2, T2 = u + C2 * 2;
      if (B <= 0 || T2 <= 0) {
        b.pathEl.style.display = "none";
        continue;
      }
      M = true, b.pathEl.style.display = "";
      let V2 = Je(y2.color), J2 = en(a, C2);
      if (b.pathEl.setAttribute("d", i(B, T2, J2, C2)), b.pathEl.setAttribute("transform", `translate(${y2.offsetX - C2},${y2.offsetY - C2})`), b.pathEl.setAttribute("fill", V2), b.pathEl.setAttribute("fill-opacity", String(y2.opacity)), y2.blur > 0) {
        let R = lt2(y2.blur, C2);
        ut2(b.filterEl, B, T2, R), b.feBlur.setAttribute("stdDeviation", String(y2.blur)), b.pathEl.setAttribute("filter", `url(#${b.filterId})`);
      } else b.pathEl.removeAttribute("filter");
    }
    t.style.display = M ? "" : "none";
  }, destroy() {
    t.remove(), de(e);
  } };
}
var H = null;
var E2;
var G2 = /* @__PURE__ */ new Map();
var O = /* @__PURE__ */ new Set();
var ae = /* @__PURE__ */ new WeakMap();
function le() {
  E2 = void 0;
  let e = [...O];
  O.clear();
  let r = /* @__PURE__ */ new Map();
  for (let t of e) {
    if (!G2.has(t)) continue;
    let n = t, o = window.getComputedStyle(n), i = Mt(n, o);
    ae.set(t, { width: i.width, height: i.height, horizontal: o.writingMode === "horizontal-tb" || o.writingMode === "" }), r.set(t, { ...i, offsetLeft: n.offsetLeft, offsetTop: n.offsetTop });
  }
  for (let t of e) {
    let n = G2.get(t);
    if (n) {
      let o = r.get(t);
      for (let i of [...n]) i(o);
    }
  }
}
function mt2() {
  return H || (H = new ResizeObserver((e) => {
    let r = false;
    for (let t of e) {
      let n = ae.get(t.target), o = t.borderBoxSize?.[0];
      n?.horizontal && o && o.inlineSize === n.width && o.blockSize === n.height || (O.add(t.target), r = true);
    }
    r && E2 === void 0 && (E2 = requestAnimationFrame(le));
  })), H;
}
function ye(e) {
  G2.has(e) && (O.add(e), E2 === void 0 && (E2 = requestAnimationFrame(le)));
}
function Se(e, r) {
  if (typeof ResizeObserver > "u") return () => {
  };
  let t = mt2(), n = G2.get(e);
  n || (n = /* @__PURE__ */ new Set(), G2.set(e, n), t.observe(e)), n.add(r), O.add(e), E2 === void 0 && (E2 = requestAnimationFrame(le));
  let o = false;
  return () => {
    o || (o = true, n.delete(r), n.size === 0 && (G2.delete(e), t.unobserve(e), ae.delete(e)), G2.size === 0 && (E2 !== void 0 && (cancelAnimationFrame(E2), E2 = void 0), O.clear(), H?.disconnect(), H = null));
  };
}
function bt2(e, r) {
  let t = true;
  return Se(e, () => {
    if (t) {
      t = false;
      return;
    }
    ye(r);
  });
}
function Ee(e) {
  let r = e.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (!r) return;
  let t = Number(r[1]), n = Number(r[2]), o = Number(r[3]), i = r[4] !== void 0 ? Number(r[4]) : 1;
  return { hex: "#" + (1 << 24 | t << 16 | n << 8 | o).toString(16).slice(1), opacity: i };
}
var ve = /(?:color-mix|light-dark|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))+\)/;
var ht2 = /\/\s*([\d.]+%?)\s*\)$/;
function ke(e) {
  let r = Ee(e);
  if (r) return r.opacity > 0 ? { color: r.hex, opacity: r.opacity } : void 0;
  if (ve.exec(e)?.[0] !== e) return;
  let t = e.match(ht2)?.[1];
  return t && parseFloat(t) === 0 ? void 0 : { color: e, opacity: 1 };
}
function Ce(e, r = getComputedStyle(e)) {
  let t = r.borderTopStyle;
  if (t === "none" || t === "hidden") return;
  for (let a of ["Right", "Bottom", "Left"]) if (r[`border${a}Style`] !== t || r[`border${a}Width`] !== r.borderTopWidth || r[`border${a}Color`] !== r.borderTopColor) return;
  let n = parseFloat(r.borderTopWidth);
  if (n <= 0 || isNaN(n)) return;
  let o = ke(r.borderTopColor);
  if (!o) return;
  let s = { dashed: "dashed", dotted: "dotted", double: "double", groove: "groove", ridge: "ridge" }[t];
  return { width: n, color: o.color, opacity: o.opacity, ...s ? { style: s } : {} };
}
function Ae(e) {
  if (!e || e === "none") return {};
  let r = [], t = 0, n = 0;
  for (let s = 0; s < e.length; s++) e[s] === "(" ? t++ : e[s] === ")" ? t-- : e[s] === "," && t === 0 && (r.push(e.slice(n, s).trim()), n = s + 1);
  r.push(e.slice(n).trim());
  let o = [], i = [];
  for (let s of r) {
    let a = s.includes("inset"), l = s.replace("inset", "").trim(), c = l.match(ve);
    if (!c) continue;
    let u = ke(c[0]);
    if (!u) continue;
    let p = l.replace(c[0], "").trim().split(/\s+/).map(parseFloat).filter((M) => !isNaN(M));
    if (p.length < 2) continue;
    let v = { offsetX: p[0], offsetY: p[1], blur: p[2] ?? 0, spread: p[3] ?? 0, ...u };
    (a ? i : o).push(v);
  }
  return { shadow: o.length > 0 ? o : void 0, innerShadow: i.length > 0 ? i : void 0 };
}
function gt2(e) {
  let r = { border: e.style.border, boxShadow: e.style.boxShadow, paddingTop: e.style.paddingTop, paddingRight: e.style.paddingRight, paddingBottom: e.style.paddingBottom, paddingLeft: e.style.paddingLeft }, t = getComputedStyle(e), n = { borderTopStyle: t.borderTopStyle, borderTopWidth: t.borderTopWidth, borderTopColor: t.borderTopColor, borderRightStyle: t.borderRightStyle, borderRightWidth: t.borderRightWidth, borderRightColor: t.borderRightColor, borderBottomStyle: t.borderBottomStyle, borderBottomWidth: t.borderBottomWidth, borderBottomColor: t.borderBottomColor, borderLeftStyle: t.borderLeftStyle, borderLeftWidth: t.borderLeftWidth, borderLeftColor: t.borderLeftColor }, o = t.boxShadow, i = parseFloat(t.paddingTop) || 0, s = parseFloat(t.paddingRight) || 0, a = parseFloat(t.paddingBottom) || 0, l = parseFloat(t.paddingLeft) || 0, c = Mt(e, t), u = Ce(e, n), { shadow: m, innerShadow: p } = Ae(o);
  u && (e.style.border = "0"), (m || p) && (e.style.boxShadow = "none"), u && (e.style.paddingTop = i + u.width + "px", e.style.paddingRight = s + u.width + "px", e.style.paddingBottom = a + u.width + "px", e.style.paddingLeft = l + u.width + "px");
  let v = {};
  return u && (v.innerBorder = u), m && (v.shadow = m), p && (v.innerShadow = p), { effects: v, size: c, savedStyles: r };
}
function yt2(e) {
  return e ? !!(e.innerBorder || e.outerBorder || e.middleBorder || e.innerShadow || e.shadow) : false;
}
function St2(e, r) {
  return { ...e?.effects, ...r };
}
function Et(e, r) {
  e.style.border = r.border, e.style.boxShadow = r.boxShadow, e.style.paddingTop = r.paddingTop, e.style.paddingRight = r.paddingRight, e.style.paddingBottom = r.paddingBottom, e.style.paddingLeft = r.paddingLeft;
}
export {
  ze as APPLE_SMOOTHING,
  Te as CURVE_TYPES,
  zt as DEFAULT_CURVE,
  mt as DEFAULT_EXPONENT,
  jt as DEFAULT_PRESERVE_SMOOTHING,
  Qe as DEFAULT_SHADOW,
  Gt as DEFAULT_SMOOTHING,
  Ye as FIGMA_SMOOTHING,
  se as acquireIsolation,
  dt2 as acquirePosition,
  it as buildArc,
  pt as buildClothoid,
  at as buildSquircle,
  ct as buildSuperellipse,
  Be as clearCurveCache,
  nn as cornerOptionsToBorderRadius,
  ft2 as createDropShadow,
  st2 as createSvgEffects,
  st as distributeAndNormalize,
  gt2 as extractAndStripEffects,
  we as generateClipPath,
  ot as generatePath,
  ft as getCurveBuilder,
  Mt as getLayoutSize,
  Y as getPathParamsForCorner,
  yt2 as hasEffects,
  St2 as mergeEffects,
  bt2 as observeAnchor,
  Se as observeResize,
  Ce as parseBorder,
  Ae as parseBoxShadow,
  Ee as parseColor,
  de as releaseIsolation,
  at2 as releasePosition,
  ye as requestMeasure,
  Et as restoreStyles
};
//# sourceMappingURL=@lisse_core.js.map
