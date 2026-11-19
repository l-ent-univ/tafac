"use client";
import {
  $,
  $n,
  $t,
  F,
  It,
  Lt,
  M,
  R,
  Wt,
  Yn,
  Z,
  _,
  ce,
  fe,
  ge,
  je,
  k,
  le,
  re,
  se,
  v,
  zn,
  zt
} from "./chunk-MLX6MPUC.js";
import {
  require_react
} from "./chunk-VK2PZV5F.js";
import {
  __commonJS,
  __toESM
} from "./chunk-YLJ4XMA6.js";

// node_modules/react/cjs/react-jsx-runtime.development.js
var require_react_jsx_runtime_development = __commonJS({
  "node_modules/react/cjs/react-jsx-runtime.development.js"(exports) {
    "use strict";
    (function() {
      function getComponentNameFromType(type) {
        if (null == type) return null;
        if ("function" === typeof type)
          return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
        if ("string" === typeof type) return type;
        switch (type) {
          case REACT_FRAGMENT_TYPE:
            return "Fragment";
          case REACT_PROFILER_TYPE:
            return "Profiler";
          case REACT_STRICT_MODE_TYPE:
            return "StrictMode";
          case REACT_SUSPENSE_TYPE:
            return "Suspense";
          case REACT_SUSPENSE_LIST_TYPE:
            return "SuspenseList";
          case REACT_ACTIVITY_TYPE:
            return "Activity";
        }
        if ("object" === typeof type)
          switch ("number" === typeof type.tag && console.error(
            "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
          ), type.$$typeof) {
            case REACT_PORTAL_TYPE:
              return "Portal";
            case REACT_CONTEXT_TYPE:
              return type.displayName || "Context";
            case REACT_CONSUMER_TYPE:
              return (type._context.displayName || "Context") + ".Consumer";
            case REACT_FORWARD_REF_TYPE:
              var innerType = type.render;
              type = type.displayName;
              type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
              return type;
            case REACT_MEMO_TYPE:
              return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
            case REACT_LAZY_TYPE:
              innerType = type._payload;
              type = type._init;
              try {
                return getComponentNameFromType(type(innerType));
              } catch (x2) {
              }
          }
        return null;
      }
      function testStringCoercion(value) {
        return "" + value;
      }
      function checkKeyStringCoercion(value) {
        try {
          testStringCoercion(value);
          var JSCompiler_inline_result = false;
        } catch (e) {
          JSCompiler_inline_result = true;
        }
        if (JSCompiler_inline_result) {
          JSCompiler_inline_result = console;
          var JSCompiler_temp_const = JSCompiler_inline_result.error;
          var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
          JSCompiler_temp_const.call(
            JSCompiler_inline_result,
            "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
            JSCompiler_inline_result$jscomp$0
          );
          return testStringCoercion(value);
        }
      }
      function getTaskName(type) {
        if (type === REACT_FRAGMENT_TYPE) return "<>";
        if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE)
          return "<...>";
        try {
          var name = getComponentNameFromType(type);
          return name ? "<" + name + ">" : "<...>";
        } catch (x2) {
          return "<...>";
        }
      }
      function getOwner() {
        var dispatcher = ReactSharedInternals.A;
        return null === dispatcher ? null : dispatcher.getOwner();
      }
      function UnknownOwner() {
        return Error("react-stack-top-frame");
      }
      function hasValidKey(config) {
        if (hasOwnProperty.call(config, "key")) {
          var getter = Object.getOwnPropertyDescriptor(config, "key").get;
          if (getter && getter.isReactWarning) return false;
        }
        return void 0 !== config.key;
      }
      function defineKeyPropWarningGetter(props, displayName) {
        function warnAboutAccessingKey() {
          specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
            "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
            displayName
          ));
        }
        warnAboutAccessingKey.isReactWarning = true;
        Object.defineProperty(props, "key", {
          get: warnAboutAccessingKey,
          configurable: true
        });
      }
      function elementRefGetterWithDeprecationWarning() {
        var componentName = getComponentNameFromType(this.type);
        didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
          "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
        ));
        componentName = this.props.ref;
        return void 0 !== componentName ? componentName : null;
      }
      function ReactElement(type, key, props, owner, debugStack, debugTask) {
        var refProp = props.ref;
        type = {
          $$typeof: REACT_ELEMENT_TYPE,
          type,
          key,
          props,
          _owner: owner
        };
        null !== (void 0 !== refProp ? refProp : null) ? Object.defineProperty(type, "ref", {
          enumerable: false,
          get: elementRefGetterWithDeprecationWarning
        }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
        type._store = {};
        Object.defineProperty(type._store, "validated", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: 0
        });
        Object.defineProperty(type, "_debugInfo", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: null
        });
        Object.defineProperty(type, "_debugStack", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: debugStack
        });
        Object.defineProperty(type, "_debugTask", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: debugTask
        });
        Object.freeze && (Object.freeze(type.props), Object.freeze(type));
        return type;
      }
      function jsxDEVImpl(type, config, maybeKey, isStaticChildren, debugStack, debugTask) {
        var children = config.children;
        if (void 0 !== children)
          if (isStaticChildren)
            if (isArrayImpl(children)) {
              for (isStaticChildren = 0; isStaticChildren < children.length; isStaticChildren++)
                validateChildKeys(children[isStaticChildren]);
              Object.freeze && Object.freeze(children);
            } else
              console.error(
                "React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead."
              );
          else validateChildKeys(children);
        if (hasOwnProperty.call(config, "key")) {
          children = getComponentNameFromType(type);
          var keys = Object.keys(config).filter(function(k3) {
            return "key" !== k3;
          });
          isStaticChildren = 0 < keys.length ? "{key: someKey, " + keys.join(": ..., ") + ": ...}" : "{key: someKey}";
          didWarnAboutKeySpread[children + isStaticChildren] || (keys = 0 < keys.length ? "{" + keys.join(": ..., ") + ": ...}" : "{}", console.error(
            'A props object containing a "key" prop is being spread into JSX:\n  let props = %s;\n  <%s {...props} />\nReact keys must be passed directly to JSX without using spread:\n  let props = %s;\n  <%s key={someKey} {...props} />',
            isStaticChildren,
            children,
            keys,
            children
          ), didWarnAboutKeySpread[children + isStaticChildren] = true);
        }
        children = null;
        void 0 !== maybeKey && (checkKeyStringCoercion(maybeKey), children = "" + maybeKey);
        hasValidKey(config) && (checkKeyStringCoercion(config.key), children = "" + config.key);
        if ("key" in config) {
          maybeKey = {};
          for (var propName in config)
            "key" !== propName && (maybeKey[propName] = config[propName]);
        } else maybeKey = config;
        children && defineKeyPropWarningGetter(
          maybeKey,
          "function" === typeof type ? type.displayName || type.name || "Unknown" : type
        );
        return ReactElement(
          type,
          children,
          maybeKey,
          getOwner(),
          debugStack,
          debugTask
        );
      }
      function validateChildKeys(node) {
        isValidElement(node) ? node._store && (node._store.validated = 1) : "object" === typeof node && null !== node && node.$$typeof === REACT_LAZY_TYPE && ("fulfilled" === node._payload.status ? isValidElement(node._payload.value) && node._payload.value._store && (node._payload.value._store.validated = 1) : node._store && (node._store.validated = 1));
      }
      function isValidElement(object) {
        return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
      }
      var React = require_react(), REACT_ELEMENT_TYPE = /* @__PURE__ */ Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = /* @__PURE__ */ Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = /* @__PURE__ */ Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = /* @__PURE__ */ Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = /* @__PURE__ */ Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = /* @__PURE__ */ Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = /* @__PURE__ */ Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = /* @__PURE__ */ Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = /* @__PURE__ */ Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = /* @__PURE__ */ Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = /* @__PURE__ */ Symbol.for("react.memo"), REACT_LAZY_TYPE = /* @__PURE__ */ Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = /* @__PURE__ */ Symbol.for("react.activity"), REACT_CLIENT_REFERENCE = /* @__PURE__ */ Symbol.for("react.client.reference"), ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, hasOwnProperty = Object.prototype.hasOwnProperty, isArrayImpl = Array.isArray, createTask = console.createTask ? console.createTask : function() {
        return null;
      };
      React = {
        react_stack_bottom_frame: function(callStackForError) {
          return callStackForError();
        }
      };
      var specialPropKeyWarningShown;
      var didWarnAboutElementRef = {};
      var unknownOwnerDebugStack = React.react_stack_bottom_frame.bind(
        React,
        UnknownOwner
      )();
      var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
      var didWarnAboutKeySpread = {};
      exports.Fragment = REACT_FRAGMENT_TYPE;
      exports.jsx = function(type, config, maybeKey) {
        var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
        return jsxDEVImpl(
          type,
          config,
          maybeKey,
          false,
          trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
          trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
        );
      };
      exports.jsxs = function(type, config, maybeKey) {
        var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
        return jsxDEVImpl(
          type,
          config,
          maybeKey,
          true,
          trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
          trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
        );
      };
    })();
  }
});

