const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_INTERFACES,
  getDefaultInterfaces,
  effectiveInterfaces,
  optionsFromEntry,
  setupInterfaces,
  teardownInterfaces,
  connectSharedInstance,
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

test("teardownInterfaces disconnects and removes every interface in reverse order", async () => {
  const rns = makeFakeRns();
  const one = makeFakeInterfaceClass("one");
  const two = makeFakeInterfaceClass("two");
  const first = new one({});
  const second = new two({});
  const connected = [first, second];

  await teardownInterfaces(rns, connected);

  // Removed in reverse connection order.
  assert.deepEqual(rns.removed, [second, first]);
  assert.equal(first.disconnectedCalls, 1);
  assert.equal(second.disconnectedCalls, 1);
});

test("teardownInterfaces keeps going when an interface throws on disconnect", async () => {
  const rns = makeFakeRns();
  const exploding = {
    name: "boom",
    async disconnect() {
      throw new Error("boom");
    },
  };
  const calm = {
    name: "calm",
    disconnectCalls: 0,
    async disconnect() {
      this.disconnectCalls += 1;
    },
  };
  const messages = [];
  const log = (...args) => messages.push(args.join(" "));

  await teardownInterfaces(rns, [exploding, calm], log);

  assert.equal(calm.disconnectCalls, 1);
  assert.equal(rns.removed.length, 2);
  assert.ok(messages.some((m) => /disconnecting interface boom/.test(m)));
});

test("connectSharedInstance returns null when the node cannot share", async () => {
  const logs = [];
  const log = (...args) => logs.push(args.join(" "));
  // No connectToSharedInstance method at all.
  assert.equal(await connectSharedInstance({}, {}, log), null);
  assert.equal(await connectSharedInstance(null, {}, log), null);
  assert.equal(logs.length, 0, "nothing logged when the method is absent");
});

test("connectSharedInstance returns the connected interface", async () => {
  const shared = { name: "shared-instance" };
  const rns = {
    async connectToSharedInstance(options) {
      this.options = options;
      return shared;
    },
  };
  const logs = [];
  const log = (...args) => logs.push(args.join(" "));

  const result = await connectSharedInstance(rns, { foo: 1 }, log);

  assert.equal(result, shared);
  assert.deepEqual(rns.options, { foo: 1 });
  assert.ok(logs.some((m) => /Connected to shared Reticulum instance/.test(m)));
});

test("connectSharedInstance returns null when no shared instance is available", async () => {
  const rns = {
    async connectToSharedInstance() {
      return null;
    },
  };
  const logs = [];
  const log = (...args) => logs.push(args.join(" "));

  assert.equal(await connectSharedInstance(rns, {}, log), null);
  assert.ok(logs.some((m) => /No shared Reticulum instance available/.test(m)));
});

test("connectSharedInstance swallows connect errors and returns null", async () => {
  const rns = {
    async connectToSharedInstance() {
      throw new Error("boom");
    },
  };
  const logs = [];
  const log = (...args) => logs.push(args.join(" "));

  assert.equal(await connectSharedInstance(rns, {}, log), null);
  assert.ok(logs.some((m) => /Failed to connect to shared instance/.test(m)));
});
