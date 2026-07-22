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
const { sendNotification } = require("./notifications");
const { setupMessaging, makeDeliverer } = require("./messaging");

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
  /** Tracks active notification episodes so flapping alerts aren't re-sent. */
  const episodes = new Map();
  /** Signal K subscription unsubscribe callbacks, drained on stop. */
  const unsubscribes = [];

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
     * The LXMF router (available after start). Exposed so inbound LXMF message
     * handling can be added later by attaching to its `"message"` events.
     */
    lxmf: undefined,

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
      plugin.lxmf = undefined;

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

        // Bring up LXMF messaging so alerts can be sent to the crew. A failure
        // here is non-fatal: the node stays up for connectivity, just without
        // messaging (deliver stays undefined and alerts are skipped).
        let deliver;
        try {
          const displayName =
            (config && config.messaging && config.messaging.display_name) ||
            "Signal K";
          plugin.lxmf = await setupMessaging(
            rns,
            plugin.identity,
            { displayName },
            app.debug,
          );
          deliver = makeDeliverer(plugin.lxmf, plugin.identity);
        } catch (e) {
          app.debug(`Messaging setup error: ${e.message}`);
        }

        // Subscribe to Signal K notifications so alarm/emergency states are
        // forwarded to the crew over LXMF.
        if (app.subscriptionmanager) {
          try {
            app.subscriptionmanager.subscribe(
              {
                context: "vessels.self",
                subscribe: [{ path: "notifications.*", policy: "instant" }],
              },
              unsubscribes,
              (err) => app.error(`Notification subscription error: ${err}`),
              (delta) => {
                if (!delta || !delta.updates) {
                  return;
                }
                for (const update of delta.updates) {
                  if (!update.values) {
                    continue;
                  }
                  for (const v of update.values) {
                    if (!v.path || v.path.indexOf("notifications.") !== 0) {
                      continue;
                    }
                    Promise.resolve(
                      sendNotification(
                        v.path,
                        v.value,
                        episodes,
                        config,
                        deliver,
                        app,
                      ),
                    ).catch((e) =>
                      app.debug(`Notification forward error: ${e.message}`),
                    );
                  }
                }
              },
            );
          } catch (e) {
            app.debug(`Notification subscription error: ${e.message}`);
          }
        }

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
      unsubscribes.splice(0).forEach((fn) => {
        try {
          fn();
        } catch {
          /* best effort */
        }
      });
      episodes.clear();
      const rns = plugin.rns;
      const interfaces = plugin.interfaces || [];
      try {
        if (rns) {
          await teardownInterfaces(rns, interfaces, app.debug);
        }
      } catch (e) {
        app.debug(`Teardown error: ${e.message}`);
      }
      plugin.lxmf = undefined;
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
