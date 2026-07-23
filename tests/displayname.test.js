const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveDisplayName, FALLBACK_NAME } = require("../plugin/displayname");

test("an explicitly configured name always wins", () => {
  assert.equal(
    resolveDisplayName({
      configured: "Custom",
      vesselName: "S/Y Bergie",
      callsign: "OH8XYZ",
    }),
    "Custom",
  );
});

test("empty configured falls back to the vessel name", () => {
  // This is the case the old schema default ("Signal K") silently broke: a
  // non-empty default was treated as an explicit override, so the vessel name
  // was never announced.
  assert.equal(
    resolveDisplayName({ configured: "", vesselName: "S/Y Bergie" }),
    "S/Y Bergie",
  );
  assert.equal(
    resolveDisplayName({ configured: undefined, vesselName: "S/Y Bergie" }),
    "S/Y Bergie",
  );
  assert.equal(
    resolveDisplayName({ configured: "   ", vesselName: "S/Y Bergie" }),
    "S/Y Bergie",
  );
});

test("vessel name and callsign combine into the marine-radio form", () => {
  assert.equal(
    resolveDisplayName({
      vesselName: "S/Y Bergie",
      callsign: "OH8XYZ",
    }),
    "S/Y Bergie DE OH8XYZ",
  );
});

test("callsign alone is used when no vessel name is set", () => {
  assert.equal(resolveDisplayName({ callsign: "OH8XYZ" }), "OH8XYZ");
});

test("a {value} wrapped vessel name is unwrapped", () => {
  assert.equal(resolveDisplayName({ vesselName: { value: "Boat" } }), "Boat");
});

test("the last-resort fallback is never empty", () => {
  assert.equal(resolveDisplayName({}), FALLBACK_NAME);
  assert.equal(resolveDisplayName(), FALLBACK_NAME);
  assert.equal(FALLBACK_NAME.length > 0, true);
});
