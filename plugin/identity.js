/**
 * Resolves the Reticulum identity for the plugin from its configuration.
 *
 * On first start (no private key configured) a fresh identity is generated and
 * flagged for persistence. When a private key is configured it is loaded as-is,
 * letting the operator reuse an existing Reticulum identity. The module is
 * intentionally free of Signal K coupling so it can be unit-tested in isolation.
 *
 * @file identity.js
 */

const { Identity, toHex, fromHex } = require("reticulum-js");

/** Raw private key export length, in bytes (x25519 priv/pub + ed25519 priv/pub). */
const PRIVATE_KEY_BYTES = 128;
/** Raw public key length, in bytes (x25519 pub + ed25519 pub). */
const PUBLIC_KEY_BYTES = 64;
/** Matches hexadecimal strings (after whitespace/dashes have been stripped). */
const HEX_RE = /^[0-9a-f]+$/i;

/**
 * @typedef {Object} IdentityConfig
 * @property {string} [publicKey] - Hex-encoded public key (64 bytes).
 * @property {string} [privateKey] - Hex-encoded private key (128 bytes).
 */

/**
 * @typedef {Object} ResolvedIdentity
 * @property {Identity} identity - The resolved Reticulum identity.
 * @property {string} publicKeyHex - Canonical hex public key.
 * @property {string} privateKeyHex - Canonical hex private key.
 * @property {boolean} changed - Whether configuration should be persisted
 *   (newly generated, or a derived/canonicalised value differs from what is stored).
 */

/**
 * Normalises a hex string for comparison: trims, lower-cases and strips the
 * whitespace and dashes `fromHex` tolerates. Returns an empty string for
 * non-string / empty input.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHex(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/[\s-]/g, "");
}

/**
 * Validates and decodes a hex key string of an exact byte length.
 *
 * @param {string} value - The hex string to parse.
 * @param {number} expectedBytes - The required length in bytes.
 * @param {string} label - Human-readable field name used in error messages.
 * @returns {Uint8Array}
 * @throws {Error} If the value is empty, not hexadecimal, or the wrong length.
 */
function parseHexKey(value, expectedBytes, label) {
  const clean = normalizeHex(value);
  if (!clean) {
    throw new Error(`No ${label} provided`);
  }
  if (!HEX_RE.test(clean)) {
    throw new Error(`${label} is not valid hexadecimal`);
  }
  if (clean.length !== expectedBytes * 2) {
    throw new Error(
      `${label} must be ${expectedBytes * 2} hex characters ` +
        `(${expectedBytes} bytes), got ${clean.length}`,
    );
  }
  return fromHex(clean);
}

/**
 * Resolves the Reticulum identity from the configured keys.
 *
 * - When a private key is configured it is decoded and loaded verbatim; this is
 *   how an operator overrides the identity with their own.
 * - When no private key is configured a new identity is generated and `changed`
 *   is set so the caller persists the freshly created keys for next time.
 *
 * @param {IdentityConfig|undefined} identityConfig
 * @returns {Promise<ResolvedIdentity>}
 */
async function resolveIdentity(identityConfig) {
  const cfg = identityConfig || {};
  const privateKeyInput = normalizeHex(cfg.privateKey);

  if (privateKeyInput) {
    const privBytes = parseHexKey(
      cfg.privateKey,
      PRIVATE_KEY_BYTES,
      "Private key",
    );
    const identity = await Identity.fromBytes(privBytes);
    if (!identity) {
      throw new Error("Could not load identity from the provided private key");
    }
    const publicKeyHex = toHex(await identity.getPublicKey());
    const privateKeyHex = toHex(await identity.getPrivateKey());
    return {
      identity,
      publicKeyHex,
      privateKeyHex,
      changed:
        publicKeyHex !== normalizeHex(cfg.publicKey) ||
        privateKeyHex !== privateKeyInput,
    };
  }

  const identity = await Identity.generate();
  return {
    identity,
    publicKeyHex: toHex(await identity.getPublicKey()),
    privateKeyHex: toHex(await identity.getPrivateKey()),
    changed: true,
  };
}

module.exports = {
  PRIVATE_KEY_BYTES,
  PUBLIC_KEY_BYTES,
  resolveIdentity,
  normalizeHex,
  parseHexKey,
};
