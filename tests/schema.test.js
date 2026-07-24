const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPluginSchema,
  buildInterfaceArray,
  buildInterfaceArrays,
  configKeyFor,
  EXCLUDED_INTERFACE_IDS,
} = require("../plugin/schema");

/**
 * @param {Partial<{id:string,name:string,schema:object}>} [overrides]
 * @returns {{id:string,name:string,schema:object}}
 */
function makeEntry(overrides = {}) {
  return {
    id: "fake",
    name: "Fake Interface",
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      title: "Fake Interface",
      description: "A fake interface for testing.",
      properties: {
        name: { type: "string" },
        host: { type: "string" },
      },
      required: ["host"],
      additionalProperties: false,
    },
    ...overrides,
  };
}

test("configKeyFor pluralises client/server ids and suffixes the rest", () => {
  assert.equal(configKeyFor("tcp-client"), "tcp_clients");
  assert.equal(configKeyFor("tcp-server"), "tcp_servers");
  assert.equal(configKeyFor("http-client"), "http_clients");
  assert.equal(configKeyFor("local-client"), "local_clients");
  assert.equal(configKeyFor("ws-client"), "ws_clients");
  assert.equal(configKeyFor("auto"), "auto_interfaces");
  assert.equal(configKeyFor("webrtc"), "webrtc_interfaces");
});

test("EXCLUDED_INTERFACE_IDS hides the browser-only WebRTC interface", () => {
  assert.ok(EXCLUDED_INTERFACE_IDS.includes("webrtc"));
});

test("buildInterfaceArray wraps one type's options as a plain instance array", () => {
  const array = buildInterfaceArray(makeEntry({ name: "Fake Interface" }));

  assert.equal(array.type, "array");
  // The array title is the interface name pluralised.
  assert.equal(array.title, "Fake Interfaces");
  assert.equal(array.items.type, "object");
  assert.equal(array.items.title, "Fake Interface");
  assert.equal(array.items.description, "A fake interface for testing.");
  assert.equal(array.items.additionalProperties, false);
  assert.deepEqual(array.items.required, ["host"]);
  assert.ok("host" in array.items.properties);
  assert.ok("name" in array.items.properties);
});

test("buildInterfaceArray appends -es when the interface name ends in s", () => {
  const array = buildInterfaceArray(makeEntry({ name: "Bus" }));
  assert.equal(array.title, "Buses");
});

test("buildInterfaceArray omits items.description when the schema has none", () => {
  const array = buildInterfaceArray({
    id: "bare",
    name: "Bare",
    schema: { properties: {}, required: [] },
  });
  assert.equal("description" in array.items, false);
});

test("buildInterfaceArray omits items.additionalProperties when the schema has none", () => {
  const array = buildInterfaceArray({
    id: "loose",
    name: "Loose",
    schema: { properties: { host: { type: "string" } } },
  });
  assert.equal("additionalProperties" in array.items, false);
});

test("buildInterfaceArrays exposes one array per interface except the excluded ones", () => {
  const arrays = buildInterfaceArrays([
    makeEntry({ id: "auto", name: "AutoInterface" }),
    makeEntry({ id: "tcp-client", name: "TCP Client Interface" }),
    makeEntry({ id: "webrtc", name: "WebRTC Interface" }),
  ]);

  assert.deepEqual(Object.keys(arrays).sort(), [
    "auto_interfaces",
    "tcp_clients",
  ]);
  assert.ok(!("webrtc_interfaces" in arrays));
});

test("buildPluginSchema returns a draft-07 object schema", () => {
  const schema = buildPluginSchema([]);

  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(schema.type, "object");
  assert.equal(schema.title, "Signal K Reticulum");
});

test("buildPluginSchema places one instance array per non-excluded interface between use_shared_instance and identity", () => {
  const entries = [
    makeEntry({ id: "auto", name: "AutoInterface" }),
    makeEntry({ id: "tcp-client", name: "TCP Client Interface" }),
    makeEntry({ id: "webrtc", name: "WebRTC Interface" }),
  ];
  const schema = buildPluginSchema(entries);
  const keys = Object.keys(schema.properties);

  // Non-interface groups bookend the interface arrays.
  assert.equal(keys[0], "log_level");
  assert.equal(keys[1], "use_shared_instance");
  assert.equal(keys[keys.length - 1], "telemetry");

  // The interface arrays land between use_shared_instance and identity, in
  // registry order, excluding WebRTC.
  const ifaceKeys = keys.slice(2, keys.indexOf("identity"));
  assert.deepEqual(ifaceKeys, ["auto_interfaces", "tcp_clients"]);

  // Each array carries its interface's required fields.
  assert.deepEqual(
    schema.properties.tcp_clients.items.required,
    entries[1].schema.required,
  );
});

test("buildPluginSchema never exposes a WebRTC config array", () => {
  const schema = buildPluginSchema([makeEntry({ id: "webrtc" })]);
  assert.ok(!("webrtc_interfaces" in schema.properties));
});
