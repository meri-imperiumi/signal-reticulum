const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIELD_ICON_APPEARANCE,
  SAIL_ICON,
  MOTOR_ICON,
  AIS_SAILING,
  DEFAULT_FG,
  DEFAULT_BG,
  readInt,
  resolveIcon,
  parseHexColor,
  toRgb,
  resolveColors,
  resolveAppearance,
  buildAppearanceFields,
  withAppearance,
} = require("../plugin/appearance");

test("FIELD_ICON_APPEARANCE matches the LXMF spec constant 0x04", () => {
  assert.equal(FIELD_ICON_APPEARANCE, 0x04);
});

test("readInt unwraps Signal K {value} and aisShipType {id,name} wrappers", () => {
  assert.equal(readInt(36), 36);
  assert.equal(readInt("37"), 37);
  assert.equal(readInt({ id: 36, name: "Sailing" }), 36);
  // A real Signal K self-path read arrives as {value: {id, name}}.
  assert.equal(readInt({ value: { id: 36, name: "Sailing" } }), 36);
  assert.equal(readInt({ value: 37 }), 37);
  assert.equal(readInt(undefined), null);
  assert.equal(readInt("not-a-number"), null);
  assert.equal(readInt({}), null);
});

test("resolveIcon: an explicit icon always wins", () => {
  assert.equal(resolveIcon({ configured: "anchor" }), "anchor");
  // Whitespace-only is treated as empty.
  assert.equal(resolveIcon({ configured: "   " }), SAIL_ICON);
  assert.equal(resolveIcon({ configured: { value: "ferry" } }), "ferry");
});

test("resolveIcon: AIS sailing type (36) yields the sail-boat icon", () => {
  assert.equal(resolveIcon({ aisShipType: AIS_SAILING }), SAIL_ICON);
  assert.equal(
    resolveIcon({ aisShipType: { value: { id: 36, name: "Sailing" } } }),
    SAIL_ICON,
  );
});

test("resolveIcon: any other known AIS type yields the ferry (motor) icon", () => {
  // 37 = Pleasure craft, 70 = Cargo, 60 = Passenger — all motor-ish.
  assert.equal(resolveIcon({ aisShipType: 37 }), MOTOR_ICON);
  assert.equal(resolveIcon({ aisShipType: 70 }), MOTOR_ICON);
  assert.equal(resolveIcon({ aisShipType: { id: 60 } }), MOTOR_ICON);
});

test("resolveIcon: unknown vessel type defaults to the sail-boat icon", () => {
  // No AIS ship type configured -> sailing-project default.
  assert.equal(resolveIcon({}), SAIL_ICON);
  assert.equal(resolveIcon({ aisShipType: undefined }), SAIL_ICON);
  assert.equal(resolveIcon({ aisShipType: null }), SAIL_ICON);
});

test("resolveIcon prefers an explicit icon over the AIS-derived one", () => {
  assert.equal(
    resolveIcon({ configured: "sail-boat", aisShipType: 70 }),
    "sail-boat",
  );
});

test("parseHexColor accepts #rrggbb, #rgb and bare hex", () => {
  assert.deepEqual(parseHexColor("#1a237e"), [26, 35, 126]);
  assert.deepEqual(parseHexColor("#fff"), [255, 255, 255]);
  assert.deepEqual(parseHexColor("000000"), [0, 0, 0]);
  assert.deepEqual(parseHexColor("#0f0"), [0, 255, 0]);
  assert.equal(parseHexColor("#xyz"), null);
  assert.equal(parseHexColor("12345"), null);
  assert.equal(parseHexColor(123), null);
});

test("toRgb accepts [r,g,b] arrays (clamped) and hex strings", () => {
  assert.deepEqual(toRgb([10, 20, 30]), [10, 20, 30]);
  assert.deepEqual(toRgb([300, -5, 128]), [255, 0, 128]);
  assert.deepEqual(toRgb("#1a237e"), [26, 35, 126]);
  assert.equal(toRgb("nope"), null);
});

