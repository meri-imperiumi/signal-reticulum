/**
 * Replies "Pong" to any incoming LXMF message whose content is "ping".
 *
 * Available to everyone (not crew-only), so any peer on the mesh can check
 * that the Signal K node and its LXMF router are reachable. Mirrors the
 * `signalk-meshtastic` ping/pong command.
 *
 * @file commands/ping.js
 */

const { toHex } = require("@reticulum/core");

module.exports = {
  crewOnly: false,
  example: "Ping",
  accept: (message) =>
    typeof message === "object" &&
    message !== null &&
    typeof message.content === "string" &&
    message.content.trim().toLowerCase() === "ping",
  // Replies are sent to the sender's `lxmf.delivery` destination, which in an
  // LXMF message is carried by the source hash. The arrival `linkId` is
  // forwarded to the deliverer so the reply rides back over the same
  // established Link the ping arrived on (the prompt/reliable path the LXMF
  // echobot uses); it is `undefined` for opportunistic inbound messages.
  handle: (message, _settings, deliver, _app, linkId) =>
    deliver(toHex(message.sourceHash), "", "Pong", linkId),
};
