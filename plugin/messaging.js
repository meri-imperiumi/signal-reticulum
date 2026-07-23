/**
 * Brings up the LXMF (Lightweight Extensible Message Format) router so the
 * Signal K node can send messages to crew members, and builds the delivery
 * callback used by the notification forwarding logic.
 *
 * The LXMF transport classes are injected through {@link deps} (defaulting to
 * the real `@reticulum/core`) so this module can be unit-tested without any
 * network I/O.
 *
 * Delivery is opportunistic by default: each message is sent as a single
 * encrypted packet addressed to the recipient's `lxmf.delivery` destination
 * hash, which requires the recipient's identity to be known (learned from an
 * announce). Store-and-forward via a propagation node is a future enhancement.
 *
 * @file messaging.js
 */

const RNS = require("@reticulum/core");

/** Injected transport classes; tests swap these for fakes. */
const deps = {
  LXMRouter: RNS.LXMRouter,
  LXMessage: RNS.LXMessage,
  FIELD_TELEMETRY: RNS.LXMFConstants.FIELD_TELEMETRY,
  fromHex: RNS.fromHex,
  toHex: RNS.toHex,
};

/**
 * Creates and initialises an LXMF router bound to `identity` on `rns`, then
 * announces the `lxmf.delivery` destination so peers learn who we are.
 *
 * The announcement is best-effort: a failure is logged but never thrown, as the
 * router remains usable for opportunistic delivery to crew whose identities are
 * already known.
 *
 * Forward-secrecy ratchets on the delivery destination are **kept enabled**
 * (the `LXMRouter.init()` default), exactly like the LXMF echobot. This is
 * not optional: peers such as NomadNet / Sideband learn our ratchet public
 * key from the announce and encrypt opportunistic inbound messages to it.
 * Disabling ratchets (as this code once did for announce-visibility reasons)
 * leaves us holding no ratchet private key, so `Identity.decrypt()` returns
 * null, the destination emits no PROOF, and the sender retransmits forever
 * with no acknowledgement or response — even though outbound traffic
 * (telemetry) still works. Keeping ratchets on ensures every ratchet-encrypted
 * inbound message decrypts and is acknowledged.
 *
 * @param {object} rns - A Reticulum instance (owns the transport/interfaces).
 * @param {object} identity - The sender Reticulum identity.
 * @param {{displayName?:string}} [options]
 * @param {(...args:any[])=>void} [log]
 * @returns {Promise<object>} The initialised LXMRouter (also exposes
 *   `deliveryDest.destinationHash`, the node's own LXMF address).
 */
async function setupMessaging(rns, identity, options = {}, log = () => {}) {
  const lxmf = new deps.LXMRouter(identity, rns);
  await lxmf.init();
  if (options.displayName) {
    try {
      await lxmf.announce(options.displayName);
      log(
        `Announced LXMF destination ${deps.toHex(
          lxmf.deliveryDest.destinationHash,
        )} as "${options.displayName}"`,
      );
    } catch (e) {
      log(`Failed to announce LXMF destination: ${e.message}`);
    }
  }
  return lxmf;
}

/**
 * Builds a `deliver(destinationHashHex, title, content, linkId?)` callback
 * bound to the given router and sender identity. Each call constructs and
 * sends a single LXMF message to the recipient's `lxmf.delivery` destination.
 *
 * When `linkId` is supplied the message is delivered over that already-
 * established Link — the same path the LXMF echobot uses to reply promptly
 * (`LXMRouter.send` looks the link up in `transport.activeLinks`, waits for it
 * to become ACTIVE, sends LINKIDENTIFY once, then the message). Without it the
 * message falls back to opportunistic single-packet delivery (LXMF.md §5.1),
 * which needs the recipient's identity to be known and a fresh path and is
 * therefore flaky for replies. The `linkId` for an inbound message is carried
 * by the router's `"message"` event as `event.detail.link`; command handlers
 * thread it through to the deliverer so replies ride back on the arrival link.
 *
 * Rejects if the recipient's identity is unknown or delivery fails; the caller
 * (notification forwarding) logs and continues with the next recipient.
 *
 * @param {object} lxmf - An initialised LXMRouter.
 * @param {object} identity - The sender Reticulum identity.
 * @returns {(destinationHashHex:string, title:string, content:string, linkId?:Uint8Array|null)=>Promise<void>}
 */
function makeDeliverer(lxmf, identity) {
  return async function deliver(destinationHashHex, title, content, linkId) {
    const message = new deps.LXMessage({
      sourceHash: lxmf.deliveryDest.destinationHash,
      destinationHash: deps.fromHex(destinationHashHex),
      title,
      content,
    });
    await lxmf.send(message, identity, linkId);
  };
}

/**
 * Builds a `deliverTelemetry(destinationHashHex, packedTelemetry)` callback
 * bound to the given router and sender identity. Each call constructs and sends
 * a single LXMF message carrying the Sideband telemetry snapshot in its
 * `FIELD_TELEMETRY` field (with empty title/content), so any LXMF client that
 * understands telemetry — Sideband, NomadNet, MeshChat — renders it in the
 * peer's telemetry view.
 *
 * The `fields` map uses an integer key (via `Map`) so it is serialised with an
 * integer field id on the wire, exactly as Sideband expects.
 *
 * Rejects if the recipient's identity is unknown or delivery fails; the caller
 * logs and continues with the next recipient.
 *
 * @param {object} lxmf - An initialised LXMRouter.
 * @param {object} identity - The sender Reticulum identity.
 * @returns {(destinationHashHex:string, packedTelemetry:Uint8Array)=>Promise<void>}
 */
function makeTelemetryDeliverer(lxmf, identity) {
  return async function deliverTelemetry(destinationHashHex, packedTelemetry) {
    const message = new deps.LXMessage({
      sourceHash: lxmf.deliveryDest.destinationHash,
      destinationHash: deps.fromHex(destinationHashHex),
      title: "",
      content: "",
      fields: new Map([[deps.FIELD_TELEMETRY, packedTelemetry]]),
    });
    await lxmf.send(message, identity);
  };
}

module.exports = {
  deps,
  setupMessaging,
  makeDeliverer,
  makeTelemetryDeliverer,
};
