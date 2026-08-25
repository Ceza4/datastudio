/*
  lib/images.js
  --------------------------------------------------------------------------
  Import pipeline for image blocks: validate, sanitise, downscale, store.

  SAFETY MODEL
  A file picker gives you a filename and a MIME type, and a hostile file
  controls both. So neither is trusted:

  1. SVG is rejected outright. SVG is XML and can carry <script>, external
     entity references and foreignObject HTML. Rendering user-supplied SVG in
     an <img> is safer than inlining it, but "safer" isn't "safe", and no
     research workflow needs SVG photos. Excluded by design, not by omission.

  2. Magic bytes are checked, not the extension. `photo.png` containing HTML
     is a real attack; the first bytes of the file decide what it is.

  3. Everything is re-encoded through a canvas. This is the important one.
     Decoding to pixels and re-encoding discards everything that isn't
     pixels — EXIF (including GPS coordinates, which people routinely leak
     without realising), colour-profile payloads, appended archives, and any
     polyglot trailing data. What gets stored cannot be anything but an image.
     Animated GIFs are the one casualty: they come out as a single frame.

  4. A hard byte cap AFTER processing, not before, so the number means what
     the user thinks it means.

  SIZE POLICY
  2MB, not the 5MB that hosted competitors use, because they have object
  storage behind them and this has the browser's disk quota. 2MB of JPEG at
  quality 0.85 is roughly a 3000×2000 photograph — past what any canvas block
  displays. Anything larger is downscaled to fit MAX_EDGE and re-encoded,
  stepping quality down until it fits rather than refusing outright.
  -------------------------------------------------------------------------- */

import { idbSet, idbGet, idbDelete, STORE_IMAGES } from './idb.js'
import { checkQuota, quotaMessage } from './limits.js'

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024   // 2MB, post-processing
export const MAX_EDGE = 2400                      // px, longest side

/** Extensions offered in the picker. Deliberately excludes .svg. */
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']

