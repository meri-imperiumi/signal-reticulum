const test = require("node:test");
const assert = require("node:assert/strict");

const { Identity, toHex } = require("reticulum-js");
const {
  resolveIdentity,
  normalizeHex,
  parseHexKey,
  PRIVATE_KEY_BYTES,
  PUBLIC_KEY_BYTES,
} = require("../plugin/identity");

test("resolveIdentity generates a new identity when no private key is configured", async () => {
  const resolved = await resolveIdentity(undefined);

  assert.equal(resolved.changed, true);
  assert.ok(resolved.identity instanceof Identity);
  // Public key is 64 bytes (128 hex chars); private key 128 bytes (256 hex chars).
  assert.equal(resolved.publicKeyHex.length, PUBLIC_KEY_BYTES * 2);
  assert.equal(resolved.privateKeyHex.length, PRIVATE_KEY_BYTES * 2);
  // identityHash is the 16-byte truncated hash (32 hex chars).
  assert.equal(resolved.identity.identityHash.length, 16);
  assert.equal(toHex(resolved.identity.identityHash).length, 32);
  // The derived public key matches the identity.
  assert.equal(
    resolved.publicKeyHex,
    toHex(await resolved.identity.getPublicKey()),
  );
});

test("resolveIdentity loads an identity from a configured private key unchanged", async () => {
  const source = await Identity.generate();
  const privateKeyHex = toHex(await source.getPrivateKey());
  const publicKeyHex = toHex(await source.getPublicKey());

  const resolved = await resolveIdentity({
    privateKey: privateKeyHex,
    publicKey: publicKeyHex,
  });

  assert.equal(resolved.changed, false);
  assert.equal(
    toHex(resolved.identity.identityHash),
    toHex(source.identityHash),
  );
  assert.equal(resolved.privateKeyHex, privateKeyHex);
  assert.equal(resolved.publicKeyHex, publicKeyHex);
});

test("resolveIdentity reuses a configured private key even without a stored public key", async () => {
  const source = await Identity.generate();
  const privateKeyHex = toHex(await source.getPrivateKey());

  const resolved = await resolveIdentity({ privateKey: privateKeyHex });

  // changed because the derived public key is not yet stored.
  assert.equal(resolved.changed, true);
  assert.equal(resolved.privateKeyHex, privateKeyHex);
  assert.equal(
    toHex(resolved.identity.identityHash),
    toHex(source.identityHash),
  );
});

test("resolveIdentity tolerates whitespace and dashes in the configured private key", async () => {
  const source = await Identity.generate();
  const privateKeyHex = toHex(await source.getPrivateKey());
  const spaced = privateKeyHex.match(/.{1,32}/g).join("  ");

  const resolved = await resolveIdentity({
    privateKey: spaced,
    publicKey: toHex(await source.getPublicKey()),
  });

  assert.equal(resolved.changed, false);
  assert.equal(resolved.privateKeyHex, privateKeyHex);
});

test("resolveIdentity rejects a private key of the wrong length", async () => {
  await assert.rejects(
    () => resolveIdentity({ privateKey: "abcd" }),
    /Private key must be 256 hex characters/,
  );
});

test("resolveIdentity rejects a non-hexadecimal private key", async () => {
  const bad = "zz".repeat(PRIVATE_KEY_BYTES);
  await assert.rejects(
    () => resolveIdentity({ privateKey: bad }),
    /Private key is not valid hexadecimal/,
  );
});

test("normalizeHex lower-cases and strips whitespace and dashes", () => {
  assert.equal(normalizeHex("  AB-CD ef\n"), "abcdef");
  assert.equal(normalizeHex(undefined), "");
  assert.equal(normalizeHex(123), "");
});

test("parseHexKey enforces the expected byte length", () => {
  assert.throws(
    () => parseHexKey("aa", PUBLIC_KEY_BYTES, "Public key"),
    /Public key must be 128 hex characters/,
  );
  // Valid case returns the decoded bytes.
  const ok = "ab".repeat(PUBLIC_KEY_BYTES);
  const bytes = parseHexKey(ok, PUBLIC_KEY_BYTES, "Public key");
  assert.equal(bytes.length, PUBLIC_KEY_BYTES);
});
