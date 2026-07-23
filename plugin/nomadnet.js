/**
 * Brings up a NomadNet node so the Signal K boat can serve pages on the
 * Reticulum mesh.
 *
 * Creates a `nomadnetwork.node` SINGLE destination (PROTOCOL-SPEC.md §1.2,
 * name_hash `213e6311bcec54ab4fde`), registers a `/page/index.mu` request
 * handler — the default path NomadNet clients fetch (§11.6.1) — over the §11
 * REQUEST/RESPONSE protocol, and announces the destination so peers can
 * discover and browse it from Sideband / NomadNet / MeshChat.
 *
 * The transport classes are injected through {@link deps} (defaulting to the
 * real `@reticulum/core`) so this module can be unit-tested without any network
 * I/O.
 *
 * Page content is produced by {@link renderPage} from a context object the
 * caller supplies via `options.getContext`, evaluated fresh on every request so
 * later steps can add live telemetry without touching the transport wiring.
 *
 * @file nomadnet.js
 */

const RNS = require("@reticulum/core");

/** Injected transport classes; tests swap these for fakes. */
const deps = {
  Destination: RNS.Destination,
  DestType: RNS.DestType,
  Allow: RNS.Allow,
  toHex: RNS.toHex,
};

/** NomadNet node aspect (§1.2). */
const NODE_ASPECT = "nomadnetwork.node";
/** Default page path NomadNet clients fetch (§11.6.1). */
const INDEX_PATH = "/page/index.mu";
/** Heading shown when no vessel name is known yet. */
const UNKNOWN_VESSEL = "Unknown vessel";

/**
 * Renders the `/page/index.mu` micron page for the given context.
 *
 * Currently just the vessel name as a micron heading (a line beginning with
 * `>` is a NomadNet section header; the page body is plain micron markup the
 * client renders). The context is evaluated per-request so live values can be
 * added in later steps.
 *
 * @param {{vesselName?: unknown}|undefined} [context]
 * @returns {string} Micron markup.
 */
function renderPage(context = {}) {
  const raw = context && context.vesselName;
  const name = readString(raw) || UNKNOWN_VESSEL;
  return `>>${name}\n`;
}

/**
 * Creates and announces the NomadNet node destination, registers the index page
 * handler, and returns an object exposing the destination hash and a `stop()`
 * teardown.
 *
 * A failure to announce is logged but never thrown: the node stays registered
 * and reachable for anyone who already knows the path (e.g. via a cached path
 * entry).
 *
 * @param {object} rns - A Reticulum instance (owns the transport/interfaces).
 * @param {object} identity - The node's Reticulum identity.
 * @param {object} [options]
 * @param {string} [options.displayName] - Node name announced in app_data
 *   (defaults to "Signal K").
 * @param {() => {vesselName?: unknown}} [options.getContext] - Called on each
 *   page request to build the render context, so the page stays live.
 * @param {(...args:any[])=>void} [log]
 * @returns {Promise<object>} The NomadNet site handle.
 */
async function setupNomadNet(rns, identity, options = {}, log = () => {}) {
  const cfg = options || {};
  const displayName = readString(cfg.displayName) || "Signal K";
  const getContext =
    typeof cfg.getContext === "function" ? cfg.getContext : () => ({});

  const dest = await deps.Destination.IN(
    NODE_ASPECT,
    deps.DestType.SINGLE,
    identity,
    rns,
  );
  // §4.5: a per-destination app_data override takes precedence over the
  // identity's app_data in the announce, so the NomadNet node can advertise
  // its own name without disturbing the LXMF delivery destination.
  dest.appData = encodeUtf8(displayName);

  rns.transport.bindLocalDestination(dest);
  rns.registerDestination(dest);

  await dest.registerRequestHandler(INDEX_PATH, {
    responseGenerator: async () => encodeUtf8(renderPage(getContext())),
    allow: deps.Allow.ALL,
  });

  // Accept incoming Links so page REQUESTs can be served. Without this the
  // destination is only *visible* (announce heard) but never completes the
  // LINKREQUEST/LRPROOF handshake, so every client's link times out before it
  // can fetch /page/index.mu. acceptLink sends the LRPROOF and registers the
  // link with the transport; the Link then dispatches REQUEST packets to the
  // registered request handlers automatically. (Mirrors LXMRouter's
  // propagation-node / delivery-destination wiring.)
  /** @type {((event:any)=>Promise<void>)|null} */
  const onLinkRequest = async (event) => {
    try {
      const link = await dest.acceptLink(
        event && event.detail && event.detail.packet,
      );
      // Inject the compressor so compressed inbound resources can be inflated
      // (harmless when no provider is configured).
      link.bz2 = rns.compressionProvider || undefined;
    } catch (e) {
      log(`Failed to accept NomadNet link: ${e.message}`);
    }
  };
  dest.addEventListener("link_request", onLinkRequest);

  try {
    await dest.announce();
    log(
      `Announced NomadNet node ${deps.toHex(
        dest.destinationHash,
      )} as "${displayName}"`,
    );
  } catch (e) {
    log(`Failed to announce NomadNet node: ${e.message}`);
  }

  return {
    destination: dest,
    destinationHash: dest.destinationHash,
    indexPath: INDEX_PATH,
    /**
     * Deregisters the page handler and removes the destination from the node.
     * Best-effort: per-step failures are swallowed so teardown always completes.
     */
    async stop() {
      if (onLinkRequest) {
        try {
          dest.removeEventListener("link_request", onLinkRequest);
        } catch {
          /* best effort */
        }
      }
      try {
        await dest.removeRequestHandler(INDEX_PATH);
      } catch {
        /* best effort */
      }
      try {
        rns.deregisterDestination(dest);
      } catch {
        /* best effort */
      }
    },
  };
}

/**
 * Coerces a Signal K self-path value (plain string or `{value}` wrapper) into a
 * trimmed string. Mirrors the helper in `displayname.js` without importing it,
 * keeping this module's only Signal K coupling at the `getContext` boundary.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readString(value) {
  if (value && typeof value === "object" && "value" in value) {
    value = value.value;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

/**
 * UTF-8 encodes a string into a Buffer (a Uint8Array), the shape NomadNet page
 * handlers return and the §11.2 RESPONSE path msgpack-encodes as `bin`.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
function encodeUtf8(str) {
  return Buffer.from(str, "utf8");
}

module.exports = {
  deps,
  NODE_ASPECT,
  INDEX_PATH,
  UNKNOWN_VESSEL,
  setupNomadNet,
  renderPage,
  readString,
};
