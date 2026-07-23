const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deps,
  setupNomadNet,
  renderPage,
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
