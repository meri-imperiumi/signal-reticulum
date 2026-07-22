const test = require("node:test");
const assert = require("node:assert/strict");

const RNS = require("reticulum-js");
const { toHex } = RNS;
const makePlugin = require("../plugin/index.js");
const messaging = require("../plugin/messaging");

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

// --- Fakes so the plugin's LXMF messaging can be exercised without RNS I/O ---

class FakeLxmRouter {
  constructor(identity, rns) {
    this.identity = identity;
    this.rns = rns;
    this.initCalls = 0;
    this.announceCalls = [];
    this.sent = [];
    this.deliveryDest = {
      destinationHash: new Uint8Array(16).fill(9),
    };
    FakeLxmRouter.instances.push(this);
  }
  async init() {
    this.initCalls += 1;
  }
  async announce(name) {
    this.announceCalls.push(name);
  }
  async send(message, identity) {
    this.sent.push({ message, identity });
  }
}
FakeLxmRouter.instances = [];

class FakeLXMessage {
  constructor(options) {
    this.options = options;
  }
}

messaging.deps.LXMRouter = FakeLxmRouter;
messaging.deps.LXMessage = FakeLXMessage;
messaging.deps.fromHex = (hex) => Buffer.from(hex, "hex");
messaging.deps.toHex = (bytes) => Buffer.from(bytes).toString("hex");

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
    subscriptionmanager: {
      subscriptions: [],
      subscribe(spec, unsubs, onError, onDelta) {
        app.subscriptionmanager.subscriptions.push(spec);
        unsubs.push(() => {
          app.subscriptionmanager.unsubscribed = true;
        });
        app._onDelta = onDelta;
        app._onError = onError;
      },
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

  assert.deepEqual(Object.keys(schema.properties), [
    "interfaces",
    "identity",
    "messaging",
    "crew",
  ]);
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

test("schema exposes messaging and crew configuration groups", () => {
  const plugin = makePlugin(makeApp());
  const schema = plugin.schema();

  const messagingGroup = schema.properties.messaging;
  assert.equal(messagingGroup.properties.send_alerts.default, true);
  assert.equal(messagingGroup.properties.display_name.default, "Signal K");

  const crewGroup = schema.properties.crew;
  assert.equal(crewGroup.type, "array");
  assert.deepEqual(crewGroup.items.required, ["name", "destination"]);
  assert.equal(
    crewGroup.items.properties.destination.pattern,
    "^[0-9a-fA-F]{32}$",
  );
});

test("start brings up LXMF messaging, announces, and subscribes to notifications", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);
  FakeLxmRouter.instances.length = 0;

  await plugin.start({ messaging: { display_name: "My Boat" } });

  assert.ok(plugin.lxmf instanceof FakeLxmRouter, "LXMF router created");
  assert.equal(plugin.lxmf.initCalls, 1);
  assert.deepEqual(plugin.lxmf.announceCalls, ["My Boat"]);

  const subs = app.subscriptionmanager.subscriptions;
  assert.ok(
    subs.some(
      (s) =>
        s.subscribe &&
        s.subscribe.some((sub) => sub.path === "notifications.*"),
    ),
    "subscribed to notifications.*",
  );
});

test("an alarm notification is forwarded to each crew member over LXMF", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);
  const dest = "0123456789abcdef0123456789abcdef";

  await plugin.start({
    messaging: { send_alerts: true },
    crew: [{ name: "Alice", destination: dest }],
  });

  const router = plugin.lxmf;
  assert.equal(router.sent.length, 0);

  app._onDelta({
    updates: [
      {
        values: [
          {
            path: "notifications.electrical.bilge",
            value: { state: "alarm", message: "Bilge high!" },
          },
        ],
      },
    ],
  });

  // The forwarding is async; let it flush.
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(router.sent.length, 1, "one LXMF message sent to the crew");
  const sent = router.sent[0].message.options;
  assert.deepEqual(sent.destinationHash, Buffer.from(dest, "hex"));
  assert.equal(sent.title, "Signal K: electrical.bilge");
  assert.equal(sent.content, "Bilge high!");
});

test("an emergency is forwarded, but a nominal notification is not", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);
  const dest = "0123456789abcdef0123456789abcdef";

  await plugin.start({
    messaging: { send_alerts: true },
    crew: [{ name: "Alice", destination: dest }],
  });
  const router = plugin.lxmf;

  app._onDelta({
    updates: [
      {
        values: [
          {
            path: "notifications.fire",
            value: { state: "emergency", message: "Fire!" },
          },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(router.sent.length, 1, "emergency forwarded");

  app._onDelta({
    updates: [
      {
        values: [
          {
            path: "notifications.fire",
            value: { state: "nominal", message: "ok" },
          },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(router.sent.length, 1, "nominal clearing not forwarded");
});

test("alerts are not forwarded when send_alerts is disabled", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);

  await plugin.start({
    messaging: { send_alerts: false },
    crew: [{ name: "Alice", destination: "0123456789abcdef0123456789abcdef" }],
  });

  app._onDelta({
    updates: [
      {
        values: [
          {
            path: "notifications.x",
            value: { state: "alarm", message: "x" },
          },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(plugin.lxmf.sent.length, 0);
});

test("stop tears down messaging and the notification subscription", async () => {
  const app = makeApp();
  const plugin = makePlugin(app);
  await plugin.start({ messaging: {} });
  assert.ok(plugin.lxmf);

  await plugin.stop();

  assert.equal(plugin.lxmf, undefined);
  assert.equal(app.subscriptionmanager.unsubscribed, true);
});
