/**
 * Wires `@digitaldefiance/bzip2-wasm` as the Reticulum `compressionProvider`.
 *
 * The Reticulum Resource layer (PROTOCOL-SPEC.md §10.2) calls
 * `bz2.compress(plaintext)` and `bz2.decompress(body, uncompressedSize)` for
 * optional compression of large link transfers — LXMF direct messages, NomadNet
 * pages and propagation containers. `@digitaldefiance/bzip2-wasm` exposes
 * `compress(data, blockSize, outLen)` and `decompress(data, outLen)` after an
 * asynchronous `init()`.
 *
 * bzip2's worst-case expansion (incompressible input) overflows the module's
 * default output buffer and throws `BZ_OUTBUFF_FULL`, so {@link createBz2Provider}
 * sizes the compress destination buffer generously. Reticulum only keeps the
 * compressed form when it is actually smaller, so the over-allocation never
 * reaches the wire.
 *
 * The BZip2 class is exposed through {@link deps} (defaulting to the required
 * module) so this module can be unit-tested with a fake instead of loading WASM.
 *
 * @file compression.js
 */

const { default: BZip2 } = require("@digitaldefiance/bzip2-wasm");

/** Injected bzip2 implementation; tests swap this for a fake. */
const deps = {
  BZip2,
};

/** bzip2 block size passed to compress (5 ⇒ 900 KB blocks, the bzip2 default). */
const BLOCK_SIZE = 5;

/**
 * Sizes the compress output buffer to absorb bzip2's worst-case expansion for
 * incompressible input (≈ 1 % plus a small fixed overhead). Reticulum discards
 * the compressed form whenever it isn't smaller, so over-allocating is harmless.
 *
 * @param {number} inputLen
 * @returns {number}
 */
function compressBufferSize(inputLen) {
  return inputLen + Math.ceil(inputLen / 100) + 600;
}

/**
 * Builds and initialises a Reticulum compressionProvider backed by bzip2-wasm.
 *
 * @param {(...args:any[])=>void} [log]
 * @returns {Promise<{compress:(data:Uint8Array)=>Uint8Array, decompress:(data:Uint8Array,size:number)=>Uint8Array}>}
 */
async function createBz2Provider(log = () => {}) {
  const impl = new deps.BZip2();
  await impl.init();
  log("bzip2 compression provider ready");
  return {
    /**
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    compress(data) {
      return impl.compress(data, BLOCK_SIZE, compressBufferSize(data.length));
    },
    /**
     * @param {Uint8Array} data
     * @param {number} size
     * @returns {Uint8Array}
     */
    decompress(data, size) {
      return impl.decompress(data, size);
    },
  };
}

module.exports = {
  deps,
  BLOCK_SIZE,
  compressBufferSize,
  createBz2Provider,
};
