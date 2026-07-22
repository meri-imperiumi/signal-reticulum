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
 *   `reticulum-js`'s `listInterfaces()`.
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
      // Other configuration groups (e.g. announce destinations) will be added
      // here as siblings of `interfaces` and `identity`.
    },
  };
}

module.exports = {
  TYPE_DISCRIMINATOR,
  wrapInterfaceSchema,
  buildPluginSchema,
};