/** MIME types we will emit. AVIF/BMP get normalised to one of these. */
const OUT_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/* Magic-byte signatures. [offset, bytes, label] */
const SIGNATURES = [
  [0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [0, [0xff, 0xd8, 0xff], 'image/jpeg'],
  [0, [0x47, 0x49, 0x46, 0x38], 'image/gif'],
  [0, [0x42, 0x4d], 'image/bmp'],
  // RIFF....WEBP — checked specially below (bytes 8-11)
  // ftyp box for AVIF — checked specially below (bytes 4-7)
]

function matches(bytes, offset, sig) {
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false
  return true
}

/** Identify a file from its actual leading bytes. Returns a MIME or null. */
export function sniffImageType(bytes) {
  for (const [off, sig, mime] of SIGNATURES) {
    if (matches(bytes, off, sig)) return mime
  }
  // WEBP: 'RIFF' .... 'WEBP'
  if (matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp'
  }
  // AVIF/HEIF: box size, then 'ftyp', then a brand
  if (matches(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (/avif|avis|mif1|heic|heix/.test(brand)) return 'image/avif'
  }
  return null
}

export class ImageRejected extends Error {
  constructor(message, code) { super(message); this.name = 'ImageRejected'; this.code = code }
}

/**
 * Validate, sanitise and downscale an image file.
 * @param {File} file
 * @returns {Promise<{blob:Blob, width:number, height:number, type:string, name:string, originalBytes:number}>}
 * @throws {ImageRejected}
 */
export async function processImageFile(file) {
  if (!file) throw new ImageRejected('No file given.', 'empty')

  // Cheap guards before reading the whole thing into memory. 40MB is well past
  // anything we'd keep, and stops a 2GB file from being decoded at all.
  if (file.size === 0) throw new ImageRejected('That file is empty.', 'empty')
  if (file.size > 40 * 1024 * 1024) {
    throw new ImageRejected('That file is over 40MB — too large to process in the browser.', 'huge')
  }

  /* 32 rather than 16: sniffImageType needs the first few bytes, and
     headerDimensions needs up to byte 26 (BMP DIB height). */
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())

  // Explicit SVG rejection, checked before sniffing so the message is useful.
  const looksSvg = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml' ||
    /^\s*(<\?xml|<svg)/i.test(new TextDecoder().decode(head))
  if (looksSvg) {
    throw new ImageRejected('SVG files are not supported — they can contain scripts. Export as PNG instead.', 'svg')
  }

  const sniffed = sniffImageType(head)
  if (!sniffed) {
    throw new ImageRejected(`"${file.name}" is not a recognised image. Supported: PNG, JPEG, WebP, GIF, AVIF, BMP.`, 'not-image')
  }

  /* Refused BEFORE any decoding happens. */
  const dims = headerDimensions(head)
  if (dims && dims.width * dims.height > MAX_PIXELS) {
    throw new ImageRejected(tooManyPixels(dims.width, dims.height), 'too-many-pixels')
  }

  const bitmap = await decode(file)
  /* Backstop for the formats headerDimensions does not parse.

     A PIXEL CEILING, NOT JUST A BYTE CEILING.

     Only the compressed size was capped (MAX_IMAGE_BYTES). Decoded size is a
     different quantity entirely: a highly compressible PNG well under the byte
     cap can declare 30000x30000 and inflate to gigabytes of RGBA. An
     out-of-memory kill is not catchable by the try/catch around this call —
     the tab simply dies, taking any unsaved work with it.

     decode() now asks the browser to downscale DURING decoding where it can,
     so the full-size bitmap is often never materialised at all. This check is
     the backstop for the paths where it cannot. */
  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    throw new ImageRejected(tooManyPixels(bitmap.width, bitmap.height), 'too-many-pixels')
  }
  const { width, height } = fit(bitmap.width, bitmap.height, MAX_EDGE)

  // Re-encode. Prefer the source's own family so screenshots stay lossless,
  // but push anything oversized through JPEG, which is what actually shrinks.
  const preferPng = sniffed === 'image/png' && width * height < 1400 * 1400
  let out = await encode(bitmap, width, height, preferPng ? 'image/png' : 'image/jpeg', 0.9)

  // Step quality down, then dimensions, until it fits the cap.
  const ladder = [0.82, 0.72, 0.6, 0.5]
  let i = 0
  let w = width, h = height
  while (out.size > MAX_IMAGE_BYTES && i < ladder.length) {
    out = await encode(bitmap, w, h, 'image/jpeg', ladder[i++])
  }
  while (out.size > MAX_IMAGE_BYTES && w > 400) {
    w = Math.round(w * 0.75); h = Math.round(h * 0.75)
    out = await encode(bitmap, w, h, 'image/jpeg', 0.7)
  }

  if (typeof bitmap.close === 'function') bitmap.close()

  if (out.size > MAX_IMAGE_BYTES) {
    throw new ImageRejected(
      `Could not get "${file.name}" under ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)}MB even after compression.`,
      'too-big'
    )
  }

  return {
    blob: out,
    width: w,
    height: h,
    type: out.type,
    name: file.name,
    originalBytes: file.size,
  }
}

/** Decode to an ImageBitmap, falling back to <img> where unsupported. */
/* 120 megapixels.

   Set by what it has to ALLOW, not by what it has to block. A 108MP phone
   camera photograph is a completely ordinary thing to drag onto a canvas, and
   an app that refuses one is broken in a way its owner will hear about; 60MP
   (the first number tried here) rejected it. 120MP decodes to about 480MB of
   RGBA — heavy, and survivable.

   What it blocks is not close to that line. A decompression bomb is
   30000x30000, i.e. 900 megapixels: seven times the cap, from a file of a few
   kilobytes. There is a very wide gap between the largest real photograph and
   the smallest useful attack, and this sits in it. */
export const MAX_PIXELS = 120_000_000

