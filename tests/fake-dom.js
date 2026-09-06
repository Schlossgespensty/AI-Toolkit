// Just enough of a document to run panel-view.js in node.
//
// Not a browser and not pretending to be one: it builds a tree, remembers
// classes, attributes and listeners, and hands out the rectangle a test put
// on an element. What it deliberately does NOT do is lay anything out - the
// browser's own layout is not something a test can copy without copying its
// mistakes too. So a test says where the boxes are, and what is checked is
// what the view does with them.

'use strict';

function element(tag) {
  const classes = new Set();
  const listeners = new Map();
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    dataset: {},
    attributes: {},
    style: {
      props: {},
      set flex(value) { this.props.flex = value; },
      get flex() { return this.props.flex; },
      setProperty(name, value) { this.props[name] = value; },
      removeProperty(name) { delete this.props[name]; },
      getPropertyValue(name) { return this.props[name]; }
    },
    children: [],
    parentElement: null,
    hidden: false,
    rect: null,
    _text: '',

    get classList() {
      return {
        add: (...names) => { for (const n of names) classes.add(n); },
        remove: (...names) => { for (const n of names) classes.delete(n); },
        toggle: (name, on) => {
          const want = on === undefined ? !classes.has(name) : Boolean(on);
          if (want) classes.add(name); else classes.delete(name);
        },
        contains: name => classes.has(name)
      };
    },
    get className() { return [...classes].join(' '); },
    set className(value) {
      classes.clear();
      for (const n of String(value).split(/\s+/)) if (n) classes.add(n);
    },

    get textContent() {
      if (el.children.length) return el.children.map(c => c.textContent).join('');
      return el._text;
    },
    set textContent(value) {
      for (const child of el.children) child.parentElement = null;
      el.children = [];
      el._text = String(value);
    },
    set innerHTML(value) { el.textContent = String(value); },

    get firstChild() { return el.children[0] || null; },
    get isConnected() {
      let node = el;
      while (node.parentElement) node = node.parentElement;
      return node.isRoot === true;
    },

    appendChild(child) {
      if (child.parentElement) child.parentElement.removeChild(child);
      child.parentElement = el;
      el.children.push(child);
      el._text = '';
      return child;
    },
    append(...kids) { for (const kid of kids) el.appendChild(kid); },
    insertBefore(child, before) {
      if (child.parentElement) child.parentElement.removeChild(child);
      const at = el.children.indexOf(before);
      child.parentElement = el;
      if (at < 0) el.children.push(child); else el.children.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = el.children.indexOf(child);
      if (at >= 0) el.children.splice(at, 1);
      child.parentElement = null;
      return child;
    },

    setAttribute(name, value) { el.attributes[name] = String(value); },
    getAttribute(name) { return name in el.attributes ? el.attributes[name] : null; },

    matches(selector) {
      if (selector.startsWith('.')) return classes.has(selector.slice(1));
      if (selector.startsWith('#')) return el.id === selector.slice(1);
      return el.tagName === selector.toUpperCase();
    },
    closest(selector) {
      let node = el;
      while (node) {
        if (node.matches && node.matches(selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(selector) { return el.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const found = [];
      const walk = node => {
        for (const child of node.children) {
          if (child.matches(selector)) found.push(child);
          walk(child);
        }
      };
      walk(el);
      return found;
    },

    // The rectangle a test gave it, or the one of the nearest parent that
    // has one: a tab strip inside an area with no rectangle of its own
    // should not read as a box at the origin with no size.
    getBoundingClientRect() {
      if (el.rect) return el.rect;
      return { left: 0, top: 0, width: 0, height: 0 };
    },
    setPointerCapture() {},
    releasePointerCapture() {},

    addEventListener(type, fn, options) {
      const key = type + (options === true || (options && options.capture) ? ':capture' : '');
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    removeEventListener() {},
    has(type) { return (listeners.get(type) || []).length > 0; },
    fire(type, event) {
      const base = { target: el, preventDefault() {}, stopPropagation() {} };
      const full = Object.assign(base, event);
      // Capture first, then bubbling up the tree - the order a browser uses,
      // and the reason a drag can swallow Escape before the editor sees it.
      for (const node of chainTo(el).reverse()) node._fire(type + ':capture', full);
      for (const node of chainTo(el)) node._fire(type, full);
      return full;
    },
    _fire(key, event) {
      for (const fn of listeners.get(key) || []) fn(event);
    }
  };
  return el;
}

function chainTo(el) {
  const chain = [];
  let node = el;
  while (node) { chain.push(node); node = node.parentElement; }
  return chain;
}

// A document with a root everything hangs under, so isConnected can answer.
function makeDocument() {
  const byId = new Map();
  const root = element('html');
  root.isRoot = true;
  const doc = {
    readyState: 'complete',
    documentElement: root,
    body: element('body'),
    createElement: tag => element(tag),
    getElementById: id => byId.get(id) || null,
    addEventListener() {},
    // test helper: hang an element in the tree under a known id
    put(id, el) { el.id = id; byId.set(id, el); root.appendChild(el); return el; },
    root
  };
  root.appendChild(doc.body);
  return doc;
}

module.exports = { element, makeDocument };
