const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deps,
  setupNomadNet,
  renderPage,
  readNumber,
  formatVesselState,
  formatAnchorDistance,
  formatDepth,
  formatTide,
  formatWind,
  formatBattery,
  INDEX_PATH,
  NODE_ASPECT,
  UNKNOWN_VESSEL,
} = require("../plugin/nomadnet");

const REAL_DEPS = { ...deps };

/** A fake Destination that records handler registration, app_data and announces. */
class FakeDestination extends EventTarget {
  constructor(name, direction, type, identity, rns) {
    super();
    this.name = name;
    this.direction = direction;
    this.type = type;
    this.identity = identity;
    this.rns = rns;
    this.destinationHash = new Uint8Array(16).fill(11);
    this.appData = null;
    this.registered = [];
    this.removed = [];
    this.announceCalls = 0;
    this.acceptedLinks = [];
    FakeDestination.instances.push(this);
  }
  static async IN(name, type, identity, rns) {
    return new this(name, "IN", type, identity, rns);
  }
  async registerRequestHandler(path, options) {
    this.registered.push({ path, options });
    return new Uint8Array(16);
  }
  async removeRequestHandler(path) {
    this.removed.push(path);
    return true;
  }
  async announce() {
    this.announceCalls += 1;
  }
  async acceptLink(packet) {
    const link = {
      linkId: new Uint8Array(16).fill(1),
      packet,
      listeners: {},
      addEventListener(type, fn) {
        (link.listeners[type] ||= []).push(fn);
      },
    };
    this.acceptedLinks.push(link);
    return link;
  }
}
FakeDestination.instances = [];

const REAL_DEST_TYPE = deps.DestType;
const REAL_ALLOW = deps.Allow;

/** A minimal fake RNS exposing the registration surface the module touches. */
function makeRns() {
  const rns = {
    transport: {
      bound: [],
      unbound: [],
      bindLocalDestination(dest) {
        rns.transport.bound.push(dest);
      },
      unbindLocalDestination(dest) {
        rns.transport.unbound.push(dest);
      },
    },
    registered: [],
    deregistered: [],
    registerDestination(dest) {
      rns.registered.push(dest);
    },
    deregisterDestination(dest) {
      rns.deregistered.push(dest);
    },
  };
  return rns;
}

test("renderPage shows the vessel name as a micron heading", () => {
  const page = renderPage({ vesselName: "S/Y Bergie" });
  assert.equal(page, ">>S/Y Bergie\n");
});

test("renderPage falls back to a placeholder when no vessel name is known", () => {
  assert.equal(renderPage({}).trim(), `>>${UNKNOWN_VESSEL}`);
  assert.equal(renderPage({ vesselName: "  " }).trim(), `>>${UNKNOWN_VESSEL}`);
  assert.equal(renderPage({ vesselName: { value: "Boat" } }), ">>Boat\n");
});

test("renderPage tolerates a missing context", () => {
  assert.equal(renderPage().trim(), `>>${UNKNOWN_VESSEL}`);
});

// --- value helpers ---------------------------------------------------------

test("readNumber unwraps {value} and rejects non-finite values", () => {
  assert.equal(readNumber(5.2), 5.2);
  assert.equal(readNumber({ value: 12 }), 12);
  assert.equal(readNumber(NaN), undefined);
  assert.equal(readNumber(Infinity), undefined);
  assert.equal(readNumber("5"), undefined);
  assert.equal(readNumber(undefined), undefined);
});

// --- telemetry formatters --------------------------------------------------

test("formatVesselState renders 'Vessel is <state>'", () => {
  assert.equal(formatVesselState("anchored"), "Vessel is anchored");
  assert.equal(formatVesselState({ value: "sailing" }), "Vessel is sailing");
  assert.equal(formatVesselState(undefined), "");
  assert.equal(formatVesselState(""), "");
});

test("formatAnchorDistance renders distance from bow in metres", () => {
  assert.equal(formatAnchorDistance(12.56), "Anchor: 12.6 m from bow");
  assert.equal(formatAnchorDistance({ value: 0 }), "Anchor: 0.0 m from bow");
  assert.equal(formatAnchorDistance(undefined), "");
});

test("formatDepth renders depth below surface in metres", () => {
  assert.equal(formatDepth(5.24), "Depth: 5.2 m below surface");
  assert.equal(formatDepth({ value: 0 }), "Depth: 0.0 m below surface");
  assert.equal(formatDepth(undefined), "");
});

