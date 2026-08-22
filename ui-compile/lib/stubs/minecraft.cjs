// A stand-in for `@minecraft/server` and `@minecraft/server-ui` while compiling.
//
// A screen module imports the whole UI library, and the library's runtime entry
// touches the game modules at import time — `import { uiManager } from
// '@minecraft/server-ui'` runs the moment the graph is evaluated. Nothing in a
// compiled screen may CALL any of it: layout and expansion are pure, and a hook
// that reaches for the game is rejected by `expandStatic` with a real message.
// So the modules only have to exist, not work.
//
// CommonJS on purpose. esbuild turns `import { world } from '@minecraft/server'`
// into a property read against this object, so a proxy answers any name the
// library asks for without the filter having to predict the list — which would
// otherwise break every time the API surface grows.

const handler = {
  get(target, key) {
    if (key === '__esModule') {
      return true;
    }

    if (key === Symbol.toPrimitive || typeof key === 'symbol') {
      return undefined;
    }

    return new Proxy(function stub() {}, handler);
  },
};

module.exports = new Proxy({}, handler);
