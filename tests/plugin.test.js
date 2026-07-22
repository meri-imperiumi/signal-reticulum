const test = require("node:test");
const assert = require("node:assert/strict");

const RNS = require("reticulum-js");
const { toHex } = RNS;
const makePlugin = require("../plugin/index.js");

// --- Fakes so the plugin can be started without any real network I/O --------

/** A fake interface class that records its lifecycle. */
function makeFakeInterfaceClass(typeName, { connectThrows } = {}) {
  return class FakeInterface {
    constructor(options) {
      this.type = typeName;
      this.options = options || {};
      this.name = (options && options.name) || typeName;
    }
    async connect() {
      if (connectThrows) throw new Error(`${typeName} connect boom`);
      this.connected = true;
    }
    async disconnect() {
      this.connected = false;
    }
  };
}

class FakeRns {
  constructor(config) {
    this.config = config;
    this.added = [];
    this.removed = [];
  }
  addInterface(iface, isDefault) {
    this.added.push({ iface, isDefault });
  }
  removeInterface(iface) {
    this.removed.push(iface);
  }
}

// Install fakes on the plugin's dependency seam.
makePlugin.deps.Reticulum = FakeRns;
makePlugin.deps.getInterface = (id) => {
  if (id === "auto") return makeFakeInterfaceClass("auto");
  if (id === "tcp-client") return makeFakeInterfaceClass("tcp-client");
  return undefined;
};

/** Minimal stand-in for the Signal K ServerAPI the plugin touches. */
function makeApp() {
  /** @type {any} */
  const app = {
    debugCalls: [],
    statusCalls: [],
    errorCalls: [],
    savedOptions: [],
    debug(...args) {
      app.debugCalls.push(args);
    },
    setPluginStatus(msg) {
      app.statusCalls.push(msg);
    },
    setPluginError(msg) {
      app.errorCalls.push(msg);
    },
    savePluginOptions(options, cb) {
      app.savedOptions.push(options);
      if (cb) setImmediate(cb, null);
    },
  };
  return app;
}

test("the plugin module exports a constructor that returns a plugin object", () => {
  const plugin = makePlugin(makeApp());

  assert.equal(typeof plugin, "object");
  assert.equal(plugin.id, "signalk-reticulum");
  assert.equal(typeof plugin.name, "string");
  assert.equal(typeof plugin.start, "function");
  assert.equal(typeof plugin.stop, "function");
  assert.equal(typeof plugin.schema, "function");
});

test("schema is built from the live RNS interface registry", () => {
  const plugin = makePlugin(makeApp());
  const schema = plugin.schema();

  const branches = schema.properties.interfaces.items.oneOf;
  const registered = RNS.listInterfaces();

  assert.equal(
    branches.length,
    registered.length,
    "one branch per registry entry",
  );

  const branchIds = branches.map((b) => b.properties.type.const);
  const registryIds = registered.map((e) => e.id);
  assert.deepEqual(
    branchIds.sort(),
    registryIds.sort(),
    "every registry id has a matching branch",
  );
});

test("every schema branch exposes the type discriminator and keeps the interface's required fields", () => {
  const plugin = makePlugin(makeApp());
  const branches = plugin.schema().properties.interfaces.items.oneOf;
  const byId = Object.fromEntries(RNS.listInterfaces().map((e) => [e.id, e]));

  for (const branch of branches) {
    const entry = byId[branch.properties.type.const];
    assert.equal(branch.properties.type.type, "string");
    assert.equal(branch.required[0], "type");
    for (const prop of Object.keys(entry.schema.properties || {})) {
      assert.ok(prop in branch.properties, `preserves ${prop}`);
    }
  }
});

