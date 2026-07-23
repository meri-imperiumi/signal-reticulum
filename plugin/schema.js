/**
 * Builds the Signal K plugin configuration JSON Schema for the Reticulum
 * integration from the available Reticulum interfaces.
 *
 * The schema is split into groups (currently only `interfaces`); the
 * `interfaces` group is an array where each item may be any registered
 * interface type, identified by a `type` discriminator holding the stable
 * registry id (e.g. "tcp-client"). This allows multiple instances of any
 * interface type to be configured.
 *
 * @file schema.js
 */

/**
 * @typedef {Object} InterfaceRegistryEntry
 * @property {string} id - Stable registry id, e.g. "tcp-client".
 * @property {string} name - Human-readable name (from the schema title).
 * @property {Record<string, any>} schema - JSON Schema for the interface options.
 */

/**
 * The discriminator property name added to every wrapped interface schema so
 * the UI can tell configured interfaces apart and pick the matching branch.
 */
const TYPE_DISCRIMINATOR = "type";

/**
 * Wraps a single interface's own configuration schema so it can be used as a
 * `oneOf` branch inside the `interfaces` array.
 *
 * A `type` discriminator property (set as a `const` to the interface's stable
 * registry id) is merged in alongside the interface's own properties, and the
 * interface's `required`/`additionalProperties` constraints are preserved.
 *
 * @param {InterfaceRegistryEntry} entry
 * @returns {Record<string, any>} A JSON Schema object suitable for a `oneOf` branch.
 */
function wrapInterfaceSchema(entry) {
  const schema = entry.schema || {};
  const properties = {
    [TYPE_DISCRIMINATOR]: {
      type: "string",
      title: "Interface type",
      const: entry.id,
      default: entry.id,
      description: `The Reticulum interface type ("${entry.id}").`,
    },
    ...(schema.properties || {}),
  };
  const required = Array.from(
    new Set([TYPE_DISCRIMINATOR, ...(schema.required || [])]),
  );
  /** @type {Record<string, any>} */
  const wrapped = {
    type: "object",
    title: entry.name,
    properties,
    required,
  };
  if (schema.description) {
    wrapped.description = schema.description;
  }
  // Preserve the interface's own additionalProperties stance (e.g. `false`
  // from strict schemas) so adding the discriminator doesn't loosen validation.
  if (schema.additionalProperties !== undefined) {
    wrapped.additionalProperties = schema.additionalProperties;
  }
  return wrapped;
}

/**
 * Builds the full plugin configuration JSON Schema.
 *
 * @param {InterfaceRegistryEntry[]} interfaces - Entries from
 *   `@reticulum/node`'s `listInterfaces()`.
 * @returns {Record<string, any>} A JSON Schema (draft-07) object describing the
 *   plugin configuration, with Reticulum interfaces grouped under `interfaces`.
 */
