const test = require("node:test");
const assert = require("node:assert/strict");

const { MsgPack } = require("@reticulum/core");
const makePlugin = require("../plugin/index.js");
const { buildSnapshot, sendTelemetryToCrew } = makePlugin;

/**
 * Builds a fake Signal K app whose `getSelfPath` returns the given path → value
 * map (values may be plain or `{value}` wrapped, matching the real server).
 */
function makeApp(paths = {}) {
  const debugCalls = [];
  const errorCalls = [];
  return {
    debugCalls,
    errorCalls,
    debug(...args) {
      debugCalls.push(args.join(" "));
    },
    error(...args) {
      errorCalls.push(args.join(" "));
    },
    getSelfPath(path) {
      return paths[path];
    },
  };
}

test("buildSnapshot returns null when no Signal K self paths are available", () => {
  assert.equal(buildSnapshot(makeApp()), null);
  assert.equal(buildSnapshot({}), null);
});

test("buildSnapshot packs position into the Sideband location sensor", () => {
  const packed = buildSnapshot(
    makeApp({
      "navigation.position": {
        latitude: 60.175987,
        longitude: -21.094551,
      },
    }),
  );
  assert.ok(packed instanceof Uint8Array);
  const decoded = MsgPack.decode(packed);
  assert.ok(decoded[0x01] != null, "time sensor present");
  assert.ok(Array.isArray(decoded[0x02]), "location sensor present");
});

test("buildSnapshot converts units: SOG m/s -> km/h, COG rad -> deg, SoC 0-1 -> %", () => {
  const packed = buildSnapshot(
    makeApp({
      "navigation.position": { latitude: 1, longitude: 2 },
      "navigation.speedOverGround": { value: 5 }, // 5 m/s -> 18 km/h
      "navigation.courseOverGroundTrue": { value: Math.PI }, // -> 180 deg
      "electrical.batteries.house.capacity.stateOfCharge": {
        value: 0.875,
      }, // -> 87.5 %
    }),
  );
  const decoded = MsgPack.decode(packed);
  const loc = decoded[0x02];
  const view = (bin) =>
    new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  // speed = 18 km/h scaled by 1e2
  assert.equal(view(loc[3]).getUint32(0, false), Math.round(18 * 1e2));
  // bearing = 180 deg scaled by 1e2
  assert.equal(view(loc[4]).getInt32(0, false), Math.round(180 * 1e2));
  // battery [charge_percent, charging, temperature]
  assert.deepEqual(decoded[0x04], [87.5, false, null]);
});

test("buildSnapshot mirrors the NomadNet page readings as custom sensors", () => {
  const packed = buildSnapshot(
    makeApp({
      "environment.depth.belowSurface": { value: 5.25 },
      "environment.tide.heightNow": { value: 1.3 },
      "environment.tide.state": "rising",
      "environment.wind.speedOverGround": { value: 5 }, // ~10 kn
      "environment.wind.directionTrue": { value: 0 },
      "navigation.anchor.distanceFromBow": { value: 12.5 },
      "navigation.state": "anchored",
    }),
  );
  const decoded = MsgPack.decode(packed);
  const custom = decoded[0xff];
  assert.ok(Array.isArray(custom));
  const byLabel = Object.fromEntries(custom.map((e) => [e[0], e[1][0]]));
  assert.equal(byLabel.Depth, "5.3 m");
  assert.equal(byLabel.Tide, "1.3 m, rising");
  assert.equal(byLabel.Wind, "10 kn from 0°");
  assert.equal(byLabel.Anchor, "12.5 m from bow");
  assert.equal(byLabel.State, "anchored");
});

test("sendTelemetryToCrew sends nothing without a deliverer or telemetry", async () => {
  assert.equal(await sendTelemetryToCrew(makeApp(), {}, undefined), 0);
  // No Signal K data -> nothing to send even with a deliverer and crew.
  const calls = [];
  const deliver = async () => {
    calls.push(1);
  };
  assert.equal(
    await sendTelemetryToCrew(
      makeApp(),
      {
        crew: [{ name: "A", destination: "a".repeat(32) }],
      },
      deliver,
    ),
    0,
  );
  assert.equal(calls.length, 0);
});

test("sendTelemetryToCrew delivers one packed snapshot per crew member", async () => {
  const app = makeApp({
    "navigation.position": { latitude: 1, longitude: 2 },
  });
  const seen = [];
  const deliver = async (dest, packed) => {
    seen.push({ dest, packed });
  };
  const settings = {
    crew: [
      { name: "Alice", destination: "11".repeat(16) },
      { name: "Bob", destination: "22".repeat(16) },
    ],
  };

  const sent = await sendTelemetryToCrew(app, settings, deliver);

  assert.equal(sent, 2);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((s) => s.dest),
    ["11".repeat(16), "22".repeat(16)],
  );
  // Same packed snapshot sent to each, and it decodes with integer SID keys.
  assert.ok(seen[0].packed instanceof Uint8Array);
  assert.ok(MsgPack.decode(seen[0].packed)[0x02], "location present");
  assert.equal(seen[0].packed, seen[1].packed, "snapshot reused");
});

test("sendTelemetryToCrew logs and continues when a recipient fails", async () => {
  const app = makeApp({
    "navigation.position": { latitude: 1, longitude: 2 },
  });
  const deliver = async (dest) => {
    if (dest.startsWith("11")) {
      throw new Error("identity unknown");
    }
  };
  const settings = {
    crew: [
      { name: "Alice", destination: "11".repeat(16) },
      { name: "Bob", destination: "22".repeat(16) },
    ],
  };

  const sent = await sendTelemetryToCrew(app, settings, deliver);
  assert.equal(sent, 1, "Bob still received the snapshot");
  assert.ok(
    app.errorCalls.some((m) => /Failed to send telemetry to Alice/.test(m)),
    "Alice's failure was logged",
  );
});

test("sendTelemetryToCrew skips invalid crew entries", async () => {
  const app = makeApp({
    "navigation.position": { latitude: 1, longitude: 2 },
  });
  const deliver = async () => {};
  const settings = {
    crew: [
      { name: "Bad", destination: "not-a-hash" },
      { name: "Bob", destination: "22".repeat(16) },
    ],
  };
  const sent = await sendTelemetryToCrew(app, settings, deliver);
  assert.equal(sent, 1);
});
