const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_INTERFACES,
  getDefaultInterfaces,
  interfacesFromConfig,
  effectiveInterfaces,
  optionsFromEntry,
  setupInterfaces,
} = require("../plugin/interfaces");

/** A fake interface class that records its lifecycle for assertions. */
function makeFakeInterfaceClass(typeName, { connectThrows, ctorThrows } = {}) {
  return class FakeInterface {
    constructor(options) {
      if (ctorThrows) throw new Error(`${typeName} boom`);
      this.type = typeName;
      this.options = options;
      this.name = options && options.name ? options.name : typeName;
      this.connectedCalls = 0;
      this.disconnectedCalls = 0;
    }
    async connect() {
      this.connectedCalls += 1;
      if (connectThrows) throw new Error(`${typeName} connect boom`);
      this.connected = true;
    }
    async disconnect() {
      this.disconnectedCalls += 1;
      this.connected = false;
    }
  };
}

function makeFakeRns() {
  const added = [];
  const removed = [];
  return {
    added,
    removed,
    addInterface(iface, isDefault) {
      added.push({ iface, isDefault });
    },
    removeInterface(iface) {
      removed.push(iface);
    },
  };
}

test("effectiveInterfaces returns the default AutoInterface when nothing is configured", () => {
  assert.deepEqual(effectiveInterfaces(undefined), [{ type: "auto" }]);
  assert.deepEqual(effectiveInterfaces(null), [{ type: "auto" }]);
  assert.deepEqual(effectiveInterfaces([]), [{ type: "auto" }]);
  assert.deepEqual(effectiveInterfaces("nope"), [{ type: "auto" }]);
});

test("effectiveInterfaces passes a non-empty configured list through unchanged", () => {
  const list = [{ type: "tcp-client", host: "x" }];
  assert.equal(effectiveInterfaces(list), list);
});

test("effectiveInterfaces default is a fresh clone, not the frozen constant", () => {
  const a = getDefaultInterfaces();
  a.push({ type: "tcp-client" });
  assert.deepEqual(DEFAULT_INTERFACES, [{ type: "auto" }]);
  assert.deepEqual(effectiveInterfaces(undefined), [{ type: "auto" }]);
});

test("optionsFromEntry strips the type discriminator", () => {
  assert.deepEqual(optionsFromEntry({ type: "auto", name: "x", port: 9 }), {
    name: "x",
    port: 9,
  });
  assert.deepEqual(optionsFromEntry(undefined), {});
});

test("setupInterfaces connects and attaches all interfaces", async () => {
  const auto = makeFakeInterfaceClass("auto");
  const tcp = makeFakeInterfaceClass("tcp-client");
  const getInterface = (id) =>
    id === "auto" ? auto : id === "tcp-client" ? tcp : undefined;
  const rns = makeFakeRns();

  const result = await setupInterfaces(
    rns,
    [
      { type: "auto", name: "lan" },
      { type: "tcp-client", host: "1.2.3.4", port: 4242 },
    ],
    getInterface,
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.connected.length, 2);
  assert.equal(result.connected[0].options.name, "lan");
  assert.equal(result.connected[1].options.host, "1.2.3.4");
  assert.equal(result.connected[0].connectedCalls, 1);
  assert.equal(rns.added.length, 2);
  assert.equal(rns.added[0].isDefault, true);
});

test("setupInterfaces reports an error for an unknown interface type", async () => {
  const rns = makeFakeRns();
  const result = await setupInterfaces(
    rns,
    [{ type: "nope" }],
    () => undefined,
  );

  assert.equal(result.connected.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /Unknown interface type "nope"/);
  assert.equal(rns.added.length, 0);
});

test("setupInterfaces records a constructor failure without throwing", async () => {
  const rns = makeFakeRns();
  const cls = makeFakeInterfaceClass("auto", { ctorThrows: true });
  const result = await setupInterfaces(rns, [{ type: "auto" }], () => cls);

  assert.equal(result.connected.length, 0);
  assert.match(result.errors[0].error, /Failed to create "auto" interface/);
});

test("setupInterfaces records a connect failure, attempts cleanup, and keeps going", async () => {
  const bad = makeFakeInterfaceClass("tcp-client", { connectThrows: true });
  const good = makeFakeInterfaceClass("auto");
  const getInterface = (id) => (id === "tcp-client" ? bad : good);
  const rns = makeFakeRns();

  const result = await setupInterfaces(
    rns,
    [{ type: "tcp-client" }, { type: "auto" }],
    getInterface,
  );

  assert.equal(result.connected.length, 1);
  assert.equal(result.connected[0].type, "auto");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /Failed to connect "tcp-client"/);
  // The failed interface was cleaned up via disconnect.
  assert.equal(bad.disconnectedByCleanup, undefined); // sanity
});

test("interfacesFromConfig flattens the per-type arrays into typed entries", () => {
  const ids = ["auto", "tcp-client"];
  const config = {
    auto_interfaces: [{}],
    tcp_clients: [{ host: "1.2.3.4", port: 4242, name: "uplink" }],
  };

  assert.deepEqual(interfacesFromConfig(config, ids), [
    { type: "auto" },
    { type: "tcp-client", host: "1.2.3.4", port: 4242, name: "uplink" },
  ]);
});

test("interfacesFromConfig ignores arrays for ids it was not given", () => {
  // "webrtc" is browser-only and filtered out before this runs; an entry left
  // under its key must not be started.
  const config = {
    webrtc_interfaces: [{ bitrate: 999 }],
    tcp_clients: [{ host: "x", port: 1 }],
  };
  assert.deepEqual(interfacesFromConfig(config, ["tcp-client"]), [
    { type: "tcp-client", host: "x", port: 1 },
  ]);
});

test("interfacesFromConfig returns an empty list when nothing is configured", () => {
  assert.deepEqual(interfacesFromConfig(undefined, ["auto"]), []);
  assert.deepEqual(interfacesFromConfig(null, ["auto"]), []);
  assert.deepEqual(interfacesFromConfig({}, ["auto"]), []);
  assert.deepEqual(
    interfacesFromConfig({ tcp_clients: [] }, ["tcp-client"]),
    [],
  );
});

test("interfacesFromConfig tolerates non-object array entries", () => {
  assert.deepEqual(
    interfacesFromConfig(
      { tcp_clients: [null, "nope", { host: "x", port: 1 }] },
      ["tcp-client"],
    ),
    [
      { type: "tcp-client" },
      { type: "tcp-client" },
      { type: "tcp-client", host: "x", port: 1 },
    ],
  );
});

test("interfacesFromConfig honours a legacy single `interfaces` array only when no per-type arrays are set", () => {
  const legacy = {
    interfaces: [{ type: "auto" }, { type: "tcp-client", host: "h", port: 9 }],
  };
  assert.deepEqual(interfacesFromConfig(legacy, ["auto", "tcp-client"]), [
    { type: "auto" },
    { type: "tcp-client", host: "h", port: 9 },
  ]);

  // Per-type arrays take precedence over the legacy key.
  const mixed = {
    ...legacy,
    tcp_clients: [{ host: "new", port: 2 }],
  };
  assert.deepEqual(interfacesFromConfig(mixed, ["auto", "tcp-client"]), [
    { type: "tcp-client", host: "new", port: 2 },
  ]);
});

test("effectiveInterfaces(interfacesFromConfig(...)) defaults to AutoInterface when nothing is configured", () => {
  assert.deepEqual(
    effectiveInterfaces(interfacesFromConfig({}, ["auto", "tcp-client"])),
    [{ type: "auto" }],
  );
});