function buildPluginSchema(interfaces) {
  const branches = interfaces.map(wrapInterfaceSchema);
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    title: "Signal K Reticulum",
    properties: {
      log_level: {
        type: "string",
        title: "Reticulum log level",
        description:
          "Verbosity of the Reticulum stack's own diagnostic output " +
          "(transport, links, announces, pathing) written to the Signal K " +
          "server log. The default (Notice) keeps important operational events; " +
          "raise it for troubleshooting or lower it to reduce log noise. This " +
          "is independent of the plugin's own messages.",
        default: "notice",
        enum: [
          "critical",
          "error",
          "warning",
          "notice",
          "info",
          "verbose",
          "debug",
        ],
      },
      use_shared_instance: {
        type: "boolean",
        title: "Use shared Reticulum instance",
        description:
          "Connect to a locally running shared Reticulum instance (rnsd) and " +
          "reuse its mesh interfaces, instead of opening the interfaces " +
          "configured below. The endpoint is auto-discovered from the " +
          "Reticulum config. When no shared instance is reachable, the plugin " +
          "falls back to the configured interfaces.",
        default: true,
      },
      interfaces: {
        type: "array",
        title: "Reticulum interfaces",
        description:
          "Reticulum network interfaces to start. Any number of instances " +
          "of any available interface type may be added. When none are " +
          "configured, an AutoInterface (zero-config LAN/Wi-Fi peering) is " +
          "started by default.",
        default: [{ type: "auto" }],
        items: {
          oneOf: branches,
        },
      },
      identity: {
        type: "object",
        title: "Identity",
        description:
          "The Reticulum identity for this Signal K node. On first start a " +
          "new identity is generated and stored here. To reuse an existing " +
          "Reticulum identity instead, paste its private key.",
        properties: {
          publicKey: {
            type: "string",
            title: "Public key",
            description:
              "Public key for this identity (64 bytes, hexadecimal). " +
              "Derived from the private key and shown for sharing/verification.",
            readOnly: true,
          },
          privateKey: {
            type: "string",
            title: "Private key",
            description:
              "Private key for this identity (128 bytes, hexadecimal). " +
              "Leave empty to auto-generate a new identity on first start. " +
              "Paste your own to reuse an existing Reticulum identity.",
          },
        },
        additionalProperties: false,
      },
      messaging: {
        type: "object",
        title: "Messaging",
        description:
          "LXMF messaging options. When alert forwarding is enabled, Signal K " +
          "notifications at the alarm/emergency levels are sent to every " +
          "configured crew member as an LXMF message.",
        properties: {
          send_alerts: {
            type: "boolean",
            title: "Send Signal K alerts to the crew via LXMF",
            default: true,
          },
          display_name: {
            type: "string",
            title: "LXMF display name",
            description:
              "Name announced to the mesh for this node's lxmf.delivery " +
              "destination, shown on crew members' messaging devices.",
            default: "Signal K",
          },
        },
        additionalProperties: false,
      },
      crew: {
        type: "array",
        title: "Crew members",
        description:
          "LXMF destinations to alert. Each entry is a crew member's " +
          "lxmf.delivery destination hash (32 hexadecimal characters).",
        default: [],
        items: {
          type: "object",
          required: ["name", "destination"],
          properties: {
            name: {
              type: "string",
              title: "Name",
              description: "A label for this crew member (used in logs).",
            },
            destination: {
              type: "string",
              title: "LXMF destination hash",
              description:
                "The 32-character hexadecimal lxmf.delivery destination " +
                "hash of the crew member's device.",
              pattern: "^[0-9a-fA-F]{32}$",
              minLength: 32,
              maxLength: 32,
            },
          },
          additionalProperties: false,
        },
      },
      nomadnet: {
        type: "object",
        title: "NomadNet site",
        description:
          "NomadNet mesh site. When enabled, the node announces a " +
          "nomadnetwork.node destination and serves a /page/index.mu page " +
          "that NomadNet clients (Sideband, NomadNet, MeshChat) can browse " +
          "to see the boat's status.",
        properties: {
          enabled: {
            type: "boolean",
            title: "Serve a NomadNet site",
            description:
              "Announce a NomadNet node destination and serve its index " +
              "page over the mesh. Off by default.",
            default: false,
          },
          display_name: {
            type: "string",
            title: "NomadNet node name",
            description:
              "Name announced to the mesh for this node's " +
              "nomadnetwork.node destination. Defaults to the vessel name " +
              "(with callsign) when left empty.",
            default: "",
          },
          banner: {
            type: "string",
            title: "Page banner",
            format: "textarea",
            description:
              "Optional ASCII/micron banner shown at the top of the index " +
              "page instead of the vessel name. Multi-line ASCII art is " +
              "rendered as-is; lines that begin with micron directives (!, >, " +
              "-, etc.) are interpreted by the client, so prefer art that " +
              "does not. Leave empty to show the vessel name as a heading.",
            default: "",
          },
          footer: {
            type: "string",
            title: "Page footer",
            format: "textarea",
            description:
              "Optional ASCII/micron text shown at the bottom of the index " +
              "page, after the telemetry. Useful for contact details, a " +
              "MMSI/callsign reminder or a static note. Multi-line content is " +
              "rendered as-is; lines that begin with micron directives (!, >, " +
              "-, etc.) are interpreted by the client. Leave empty for no " +
              "footer.",
            default: "",
          },
        },
        additionalProperties: false,
      },
    },
  };
}

module.exports = {
  TYPE_DISCRIMINATOR,
  wrapInterfaceSchema,
  buildPluginSchema,
};