test("formatTide renders height and state together or separately", () => {
  assert.equal(formatTide(1.3, "rising"), "Tide: 1.3 m, rising");
  assert.equal(formatTide(1.3, undefined), "Tide: 1.3 m");
  assert.equal(formatTide(undefined, "falling"), "Tide: falling");
  assert.equal(formatTide(undefined, undefined), "");
});

test("formatWind converts m/s to knots and radians to degrees", () => {
  assert.equal(formatWind(6, Math.PI / 4), "Wind: 12 kn at 45\u00B0");
  assert.equal(formatWind(6, undefined), "Wind: 12 kn");
  assert.equal(formatWind(undefined, Math.PI / 2), "Wind: 90\u00B0");
  assert.equal(formatWind(undefined, undefined), "");
});

test("formatBattery converts SoC to percent and shows current", () => {
  assert.equal(formatBattery(0.873, 2.3), "Battery: 87 %, 2.3 A");
  assert.equal(formatBattery(0.5, undefined), "Battery: 50 %");
  assert.equal(formatBattery(undefined, -1.2), "Battery: -1.2 A");
  assert.equal(formatBattery(undefined, undefined), "");
});

// --- banner & telemetry rendering ------------------------------------------

test("renderPage shows a configured banner instead of the vessel name", () => {
  const page = renderPage({ vesselName: "Boat", banner: "/|__\n\\__/" });
  assert.equal(page, "/|__\n\\__/\n");
  assert.doesNotMatch(page, /Boat/);
});

test("renderPage trims surrounding whitespace from the banner", () => {
  const page = renderPage({ banner: "  /\n\\  " });
  assert.equal(page, "/\n\\\n");
});

test("renderPage combines a banner with the telemetry section", () => {
  const page = renderPage({
    banner: "B",
    telemetry: { state: "sailing" },
  });
  assert.equal(page, "B\n\n>Vessel status\nVessel is sailing\n");
});

test("renderPage appends a Vessel status section when telemetry is available", () => {
  const page = renderPage({
    vesselName: "S/Y Bergie",
    telemetry: {
      state: "anchored",
      anchorDistance: 12.34,
      depth: 5.2,
      tideHeight: 1.3,
      tideState: "rising",
      windSpeed: 6.0,
      windDirection: Math.PI / 4,
      batterySoc: 0.873,
      batteryCurrent: 2.3,
    },
  });
  assert.equal(
    page,
    ">>S/Y Bergie\n" +
      "\n" +
      ">Vessel status\n" +
      "Vessel is anchored\n" +
      "Anchor: 12.3 m from bow\n" +
      "Depth: 5.2 m below surface\n" +
      "Tide: 1.3 m, rising\n" +
      "Wind: 12 kn at 45\u00B0\n" +
      "Battery: 87 %, 2.3 A\n",
  );
});

test("renderPage omits individual readings that are not available", () => {
  const page = renderPage({
    vesselName: "Boat",
    telemetry: { state: "moored" },
  });
  assert.equal(page, ">>Boat\n\n>Vessel status\nVessel is moored\n");
});

test("renderPage omits the telemetry section entirely when nothing is available", () => {
  assert.equal(renderPage({ vesselName: "Boat" }), ">>Boat\n");
  assert.equal(renderPage({ vesselName: "Boat", telemetry: {} }), ">>Boat\n");
});

test("setupNomadNet creates and registers the nomadnetwork.node destination", async () => {
  deps.Destination = FakeDestination;
  deps.toHex = (bytes) => Buffer.from(bytes).toString("hex");
  const rns = makeRns();
  const identity = { id: "me" };
  const logs = [];

  const site = await setupNomadNet(
    rns,
    identity,
    {
      displayName: "My Boat",
    },
    (...a) => logs.push(a.join(" ")),
  );

  assert.equal(FakeDestination.instances.length, 1, "one destination created");
  const dest = FakeDestination.instances[0];
  assert.equal(dest.name, NODE_ASPECT);
  assert.equal(dest.rns, rns, "destination bound to the rns instance");
  assert.deepEqual(rns.transport.bound, [dest], "bound to the transport");
  assert.deepEqual(rns.registered, [dest], "registered with the node");
  assert.deepEqual(
    Buffer.from(dest.appData).toString("utf8"),
    "My Boat",
    "node name set as announce app_data",
  );

  assert.deepEqual(
    dest.registered.map((r) => r.path),
    [INDEX_PATH],
    "index page handler registered",
  );
  assert.equal(dest.announceCalls, 1, "destination announced once");
  assert.ok(logs.some((l) => /Announced NomadNet node/.test(l)));

  assert.equal(site.indexPath, INDEX_PATH);
  assert.equal(site.destination, dest);

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});

