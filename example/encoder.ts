/**
 * Repeat a full hidden secret block throughout a carrier string.
 *
 * Goal:
 * - hide one complete secret block many times
 * - recover from a partial substring if it contains one full block
 *
 * Uses Unicode variation selectors:
 *   0..15   -> U+FE00..U+FE0F
 *   16..255 -> U+E0100..U+E01EF
 */

const VS1_START = 0xfe_00
const VS17_START = 0xe_01_00

const MAGIC = Uint8Array.from([0x56, 0x53, 0x52, 0x31]) // "VSR1"
const VERSION = 1

type ByteLike = Uint8Array | number[]

export type RepeatSecretOptions = {
  spacing?: number // Visible chars between repeated blocks
}

export type EmbedRepeatedSecretResult = {
  embeddedText: string
  blockLength: number
  copiesEmbedded: number
  requiredCarrierLengthPerCopy: number
}

function toUint8Array(value: ByteLike): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value)
}

export function byteToVariationSelector(byte: number): string {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
    throw new Error(`Invalid byte: ${byte}`)
  }

  if (byte < 16) {
    return String.fromCodePoint(VS1_START + byte)
  }

  return String.fromCodePoint(VS17_START + (byte - 16))
}

export function variationSelectorToByte(codePoint: number): number | undefined {
  if (codePoint >= 0xfe_00 && codePoint <= 0xfe_0f) {
    return codePoint - 0xfe_00
  }

  if (codePoint >= 0xe_01_00 && codePoint <= 0xe_01_ef) {
    return 16 + (codePoint - 0xe_01_00)
  }

  return null
}

export function concatBytes(...arrays: ByteLike[]): Uint8Array {
  const normalized = arrays.map(toUint8Array)
  const total = normalized.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(total)

  let offset = 0
  for (const arr of normalized) {
    out.set(arr, offset)
    offset += arr.length
  }

  return out
}

export function uint16ToBytesBE(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff])
}

export function bytesToUint16BE(bytes: ByteLike, offset = 0): number {
  const arr = toUint8Array(bytes)
  return ((arr[offset] << 8) | arr[offset + 1]) >>> 0
}

export function uint32ToBytesBE(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ])
}

export function bytesToUint32BE(bytes: ByteLike, offset = 0): number {
  const arr = toUint8Array(bytes)
  return (
    (((arr[offset] << 24) >>> 0) |
      (arr[offset + 1] << 16) |
      (arr[offset + 2] << 8) |
      arr[offset + 3]) >>>
    0
  )
}

export function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

export function utf8Decode(bytes: ByteLike): string {
  return new TextDecoder().decode(toUint8Array(bytes))
}

// CRC32
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)

  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1
    }

    table[i] = c >>> 0
  }

  return table
})()

export function crc32(bytes: ByteLike): number {
  const arr = toUint8Array(bytes)
  let crc = 0xff_ff_ff_ff

  for (const byte of arr) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xff_ff_ff_ff) >>> 0
}

/**
 * Block format:
 * [magic:4][version:1][payloadLength:2][payload:N][crc32:4]
 *
 * CRC is over [magic|version|payloadLength|payload]
 */
export function buildSecretBlock(secretMessage: string): Uint8Array {
  const payload = utf8Encode(secretMessage)

  if (payload.length > 0xff_ff) {
    throw new Error(
      'Secret message too large; max UTF-8 payload is 65535 bytes'
    )
  }

  const header = concatBytes(
    MAGIC,
    Uint8Array.from([VERSION]),
    uint16ToBytesBE(payload.length)
  )

  const withoutCrc = concatBytes(header, payload)
  const crc = uint32ToBytesBE(crc32(withoutCrc))

  return concatBytes(withoutCrc, crc)
}

export function parseSecretBlock(block: ByteLike): string {
  const bytes = toUint8Array(block)

  const minLen = 4 + 1 + 2 + 4
  if (bytes.length < minLen) {
    throw new Error('Block too short')
  }

  if (
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[3] !== MAGIC[3]
  ) {
    throw new Error('Bad magic')
  }

  const version = bytes[4]
  if (version !== VERSION) {
    throw new Error(`Unsupported version ${version}`)
  }

  const payloadLength = bytesToUint16BE(bytes, 5)
  const expectedLength = 4 + 1 + 2 + payloadLength + 4

  if (bytes.length !== expectedLength) {
    throw new Error('Block length mismatch')
  }

  const payloadStart = 7
  const payloadEnd = payloadStart + payloadLength
  const payload = bytes.slice(payloadStart, payloadEnd)

  const expectedCrc = bytesToUint32BE(bytes, payloadEnd)
  const actualCrc = crc32(bytes.slice(0, payloadEnd))

  if (expectedCrc !== actualCrc) {
    throw new Error('CRC mismatch')
  }

  return utf8Decode(payload)
}

/**
 * Embed one complete secret block repeatedly across the carrier.
 *
 * Each hidden byte consumes one visible character.
 * spacing controls how many plain visible characters appear between block copies.
 */