test("resolveColors falls back to defaults for absent/invalid colors", () => {
  assert.deepEqual(resolveColors({}), { fg: DEFAULT_FG, bg: DEFAULT_BG });
  assert.deepEqual(resolveColors({ fg: "#fff", bg: "#1a237e" }), {
    fg: [255, 255, 255],
    bg: [26, 35, 126],
  });
  // A bad fg keeps the default but a good bg is still applied.
  assert.deepEqual(resolveColors({ fg: "nope", bg: "#000" }), {
    fg: DEFAULT_FG,
    bg: [0, 0, 0],
  });
});

test("resolveAppearance combines icon + colors end to end", () => {
  const a = resolveAppearance({
    icon: "",
    fgColor: "#ffffff",
    bgColor: "#1a237e",
    aisShipType: { value: { id: 36, name: "Sailing" } },
  });
  assert.deepEqual(a, {
    icon: SAIL_ICON,
    fg: [255, 255, 255],
    bg: [26, 35, 126],
  });

  const b = resolveAppearance({ aisShipType: 70 });
  assert.equal(b.icon, MOTOR_ICON);
  assert.deepEqual(b.fg, DEFAULT_FG);
  assert.deepEqual(b.bg, DEFAULT_BG);
});

test("buildAppearanceFields emits the Sideband wire shape [str, bin, bin]", () => {
  const fields = buildAppearanceFields({
    icon: "sail-boat",
    fg: [0, 0, 0],
    bg: [255, 255, 255],
  });
  assert.ok(fields instanceof Map);
  assert.deepEqual([...fields.keys()], [0x04]);
  const value = fields.get(0x04);
  assert.ok(Array.isArray(value), "appearance value is a 3-element array");
  assert.equal(value[0], "sail-boat", "icon is a plain string");
  // Colors MUST be Uint8Array so msgpack writes them as `bin`, matching
  // Sideband's struct.pack("!BBB") — an array of ints would be dropped.
  assert.ok(value[1] instanceof Uint8Array, "fg is a byte string");
  assert.ok(value[2] instanceof Uint8Array, "bg is a byte string");
  assert.equal(value[1].length, 3);
  assert.equal(value[2].length, 3);
  assert.deepEqual(Array.from(value[1]), [0, 0, 0]);
  assert.deepEqual(Array.from(value[2]), [255, 255, 255]);
});

test("buildAppearanceFields honours an injected field id (for tests)", () => {
  const fields = buildAppearanceFields(
    { icon: "x", fg: [1, 2, 3], bg: [4, 5, 6] },
    0x99,
  );
  assert.ok(fields.has(0x99));
});

test("withAppearance merges appearance into an existing fields Map", () => {
  const telemetry = new Uint8Array([1, 2, 3]);
  const base = new Map([[0x02, telemetry]]);
  const merged = withAppearance(base, {
    icon: "ferry",
    fg: [0, 0, 0],
    bg: [255, 255, 255],
  });
  // A fresh Map is returned; the original base is untouched.
  assert.notEqual(merged, base);
  assert.equal(base.size, 1, "base map is not mutated");
  assert.equal(merged.get(0x02), telemetry, "telemetry field preserved");
  assert.ok(merged.has(0x04), "appearance field added");
  assert.equal(merged.get(0x04)[0], "ferry");
});

test("withAppearance returns the base unchanged when there is no appearance", () => {
  const base = new Map([[0x02, new Uint8Array([1])]]);
  assert.equal(withAppearance(base, undefined), base);
  assert.equal(withAppearance(base, null), base);
  // An appearance without an icon is treated as "no appearance".
  assert.equal(withAppearance(base, { fg: [1, 2, 3] }), base);
});

test("withAppearance builds from a null base", () => {
  const fromNothing = withAppearance(null, {
    icon: "anchor",
    fg: [0, 0, 0],
    bg: [0, 0, 0],
  });
  assert.ok(fromNothing instanceof Map);
  assert.equal(fromNothing.get(0x04)[0], "anchor");
});
