/**
 * Signal K plugin integrating the server with the Reticulum Network System.
 *
 * @param {import("@signalk/server-api").ServerAPI} app
 * @returns {import("@signalk/server-api").Plugin}
 */
const RNS = require("reticulum-js");
const { toHex } = RNS;
const { buildPluginSchema } = require("./schema");
const { resolveIdentity } = require("./identity");
const {
  effectiveInterfaces,
  setupInterfaces,
  teardownInterfaces,
} = require("./interfaces");

/**
 * Overridable dependencies (the Reticulum orchestrator class and the interface
 * registry lookup). Defaults point at the real reticulum-js; tests swap these
 * for fakes so the plugin can be exercised without network I/O.
 */
const deps = {
  Reticulum: RNS.Reticulum,
  getInterface: RNS.getInterface,
};

module.exports = (app) => {
  /** @type {import("@signalk/server-api").Plugin} */
  const plugin = {
    id: "signalk-reticulum",
    name: "Signal K Reticulum",
    description:
      "Connects Signal K to the Reticulum Network System mesh network.",
    /** Resolved Reticulum identity (available after start). */
    identity: undefined,
    /** The Reticulum node (available after start). */
    rns: undefined,
    /** Connected interface instances (available after start). */
    interfaces: [],

    /**
     * Resolves (or generates) the identity, brings up the Reticulum node and
     * connects the configured interfaces.
     *
     * @param {object} config
     * @param {(newConfiguration: object) => void} restart
     */
    async start(config, restart) {
      plugin.identity = undefined;
      plugin.rns = undefined;
      plugin.interfaces = [];

      let resolved;
      try {
        resolved = await resolveIdentity(config && config.identity);
      } catch (e) {
        app.setPluginError(`Identity error: ${e.message}`);
        app.debug(`Identity error: ${e.message}`);
        return;
      }
      plugin.identity = resolved.identity;
      const hashHex = toHex(resolved.identity.identityHash);

      if (resolved.changed) {
        app.savePluginOptions(
          {
            ...config,
            identity: {
              privateKey: resolved.privateKeyHex,
              publicKey: resolved.publicKeyHex,
            },
          },
          (err) => {
            if (err) {
              app.debug(`Failed to persist identity: ${err.message}`);
              return;
            }
            app.debug(`Persisted Reticulum identity ${hashHex}`);
          },
        );
      }

      try {
        const rns = new deps.Reticulum({});
        plugin.rns = rns;
        app.debug(`Loaded Reticulum identity ${hashHex}`);

        const list = effectiveInterfaces(config && config.interfaces);
        const defaulted = list.every((entry) => entry && entry.type === "auto");
        if (defaulted) {
          app.debug("No interfaces configured; starting default AutoInterface");
        }
        const result = await setupInterfaces(
          rns,
          list,
          deps.getInterface,
          app.debug,
        );
        plugin.interfaces = result.connected;

        const summary =
          `Identity ${hashHex}, ` +
          `${result.connected.length} interface(s) connected`;
        if (result.errors.length) {
          app.setPluginError(
            `${summary}; ${result.errors.length} failed: ` +
              result.errors.map((e) => e.error).join("; "),
          );
        } else {
          app.setPluginStatus(summary);
        }
        app.debug(summary);
      } catch (e) {
        app.setPluginError(`Start error: ${e.message}`);
        app.debug(`Start error: ${e.message}`);
      }
    },

    /**
     * Disconnects every interface, detaches them from the node and clears state.
     */
    async stop() {
      app.debug("Stopping");
      const rns = plugin.rns;
      const interfaces = plugin.interfaces || [];
      try {
        if (rns) {
          await teardownInterfaces(rns, interfaces, app.debug);
        }
      } catch (e) {
        app.debug(`Teardown error: ${e.message}`);
      }
      plugin.identity = undefined;
      plugin.rns = undefined;
      plugin.interfaces = [];
      app.setPluginStatus("Stopped");
    },

    schema: () => buildPluginSchema(RNS.listInterfaces()),
  };
  return plugin;
};

// Exposed for tests to override Reticulum/registry without network I/O.
module.exports.deps = deps;
