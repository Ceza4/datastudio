/*
  lib/zip.js
  --------------------------------------------------------------------------
  Minimal ZIP writer, no dependencies.

  WHY THIS EXISTS
  .docx and .pptx are not really "document formats" — they're ZIP archives of
  XML parts with a prescribed folder layout (OOXML). To emit a genuine Word or
  PowerPoint file that opens and stays editable, you need a ZIP writer. The
  npm options (jszip, docx, pptxgenjs) are each 200KB–1MB and this is ~90 lines,
  so it isn't worth the dependency or the bundle.

  STORED, NOT DEFLATED
  Entries are written with compression method 0 (stored / uncompressed). Word,
  PowerPoint, Excel, macOS Archive Utility and every unzip implementation read
  stored entries fine — DEFLATE is an optimisation, not a requirement. Staying
  uncompressed keeps this synchronous (no CompressionStream, no async plumbing
  through every export path) and the output is plain text XML that compresses
  away to nothing in transit anyway. A 40-row table exports at roughly 12KB
  instead of 4KB; not worth the complexity.

  ORDER MATTERS
  For OOXML, `[Content_Types].xml` must be the first entry in the archive.
  Callers are responsible for adding it first; addFile preserves insertion
  order.
  -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

const enc = new TextEncoder()

/* MS-DOS date/time, as ZIP has stored timestamps since 1989. */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

export function createZip() {
  const entries = []
  return {
    /** @param {string} path  @param {string|Uint8Array} content */
    addFile(path, content) {
      const data = typeof content === 'string' ? enc.encode(content) : content
      entries.push({ name: path, data, crc: crc32(data) })
      return this
    },
    /** @returns {Blob} */
    toBlob(mime = 'application/zip') {
      const { time, date } = dosDateTime()
      const chunks = []
      const central = []
      let offset = 0

      for (const e of entries) {
        const nameBytes = enc.encode(e.name)

        // ── local file header ──
        const lh = new DataView(new ArrayBuffer(30))
        lh.setUint32(0, 0x04034b50, true)   // signature
        lh.setUint16(4, 20, true)           // version needed
        lh.setUint16(6, 0, true)            // flags
        lh.setUint16(8, 0, true)            // method: stored
        lh.setUint16(10, time, true)
        lh.setUint16(12, date, true)
        lh.setUint32(14, e.crc, true)
        lh.setUint32(18, e.data.length, true)  // compressed size
        lh.setUint32(22, e.data.length, true)  // uncompressed size
        lh.setUint16(26, nameBytes.length, true)
        lh.setUint16(28, 0, true)           // extra field length
        chunks.push(new Uint8Array(lh.buffer), nameBytes, e.data)

        // ── central directory entry (buffered, written after all files) ──
        const cd = new DataView(new ArrayBuffer(46))
        cd.setUint32(0, 0x02014b50, true)
        cd.setUint16(4, 20, true)           // version made by
        cd.setUint16(6, 20, true)           // version needed
        cd.setUint16(8, 0, true)
        cd.setUint16(10, 0, true)
        cd.setUint16(12, time, true)
        cd.setUint16(14, date, true)
        cd.setUint32(16, e.crc, true)
        cd.setUint32(20, e.data.length, true)
        cd.setUint32(24, e.data.length, true)
        cd.setUint16(28, nameBytes.length, true)
        cd.setUint16(30, 0, true)           // extra
        cd.setUint16(32, 0, true)           // comment
        cd.setUint16(34, 0, true)           // disk number
        cd.setUint16(36, 0, true)           // internal attrs
        cd.setUint32(38, 0, true)           // external attrs
        cd.setUint32(42, offset, true)      // offset of local header
        central.push(new Uint8Array(cd.buffer), nameBytes)

        offset += 30 + nameBytes.length + e.data.length
      }

      const centralSize = central.reduce((n, c) => n + c.length, 0)

      // ── end of central directory ──
      const eocd = new DataView(new ArrayBuffer(22))
      eocd.setUint32(0, 0x06054b50, true)
      eocd.setUint16(4, 0, true)
      eocd.setUint16(6, 0, true)
      eocd.setUint16(8, entries.length, true)
      eocd.setUint16(10, entries.length, true)
      eocd.setUint32(12, centralSize, true)
      eocd.setUint32(16, offset, true)
      eocd.setUint16(20, 0, true)

      return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], { type: mime })
    },
  }
}

/** XML-escape a string for use in OOXML text nodes and attributes. */
export function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    /* Strip control characters — XML 1.0 forbids them and Word refuses to
       open a document containing any. Written as escapes rather than literal
       bytes: the literal form made this source a binary file to grep and diff,
       so the regex was invisible to review. Tab, LF and CR are legal XML and
       are deliberately preserved. */
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}
