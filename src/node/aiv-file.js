const fs = require('fs');
const path = require('path');

function binaryBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Buffer.from(value);
  return null;
}

function transferableBytes(value) {
  const buffer = binaryBuffer(value);
  return buffer ? Uint8Array.from(buffer) : null;
}

function sourceForSave(sourceBytes, sourcePath) {
  const cached = binaryBuffer(sourceBytes);
  if (cached?.byteLength) return { bytes: cached, origin: 'memory' };

  if (sourcePath && path.extname(sourcePath).toLowerCase() === '.aiv') {
    try {
      const bytes = fs.readFileSync(sourcePath);
      if (bytes.byteLength) return { bytes, origin: 'file' };
    } catch (_) {
      // The opened file may have been moved, deleted, or become unavailable.
      // A fresh native AIV can still be built from the editor document below.
    }
  }

  return { bytes: null, origin: null };
}

function writeNativeAiv({
  codec,
  document,
  destination,
  templates,
  atomicWriteFile,
  sourcePath = null,
  sourceBytes = null,
  unchanged = false
}) {
  if (!codec?.encodeAiv) throw new Error('The native AIV encoder is unavailable.');
  if (typeof atomicWriteFile !== 'function') throw new Error('The AIV file writer is unavailable.');

  const resolvedDestination = path.resolve(destination);
  const source = sourceForSave(sourceBytes, sourcePath);
  const encoded = source.bytes && unchanged
    ? Uint8Array.from(source.bytes)
    : codec.encodeAiv(document, templates, { source: source.bytes });

  if (!encoded?.byteLength) throw new Error('The native AIV encoder returned no binary data.');
  const output = Buffer.from(encoded);
  atomicWriteFile(resolvedDestination, output);
  return {
    path: resolvedDestination,
    native: true,
    preservedSource: Boolean(source.bytes),
    sourceOrigin: source.origin,
    sourceBytes: transferableBytes(output)
  };
}

module.exports = {
  binaryBuffer,
  transferableBytes,
  sourceForSave,
  writeNativeAiv
};