test("schema exposes identity and interface groups with the AutoInterface default", () => {
  const plugin = makePlugin(makeApp());
  const schema = plugin.schema();

  assert.deepEqual(Object.keys(schema.properties), ["interfaces", "identity"]);
  const identity = schema.properties.identity;
  assert.ok("publicKey" in identity.properties);
  assert.ok("privateKey" in identity.properties);
  assert.equal(identity.properties.publicKey.readOnly, true);

  assert.deepEqual(schema.properties.interfaces.default, [{ type: "auto" }]);
});

test("start sets up the node, default AutoInterface and persists a generated identity", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);

  await plugin.start({});

  const hashHex = toHex(plugin.identity.identityHash);
  assert.ok(plugin.rns instanceof FakeRns, "Reticulum node created");
  assert.equal(plugin.interfaces.length, 1, "default AutoInterface connected");
  assert.equal(plugin.rns.added.length, 1);
  assert.equal(plugin.rns.added[0].isDefault, true);
  assert.match(app.statusCalls[0], /Identity .*?, 1 interface\(s\) connected/);

  assert.equal(app.savedOptions.length, 1);
  const saved = app.savedOptions[0];
  assert.ok(saved.identity.publicKey);
  assert.ok(saved.identity.privateKey);
  assert.equal(app.errorCalls.length, 0);
});

test("start connects explicitly configured interfaces", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);

  const source = await RNS.Identity.generate();
  const config = {
    identity: {
      privateKey: toHex(await source.getPrivateKey()),
      publicKey: toHex(await source.getPublicKey()),
    },
    interfaces: [
      { type: "tcp-client", host: "example.com", port: 4242 },
      { type: "auto", name: "lan" },
    ],
  };

  await plugin.start(config);

  assert.equal(plugin.interfaces.length, 2);
  assert.equal(plugin.interfaces[0].options.host, "example.com");
  assert.equal(plugin.interfaces[1].options.name, "lan");
  assert.equal(app.savedOptions.length, 0, "nothing persisted when keys match");
  assert.equal(app.errorCalls.length, 0);
});

test("start records interface errors and keeps the rest running", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);
  // A registry where tcp-client fails to connect.
  makePlugin.deps.getInterface = (id) => {
    if (id === "tcp-client")
      return makeFakeInterfaceClass("tcp-client", { connectThrows: true });
    if (id === "auto") return makeFakeInterfaceClass("auto");
    return undefined;
  };

  const source = await RNS.Identity.generate();
  await plugin.start({
    identity: {
      privateKey: toHex(await source.getPrivateKey()),
      publicKey: toHex(await source.getPublicKey()),
    },
    interfaces: [{ type: "tcp-client" }, { type: "auto" }],
  });

  assert.equal(plugin.interfaces.length, 1, "auto still connected");
  assert.equal(app.errorCalls.length, 1);
  assert.match(app.errorCalls[0], /1 failed/);
  assert.match(app.errorCalls[0], /Failed to connect "tcp-client"/);

  // Restore the default fake registry for subsequent tests.
  makePlugin.deps.getInterface = (id) => {
    if (id === "auto") return makeFakeInterfaceClass("auto");
    if (id === "tcp-client") return makeFakeInterfaceClass("tcp-client");
    return undefined;
  };
});

test("start surfaces an identity error without setting up interfaces", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);

  await plugin.start({ identity: { privateKey: "abcd" } });

  assert.equal(plugin.identity, undefined);
  assert.equal(plugin.rns, undefined);
  assert.equal(app.errorCalls.length, 1);
  assert.match(app.errorCalls[0], /Identity error/);
});

test("stop tears down every connected interface and clears state", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);
  await plugin.start({});
  const rns = plugin.rns;
  const ifaces = plugin.interfaces;
  assert.ok(ifaces.length > 0);

  await plugin.stop();

  assert.equal(
    rns.removed.length,
    ifaces.length,
    "all interfaces removed from node",
  );
  assert.equal(plugin.rns, undefined);
  assert.equal(plugin.identity, undefined);
  assert.equal(plugin.interfaces.length, 0);
  assert.equal(app.statusCalls[app.statusCalls.length - 1], "Stopped");
});