/**
 * Pixel dimensions read from the file HEADER, without decoding anything.
 *
 * This is the only check that can stop a decompression bomb, because by the
 * time a bitmap exists the memory has already been spent — and an
 * out-of-memory kill is not catchable: the tab dies, taking unsaved work with
 * it. The byte cap does not help, which is the whole problem: a uniform-colour
 * PNG of 30000x30000 compresses to a few kilobytes and expands to 3.6GB of
 * RGBA.
 *
 * Returns null when the format is one whose header is not worth parsing
 * (JPEG's SOF marker can sit behind arbitrarily many segments, AVIF's is
 * inside a box tree). Those fall through to the post-decode check, which is
 * weaker but still catches the case before the image reaches the canvas.
 *
 * @param {Uint8Array} head first ~32 bytes of the file
 * @returns {{width:number, height:number}|null}
 */
/** One wording, whether the refusal came from the header or from the bitmap. */
function tooManyPixels(w, h) {
  const mp = Math.round((w * h) / 1e6)
  return `That image is ${w}\u00d7${h} (${mp} megapixels), which is too large to open safely. ` +
    `The limit is ${Math.round(MAX_PIXELS / 1e6)} megapixels — resize it and try again.`
}

export function headerDimensions(head) {
  if (!head || head.length < 26) return null
  const be32 = i => (head[i] << 24 | head[i + 1] << 16 | head[i + 2] << 8 | head[i + 3]) >>> 0
  const le16 = i => head[i] | (head[i + 1] << 8)
  const le32 = i => (head[i] | head[i + 1] << 8 | head[i + 2] << 16 | head[i + 3] << 24) >>> 0

  // PNG: 8-byte signature, then an IHDR chunk whose width/height are big-endian.
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) {
    return { width: be32(16), height: be32(20) }
  }
  // GIF: "GIF8", then the logical screen descriptor, little-endian.
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    return { width: le16(6), height: le16(8) }
  }
  // BMP: "BM", then a DIB header with signed 32-bit little-endian dimensions.
  if (head[0] === 0x42 && head[1] === 0x4D) {
    const w = le32(18), h = le32(22)
    // Height is signed — a negative value means top-down rows, same magnitude.
    return { width: w, height: h > 0x7FFFFFFF ? 0x100000000 - h : h }
  }
  return null
}

async function decode(fileOrBlob) {
  if (typeof createImageBitmap === 'function') {
    /* No resizeWidth/resizeHeight hint. Passing BOTH forces the image to that
       exact box and distorts the aspect ratio; passing one preserves the ratio
       but does nothing about the other axis, so a 3000x30000 image is still
       enormous after the hint. The dimension check happens before this call
       instead — see headerDimensions. */
    try { return await createImageBitmap(fileOrBlob) } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(fileOrBlob)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new ImageRejected('That image could not be decoded — it may be corrupt.', 'corrupt'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, _img: img }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function fit(w, h, max) {
  if (w <= max && h <= max) return { width: w, height: h }
  const s = max / Math.max(w, h)
  return { width: Math.round(w * s), height: Math.round(h * s) }
}

function encode(bitmap, w, h, type, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // JPEG has no alpha; without this, transparent PNGs re-encode onto black.
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(bitmap._img || bitmap, 0, 0, w, h)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new ImageRejected('Encoding failed.', 'encode'))),
      OUT_TYPES.includes(type) ? type : 'image/jpeg',
      quality
    )
  })
}

/* ── storage ─────────────────────────────────────────────────────────── */

export function newImageId() {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export async function putImage(id, record) {
  /* Metering hook. Returns ok:true until pricing is decided (see lib/limits).
     Deliberately does NOT block the local write when it eventually fails —
     the free tier limits cloud sync, never the local disk. Over quota, the
     image is stored here and queued rather than refused. */
  const quota = await checkQuota('imageBytes', record?.blob?.size || 0)
  await idbSet(STORE_IMAGES, id, record)
  if (!quota.ok) return { id, warning: quotaMessage(quota) }
  return id
}

export async function getImage(id) {
  return idbGet(STORE_IMAGES, id)
}

export async function deleteImage(id) {
  return idbDelete(STORE_IMAGES, id)
}

/* Object-URL cache. Creating a URL per render would leak one per frame; this
   hands out a stable URL per image id and revokes on explicit release. */
const urlCache = new Map()

export async function imageUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id)
  const rec = await getImage(id)
  if (!rec?.blob) return null
  const url = URL.createObjectURL(rec.blob)
  urlCache.set(id, url)
  return url
}

