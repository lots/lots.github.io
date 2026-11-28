// Browser shim for the Node-only optional dependencies of @sabaki/sgf.
// Only sgf.parse()/stringify() are used in the renderer; parseFile/parseBuffer
// encoding detection are not available.
module.exports = {
  encodingExists: () => true,
  decode: (buffer) => buffer.toString(),
  encode: (value) => value,
  detect: () => ({ encoding: 'UTF-8' }),
}