// node_modules/react/jsx-runtime.js
var require_jsx_runtime = __commonJS({
  "node_modules/react/jsx-runtime.js"(exports, module) {
    "use strict";
    if (false) {
      module.exports = null;
    } else {
      module.exports = require_react_jsx_runtime_development();
    }
  }
});

// node_modules/skullet/dist/react/index.mjs
var import_react = __toESM(require_react(), 1);
var import_react2 = __toESM(require_react(), 1);
var import_react3 = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
var import_react4 = __toESM(require_react(), 1);
var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
var U = import_react3.default.createContext({});
var $2 = import_react3.default.createContext(null);
var b = () => import_react3.default.useContext(U);
var V = () => import_react3.default.useContext($2);
var P = () => b().reveal;
function se2({ children: t, ...e }) {
  let { debug: n, theme: o, mode: r, text: i, nonce: s } = e, l = je({ theme: o, mode: r, text: i }), [a] = import_react3.default.useState(() => ({ sent: false }));
  return import_react3.default.useEffect(() => {
    n !== void 0 && Yn(n);
  }, [n]), (0, import_jsx_runtime.jsx)(U.Provider, { value: e, children: (0, import_jsx_runtime.jsxs)($2.Provider, { value: a, children: [l && (0, import_jsx_runtime.jsx)("style", { nonce: s, children: l }), t] }) });
}
var f = typeof window > "u" ? import_react2.default.useEffect : import_react2.default.useLayoutEffect;
var h = () => import_react2.default.useInsertionEffect(() => (F(), ce), []);
var F2 = Number(import_react2.default.version.split(".")[0]) >= 19;
var E = () => {
  let { nonce: t } = b();
  return F2 ? (0, import_jsx_runtime2.jsx)("style", { ...{ href: "skullet", precedence: "medium", nonce: t }, children: It }) : null;
};
var be = F2 ? { inert: true } : { inert: "" };
var Y = (t) => import_react2.default.Children.map(t, (e) => {
  if (!import_react2.default.isValidElement(e)) return e;
  let n = e.type.Skeleton;
  return n ? (0, import_jsx_runtime2.jsx)("span", { [M]: "", children: (0, import_jsx_runtime2.jsx)(n, { ...e.props }) }) : e.props.children && typeof e.props.children != "function" ? import_react2.default.cloneElement(e, void 0, Y(e.props.children)) : e;
});
var he = () => () => {
};
var Ee = () => import_react2.default.useSyncExternalStore(he, () => false, () => true);
var L = ({ children: t, id: e, exact: n, refetch: o, label: r }) => {
  let i = import_react2.default.useRef(null), { nonce: s } = b(), l = V(), a = Ee(), c = zt;
  return a && l && (l.sent && (c = Wt), l.sent = true), f(() => {
    if (!i.current) return;
    let u = new fe(i.current, { id: e, exact: n, refetch: o });
    return () => u.destroy();
  }, [e, n, o]), (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [r && (0, import_jsx_runtime2.jsx)("span", { [le]: "", children: r }), (0, import_jsx_runtime2.jsxs)("div", { ref: i, [$]: "", "aria-hidden": true, ...be, children: [(0, import_jsx_runtime2.jsx)("div", { [R]: "", children: Y(t) }), (0, import_jsx_runtime2.jsx)("div", { [re]: "" }), (0, import_jsx_runtime2.jsx)("div", { [v]: "" })] }), a && (0, import_jsx_runtime2.jsx)("script", { nonce: s, suppressHydrationWarning: true, dangerouslySetInnerHTML: { __html: c } })] });
};
var w = ({ children: t, id: e, registry: n, enter: o, exiting: r, onExited: i, memory: s, onEntered: l }) => {
  let a = import_react2.default.useRef(null), c = P();
  return f(() => {
    if (!a.current) return;
    let u = { element: a.current, memory: null };
    return n.set(e, u), $t(a.current, c, { initial: !o }).then(l), s && (u.memory = new ge(a.current, s)), () => {
      u.memory?.destroy(), n.delete(e);
    };
  }, []), f(() => {
    !r || !a.current || Lt(a.current, n.get(e)?.box).then(i);
  }, [r]), (0, import_jsx_runtime2.jsx)("div", { ref: a, [_]: "", children: t });
};
var N = class extends import_react2.default.Component {
  getSnapshotBeforeUpdate(e) {
    for (let n of this.props.exiting) {
      if (e.exiting.includes(n)) continue;
      let o = this.props.registry.get(n);
      o && (o.memory?.save(), o.box = zn(o.element));
    }
    return null;
  }
  componentDidUpdate() {
  }
  render() {
    return this.props.children;
  }
};
var we = ({ height: t, width: e, radius: n, className: o, style: r }) => {
  let i = import_react.default.useRef(null);
  return h(), f(() => {
    i.current && Z(i.current);
  }, []), (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [(0, import_jsx_runtime3.jsx)(E, {}), (0, import_jsx_runtime3.jsx)("span", { ref: i, [se]: "", className: o, style: { ...$n({ height: t, width: e, radius: n }), ...r } })] });
};
function Be(t) {
  let { id: e, label: n, skeleton: o, empty: r, emptyMessage: i, error: s, className: l, style: a } = t;
  h();
  let c = typeof t.children == "function" ? t.children : null, u = c ? t.data : void 0, B = c ? t.sample : void 0, Q = c ? null : t.children, _2 = import_react.default.useRef(null);
  f(() => {
    u != null && (_2.current = { id: e, data: u });
  });
  let A = (d) => c ? d != null ? c(d) : null : Q, X = !!t.loading || !!c && u == null && !s && !r, R2, g, I;
  if (X) {
    let d = _2.current, S = u ?? (d && d.id === e ? d.data : null);
    R2 = "skeleton", g = o ? (0, import_jsx_runtime3.jsx)("div", { [M]: "", "aria-hidden": true, children: o }) : (0, import_jsx_runtime3.jsx)(L, { id: e, exact: S != null, refetch: u != null, label: n, children: A(S ?? B) });
  } else s ? (R2 = "error", g = s) : r ? (R2 = "empty", g = i ?? A(u)) : (R2 = "content", g = A(u), I = { id: e, data: u, rendered: !!c, sample: B !== void 0 });
  let [m, Z2] = import_react.default.useState({ id: 0, key: R2 }), [H, D] = import_react.default.useState([]), M2 = import_react.default.useRef(/* @__PURE__ */ new Map()).current, W = import_react.default.useRef(g);
  if (f(() => {
    W.current = g;
  }), m.key !== R2) {
    let d = { id: m.id, node: W.current };
    D((S) => S.some((O) => O.id === d.id) ? S : [...S, d]), Z2({ id: m.id + 1, key: R2, from: m.key });
  }
  let G = import_react.default.useRef(t.onReveal);
  f(() => {
    G.current = t.onReveal;
  });
  let ee = m.key === "content" && m.from === "skeleton" ? () => G.current?.() : void 0, te = (d) => D((S) => S.filter((O) => O.id !== d)), ne = [...H.map((d) => (0, import_jsx_runtime3.jsx)(w, { id: d.id, registry: M2, enter: false, exiting: true, onExited: () => te(d.id), children: d.node }, d.id)), (0, import_jsx_runtime3.jsx)(w, { id: m.id, registry: M2, enter: m.id > 0, exiting: false, onExited: () => {
  }, memory: I, onEntered: ee, children: g }, m.id)];
  return (0, import_jsx_runtime3.jsxs)("div", { [k]: "", "aria-busy": R2 === "skeleton" || void 0, className: l, style: a, children: [(0, import_jsx_runtime3.jsx)(E, {}), (0, import_jsx_runtime3.jsx)(N, { exiting: H.map((d) => d.id), registry: M2, children: ne })] });
}
var Ue = ({ children: t, id: e, label: n, waited: o }) => {
  let r = import_react4.default.useRef(null), i = P();
  return f(() => {
    let s = r.current, l = s?.parentElement;
    if (!(!s || !l)) return o.current = true, $t(s, i, { initial: true }), l.setAttribute("aria-busy", "true"), () => {
      if (l.removeAttribute("aria-busy"), !s.isConnected) return;
      let a = zn(s), c = s.cloneNode(true);
      queueMicrotask(() => {
        if (s.isConnected) return;
        Object.assign(c.style, { position: "absolute", top: `${a.top}px`, left: `${a.left}px`, width: `${a.width}px` }), l.prepend(c);
        let u = c.querySelector(`[${$}]`);
        u && new fe(u, { id: e, exact: true }).destroy(), Lt(c, a).then(() => c.remove());
      });
    };
  }, []), (0, import_jsx_runtime4.jsx)("div", { ref: r, [_]: "", children: (0, import_jsx_runtime4.jsx)(L, { id: e, exact: t != null, label: n, children: t }) });
};
var $e = ({ children: t, id: e, waited: n, onReveal: o }) => {
  let r = import_react4.default.useRef(null), i = P();
  return f(() => {
    if (!r.current) return;
    let s = $t(r.current, i, { initial: !n.current });
    n.current && o && s.then(o);
    let l = new ge(r.current, { id: e });
    return () => l.destroy();
  }, []), (0, import_jsx_runtime4.jsx)("div", { ref: r, [_]: "", children: t });
};
function Ve({ children: t, skeleton: e, id: n, label: o, onReveal: r, className: i, style: s }) {
  h();
  let l = import_react4.default.useRef(false);
  return (0, import_jsx_runtime4.jsxs)("div", { [k]: "", className: i, style: s, children: [(0, import_jsx_runtime4.jsx)(E, {}), (0, import_jsx_runtime4.jsx)(import_react4.default.Suspense, { fallback: (0, import_jsx_runtime4.jsx)(Ue, { id: n, label: o, waited: l, children: e }), children: (0, import_jsx_runtime4.jsx)($e, { id: n, waited: l, onReveal: r, children: t }) })] });
}
export {
  Be as Skeleton,
  we as SkeletonBox,
  Ve as SkeletonSuspense,
  se2 as SkulletProvider,
  P as useReveal,
  b as useSkullet
};
//# sourceMappingURL=skullet_react.js.map
