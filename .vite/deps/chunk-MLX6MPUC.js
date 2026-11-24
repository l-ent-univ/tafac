// node_modules/skullet/dist/index.mjs
var k = "skullet-reveal";
var _ = "skullet-pane";
var $ = "skullet-loading";
var R = "skullet-ghost";
var re = "skullet-snapshot";
var v = "skullet-layer";
var ie = "skullet-rect";
var se = "skullet-bar";
var ae = "skullet-inactive";
var A = "skullet-exiting";
var L = "skullet-covered";
var M = "skullet-own";
var Pe = "skullet-ignore";
var N = "skullet-block";
var _t = /* @__PURE__ */ Symbol.for("skullet.ghost");
var Nt = /* @__PURE__ */ Symbol.for("skullet.uncover");
var le = "skullet-status";
var z = "skullet-xray";
var He = "skullet-debug";
var D = "var(--skullet-base, rgb(128 128 128 / 0.2))";
var Dt = "var(--skullet-highlight, rgb(255 255 255 / 0.12))";
var T = 200;
var W = 320;
var Bt = 280;
var Ie = 1e4;
var ze = { shimmer: { slow: 4e3, fast: 2e3 }, pulse: { slow: 2400, fast: 1200 } };
var xe = ["a", "b", "code", "dd", "dt", "em", "h1", "h2", "h3", "h4", "h5", "h6", "i", "label", "li", "p", "small", "span", "strong", "td", "th", "time"];
var K = ["audio", "canvas", "embed", "iframe", "img", "input", "object", "picture", "select", "svg", "textarea", "video"];
var Pt = K.join(", ");
var Gn = xe.join(", ");
var It = `
[${k}] {
  position: relative;
}

skullet-reveal {
  display: block;
}

skullet-reveal[loading]:not(:defined) {
  visibility: hidden;
}

[${_}] {
  display: block;
}

[${$}] {
  position: relative;
  -webkit-user-select: none;
  user-select: none;
  pointer-events: none;
}

[${ae}] {
  display: none !important;
}

[${v}] {
  position: absolute;
  inset: 0;
  overflow: visible;
}

[${se}] {
  display: block;
  background-color: ${D};
  background-repeat: no-repeat;
}

/* Containers keep their surface; what they hold is drawn by bones, measured before the first paint */
@scope ([${$}]) to ([${M}], [${v}]) {
  :scope,
  :scope * {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    text-decoration-color: transparent !important;
  }

  :scope ::placeholder {
    color: transparent !important;
  }

  /* A line to measure in empty text; content only, never a size, or a dot-sized span would grow round it */
  :scope :is(${Gn}):empty:not(svg *)::before {
    content: "000000";
  }

  /* Leaves are drawn by bones, so their own paint never shows; visibility, as measuring reads it */
  :scope :is(:not(:has(*)), ${Pt}, [${L}], [${N}]):not(svg *) {
    visibility: hidden !important;
  }

  /* No script to measure: a bar struck through each line of text instead */
  @media (scripting: none) {
    :scope :not(:has(*)):not(svg *) {
      visibility: visible !important;
    }

    :scope,
    :scope * {
      text-decoration: line-through ${D} !important;
      text-decoration-thickness: 0.72em !important;
      text-decoration-skip-ink: none !important;
    }

    :scope :is(${Pt}, [${N}]):not(svg *) {
      visibility: visible !important;
      background: ${D} !important;
    }

    :scope svg * {
      fill: transparent !important;
      stroke: transparent !important;
    }

    :scope :is(img, video) {
      object-position: -100vw 0;
    }
  }
}

/* Read by screen readers in the skeleton's place, never seen */
[${le}] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Debug x-ray: the ghost shown through its bones, to see what was measured */
[${z}] [${$}] [${R}],
[${z}] [${$}] [${R}] *:not(svg *) {
  visibility: visible !important;
  color: rgb(255 0 80 / 0.7) !important;
  -webkit-text-fill-color: rgb(255 0 80 / 0.7) !important;
}

/* Lets addStyles see a stylesheet already on the page, from styles.css or a server render */
:root {
  --skullet: 1;
}`;
var B = null;
var We = 0;
var Ht;
function F() {
  We++, !B && (Ht ??= !!getComputedStyle(document.documentElement).getPropertyValue("--skullet"), !Ht && (B = document.createElement("style"), B.dataset.skullet = "true", B.textContent = It, document.head.appendChild(B)));
}
function ce() {
  We--, !(We > 0 || !B) && (B.remove(), B = null);
}
var zt = '"use strict";(()=>{var B="skullet-ghost";var D="skullet-layer",L="skullet-rect";var R="skullet-covered",$="skullet-own",v="skullet-ignore",H="skullet-block",I=Symbol.for("skullet.ghost"),G=Symbol.for("skullet.uncover"),P="skullet.boot";var W="var(--skullet-base, rgb(128 128 128 / 0.2))",z="var(--skullet-highlight, rgb(255 255 255 / 0.12))";var F={shimmer:{slow:4e3,fast:2e3},pulse:{slow:2400,fast:1200}},X=["a","b","code","dd","dt","em","h1","h2","h3","h4","h5","h6","i","label","li","p","small","span","strong","td","th","time"],U=["audio","canvas","embed","iframe","img","input","object","picture","select","svg","textarea","video"];var gt,V=()=>gt??(gt=/jsdom/.test(navigator.userAgent)?null:document.createElement("canvas").getContext("2d"));var J=(t,n)=>t?{left:Math.max(t.left,n.left),right:Math.min(t.right,n.right),top:Math.max(t.top,n.top),bottom:Math.min(t.bottom,n.bottom)}:n,A=t=>[[t.left,t.top],[t.right,t.top],[t.right,t.bottom],[t.left,t.bottom]],k=(t,n)=>Math.abs(t[0]-n[0])<1&&Math.abs(t[1]-n[1])<1;function Q(t,n){let e=Math.min(n.right-n.left,n.bottom-n.top),o=r=>r.endsWith("%")?parseFloat(r)/100*e:parseFloat(r)||0;return[o(t.borderTopLeftRadius),o(t.borderTopRightRadius),o(t.borderBottomRightRadius),o(t.borderBottomLeftRadius)]}function bt(t,n,e){let o=J(t,n),r=Q(e,n),c=t?A(t):[],a=A(n),l=A(o).map((f,T)=>k(f,a[T])?r[T]:t&&k(f,c[T])?t.corners[T]:0),{left:s,right:i,top:u,bottom:h}=o;return{left:s,right:i,top:u,bottom:h,corners:l}}function Tt(t,n,e,o){if(!t)return e;let r=A(t),c=A(n).map((l,s)=>t.corners[s]>0&&k(l,r[s]));if(!c.some(Boolean))return e;let a=Q(o,n);return c.map((l,s)=>l?Math.max(a[s],t.corners[s]):a[s]).map(l=>`${l}px`).join(" ")}var j=(t,n)=>{let e=J(n,t);return e.right-e.left>=2&&e.bottom-e.top>=2?e:null},q={top:"ascender",bottom:"descender"},C=new Map,tt=t=>[...t.getClientRects?.()??[]];function St(t){let n=`${t.fontStyle} ${t.fontWeight} ${t.fontSize} ${t.fontFamily}`;if(C.has(n))return C.get(n);let e=V(),o=null;if(e){e.font=n;let r=e.measureText("H"),c=a=>e.measureText(a).actualBoundingBoxAscent;o={ascent:r.fontBoundingBoxAscent,descent:r.fontBoundingBoxDescent,ascender:c("bdfhkl"),capHeight:r.actualBoundingBoxAscent,xHeight:c("xz"),descender:e.measureText("gjpqy").actualBoundingBoxDescent}}return C.set(n,o),o}var Y={ascender:"ascender","cap-height":"capHeight","x-height":"xHeight"},K=(t,n,e,o)=>{let r=t.getPropertyValue(n).trim();return e.includes(r)?r:o};function xt(t,n,e){let o=St(n);if(!o){let s=Math.min(e*.72,t.bottom-t.top),i=(t.top+t.bottom)/2;return{barTop:i-s/2,barBottom:i+s/2}}let r=K(n,"--skullet-text-top",Object.keys(Y),q.top),c=K(n,"--skullet-text-bottom",["baseline","descender"],q.bottom),a=o.ascent+o.descent,l=t.top+(t.bottom-t.top-a)/2+o.ascent;return{barTop:l-o[Y[r]],barBottom:l+(c==="descender"?o.descender:0)}}var Et=new Set(U),Rt=new Set(X),et=.4,At=/[,/]\\s*0\\)$/,y=(t,n)=>t!==""&&t!==n,yt=["Top","Right","Bottom","Left"],Mt=t=>yt.every(n=>y(t[`border${n}Style`],"none")&&y(t[`border${n}Width`],"0px")),Ct=t=>{let[n=0,e=0,o=0,r=0]=(t.replace(/rgba?\\([^)]*\\)|#\\w+/g,"").match(/-?[\\d.]+px/g)??[]).map(parseFloat);return t.includes("inset")&&!o&&!r&&n===0!=(e===0)&&Math.abs(n+e)<=2},kt=t=>y(t,"none")&&!t.split(/,(?![^(]*\\))/).every(Ct),Ot=t=>y(t.backgroundColor,"transparent")&&!At.test(t.backgroundColor)||y(t.backgroundImage,"none")||kt(t.boxShadow)||Mt(t),ot=t=>Et.has(t.localName),nt=t=>Rt.has(t.localName)&&!t.firstElementChild&&!t.textContent?.trim(),wt=t=>{let n=document.createTreeWalker(t,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT),e=document.createRange(),o=[],r=0;for(;n.nextNode();){let i=n.currentNode;if(i.nodeType===Node.TEXT_NODE){let u=i.parentElement;if(!i.textContent?.trim()||!u)continue;r++;let h=u.getBoundingClientRect();if(h.width<=1||h.height<=1)continue;e.selectNodeContents(i),o.push(tt(e).filter(f=>f.width||f.height))}else nt(i)&&(r++,o.push([...i.getClientRects()]))}if(!o.some(i=>i.length))return r;let c=(parseFloat(getComputedStyle(t).fontSize)||16)*et,a=(i,u)=>Math.min(i.bottom,u.bottom)-Math.max(i.top,u.top)>=Math.min(i.height,u.height)/2&&Math.max(i.left,u.left)-Math.min(i.right,u.right)<=c,l=o.map((i,u)=>u),s=i=>l[i]===i?i:l[i]=s(l[i]);for(let i=0;i<o.length;i++)for(let u=i+1;u<o.length;u++)o[i].some(h=>o[u].some(f=>a(h,f)))&&(l[s(u)]=s(i));return new Set(o.map((i,u)=>s(u))).size},Nt=(t,n)=>t.hasAttribute(H)||ot(t)||Ot(n)&&wt(t)<=1;function _t(t,n){if(parseFloat(n.borderRadius)||!t.parentElement)return n.borderRadius||"0px";let e=t.parentElement,o=getComputedStyle(e),r=t.getBoundingClientRect(),c=e.getBoundingClientRect();return Math.abs(r.width-c.width)<1&&Math.abs(r.height-c.height)<1&&o.overflow!=="visible"?o.borderRadius:n.borderRadius||"0px"}function Z(t){t.sort((e,o)=>e.left-o.left);let n=[];for(let e of t){let o=n.find(r=>{let c=Math.min(r.bottom,e.bottom)-Math.max(r.top,e.top),a=Math.min(r.bottom-r.top,e.bottom-e.top),l=e.left-r.right;return c>=a/2&&l<=Math.max(r.fontSize,e.fontSize)*et});o?(o.left=Math.min(o.left,e.left),o.right=Math.max(o.right,e.right),o.top=Math.min(o.top,e.top),o.bottom=Math.max(o.bottom,e.bottom),o.fontSize=Math.max(o.fontSize,e.fontSize),o.barTop=Math.min(o.barTop,e.barTop),o.barBottom=Math.max(o.barBottom,e.barBottom)):n.push({...e})}return n.map(e=>{let o=e.barBottom-e.barTop;return{x:e.left,y:e.barTop,width:e.right-e.left,height:o,radius:e.radius||`${Math.round(o/3)}px`}})}function rt(t,n,{mark:e=!0,onCovered:o}={}){let r=n.getBoundingClientRect(),c=n.offsetWidth?r.width/n.offsetWidth:1,a=n.offsetHeight?r.height/n.offsetHeight:1,l=m=>({left:(m.left-r.left)/c,right:(m.right-r.left)/c,top:(m.top-r.top)/a,bottom:(m.bottom-r.top)/a}),s=[],i=[],u=new Set,h=document.createRange(),f=(m,g,b)=>{let d=j(m,b);if(!d)return;let p=parseFloat(g.fontSize)||16,M=l(d);i.push({...M,fontSize:p,...xt(M,g,p),radius:g.getPropertyValue("--skullet-radius").trim()})},T=(m,g)=>{let b=m.data.search(/\\S/);if(b<0||!m.parentElement)return;h.setStart(m,b),h.setEnd(m,m.data.trimEnd().length);let d=getComputedStyle(m.parentElement);for(let p of tt(h))f(p,d,g)},_=(m,g)=>{for(let b of m.childNodes){if(b.nodeType===Node.TEXT_NODE){T(b,g);continue}if(b.nodeType!==Node.ELEMENT_NODE)continue;let d=b;if(d.hasAttribute(v)||d.hasAttribute($))continue;let p=getComputedStyle(d);if(p.display==="none")continue;if(Nt(d,p)){let E=j(d.getBoundingClientRect(),g);if(E){let S=l(E);s.push({x:S.left,y:S.top,width:S.right-S.left,height:S.bottom-S.top,radius:Tt(g,E,_t(d,p),p)})}ot(d)||u.add(d);continue}if(nt(d)){for(let E of d.getClientRects())f(E,p,g);continue}let M=p.overflowX!=="visible"||p.overflowY!=="visible";_(d,M?bt(g,d.getBoundingClientRect(),p):g)}};if(_(t,null),o?.(u),!e)return[...s,...Z(i)];for(let m of t.querySelectorAll(`[${R}]`))u.has(m)||m.removeAttribute(R);for(let m of u)m.hasAttribute(R)||m.setAttribute(R,"");return[...s,...Z(i)]}var Bt=t=>typeof matchMedia<"u"&&matchMedia(t).matches,Dt=()=>typeof Element<"u"&&typeof Element.prototype.animate=="function",st=()=>!Dt()||Bt("(prefers-reduced-motion: reduce)");var it=t=>t.getAnimations?.()??[];var Lt=.7,$t=1280,at=320,vt=2.5,Ht=.45,It=["shimmer","group-shimmer","pulse","none"];function lt(t){let n=getComputedStyle(t),e=(c,a,l)=>{let s=n.getPropertyValue(c).trim();return a.includes(s)?s:l},o=e("--skullet-animation",It,"shimmer"),r=e("--skullet-speed",["slow","fast"],"slow");return{animation:o,duration:F[o==="pulse"?"pulse":"shimmer"][r]}}var w=20,Gt=Math.sin(w*Math.PI/180),ut=Math.cos(w*Math.PI/180),Pt=Gt/ut;var Wt=`${90+w}deg`,O=.85,x=12,ct=t=>(1-Math.cos(Math.PI*t))/2;function zt(t){let n=t*vt,e=(r,c)=>`color-mix(in srgb, ${z} ${(c*100).toFixed(1)}%, transparent) ${(r*t).toFixed(2)}px`,o=[];for(let r=0;r<=x;r++)o.push(e(r/x*O,ct(r/x)));for(let r=1;r<=x;r++)o.push(e(O+r/x*(1-O),ct(1-r/x)));return{width:n/ut,image:`repeating-linear-gradient(${Wt}, ${o.join(", ")}, transparent ${n.toFixed(2)}px)`}}function Ft(t,n,e=lt(t)){for(let f of it(t))f.cancel();if(t.style.backgroundImage="",t.style.backgroundRepeat="",st()||typeof t.animate!="function"||e.animation==="none")return;let o={duration:e.duration,iterations:1/0};if(e.animation==="pulse"){t.animate([{opacity:1,easing:"ease-in-out"},{opacity:Ht,easing:"ease-in-out"},{opacity:1}],o).startTime=0;return}let r=t.getBoundingClientRect(),c=r.left+scrollX,a=e.animation==="group-shimmer"?n??{left:c,top:r.top,width:r.width,height:r.height}:{left:0,top:0,width:document.documentElement.clientWidth||innerWidth,height:innerHeight},l=Math.min(Math.max(a.width*.4,80),at),{width:s,image:i}=zt(l),u=c-a.left+(r.top-a.top)*Pt,h=e.duration*Lt/($t+at);t.style.backgroundImage=i,t.style.backgroundSize=`${s}px 100%`,t.style.backgroundRepeat="repeat-x",t.animate([{backgroundPosition:`${-u}px 0`},{backgroundPosition:`${s-u}px 0`}],{duration:s*h,iterations:1/0}).startTime=0}var Xt=t=>t.shadowRoot??t.attachShadow({mode:"open"});function mt(t,n){let e=Xt(t),o=t.getBoundingClientRect(),r={left:o.left+scrollX,top:o.top,width:o.width,height:o.height},c=lt(t);for(n.forEach((a,l)=>{let s=e.children[l];s||(s=document.createElement("div"),s.setAttribute(L,""),s.style.cssText=`position:absolute;display:block;pointer-events:none;background-color:${W};background-repeat:no-repeat`,e.append(s)),Object.assign(s.style,{left:`${a.x}px`,top:`${a.y}px`,width:`${a.width}px`,height:`${a.height}px`,borderRadius:a.radius});let i=`${Math.round(r.left+a.x)}|${Math.round(a.y)}|${Math.round(a.height)}|${Math.round(r.left)}|${Math.round(r.width)}|${Math.round(r.height)}|${document.documentElement.clientWidth}|${c.animation}|${c.duration}`;s.dataset.motion!==i&&(s.dataset.motion=i,Ft(s,r,c))});e.children.length>n.length;)e.lastElementChild.remove()}var pt=t=>t.parentElement?`${pt(t.parentElement)} > :nth-child(${[...t.parentElement.children].indexOf(t)+1})`:":root";function N(t){let n=t?.previousElementSibling,e=n?.querySelector(`:scope > [${B}]`),o=n?.querySelector(`:scope > [${D}]`);if(!n||!e||!o)return;let r=typeof CSSStyleSheet=="function"&&"replaceSync"in CSSStyleSheet.prototype?new CSSStyleSheet:null;r&&(document.adoptedStyleSheets=[...document.adoptedStyleSheets,r],n[G]=()=>{document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==r)});let c=s=>r?.replaceSync(s.size?`${[...s].map(pt).join(", ")} { visibility: hidden !important; }`:""),a=()=>{if(!o.isConnected||n[I])return l.disconnect();e.getClientRects().length&&mt(o,rt(e,o,{mark:!1,onCovered:c}))},l=new ResizeObserver(a);l.observe(n),document.fonts?.ready.then(a)}var ht=self,ft=Symbol.for(P),dt=ht[ft];ht[ft]=N;Array.isArray(dt)&&dt.forEach(N);N(document.currentScript);})();';
var Wt = '(s=>{let k=Symbol.for("skullet.boot"),b=self[k];typeof b=="function"?b(s):(self[k]=b||[]).push(s)})(document.currentScript)';
var qn = (e, t = false) => `<script${e ? ` nonce="${e.replace(/"/g, "&quot;")}"` : ""}>${t ? Wt : zt}<\/script>`;
var qe = { light: { base: "rgb(0 0 0 / 0.07)", highlight: "rgb(255 255 255 / 0.6)" }, dark: { base: "rgb(255 255 255 / 0.08)", highlight: "rgb(255 255 255 / 0.1)" } };
var jn = { ...qe, animation: "shimmer", speed: "slow", text: { top: "ascender", bottom: "descender" } };
function Ge(e = {}, t = null) {
  let n = {}, o = t && (e[t] ?? qe[t]);
  return o && (n["--skullet-base"] = o.base, n["--skullet-highlight"] = o.highlight), e.radius && (n["--skullet-radius"] = e.radius), e.animation && (n["--skullet-animation"] = e.animation), e.speed && (n["--skullet-speed"] = e.speed), e.text?.top && (n["--skullet-text-top"] = e.text.top), e.text?.bottom && (n["--skullet-text-bottom"] = e.text.bottom), n;
}
var Ft = (e) => Object.entries(e).map(([t, n]) => `${t}: ${n};`).join(" ");
function je({ theme: e = {}, mode: t, text: n, selector: o = ":root" }) {
  let r = { ...e, text: { ...e.text, ...n } }, i = t ?? (e.light || e.dark ? "system" : null), a = Ge(r, i === "dark" ? "dark" : i ? "light" : null), s = [];
  if (Object.keys(a).length && s.push(`${o} { ${Ft(a)} }`), i === "system") {
    let c = Ge({ dark: e.dark }, "dark");
    s.push(`@media (prefers-color-scheme: dark) { ${o} { ${Ft(c)} } }`);
  }
  return s.join(`
`);
}
var Fe = null;
function Un(e, t, { nonce: n } = {}) {
  Fe ??= document.head.appendChild(document.createElement("style")), n && (Fe.nonce = n), Fe.textContent = je({ theme: e, mode: t });
}
var Xn = (e, t) => {
  let n = je(e);
  return n ? `<style${t ? ` nonce="${t.replace(/"/g, "&quot;")}"` : ""}>${n}</style>` : "";
};
var P = /* @__PURE__ */ new Map();
var Te;
var w = null;
var G = 0;
function Vn() {
  try {
    return new URLSearchParams(location.search).has("skullet-debug") || localStorage.getItem("skullet:debug") === "1";
  } catch {
    return false;
  }
}
var Kn = () => Te ??= typeof window < "u" && Vn();
var q = (e) => Kn() || !!e?.closest(`[${He}]`);
function Yn(e) {
  Te = e, e ? Ut() : Zn();
}
function Gt(e, t) {
  !e || !q(e) || (P.set(e, { state: "loading", source: t }), jt());
}
function qt(e, t) {
  !e || !q(e) || (P.set(e, { ...P.get(e), state: "shown", moved: t }), jt());
}
function jt() {
  Ut(), cancelAnimationFrame(G), Ue();
}
var Jn = `
:host { all: initial; }
.box { position: fixed; box-sizing: border-box; border: 1px dashed; border-radius: 4px; }
.label {
  position: absolute; left: -1px; bottom: 100%; margin-bottom: 2px;
  padding: 1px 6px; border-radius: 4px; white-space: nowrap;
  font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff;
}
.loading { border-color: #3b82f6; } .loading .label { background: #3b82f6; }
.still { border-color: #22c55e; } .still .label { background: #16a34a; }
.moved { border-color: #ef4444; border-style: solid; } .moved .label { background: #dc2626; }
.panel {
  position: fixed; right: 12px; bottom: 12px; display: flex; gap: 8px; align-items: center;
  padding: 6px 10px; border-radius: 8px; background: #111; color: #fff; pointer-events: auto;
  font: 500 12px/16px ui-sans-serif, system-ui, sans-serif; box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
}
.panel label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
`;
function Ut() {
  if (typeof document > "u") return;
  if (!w?.isConnected) {
    w = document.createElement("div"), w.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    let t = w.attachShadow({ mode: "open" });
    t.innerHTML = `<style>${Jn}</style><div class="boxes"></div>`, document.body.append(w);
  }
  let e = w.shadowRoot;
  if (Te && !e.querySelector(".panel")) {
    let t = document.createElement("div");
    t.className = "panel", t.innerHTML = 'skullet debug <label><input type="checkbox" class="xray"> x-ray</label>', t.querySelector(".xray").addEventListener("change", (n) => {
      document.documentElement.toggleAttribute(z, n.target.checked);
    }), e.append(t);
  }
  G || (G = requestAnimationFrame(Ue));
}
function Zn() {
  w?.shadowRoot?.querySelector(".panel")?.remove(), document.documentElement.removeAttribute(z), ![...P.keys()].some((e) => q(e)) && (cancelAnimationFrame(G), G = 0, w?.remove(), w = null);
}
var Qn = ({ state: e, source: t, moved: n }) => {
  let o = t ? ` · ${t}` : "";
  return e === "loading" ? { kind: "loading", text: `skeleton${o}` } : !n || n.width === 0 && n.height === 0 ? { kind: "still", text: `✓ no movement${o}` } : { kind: "moved", text: `✗ moved ${n.width}×${n.height}px${o}` };
};
function Ue() {
  if (G = 0, !w?.shadowRoot) return;
  let e = w.shadowRoot.querySelector(".boxes");
  for (let n of P.keys()) (!n.isConnected || !q(n)) && P.delete(n);
  let t = [...P];
  for (; e.children.length > t.length; ) e.lastElementChild.remove();
  t.forEach(([n, o], r) => {
    let i = e.children[r];
    i || (i = e.appendChild(document.createElement("div")), i.innerHTML = '<span class="label"></span>');
    let a = n.getBoundingClientRect(), { kind: s, text: c } = Qn(o);
    i.className = `box ${s}`, Object.assign(i.style, { left: `${a.left - 2}px`, top: `${a.top - 2}px`, width: `${a.width + 4}px`, height: `${a.height + 4}px` }), i.firstElementChild.textContent = c;
  }), (Te || P.size) && (G = requestAnimationFrame(Ue));
}
var eo;
var ye = () => eo ??= /jsdom/.test(navigator.userAgent) ? null : document.createElement("canvas").getContext("2d");
var Jt = (e, t) => e ? { left: Math.max(e.left, t.left), right: Math.min(e.right, t.right), top: Math.max(e.top, t.top), bottom: Math.min(e.bottom, t.bottom) } : t;
var ue = (e) => [[e.left, e.top], [e.right, e.top], [e.right, e.bottom], [e.left, e.bottom]];
var Ve = (e, t) => Math.abs(e[0] - t[0]) < 1 && Math.abs(e[1] - t[1]) < 1;
function Zt(e, t) {
  let n = Math.min(t.right - t.left, t.bottom - t.top), o = (r) => r.endsWith("%") ? parseFloat(r) / 100 * n : parseFloat(r) || 0;
  return [o(e.borderTopLeftRadius), o(e.borderTopRightRadius), o(e.borderBottomRightRadius), o(e.borderBottomLeftRadius)];
}
function to(e, t, n) {
  let o = Jt(e, t), r = Zt(n, t), i = e ? ue(e) : [], a = ue(t), s = ue(o).map((p, m) => Ve(p, a[m]) ? r[m] : e && Ve(p, i[m]) ? e.corners[m] : 0), { left: c, right: l, top: u, bottom: d } = o;
  return { left: c, right: l, top: u, bottom: d, corners: s };
}
function no(e, t, n, o) {
  if (!e) return n;
  let r = ue(e), i = ue(t).map((s, c) => e.corners[c] > 0 && Ve(s, r[c]));
  if (!i.some(Boolean)) return n;
  let a = Zt(o, t);
  return i.map((s, c) => s ? Math.max(a[c], e.corners[c]) : a[c]).map((s) => `${s}px`).join(" ");
}
var Xt = (e, t) => {
  let n = Jt(t, e);
  return n.right - n.left >= 2 && n.bottom - n.top >= 2 ? n : null;
};
var Ke = { top: "ascender", bottom: "descender" };
var Xe = /* @__PURE__ */ new Map();
var Qt = (e) => [...e.getClientRects?.() ?? []];
function oo(e) {
  let t = `${e.fontStyle} ${e.fontWeight} ${e.fontSize} ${e.fontFamily}`;
  if (Xe.has(t)) return Xe.get(t);
  let n = ye(), o = null;
  if (n) {
    n.font = t;
    let r = n.measureText("H"), i = (a) => n.measureText(a).actualBoundingBoxAscent;
    o = { ascent: r.fontBoundingBoxAscent, descent: r.fontBoundingBoxDescent, ascender: i("bdfhkl"), capHeight: r.actualBoundingBoxAscent, xHeight: i("xz"), descender: n.measureText("gjpqy").actualBoundingBoxDescent };
  }
  return Xe.set(t, o), o;
}
var Vt = { ascender: "ascender", "cap-height": "capHeight", "x-height": "xHeight" };
var Kt = (e, t, n, o) => {
  let r = e.getPropertyValue(t).trim();
  return n.includes(r) ? r : o;
};
function ro(e, t, n) {
  let o = oo(t);
  if (!o) {
    let c = Math.min(n * 0.72, e.bottom - e.top), l = (e.top + e.bottom) / 2;
    return { barTop: l - c / 2, barBottom: l + c / 2 };
  }
  let r = Kt(t, "--skullet-text-top", Object.keys(Vt), Ke.top), i = Kt(t, "--skullet-text-bottom", ["baseline", "descender"], Ke.bottom), a = o.ascent + o.descent, s = e.top + (e.bottom - e.top - a) / 2 + o.ascent;
  return { barTop: s - o[Vt[r]], barBottom: s + (i === "descender" ? o.descender : 0) };
}
var io = new Set(K);
var so = new Set(xe);
var en = 0.4;
var ao = /[,/]\s*0\)$/;
var pe = (e, t) => e !== "" && e !== t;
var lo = ["Top", "Right", "Bottom", "Left"];
var co = (e) => lo.every((t) => pe(e[`border${t}Style`], "none") && pe(e[`border${t}Width`], "0px"));
var uo = (e) => {
  let [t = 0, n = 0, o = 0, r = 0] = (e.replace(/rgba?\([^)]*\)|#\w+/g, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
  return e.includes("inset") && !o && !r && t === 0 != (n === 0) && Math.abs(t + n) <= 2;
};
var po = (e) => pe(e, "none") && !e.split(/,(?![^(]*\))/).every(uo);
var mo = (e) => pe(e.backgroundColor, "transparent") && !ao.test(e.backgroundColor) || pe(e.backgroundImage, "none") || po(e.boxShadow) || co(e);
var tn = (e) => io.has(e.localName);
var nn = (e) => so.has(e.localName) && !e.firstElementChild && !e.textContent?.trim();
var ho = (e) => {
  let t = document.createTreeWalker(e, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT), n = document.createRange(), o = [], r = 0;
  for (; t.nextNode(); ) {
    let l = t.currentNode;
    if (l.nodeType === Node.TEXT_NODE) {
      let u = l.parentElement;
      if (!l.textContent?.trim() || !u) continue;
      r++;
      let d = u.getBoundingClientRect();
      if (d.width <= 1 || d.height <= 1) continue;
      n.selectNodeContents(l), o.push(Qt(n).filter((p) => p.width || p.height));
    } else nn(l) && (r++, o.push([...l.getClientRects()]));
  }
  if (!o.some((l) => l.length)) return r;
  let i = (parseFloat(getComputedStyle(e).fontSize) || 16) * en, a = (l, u) => Math.min(l.bottom, u.bottom) - Math.max(l.top, u.top) >= Math.min(l.height, u.height) / 2 && Math.max(l.left, u.left) - Math.min(l.right, u.right) <= i, s = o.map((l, u) => u), c = (l) => s[l] === l ? l : s[l] = c(s[l]);
  for (let l = 0; l < o.length; l++) for (let u = l + 1; u < o.length; u++) o[l].some((d) => o[u].some((p) => a(d, p))) && (s[c(u)] = c(l));
  return new Set(o.map((l, u) => c(u))).size;
};
var fo = (e, t) => e.hasAttribute(N) || tn(e) || mo(t) && ho(e) <= 1;
function go(e, t) {
  if (parseFloat(t.borderRadius) || !e.parentElement) return t.borderRadius || "0px";
  let n = e.parentElement, o = getComputedStyle(n), r = e.getBoundingClientRect(), i = n.getBoundingClientRect();
  return Math.abs(r.width - i.width) < 1 && Math.abs(r.height - i.height) < 1 && o.overflow !== "visible" ? o.borderRadius : t.borderRadius || "0px";
}
function Yt(e) {
  e.sort((n, o) => n.left - o.left);
  let t = [];
  for (let n of e) {
    let o = t.find((r) => {
      let i = Math.min(r.bottom, n.bottom) - Math.max(r.top, n.top), a = Math.min(r.bottom - r.top, n.bottom - n.top), s = n.left - r.right;
      return i >= a / 2 && s <= Math.max(r.fontSize, n.fontSize) * en;
    });
    o ? (o.left = Math.min(o.left, n.left), o.right = Math.max(o.right, n.right), o.top = Math.min(o.top, n.top), o.bottom = Math.max(o.bottom, n.bottom), o.fontSize = Math.max(o.fontSize, n.fontSize), o.barTop = Math.min(o.barTop, n.barTop), o.barBottom = Math.max(o.barBottom, n.barBottom)) : t.push({ ...n });
  }
  return t.map((n) => {
    let o = n.barBottom - n.barTop;
    return { x: n.left, y: n.barTop, width: n.right - n.left, height: o, radius: n.radius || `${Math.round(o / 3)}px` };
  });
}
function Ye(e, t, { mark: n = true, onCovered: o } = {}) {
  let r = t.getBoundingClientRect(), i = t.offsetWidth ? r.width / t.offsetWidth : 1, a = t.offsetHeight ? r.height / t.offsetHeight : 1, s = (h) => ({ left: (h.left - r.left) / i, right: (h.right - r.left) / i, top: (h.top - r.top) / a, bottom: (h.bottom - r.top) / a }), c = [], l = [], u = /* @__PURE__ */ new Set(), d = document.createRange(), p = (h, g, S) => {
    let b = Xt(h, S);
    if (!b) return;
    let x = parseFloat(g.fontSize) || 16, I = s(b);
    l.push({ ...I, fontSize: x, ...ro(I, g, x), radius: g.getPropertyValue("--skullet-radius").trim() });
  }, m = (h, g) => {
    let S = h.data.search(/\S/);
    if (S < 0 || !h.parentElement) return;
    d.setStart(h, S), d.setEnd(h, h.data.trimEnd().length);
    let b = getComputedStyle(h.parentElement);
    for (let x of Qt(d)) p(x, b, g);
  }, f = (h, g) => {
    for (let S of h.childNodes) {
      if (S.nodeType === Node.TEXT_NODE) {
        m(S, g);
        continue;
      }
      if (S.nodeType !== Node.ELEMENT_NODE) continue;
      let b = S;
      if (b.hasAttribute(Pe) || b.hasAttribute(M)) continue;
      let x = getComputedStyle(b);
      if (x.display === "none") continue;
      if (fo(b, x)) {
        let y = Xt(b.getBoundingClientRect(), g);
        if (y) {
          let C = s(y);
          c.push({ x: C.left, y: C.top, width: C.right - C.left, height: C.bottom - C.top, radius: no(g, y, go(b, x), x) });
        }
        tn(b) || u.add(b);
        continue;
      }
      if (nn(b)) {
        for (let y of b.getClientRects()) p(y, x, g);
        continue;
      }
      let I = x.overflowX !== "visible" || x.overflowY !== "visible";
      f(b, I ? to(g, b.getBoundingClientRect(), x) : g);
    }
  };
  if (f(e, null), o?.(u), !n) return [...c, ...Yt(l)];
  for (let h of e.querySelectorAll(`[${L}]`)) u.has(h) || h.removeAttribute(L);
  for (let h of u) h.hasAttribute(L) || h.setAttribute(L, "");
  return [...c, ...Yt(l)];
}
var on = (e) => typeof matchMedia < "u" && matchMedia(e).matches;
var Je = () => typeof Element < "u" && typeof Element.prototype.animate == "function";
var O = () => !Je() || on("(prefers-reduced-motion: reduce)");
var rn = () => on("(prefers-reduced-transparency: reduce)");
var Y = (e) => e.getAnimations?.() ?? [];
var sn = 0.7;
var an = 1280;
var Qe = 320;
var bo = 2.5;
var xo = 0.45;
var To = ["shimmer", "group-shimmer", "pulse", "none"];
function Se(e) {
  let t = getComputedStyle(e), n = (i, a, s) => {
    let c = t.getPropertyValue(i).trim();
    return a.includes(c) ? c : s;
  }, o = n("--skullet-animation", To, "shimmer"), r = n("--skullet-speed", ["slow", "fast"], "slow");
  return { animation: o, duration: ze[o === "pulse" ? "pulse" : "shimmer"][r] };
}
var et = 20;
var yo = Math.sin(et * Math.PI / 180);
var tt = Math.cos(et * Math.PI / 180);
var j = yo / tt;
var U = tt;
var nt = `${90 + et}deg`;
var Ze = 0.85;
var E = 12;
var J = (e) => (1 - Math.cos(Math.PI * e)) / 2;
function So(e) {
  let t = e * bo, n = (r, i) => `color-mix(in srgb, ${Dt} ${(i * 100).toFixed(1)}%, transparent) ${(r * e).toFixed(2)}px`, o = [];
  for (let r = 0; r <= E; r++) o.push(n(r / E * Ze, J(r / E)));
  for (let r = 1; r <= E; r++) o.push(n(Ze + r / E * (1 - Ze), J(1 - r / E)));
  return { width: t / tt, image: `repeating-linear-gradient(${nt}, ${o.join(", ")}, transparent ${t.toFixed(2)}px)` };
}
function Z(e, t, n = Se(e)) {
  for (let p of Y(e)) p.cancel();
  if (e.style.backgroundImage = "", e.style.backgroundRepeat = "", O() || typeof e.animate != "function" || n.animation === "none") return;
  let o = { duration: n.duration, iterations: 1 / 0 };
  if (n.animation === "pulse") {
    e.animate([{ opacity: 1, easing: "ease-in-out" }, { opacity: xo, easing: "ease-in-out" }, { opacity: 1 }], o).startTime = 0;
    return;
  }
  let r = e.getBoundingClientRect(), i = r.left + scrollX, a = n.animation === "group-shimmer" ? t ?? { left: i, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: document.documentElement.clientWidth || innerWidth }, s = Math.min(Math.max(a.width * 0.4, 80), Qe), { width: c, image: l } = So(s), u = i - a.left + (r.top - a.top) * j, d = n.duration * sn / (an + Qe);
  e.style.backgroundImage = l, e.style.backgroundSize = `${c}px 100%`, e.style.backgroundRepeat = "repeat-x", e.animate([{ backgroundPosition: `${-u}px 0` }, { backgroundPosition: `${c - u}px 0` }], { duration: c * d, iterations: 1 / 0 }).startTime = 0;
}
function ln(e) {
  if (O()) return null;
  let t = Se(e);
  return t.animation !== "shimmer" && t.animation !== "group-shimmer" ? null : t.duration * sn / (an + Qe);
}
var Eo = (e) => e.shadowRoot ?? e.attachShadow({ mode: "open" });
var Ee = (e) => e.shadowRoot ? [...e.shadowRoot.children] : [];
function ot(e, t) {
  let n = Eo(e), o = e.getBoundingClientRect(), r = { left: o.left + scrollX, top: o.top, width: o.width, height: o.height }, i = Se(e);
  for (t.forEach((a, s) => {
    let c = n.children[s];
    c || (c = document.createElement("div"), c.setAttribute(ie, ""), c.style.cssText = `position:absolute;display:block;pointer-events:none;background-color:${D};background-repeat:no-repeat`, n.append(c)), Object.assign(c.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${a.width}px`, height: `${a.height}px`, borderRadius: a.radius });
    let l = `${Math.round(r.left + a.x)}|${Math.round(a.y)}|${Math.round(a.height)}|${Math.round(r.left)}|${Math.round(r.width)}|${Math.round(r.height)}|${document.documentElement.clientWidth}|${i.animation}|${i.duration}`;
    c.dataset.motion !== l && (c.dataset.motion = l, Z(c, r, i));
  }); n.children.length > t.length; ) n.lastElementChild.remove();
}
var de = 150;
var Ro = 120;
var vo = 72;
var Ao = 3;
var ko = 60;
var it = 150;
var Mo = 400;
var st = 1.5;
var Q = 1e3;
var at = 1e3;
var wo = /* @__PURE__ */ new Set(["filter", "transform", "translate", "scale", "rotate", "clipPath", "easing", "composite"]);
var pn = -1 / 0;
var cn = false;
function Co() {
  if (!(cn || typeof addEventListener > "u")) {
    cn = true;
    for (let e of ["wheel", "touchmove", "keydown"]) addEventListener(e, () => pn = performance.now(), { passive: true, capture: true });
  }
}
var Re = /* @__PURE__ */ new WeakMap();
function dn(e, { served: t, refetch: n }) {
  Co();
  let o = Re.get(e)?.since ?? performance.now();
  Re.set(e, { since: t ? -1 / 0 : o, refetch: n });
}
function ve(e) {
  let t = [], n = (o) => {
    for (let r of o.children) {
      let i = [...r.childNodes].some((a) => a.nodeType === Node.TEXT_NODE && a.textContent?.trim());
      !r.firstElementChild || i || r.localName === "svg" ? t.push(r) : n(r);
    }
  };
  return n(e), t;
}
function $o(e, t) {
  for (let n = e; n && n !== t; n = n.parentElement) {
    let o = n.parentElement;
    if (!o) break;
    if ([...o.children].filter((i) => i.localName === n.localName && i.className === n.className).length >= 3) return n;
  }
  return e;
}
var Lo = (e, t) => {
  let n = t.left + t.width / 2, o = t.top + t.height / 2;
  return n >= e.left && n <= e.right && o >= e.top && o <= e.bottom;
};
function lt(e) {
  let { left: t, top: n, right: o, bottom: r } = e.getBoundingClientRect();
  for (let i of e.querySelectorAll(`:scope > [${A}]`)) {
    let a = i.getBoundingClientRect();
    t = Math.min(t, a.left), n = Math.min(n, a.top), o = Math.max(o, a.right), r = Math.max(r, a.bottom);
  }
  return new DOMRect(t, n, o - t, r - n);
}
var Ae = (e, t) => Math.min(Math.max(e, 0), t);
var rt = -1 / 0;
function Oo(e, t, n, o, r) {
  let i = performance.now();
  i - rt > it && (rt = i);
  let a = i - rt, s = t.getBoundingClientRect(), c = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map(), u = (p) => parseFloat(getComputedStyle(p).fontSize) || 16;
  for (let p of ve(e)) {
    let m = $o(p, e), f = c.get(m);
    f || (f = { rect: m.getBoundingClientRect(), size: 0 }, c.set(m, f));
    let h = u(p);
    f.size = Math.max(f.size, h), l.set(p, { unit: f, size: h });
  }
  let d = (p) => {
    let m = n(p);
    return m === null ? null : Ae(m, Q) + Math.max(o.delay ?? 0, 0);
  };
  return { kind: "sequence", duration: r, enter: o.enter, pieceDelay: (p) => {
    let m = l.get(p);
    return m ? d({ rect: p.getBoundingClientRect(), unit: m.unit.rect, secondary: m.size < m.unit.size, reveal: s, late: a }) : null;
  }, boneDelay: (p) => {
    let m = [...c.values()].find((f) => Lo(f.rect, p));
    return d({ rect: p, unit: m?.rect ?? null, secondary: !!m && p.height < m.size * 0.8, reveal: s, late: a });
  } };
}
function _o(e, t) {
  if (!e) return;
  let n = {};
  for (let [o, r] of Object.entries(e)) wo.has(o) ? n[o] = r : o !== "opacity" && t(o);
  return n;
}
function mn(e, t, n, o = () => {
}) {
  let r = Re.get(t);
  Re.delete(t);
  let i = n;
  for (; i.choose; ) {
    let { choose: c, ...l } = i;
    i = { ...l, ...c({ content: e, reveal: t, waited: r ? performance.now() - r.since : 1 / 0, input: performance.now() - pn < Mo, refetch: !!r?.refetch, height: e.getBoundingClientRect().height, pieces: ve(e).length }) };
  }
  let a = Ae(i.duration ?? T, at);
  if (i = { ...i, delay: Math.min(i.delay ?? 0, Q) }, !a) return { kind: "instant" };
  let s = _o(i.enter, o);
  if (i.wipe) {
    let c = lt(t);
    if (c.width * c.height <= innerWidth * innerHeight * st) return { kind: "wipe", wipe: i.wipe, start: performance.now() + (i.delay ?? 0), duration: a, reveal: c, enter: s };
  } else if (typeof i.order == "function") return Oo(e, t, i.order, { ...i, enter: s }, a);
  return { kind: "together", delay: Math.max(i.delay ?? 0, 0), duration: a, enter: s };
}
var hn = ({ rect: e, reveal: t }) => {
  let n = (e.top - t.top) / Math.max(t.height, 1), o = (e.left - t.left) / Math.max(t.width, 1);
  return Ae(n * 0.8 + o * 0.2, 1) * W;
};
var un = (e) => e.bottom > 0 && e.top < innerHeight;
var fn = ({ rect: e, unit: t, secondary: n, late: o }) => {
  if (!t) return un(e) ? 0 : null;
  if (!un(t)) return null;
  let r = Ae(t.top / innerHeight, 1) * W;
  return Math.max(r - o, 0) + (n ? ko : 0);
};
var gn = { duration: 0 };
var me = { order: "together" };
var ke = { order: hn };
var ct = (e) => e.input || e.waited < de ? gn : e.refetch ? { order: "together", duration: Ro } : null;
var ut = (e) => e.height < vo || e.pieces <= Ao ? me : { order: fn };
var Me = { hold: de, choose: (e) => ct(e) ?? ut(e) };
var No = new Set(K);
var Do = "script, noscript, template, base, meta, link";
var bn = /* @__PURE__ */ new Set(["iframe", "object", "embed"]);
var Bo = /* @__PURE__ */ new Set(["src", "srcset", "sizes", "poster", "data", "srcdoc", "action", "formaction", "value", "alt", L]);
var pt = (e) => e.replace(/[A-Z]/g, "X").replace(/[a-z]/g, "x").replace(/\d/g, "0");
function Po(e, t) {
  let n = pt(t.data);
  t.data = n;
  let o = e.parentElement, r = ye();
  if (!o || !r || !n.trim()) return;
  let i = getComputedStyle(o);
  r.font = `${i.fontStyle} ${i.fontWeight} ${i.fontSize} ${i.fontFamily}`;
  let a = (d) => {
    let p = d.replace(/\s+/g, " ");
    return i.textTransform === "uppercase" ? p.toUpperCase() : i.textTransform === "lowercase" ? p.toLowerCase() : p;
  }, s = r.measureText(a(e.data)).width, c = r.measureText(a(n)).width, l = (s - c) / a(n).length;
  if (Math.abs(l) < 0.01) return;
  let u = document.createElement("span");
  u.style.letterSpacing = `${(parseFloat(i.letterSpacing) || 0) + l}px`, t.replaceWith(u), u.append(t);
}
function xn(e) {
  for (let t of e.querySelectorAll(Do)) t.remove();
  for (let t of e.querySelectorAll("*")) {
    if (bn.has(t.localName)) {
      let n = document.createElement("span");
      n.style.cssText = t.getAttribute("style") ?? "", n.style.display ||= "inline-block", t.replaceWith(n);
      continue;
    }
    for (let { name: n, value: o } of [...t.attributes]) {
      let r = n.toLowerCase();
      (r.startsWith("on") || Bo.has(r) || r.endsWith("href") && /^\s*javascript:/i.test(o)) && t.removeAttribute(n);
    }
    t.localName === "img" && t.setAttribute("alt", "");
  }
  for (let t of e.querySelectorAll("video source, picture source")) t.remove();
}
function dt(e, t) {
  let n = e.cloneNode(true), o = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, r = document.createTreeWalker(e, o), i = document.createTreeWalker(n, o), a = [], s = [];
  for (; r.nextNode() && i.nextNode(); ) {
    let c = r.currentNode, l = i.currentNode;
    c.nodeType === Node.TEXT_NODE ? t && a.push([c, l]) : (No.has(c.localName) || bn.has(c.localName)) && s.push([c, l]);
  }
  for (let [c, l] of s) {
    let u = c.getBoundingClientRect();
    l.style.boxSizing = "border-box", l.style.width = `${u.width}px`, u.width && u.height ? (l.style.maxWidth = "100%", l.style.height = "auto", l.style.aspectRatio = `${u.width} / ${u.height}`) : l.style.height = `${u.height}px`;
  }
  for (let [c, l] of a) Po(c, l);
  return xn(n), n.innerHTML;
}
function Tn(e) {
  let t = document.createElement("template");
  return t.innerHTML = e, xn(t.content), t.content;
}
var yn = (e, t) => [...e.children].map((n) => {
  let o = [...n.classList].sort().join("."), r = t > 1 && n.firstElementChild ? `(${yn(n, t - 1)})` : "";
  return `${n.localName}${o ? `.${o}` : ""}${r}`;
}).join(",");
var Ho = (e) => {
  let t = 5381;
  for (let n = 0; n < e.length; n++) t = t * 33 ^ e.charCodeAt(n);
  return (t >>> 0).toString(36);
};
function we(e) {
  let t = yn(e, 2);
  return t ? `${location.pathname}|${Ho(t)}` : null;
}
var mt = false;
try {
  mt = true;
} catch {
  mt = false;
}
var ht = mt;
var Sn = /* @__PURE__ */ new Set();
function H(e, t) {
  !ht || Sn.has(e) || (Sn.add(e), console.warn(`[skullet] ${t}`));
}
var Io = /^(https?:|\/|data:|blob:)/;
function Ce(e) {
  return typeof e == "string" ? Io.test(e) ? "" : pt(e) : Array.isArray(e) ? e.map(Ce) : e instanceof Date ? e : e && typeof e == "object" ? Object.fromEntries(Object.entries(e).map(([t, n]) => [t, Ce(n)])) : e;
}
var ft = "skullet:shapes";
var En = 2;
var zo = 50;
var Wo = 2e4;
var gt = /* @__PURE__ */ new Map();
var he = /* @__PURE__ */ new Map();
function Rn(e, t) {
  return he.has(e) || he.set(e, /* @__PURE__ */ new Set()), he.get(e).add(t), () => he.get(e)?.delete(t);
}
function vn(e) {
  for (let t of he.get(e) ?? []) t();
}
function An() {
  try {
    let e = JSON.parse(localStorage.getItem(ft) ?? "null");
    return e?.v === En ? e.shapes : {};
  } catch {
    return {};
  }
}
function Fo(e) {
  try {
    localStorage.setItem(ft, JSON.stringify({ v: En, shapes: e }));
  } catch {
  }
}
function kn(e, t) {
  gt.set(e, dt(t, false));
  let n = dt(t, true);
  if (n.length > Wo) return;
  let o = An();
  delete o[e], o[e] = n;
  let r = Object.keys(o);
  for (let i of r.slice(0, r.length - zo)) delete o[i];
  Fo(o);
}
function Mn(e) {
  return gt.get(e) ?? An()[e] ?? null;
}
function Go({ persisted: e = true } = {}) {
  if (gt.clear(), !!e) try {
    localStorage.removeItem(ft);
  } catch {
  }
}
var qo = [100, 90, 60].map((e) => `<div ${N} style="width:${e}%;height:0.75em;margin:0.5em 0;border-radius:0.25em"></div>`).join("");
var bt = new WeakSet(typeof document > "u" ? [] : document.querySelectorAll(`[${$}]`));
var Tt = /* @__PURE__ */ new WeakMap();
function Cn(e) {
  if (!e) return;
  let t = Tt.get(e);
  return Tt.delete(e), t;
}
function xt(e, t) {
  for (let o of e.children) if (o.hasAttribute(t)) return o;
  let n = document.createElement("div");
  return n.setAttribute(t, ""), e.append(n), n;
}
var wn = (e) => !!e.firstElementChild || !!e.textContent?.trim();
var fe = class {
  constructor(t, n = {}) {
    this.root = t;
    this.options = n;
    F(), t[_t] = true, t.setAttribute($, ""), t.setAttribute("aria-hidden", "true"), t.inert = true, this.ghost = xt(t, R), this.snapshot = xt(t, re), this.layer = xt(t, v), this.hadContent = wn(this.ghost);
    let o = t.closest(`[${k}]`);
    o && dn(o, { served: bt.has(t), refetch: !!n.refetch && this.hadContent }), this.choose(), this.measure(), t[Nt]?.(), this.mutations = new MutationObserver(this.schedule), this.mutations.observe(this.ghost, { childList: true, subtree: true, characterData: true, attributes: true }), this.resize = typeof ResizeObserver > "u" ? null : new ResizeObserver(this.schedule), this.resize?.observe(t), t.addEventListener("load", this.schedule, true), addEventListener("resize", this.schedule), document.fonts?.ready.then(this.schedule);
  }
  root;
  options;
  ghost;
  snapshot;
  layer;
  source = null;
  hadContent = false;
  frame = 0;
  mutations;
  resize;
  schedule = () => {
    this.root.closest(`[${A}]`) || (cancelAnimationFrame(this.frame), this.frame = requestAnimationFrame(() => {
      let t = wn(this.ghost);
      t !== this.hadContent && (this.hadContent = t, this.choose()), this.measure();
    }));
  };
  choose() {
    let t = "fallback", n = null, o = this.options.exact || bt.has(this.root), r = !!this.ghost.querySelector(`[${M}]`);
    if ((o || r) && this.hadContent) t = "ghost";
    else {
      let i = this.options.id ?? we(this.ghost);
      i && (vn(i), n = Mn(i)), n ? t = "recall" : this.hadContent && (t = "ghost");
    }
    t !== this.source && (t === "recall" && n ? this.snapshot.replaceChildren(Tn(n)) : t === "fallback" ? (this.snapshot.innerHTML = qo, H(`fallback:${this.options.id}`, `Nothing to draw a skeleton from${this.options.id ? ` for "${this.options.id}"` : ""}. Pass \`sample\` data, or an \`id\` so its shape is remembered after the first load. For a lone placeholder box, use \`SkeletonBox\`.`)) : this.snapshot.replaceChildren()), this.ghost.toggleAttribute(ae, t !== "ghost"), this.snapshot.toggleAttribute(ae, t === "ghost"), this.source = t, Gt(this.root.closest(`[${k}]`), t === "recall" ? "remembered shape" : t === "fallback" ? "fallback" : this.options.exact ? "data" : bt.has(this.root) ? "server render" : "sample");
  }
  measure() {
    let t = this.source === "ghost" ? this.ghost : this.snapshot;
    ot(this.layer, Ye(t, this.layer));
    let n = this.root.closest(`[${k}]`);
    n && Tt.set(n, { width: this.root.offsetWidth, height: this.root.offsetHeight, guessed: !(this.options.exact && this.source === "ghost"), images: [...t.querySelectorAll("img")].map((o) => o.getBoundingClientRect().height) });
  }
  destroy() {
    cancelAnimationFrame(this.frame), this.mutations.disconnect(), this.resize?.disconnect(), this.root.removeEventListener("load", this.schedule, true), removeEventListener("resize", this.schedule), ce();
  }
};
var jo = 250;
var ge = class {
  constructor(t, n = {}) {
    this.element = t;
    this.options = n;
    this.key = n.id ?? we(t), this.untrack = this.key ? Rn(this.key, () => this.save()) : () => {
    }, (ht || q(t)) && this.check(), this.save(), this.mutations = new MutationObserver(this.schedule), this.mutations.observe(t, { childList: true, subtree: true, characterData: true }), this.resize = typeof ResizeObserver > "u" ? null : new ResizeObserver(this.schedule), this.resize?.observe(t), t.addEventListener("load", this.schedule, true);
  }
  element;
  options;
  key;
  timer;
  mutations;
  resize;
  untrack;
  schedule = () => {
    clearTimeout(this.timer), this.timer = setTimeout(() => this.save(), jo);
  };
  save() {
    clearTimeout(this.timer), this.key && this.element.isConnected && this.element.offsetHeight && kn(this.key, this.element);
  }
  check() {
    let { data: t, id: n, rendered: o, sample: r } = this.options, i = n ? `<Skeleton id="${n}">` : "<Skeleton>", a = this.element.closest(`[${k}]`), s = Cn(a);
    if (!s) return;
    s.guessed && o && !r && t != null && H(`sample:${this.key}`, `${i} has no \`sample\`, so a first load guesses its shape${n ? "" : " and it can't be remembered"}. Pass this to make it exact:
  sample={${JSON.stringify(Ce(t))}}`);
    let c = [...this.element.querySelectorAll("img")].filter((l) => !l.complete);
    Promise.all(c.map((l) => new Promise((u) => {
      l.addEventListener("load", u, { once: true }), l.addEventListener("error", u, { once: true });
    }))).then(() => {
      if (!this.element.isConnected) return;
      let l = this.element.offsetWidth, u = this.element.offsetHeight;
      if (qt(a, { width: l - s.width, height: u - s.height }), Math.abs(l - s.width) <= 1 && Math.abs(u - s.height) <= 1) return;
      let d = [...this.element.querySelectorAll("img")].filter((p, m) => (s.images[m] ?? 0) < 1 && p.getBoundingClientRect().height >= 1).map((p) => p.currentSrc.split("/").pop() || "an image");
      if (d.length) {
        H(`unsized:${this.key}`, `${i}'s skeleton had no room for ${d.length === 1 ? "an image" : `${d.length} images`} (${d.slice(0, 3).join(", ")}${d.length > 3 ? ", …" : ""}), so the layout jumped when they loaded. Give each \`width\` and \`height\` attributes, or an \`aspect-ratio\`, so its space is known before it loads.`);
        return;
      }
      H(`jump:${this.key}`, s.guessed ? `${i}'s skeleton was ${s.width}×${s.height}px but its content is ${l}×${u}px, so the layout jumped on reveal. ${o ? "Pass `sample` data shaped like the real thing" : "Pass an `id` so its shape is remembered"}, and give images a size.` : `${i}'s skeleton was drawn from the data on screen (${s.width}×${s.height}px), but the new data is ${l}×${u}px, so the layout jumped on reveal. When new data adds to what's shown — another page of a list — give the addition a reveal of its own.`);
    });
  }
  destroy() {
    this.save(), clearTimeout(this.timer), this.mutations.disconnect(), this.resize?.disconnect(), this.element.removeEventListener("load", this.schedule, true), this.untrack();
  }
};
var $e = { height: "1em", width: "60%", radius: "var(--skullet-radius, 0.25em)" };
var yt = (e) => typeof e == "number" ? `${e}px` : e;
function $n({ height: e = $e.height, width: t = $e.width, radius: n = $e.radius } = {}) {
  return { height: yt(e), width: yt(t), borderRadius: yt(n) };
}
function Uo(e) {
  F();
  let t = document.createElement("span");
  return t.setAttribute(se, ""), Object.assign(t.style, $n(e)), requestAnimationFrame(() => {
    t.isConnected && Z(t);
  }), t;
}
var Ln = () => {
};
var Xo = (e) => {
  if (e.loading !== "lazy") return false;
  let t = e.getBoundingClientRect();
  return t.bottom < -innerHeight || t.top > innerHeight * 2;
};
var St = (e) => [...e.querySelectorAll("img")].filter((t) => !t.complete && !Xo(t));
function Et(e) {
  let t = e.complete ? Promise.resolve() : new Promise((n) => {
    e.addEventListener("load", () => n(), { once: true }), e.addEventListener("error", () => n(), { once: true });
  });
  return Promise.race([t.then(() => e.decode?.()).then(Ln, Ln), new Promise((n) => setTimeout(n, Ie))]);
}
var Vo = 360;
var Ko = 2;
var At = 600;
var vt = 40;
var Le = vt / U;
var Rt = 320;
var Yo = 120;
var On = 0.45;
var Oe = (e) => e.left + e.top * j;
var kt = (e) => e.width + e.height * j;
var Nn = (e, t) => Oe(t) - Le + (kt(t) + 2 * Le) * e;
var X = { start: -1 / 0, origin: 0, speed: 1 };
function Jo(e) {
  let t = e.querySelector(`:scope > [${A}] [${v}]`), n = t && ln(t);
  if (!n) return null;
  let o = lt(e);
  if (o.width * o.height > innerWidth * innerHeight * st) return null;
  let r = Oe(o), i = r + kt(o), a = performance.now(), s = a - X.start;
  s <= it && (r - X.origin) / X.speed >= s && (i - X.origin) / X.speed - s <= At || (X = { start: a, origin: r, speed: Math.max(Ko / n, (i - r) / Vo) });
  let { start: l, origin: u, speed: d } = X;
  return { delay: (r - Le - u) / d - (a - l), duration: (i - r + 2 * Le) / d };
}
var _n = (e) => (t, { rect: n, reveal: o }) => {
  let r = (Nn(t, o) - Oe(n)) * U, i = Array.from({ length: E + 1 }, (a, s) => {
    let c = e ? 1 - J(s / E) : J(s / E), l = -vt + 2 * vt * s / E;
    return `rgb(0 0 0 / ${c.toFixed(3)}) ${(r + l).toFixed(2)}px`;
  });
  return `linear-gradient(${nt}, ${i.join(", ")})`;
};
var Dn = "http://www.w3.org/2000/svg";
var ee = null;
var Zo = 0;
function Qo() {
  return ee?.isConnected || (ee = document.createElementNS(Dn, "svg"), ee.setAttribute("aria-hidden", "true"), ee.style.cssText = "position:absolute;width:0;height:0;overflow:hidden", document.body.append(ee)), ee;
}
var te = (e, t) => {
  let n = document.createElementNS(Dn, e);
  for (let [o, r] of Object.entries(t)) n.setAttribute(o, String(r));
  return n;
};
var er = (e, { rect: t, reveal: n, progress: o }) => {
  if (rn()) return;
  let r = Oe(t), i = kt(t), a = Rt / 2 / U, s = () => Nn(o(), n) - r - Yo / U;
  if (s() - a > i) return;
  let c = 2 * a + t.height * j, l = c / 2, u = t.height / 2, d = Rt / 2 * U, p = Rt / 2 * j * U, m = document.createElement("canvas");
  m.width = Math.ceil(c), m.height = Math.ceil(t.height);
  let f = m.getContext("2d");
  if (!f) return;
  let h = f.createLinearGradient(l - d, u - p, l + d, u + p);
  for (let y = 0; y <= E; y++) {
    let C = y / E;
    h.addColorStop(C, `rgb(255 255 255 / ${J(1 - Math.abs(C * 2 - 1)).toFixed(3)})`);
  }
  f.fillStyle = h, f.fillRect(0, 0, m.width, m.height);
  let g = `skullet-gloss-${++Zo}`, S = te("filter", { id: g, "color-interpolation-filters": "sRGB", primitiveUnits: "objectBoundingBox" }), b = te("feComponentTransfer", { in: "SourceGraphic", result: "lit" });
  for (let y of ["R", "G", "B"]) b.append(te(`feFunc${y}`, { type: "linear", slope: 1 - On, intercept: On }));
  let x = te("feImage", { href: m.toDataURL(), y: 0, width: c / t.width, height: 1, preserveAspectRatio: "none", result: "band" });
  S.append(b, x, te("feComposite", { in: "lit", in2: "band", operator: "in", result: "shine" }), te("feComposite", { in: "shine", in2: "SourceGraphic", operator: "over" })), Qo().append(S), e.style.filter = `url(#${g})`;
  let I = () => {
    let y = s();
    if (y - a > i || !e.isConnected) {
      e.style.filter.includes(g) && (e.style.filter = ""), S.remove();
      return;
    }
    x.setAttribute("x", ((y - l - u * j) / t.width).toFixed(4)), requestAnimationFrame(I);
  };
  I();
};
var tr = { mask: _n(true), out: _n(false), effect: er };
var _e = { hold: de, choose: (e) => {
  let t = ct(e);
  if (t) return t;
  let n = Jo(e.reveal);
  return n ? { wipe: tr, ...n } : ut(e);
} };
var nr = { together: me, sequence: ke, smart: Me, sweep: _e };
var Mt = (e = "smart") => typeof e == "string" ? nr[e] : e;
function or(e) {
  let t = Mt(e), n = t.hold ?? 0;
  if (t === me) return T;
  if (t === ke) return W + T;
  if (t === Me) return n + W + T;
  if (t === _e) return n + At + T;
  if (t.duration === 0) return 0;
  let o = t.choose ? Q : Math.min(Math.max(t.delay ?? 0, 0), Q);
  return n + o + Q + at;
}
var De = () => {
};
var oe = (e) => e.finished.then(De, De);
var be = /* @__PURE__ */ new WeakMap();
function V(e, t = 0, n = T, o = 0, r) {
  return O() ? Promise.resolve() : oe(e.animate([{ ...r, opacity: o }, { opacity: 1 }], { duration: n, delay: t, easing: "ease", fill: "backwards" }));
}
var ne = (e) => !!e.querySelector(`[${v}], [${R}], :scope > [${M}]`);
var rr = (e, t) => Math.abs(e.left - t.left) < 2 && Math.abs(e.top - t.top) < 2 && Math.abs(e.width - t.width) < 2 && Math.abs(e.height - t.height) < 2;
var Be = /* @__PURE__ */ new WeakMap();
function In(e) {
  for (let t of Be.get(e) ?? []) t.remove();
  Be.delete(e);
}
function ir(e, t) {
  let n = St(e), o = [...t.children].some((r) => r !== e && r.hasAttribute(_) && ne(r));
  if (!(!n.length || !o)) {
    for (let r of n) r.style.opacity = "0";
    queueMicrotask(() => {
      if (!e.isConnected) return;
      let r = t.getBoundingClientRect(), i = [...t.querySelectorAll(`:scope > [${A}] [${v}]`)].flatMap(Ee), a = Be.get(t) ?? /* @__PURE__ */ new Set();
      Be.set(t, a);
      for (let s of n) {
        let c = s.getBoundingClientRect(), l = i.find((p) => rr(p.getBoundingClientRect(), c)), u = l?.getBoundingClientRect() ?? c, d = document.createElement("div");
        d.setAttribute(ie, ""), Object.assign(d.style, { position: "absolute", left: `${u.left - r.left - t.clientLeft}px`, top: `${u.top - r.top - t.clientTop}px`, width: `${u.width}px`, height: `${u.height}px`, borderRadius: l?.style.borderRadius || getComputedStyle(s).borderRadius, backgroundColor: D, backgroundRepeat: "no-repeat", pointerEvents: "none" }), t.append(d), a.add(d), l && (l.style.visibility = "hidden"), Z(d), Et(s).then(() => {
          if (a.has(d)) {
            if (a.delete(d), s.style.opacity = "", V(s), O()) return d.remove();
            oe(d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T, easing: "ease", fill: "forwards" })).then(() => d.remove());
          }
        });
      }
    });
  }
}
function sr(e, t) {
  return O() ? Promise.resolve() : Promise.all(ve(e).map((n) => {
    let o = t.pieceDelay(n);
    if (o !== null) return V(n, o, t.duration, 0, t.enter);
  })).then(De);
}
function ar(e) {
  for (let t of e.querySelectorAll(`:scope > [${A}]`)) {
    for (let n of Y(t)) n.finish();
    t.style.opacity = "0";
  }
}
function lr(e) {
  let t = 0;
  for (let n of e.querySelectorAll(`:scope > [${A}]`)) if (!ne(n)) {
    t = Math.max(t, parseFloat(getComputedStyle(n).opacity) || 0);
    for (let o of Y(n)) o.finish();
    n.style.opacity = "0";
  }
  return t;
}
function $t(e, t = "smart", { initial: n = false } = {}) {
  let o = Bn.get(e);
  return o || (o = cr(e, t, n), Bn.set(e, o)), o;
}
var Bn = /* @__PURE__ */ new WeakMap();
function cr(e, t, n) {
  let o = e.parentElement, r = Mt(t);
  if (ne(e)) {
    o && In(o);
    let s = Math.max(r.hold ?? 0, 0);
    return s ? (o && be.set(o, { kind: "skeleton", hold: s }), n ? Promise.resolve() : V(e, s)) : (o && be.delete(o), n ? Promise.resolve() : V(e));
  }
  if (n || !o) return Promise.resolve();
  let i = lr(o);
  if (i > 0.01) {
    let s = T * (1 - i);
    return be.set(o, { kind: "together", delay: 0, duration: s }), V(e, 0, s, i);
  }
  ir(e, o);
  let a = mn(e, o, r, (s) => H(`enter:${s}`, `\`enter\` can't set \`${s}\`: only properties that change nothing's layout animate, so the reveal never moves the page.`));
  return be.set(o, a), a.kind === "instant" ? (ar(o), Promise.resolve()) : a.kind === "sequence" ? sr(e, a) : a.kind === "wipe" ? Fn(e, a, true) : V(e, a.delay, a.duration, 0, a.enter);
}
function zn(e) {
  let t = e.getBoundingClientRect(), n = e.offsetParent ?? document.documentElement, o = n.getBoundingClientRect();
  return { top: t.top - o.top - n.clientTop, left: t.left - o.left - n.clientLeft, width: t.width, height: t.height };
}
function ur(e, t = zn(e)) {
  return Object.assign(e.style, { position: "absolute", top: `${t.top}px`, left: `${t.left}px`, width: `${t.width}px`, height: `${t.height}px`, margin: "0", boxSizing: "border-box", pointerEvents: "none" }), e.inert = true, e.setAttribute(A, ""), t;
}
var Ne = /* @__PURE__ */ new WeakMap();
function pr(e, t) {
  let n = e.querySelector(`:scope > [${_}]:not([${A}])`);
  if (!n) return;
  let o = Ne.get(e), r = e.getBoundingClientRect().height;
  o?.animation.cancel();
  let i = e.getBoundingClientRect().height, a = o ? r : i - n.getBoundingClientRect().height + t.height;
  if (Math.abs(a - i) < 0.5) {
    o && Pn(e, o);
    return;
  }
  let { overflow: s, boxSizing: c } = o ?? e.style;
  Object.assign(e.style, { overflow: "clip", boxSizing: "border-box" });
  let l = e.animate([{ height: `${a}px` }, { height: `${i}px` }], { duration: Bt, easing: "cubic-bezier(0.2, 0, 0, 1)" }), u = { animation: l, overflow: s, boxSizing: c };
  Ne.set(e, u), oe(l).then(() => {
    Ne.get(e) === u && Pn(e, u);
  });
}
function Pn(e, { overflow: t, boxSizing: n }) {
  Ne.delete(e), Object.assign(e.style, { overflow: t, boxSizing: n });
}
function Lt(e, t) {
  let n = parseFloat(getComputedStyle(e).opacity), o = Number.isNaN(n) ? 1 : n;
  for (let s of Y(e)) s.cancel();
  Wn(e), e.style.filter = "";
  let r = e.parentElement;
  r && !ne(e) && In(r);
  let i = ur(e, t), a = (s, c) => Je() ? oe(e.animate([{ opacity: o }, { opacity: 0 }], { duration: c * o, delay: s, easing: "ease", fill: "forwards" })) : (e.style.opacity = "0", Promise.resolve());
  return Promise.resolve().then(() => {
    let s = r && be.get(r), c = O() || s?.kind === "instant";
    if (r && !c && pr(r, i), s?.kind === "skeleton") return a(s.hold, T);
    if (c) {
      e.style.opacity = "0";
      return;
    }
    return s?.kind === "sequence" && ne(e) ? dr(e, s) : s?.kind === "wipe" && ne(e) ? Fn(e, s, false) : s?.kind === "together" ? a(s.delay, s.duration) : a(0, T);
  });
}
function dr(e, t) {
  for (let r of e.querySelectorAll(`[${R}], [${re}]`)) r.style.visibility = "hidden";
  let n = [...e.querySelectorAll(`[${R}] [${M}]`)].filter((r) => !r.parentElement?.closest(`[${M}]`));
  for (let r of n) r.style.visibility = "visible";
  let o = [...[...e.querySelectorAll(`[${v}]`)].flatMap(Ee), ...n];
  return Promise.all(o.map((r) => {
    let i = r.getBoundingClientRect(), a = (c) => oe(r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: t.duration, delay: c, easing: "ease", fill: "forwards" })), s = t.boneDelay(i);
    if (s === null) {
      r.style.opacity = "0";
      return;
    }
    return a(s);
  })).then(De);
}
var Hn = 100;
var wt = /* @__PURE__ */ new WeakMap();
function Ct(e, t) {
  e.style.setProperty("mask-image", t), e.style.setProperty("-webkit-mask-image", t);
}
function mr(e, t) {
  Ct(e, `linear-gradient(#000 0 0), ${t}`), e.style.setProperty("-webkit-mask-composite", "xor"), e.style.setProperty("mask-composite", "exclude");
}
function Wn(e) {
  wt.get(e)?.();
  for (let t of ["mask-image", "-webkit-mask-image", "mask-composite", "-webkit-mask-composite"]) e.style.removeProperty(t);
}
function Fn(e, t, n) {
  let o = { rect: e.getBoundingClientRect(), reveal: t.reveal }, { mask: r, out: i } = t.wipe, a = (l) => {
    n ? Ct(e, r(l, o)) : i ? Ct(e, i(l, o)) : mr(e, r(l, o));
  }, s = () => (performance.now() - t.start) / t.duration;
  return s() >= 1 ? (n || (e.style.opacity = "0"), Promise.resolve()) : (n && (t.wipe.effect?.(e, { ...o, progress: s }), t.enter && e.animate([t.enter, {}], { duration: t.duration, delay: Math.max(t.start - performance.now(), 0), easing: "ease", fill: "backwards" })), new Promise((l) => {
    let u = 0, d = performance.now(), p = 0, m = () => {
      let g = performance.now();
      if (g - d > Hn && (t.stalled = true), d = g, t.stalled) return f(p);
      p = Math.min(Math.max(s(), 0), 1), a(p), p < 1 ? u = requestAnimationFrame(m) : f(null);
    }, f = (g = null) => {
      cancelAnimationFrame(u), clearTimeout(h), wt.delete(e), l(g);
    }, h = setTimeout(() => f(null), Math.max(t.start + t.duration - performance.now(), 0) + Hn);
    wt.set(e, f), m();
  }).then((l) => {
    if (Wn(e), l === null) {
      n || (e.style.opacity = "0");
      return;
    }
    let u = T * (1 - l);
    return n ? V(e, 0, u, l) : oe(e.animate([{ opacity: 1 - l }, { opacity: 0 }], { duration: u, easing: "ease", fill: "forwards" })).then(() => {
      e.style.opacity = "0";
    });
  }));
}
var Ot = class {
  constructor(t, n = {}) {
    this.element = t;
    this.options = n;
    F(), t.setAttribute(k, "");
  }
  element;
  options;
  current = null;
  ghost = null;
  memory = null;
  arrival = Promise.resolve();
  load(t) {
    let n = document.createElement("div"), o = document.createElement("div");
    o.setAttribute(R, ""), t && o.append(t), n.append(o);
    let r = this.swap(n);
    if (this.options.label) {
      let i = document.createElement("span");
      i.setAttribute(le, ""), i.textContent = this.options.label, r.prepend(i);
    }
    return this.element.setAttribute("aria-busy", "true"), this.ghost = new fe(n, { id: this.options.id }), r;
  }
  show(t) {
    let n = this.element.getAttribute("aria-busy") === "true", o = this.swap(t);
    return n && this.options.onReveal && this.arrival.then(this.options.onReveal), this.element.removeAttribute("aria-busy"), this.memory = new ge(o, { id: this.options.id }), o;
  }
  swap(t) {
    this.memory?.destroy(), this.ghost?.destroy(), this.memory = this.ghost = null;
    let n = document.createElement("div");
    n.setAttribute(_, ""), n.append(t);
    let o = this.current;
    return this.current = n, o && Lt(o).then(() => o.remove()), this.element.append(n), this.arrival = $t(n, this.options.reveal, { initial: !o }), n;
  }
  destroy() {
    this.memory?.destroy(), this.ghost?.destroy(), ce();
  }
};

export {
  k,
  _,
  $,
  R,
  re,
  v,
  ie,
  se,
  M,
  Pe,
  N,
  le,
  z,
  He,
  T,
  W,
  Ie,
  ze,
  It,
  F,
  ce,
  zt,
  Wt,
  qn,
  qe,
  jn,
  Ge,
  je,
  Un,
  Xn,
  q,
  Yn,
  Ke,
  Ye,
  O,
  Se,
  Z,
  Ee,
  ot,
  de,
  hn,
  fn,
  gn,
  me,
  ke,
  Me,
  Go,
  fe,
  ge,
  $e,
  $n,
  Uo,
  St,
  Et,
  _e,
  or,
  $t,
  zn,
  Lt,
  Ot
};
//# sourceMappingURL=chunk-MLX6MPUC.js.map
