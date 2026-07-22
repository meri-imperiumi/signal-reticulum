/**
 * Brings up the configured Reticulum interfaces on a {@link Reticulum} node and
 * tears them down again on stop. Individual interface failures are isolated so
 * one bad interface does not prevent the others from coming up.
 *
 * The transport and the interface registry are injected, so this module is free
 * of network I/O and can be unit-tested with fakes.
 *
 * @file interfaces.js
 */

const RNS = require("reticulum-js");

/** Default interfaces applied when none are configured (zero-config peering). */
const DEFAULT_INTERFACES = Object.freeze([{ type: "auto" }]);

/**
 * Returns a fresh copy of the default interface list.
 * @returns {{type: string}[]}
 */
function getDefaultInterfaces() {
  return DEFAULT_INTERFACES.map((entry) => ({ ...entry }));
}

/**
 * Returns the effective interface list, defaulting to AutoInterface peering when
 * the configuration carries none (so a fresh install works out of the box).
 *
 * @param {unknown} configInterfaces
 * @returns {object[]}
 */
function effectiveInterfaces(configInterfaces) {
  if (Array.isArray(configInterfaces) && configInterfaces.length > 0) {
    return configInterfaces;
  }
  return getDefaultInterfaces();
}

/**
 * Strips the discriminator from a config entry, leaving the constructor options.
 * @param {object} entry
 * @returns {object}
 */
function optionsFromEntry(entry) {
  const { type: _type, ...options } = entry || {};
  return options;
}

/**
 * @typedef {Object} InterfaceSetupResult
 * @property {object[]} connected - Successfully connected interface instances.
 * @property {{entry: object, type: (string|undefined), error: string}[]} errors
 */

/**
 * Instantiates, connects and attaches each configured interface to the node.
 *
 * Failures (unknown type, construction error, connection error) are recorded in
 * `errors` and logged rather than thrown, so the plugin keeps running with the
 * interfaces that did come up.
 *
 * @param {{addInterface(iface: object, isDefault?: boolean): void, removeInterface(iface: object): void}} rns
 * @param {object[]} configInterfaces
 * @param {(id: string) => any} [getInterface] - Registry lookup, defaults to RNS.
 * @param {(...args: any[]) => void} [log]
 * @returns {Promise<InterfaceSetupResult>}
 */
async function setupInterfaces(
  rns,
  configInterfaces,
  getInterface = RNS.getInterface,
  log = () => {},
) {
  const connected = [];
  const errors = [];
  for (const entry of configInterfaces) {
    const type = entry && entry.type;
    const InterfaceClass = type ? getInterface(type) : undefined;
    if (typeof InterfaceClass !== "function") {
      const msg = `Unknown interface type "${type}"`;
      errors.push({ entry, type, error: msg });
      log(msg);
      continue;
    }

    let iface;
    try {
      iface = new InterfaceClass(optionsFromEntry(entry));
    } catch (e) {
      const msg = `Failed to create "${type}" interface: ${e.message}`;
      errors.push({ entry, type, error: msg });
      log(msg);
      continue;
    }

    try {
      if (typeof iface.connect === "function") {
        await iface.connect();
      }
      rns.addInterface(iface, true);
      connected.push(iface);
      log(`Connected interface ${iface.name || type}`);
    } catch (e) {
      const msg = `Failed to connect "${type}" interface: ${e.message}`;
      errors.push({ entry, type, error: msg });
      log(msg);
      // Release any half-open resources before moving on.
      try {
        if (typeof iface.disconnect === "function") {
          await iface.disconnect();
        }
      } catch {
        /* best effort */
      }
    }
  }
  return { connected, errors };
}

/**
 * Disconnects and detaches every interface, in reverse connection order. Never
 * throws; per-interface failures are logged.
 *
 * @param {{removeInterface(iface: object): void}} rns
 * @param {object[]} interfaces
 * @param {(...args: any[]) => void} [log]
 * @returns {Promise<void>}
 */
async function teardownInterfaces(rns, interfaces, log = () => {}) {
  const list = [...interfaces].reverse();
  for (const iface of list) {
    const name = iface && iface.name;
    try {
      if (iface && typeof iface.disconnect === "function") {
        await iface.disconnect();
      }
    } catch (e) {
      log(`Error disconnecting interface ${name}: ${e.message}`);
    }
    try {
      rns.removeInterface(iface);
    } catch (e) {
      log(`Error removing interface ${name}: ${e.message}`);
    }
  }
}

module.exports = {
  DEFAULT_INTERFACES,
  getDefaultInterfaces,
  effectiveInterfaces,
  optionsFromEntry,
  setupInterfaces,
  teardownInterfaces,
};