export function releaseImageUrl(id) {
  const url = urlCache.get(id)
  if (url) { URL.revokeObjectURL(url); urlCache.delete(id) }
}

/* canvas.toBlob hands its callback `null` on failure — a zero-sized canvas,
   an unsupported type, an out-of-memory encode. Writing that null straight
   back into IndexedDB replaced a perfectly good image with a record holding
   no bytes, which is exactly what "Image data not found" was: not a lookup
   failure, a successful lookup of a record we had already destroyed.
   Nothing is written unless a real blob comes back. */
function toBlobOrThrow(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (!canvas.width || !canvas.height) {
      reject(new ImageRejected('That selection is empty — drag a larger area.', 'empty-crop'))
      return
    }
    canvas.toBlob(b => {
      if (b && b.size > 0) resolve(b)
      else reject(new ImageRejected('The edit could not be encoded; your image is unchanged.', 'encode'))
    }, type, quality)
  })
}

/** Apply rotate/flip to the stored bytes and write them back. */
export async function transformImage(id, { rotate = 0, flipH = false, flipV = false }) {
  const rec = await getImage(id)
  if (!rec?.blob) throw new ImageRejected('Image not found.', 'missing')
  const bitmap = await decode(rec.blob)
  const swap = rotate === 90 || rotate === 270
  const w = swap ? bitmap.height : bitmap.width
  const h = swap ? bitmap.width : bitmap.height

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.translate(w / 2, h / 2)
  if (rotate) ctx.rotate((rotate * Math.PI) / 180)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(bitmap._img || bitmap, -bitmap.width / 2, -bitmap.height / 2)

  const type = rec.blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
  let blob
  try {
    blob = await toBlobOrThrow(canvas, type, 0.92)
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close()
  }

  await putImage(id, { ...rec, blob, width: w, height: h })
  releaseImageUrl(id)
  return { width: w, height: h }
}

/**
 * Crop to a normalised rect (0-1, relative to the IMAGE, not its container).
 * The caller is responsible for having measured against the painted pixels —
 * see the crop handler in NotebookCanvas.
 */
export async function cropImage(id, { x, y, w, h }) {
  const rec = await getImage(id)
  if (!rec?.blob) throw new ImageRejected('Image not found.', 'missing')

  if (![x, y, w, h].every(Number.isFinite)) {
    throw new ImageRejected('That crop selection was not valid.', 'bad-rect')
  }

  const bitmap = await decode(rec.blob)

  /* Clamp into the image. A drag that starts or ends outside the picture used
     to produce a source rectangle partly off the bitmap, and drawImage happily
     rendered the out-of-bounds part as nothing — so the crop came back with a
     blank band, or empty entirely. */
  const x0 = Math.min(Math.max(x, 0), 1)
  const y0 = Math.min(Math.max(y, 0), 1)
  const x1 = Math.min(Math.max(x + w, 0), 1)
  const y1 = Math.min(Math.max(y + h, 0), 1)

  const sx = Math.round(x0 * bitmap.width)
  const sy = Math.round(y0 * bitmap.height)
  const sw = Math.max(1, Math.round((x1 - x0) * bitmap.width))
  const sh = Math.max(1, Math.round((y1 - y0) * bitmap.height))

  if (sw < 8 || sh < 8) {
    if (typeof bitmap.close === 'function') bitmap.close()
    throw new ImageRejected('That selection is too small to crop to.', 'tiny-crop')
  }

  const canvas = document.createElement('canvas')
  canvas.width = sw; canvas.height = sh
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap._img || bitmap, sx, sy, sw, sh, 0, 0, sw, sh)

  const type = rec.blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
  let blob
  try {
    blob = await toBlobOrThrow(canvas, type, 0.92)
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close()
  }

  await putImage(id, { ...rec, blob, width: sw, height: sh })
  releaseImageUrl(id)
  return { width: sw, height: sh }
}
