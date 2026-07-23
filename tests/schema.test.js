const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPluginSchema,
  wrapInterfaceSchema,
  TYPE_DISCRIMINATOR,
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

test("buildPluginSchema returns a draft-07 object schema with the interfaces group", () => {
  const schema = buildPluginSchema([]);

  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(schema.type, "object");
  assert.equal(schema.title, "Signal K Reticulum");
  assert.deepEqual(Object.keys(schema.properties), [
    "use_shared_instance",
    "interfaces",
    "identity",
    "messaging",
    "crew",
    "nomadnet",
  ]);
  assert.equal(schema.properties.interfaces.type, "array");
  assert.equal(schema.properties.interfaces.items.oneOf.length, 0);
});

test("buildPluginSchema creates one oneOf branch per provided interface", () => {
  const entries = [
    makeEntry({ id: "a", name: "A" }),
    makeEntry({ id: "b", name: "B" }),
  ];
  const items = buildPluginSchema(entries).properties.interfaces.items;

  assert.equal(items.oneOf.length, 2);
});

test("the interfaces group defaults to AutoInterface", () => {
  const schema = buildPluginSchema([makeEntry()]);
  assert.deepEqual(schema.properties.interfaces.default, [{ type: "auto" }]);
});

test("wrapInterfaceSchema adds a type discriminator set to the registry id", () => {
  const wrapped = wrapInterfaceSchema(makeEntry({ id: "tcp-client" }));

  const disc = wrapped.properties[TYPE_DISCRIMINATOR];
  assert.equal(disc.type, "string");
  assert.equal(disc.const, "tcp-client");
  assert.equal(disc.default, "tcp-client");
});

test("wrapInterfaceSchema puts type first in required and keeps the interface required fields", () => {
  const wrapped = wrapInterfaceSchema(makeEntry({ id: "fake" }));

  assert.equal(wrapped.required[0], TYPE_DISCRIMINATOR);
  assert.deepEqual(wrapped.required, ["type", "host"]);
});

test("wrapInterfaceSchema preserves the interface's own properties", () => {
  const wrapped = wrapInterfaceSchema(makeEntry());

  assert.ok("name" in wrapped.properties);
  assert.ok("host" in wrapped.properties);
});

test("wrapInterfaceSchema preserves additionalProperties:false from strict schemas", () => {
  const wrapped = wrapInterfaceSchema(makeEntry());
  assert.equal(wrapped.additionalProperties, false);
});

test("wrapInterfaceSchema omits additionalProperties when the source omits it", () => {
  const schema = { type: "object", properties: { host: { type: "string" } } };
  const wrapped = wrapInterfaceSchema({ id: "loose", name: "Loose", schema });
  assert.equal("additionalProperties" in wrapped, false);
});

test("wrapInterfaceSchema keeps the interface title and description", () => {
  const wrapped = wrapInterfaceSchema(makeEntry({ name: "My Iface" }));
  assert.equal(wrapped.title, "My Iface");
  assert.equal(wrapped.description, "A fake interface for testing.");
});

test("wrapInterfaceSchema does not duplicate type when an interface already lists it as required", () => {
  const entry = makeEntry({
    id: "fake",
    schema: {
      type: "object",
      properties: { host: { type: "string" } },
      required: ["type", "host"],
    },
  });
  const wrapped = wrapInterfaceSchema(entry);
  assert.deepEqual(wrapped.required, ["type", "host"]);
});