test("the index handler returns the live page bytes built from getContext", async () => {
  deps.Destination = FakeDestination;
  deps.toHex = () => "00";
  const rns = makeRns();
  let name = "First";

  const site = await setupNomadNet(
    rns,
    {},
    {
      displayName: "Boat",
      getContext: () => ({ vesselName: name }),
    },
  );

  const handler = site.destination.registered[0];
  const response = await handler.options.responseGenerator();

  assert.deepEqual(
    Buffer.from(response).toString("utf8"),
    ">>First\n",
    "first render reflects the initial name",
  );

  name = "Renamed";
  const response2 = await handler.options.responseGenerator();
  assert.deepEqual(
    Buffer.from(response2).toString("utf8"),
    ">>Renamed\n",
    "getContext is re-evaluated on each request",
  );

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});

test("the index handler is registered with ALLOW_ALL so anyone can browse", async () => {
  deps.Destination = FakeDestination;
  deps.DestType = { SINGLE: "single" };
  deps.Allow = { ALL: 0x01 };
  const rns = makeRns();

  const site = await setupNomadNet(rns, {}, { displayName: "Boat" });

  const handler = site.destination.registered[0];
  assert.equal(handler.options.allow, deps.Allow.ALL);

  FakeDestination.instances.length = 0;
  deps.DestType = REAL_DEST_TYPE;
  deps.Allow = REAL_ALLOW;
  Object.assign(deps, REAL_DEPS);
});

test("setupNomadNet logs but does not throw when announce fails", async () => {
  deps.Destination = class extends FakeDestination {
    async announce() {
      throw new Error("airtime");
    }
  };
  deps.toHex = () => "00";
  const rns = makeRns();
  const logs = [];

  const site = await setupNomadNet(rns, {}, { displayName: "Boat" }, (...a) =>
    logs.push(a.join(" ")),
  );

  assert.ok(site, "site handle still returned");
  assert.equal(
    site.destination.registered.length,
    1,
    "handler still registered",
  );
  assert.ok(logs.some((l) => /Failed to announce NomadNet node/.test(l)));

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});

test("incoming link requests are accepted so the LRPROOF handshake completes", async () => {
  deps.Destination = FakeDestination;
  deps.toHex = (bytes) => Buffer.from(bytes).toString("hex");
  const rns = makeRns();

  const site = await setupNomadNet(rns, {}, { displayName: "Boat" });
  const dest = site.destination;
  const packet = { id: "LINKREQUEST" };

  dest.dispatchEvent(new CustomEvent("link_request", { detail: { packet } }));
  // acceptLink is async; let it flush.
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(dest.acceptedLinks.length, 1, "link accepted");
  assert.equal(
    dest.acceptedLinks[0].packet,
    packet,
    "acceptLink received the LINKREQUEST packet",
  );
  assert.equal(
    dest.acceptedLinks[0].bz2,
    undefined,
    "bz2 left unset when no compressor is configured",
  );

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});

test("a link accept failure is logged but does not break the site", async () => {
  deps.Destination = class extends FakeDestination {
    async acceptLink() {
      throw new Error("transport down");
    }
  };
  deps.toHex = () => "00";
  const rns = makeRns();
  const logs = [];

  const site = await setupNomadNet(rns, {}, { displayName: "Boat" }, (...a) =>
    logs.push(a.join(" ")),
  );
  site.destination.dispatchEvent(
    new CustomEvent("link_request", { detail: { packet: {} } }),
  );
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(
    logs.some((l) => /Failed to accept NomadNet link/.test(l)),
    "accept failure logged",
  );

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});

test("stop removes the link-request listener along with the handler", async () => {
  deps.Destination = FakeDestination;
  deps.toHex = () => "00";
  const rns = makeRns();

  const site = await setupNomadNet(rns, {}, { displayName: "Boat" });
  const dest = site.destination;

  await site.stop();

  // A link request after stop must not be accepted.
  dest.dispatchEvent(
    new CustomEvent("link_request", { detail: { packet: {} } }),
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(dest.acceptedLinks.length, 0, "listener removed on stop");

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});

test("setupNomadNet defaults the node name when none is given", async () => {
  deps.Destination = FakeDestination;
  deps.toHex = () => "00";
  const rns = makeRns();

  const site = await setupNomadNet(rns, {}, {});
  assert.deepEqual(
    Buffer.from(site.destination.appData).toString("utf8"),
    "Signal K",
  );

  FakeDestination.instances.length = 0;
  Object.assign(deps, REAL_DEPS);
});
