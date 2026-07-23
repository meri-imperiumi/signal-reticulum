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
 * Forward-secrecy ratchets on the delivery destination are **off by default**.
 * The LXMRouter enables them unconditionally in `init()`, which makes the
 * `lxmf.delivery` announce carry a `ratchet_pub` (packet `context_flag = 1`).
 * Several LXMF clients (older Sideband / NomadNet / MeshChat and firmware
 * builds) parse the announce body at a fixed signature offset and silently
 * reject ratchet-bearing announces as signature-invalid, leaving the node
 * invisible on the mesh even though NomadNet (no ratchet) shows up fine
 * (PROTOCOL-SPEC.md §4.5 step 1, §7.3.3). A ratchet-less announce
 * (`context_flag = 0`) is interop-correct against every RNS 1.x receiver; the
 * only trade-off is forward secrecy — opportunistic inbound messages are then
 * encrypted to the long-term X25519 key. Operators whose clients all support
 * ratchets can opt in via `options.forwardSecrecy`.
 *
 * @param {object} rns - A Reticulum instance (owns the transport/interfaces).
 * @param {object} identity - The sender Reticulum identity.
 * @param {{displayName?:string, forwardSecrecy?:boolean}} [options]
 * @param {(...args:any[])=>void} [log]
 * @returns {Promise<object>} The initialised LXMRouter (also exposes
 *   `deliveryDest.destinationHash`, the node's own LXMF address).
 */
async function setupMessaging(rns, identity, options = {}, log = () => {}) {
  const lxmf = new deps.LXMRouter(identity, rns);
  await lxmf.init();
  // Drop the ratchet the router enabled in init() unless the operator opted
  // into forward secrecy, so the announce is visible to every LXMF client.
  if (lxmf.deliveryDest && !options.forwardSecrecy) {
    lxmf.deliveryDest.ratchetsEnabled = false;
    lxmf.deliveryDest.ratchets = null;
  }
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
 * Builds a `deliver(destinationHashHex, title, content)` callback bound to the
 * given router and sender identity. Each call constructs and sends a single
 * LXMF message (opportunistic delivery) to the recipient's `lxmf.delivery`
 * destination.
 *
 * Rejects if the recipient's identity is unknown or delivery fails; the caller
 * (notification forwarding) logs and continues with the next recipient.
 *
 * @param {object} lxmf - An initialised LXMRouter.
 * @param {object} identity - The sender Reticulum identity.
 * @returns {(destinationHashHex:string, title:string, content:string)=>Promise<void>}
 */
function makeDeliverer(lxmf, identity) {
  return async function deliver(destinationHashHex, title, content) {
    const message = new deps.LXMessage({
      sourceHash: lxmf.deliveryDest.destinationHash,
      destinationHash: deps.fromHex(destinationHashHex),
      title,
      content,
    });
    await lxmf.send(message, identity);
  };
}

module.exports = {
  deps,
  setupMessaging,
  makeDeliverer,
};
