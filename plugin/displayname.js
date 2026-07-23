/**
 * Resolves the LXMF display name announced to the mesh for this node.
 *
 * Following marine-radio convention the default name is
 * "<vessel name> DE <callsign>" (e.g. "S/Y Bergie DE OH8XYZ"), so peers — and
 * the matching logic in plugins such as `signalk-meshtastic` — can associate the
 * node with a vessel and its callsign.
 *
 * An explicitly configured display name always wins. Otherwise the name is
 * derived from whichever of the vessel name/callsign are known, finally falling
 * back to "Signal K".
 *
 * This module is intentionally free of Signal K coupling (it never touches the
 * `app` object): the caller reads the self paths and passes the raw values in,
 * so the logic can be unit-tested in isolation.
 *
 * @file displayname.js
 */

/** Used when no vessel identity is available at all. */
const FALLBACK_NAME = "Signal K";

/**
 * Coerces a Signal K self-path value into a trimmed string, tolerating both a
 * plain string and a wrapped `{value: ...}` update value.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readSelfString(value) {
  if (value && typeof value === "object" && "value" in value) {
    value = value.value;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

/**
 * Resolves the LXMF display name.
 *
 * @param {object} [options]
 * @param {string} [options.configured] - An explicitly configured display name;
 *   when non-empty it is returned verbatim.
 * @param {unknown} [options.vesselName] - Value at `vessels.self.name`.
 * @param {unknown} [options.callsign] - Value at
 *   `vessels.self.communication.callsignVhf`.
 * @returns {string}
 */
function resolveDisplayName({ configured, vesselName, callsign } = {}) {
  const override = readSelfString(configured);
  if (override) {
    return override;
  }
  const name = readSelfString(vesselName);
  const cs = readSelfString(callsign);
  if (name && cs) {
    return `${name} DE ${cs}`;
  }
  if (name) {
    return name;
  }
  if (cs) {
    return cs;
  }
  return FALLBACK_NAME;
}

module.exports = {
  FALLBACK_NAME,
  resolveDisplayName,
  readSelfString,
};