export function embedSecretRepeatedly(
  carrier: string,
  secretMessage: string,
  options: RepeatSecretOptions = {}
): EmbedRepeatedSecretResult {
  const {spacing = 32} = options

  if (!Number.isInteger(spacing) || spacing < 0) {
    throw new Error('spacing must be 0 or greater')
  }

  const carrierChars = Array.from(carrier)
  const block = buildSecretBlock(secretMessage)
  const perCopyChars = block.length + spacing

  if (carrierChars.length < block.length) {
    throw new Error(
      `Carrier too short. Need at least ${block.length} visible characters for one copy.`
    )
  }

  const copiesEmbedded = Math.floor(
    (carrierChars.length + spacing) / perCopyChars
  )

  if (copiesEmbedded < 1) {
    throw new Error('Carrier too short to embed even one repeated copy')
  }

  let out = ''
  let charIndex = 0

  for (let copy = 0; copy < copiesEmbedded; copy++) {
    for (const aBlock of block) {
      out += carrierChars[charIndex]
      out += byteToVariationSelector(aBlock)
      charIndex++
    }

    for (let s = 0; s < spacing && charIndex < carrierChars.length; s++) {
      out += carrierChars[charIndex]
      charIndex++
    }
  }

  while (charIndex < carrierChars.length) {
    out += carrierChars[charIndex]
    charIndex++
  }

  return {
    embeddedText: out,
    blockLength: block.length,
    copiesEmbedded,
    requiredCarrierLengthPerCopy: perCopyChars
  }
}

export function extractAllHiddenBytes(text: string): Uint8Array {
  const cps = Array.from(text, (ch) => ch.codePointAt(0)!)
  const bytes: number[] = []

  for (let i = 0; i < cps.length - 1; i++) {
    const maybeByte = variationSelectorToByte(cps[i + 1])
    if (maybeByte !== null) {
      bytes.push(maybeByte)
      i += 1
    }
  }

  return Uint8Array.from(bytes)
}

/**
 * Scan extracted hidden bytes for the first valid secret block.
 * This allows recovery from a partial substring.
 */
export function recoverSecretFromText(text: string): string | undefined {
  const hiddenBytes = extractAllHiddenBytes(text)
  const minLen = 4 + 1 + 2 + 4

  for (let start = 0; start <= hiddenBytes.length - minLen; start++) {
    if (
      hiddenBytes[start] !== MAGIC[0] ||
      hiddenBytes[start + 1] !== MAGIC[1] ||
      hiddenBytes[start + 2] !== MAGIC[2] ||
      hiddenBytes[start + 3] !== MAGIC[3]
    ) {
      continue
    }

    const version = hiddenBytes[start + 4]
    if (version !== VERSION) {
      continue
    }

    const payloadLength = bytesToUint16BE(hiddenBytes, start + 5)
    const blockLength = 4 + 1 + 2 + payloadLength + 4
    const end = start + blockLength

    if (end > hiddenBytes.length) {
      continue
    }

    const candidate = hiddenBytes.slice(start, end)

    try {
      return parseSecretBlock(candidate)
    } catch {
      // Keep scanning
    }
  }

  return null
}

export type RecoveredSecretMatch = {
  start: number
  end: number
  blockLength: number
  secret: string
}

/**
 * Scan extracted hidden bytes for all valid secret blocks.
 * This allows recovery of multiple repeated or distinct secrets from one text.
 */
export function recoverMultipleSecretsFromText(
  text: string
): RecoveredSecretMatch[] {
  const hiddenBytes = extractAllHiddenBytes(text)
  const minLen = 4 + 1 + 2 + 4

  const results: RecoveredSecretMatch[] = []

  for (let start = 0; start <= hiddenBytes.length - minLen; start++) {
    if (
      hiddenBytes[start] !== MAGIC[0] ||
      hiddenBytes[start + 1] !== MAGIC[1] ||
      hiddenBytes[start + 2] !== MAGIC[2] ||
      hiddenBytes[start + 3] !== MAGIC[3]
    ) {
      continue
    }

    const version = hiddenBytes[start + 4]
    if (version !== VERSION) {
      continue
    }

    const payloadLength = bytesToUint16BE(hiddenBytes, start + 5)
    const blockLength = 4 + 1 + 2 + payloadLength + 4
    const end = start + blockLength

    if (end > hiddenBytes.length) {
      continue
    }

    const candidate = hiddenBytes.slice(start, end)

    try {
      const secret = parseSecretBlock(candidate)

      results.push({
        start,
        end,
        blockLength,
        secret
      })

      // Skip ahead past this valid block so we don't re-detect overlapping bytes
      start = end - 1
    } catch {
      // Keep scanning
    }
  }

  return results
}

export function repeatCarrierPattern(
  pattern: string,
  minLength: number
): string {
  const chars = Array.from(pattern)

  if (chars.length === 0) {
    throw new Error('Pattern must not be empty')
  }

  let out = ''
  while (Array.from(out).length < minLength) {
    out += pattern
  }

  return Array.from(out).slice(0, minLength).join('')
}

// Example
/*
const secret = "this is the secret";
const carrier = repeatCarrierPattern(
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ",
  5000
);

const embedded = embedSecretRepeatedly(carrier, secret, { spacing: 24 });

console.log("copiesEmbedded:", embedded.copiesEmbedded);
console.log("blockLength:", embedded.blockLength);

// Full text recovery
console.log(recoverSecretFromText(embedded.embeddedText));

// Partial slice recovery
const chars = Array.from(embedded.embeddedText);
const partial = chars.slice(600, 1400).join("");
console.log(recoverSecretFromText(partial));
*/
