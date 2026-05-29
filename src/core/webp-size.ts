export interface SkinSheetMeta {
  width: number
  height: number
}

function fourCC(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
}

/**
 * 解析 WebP 容器尺寸（VP8 / VP8L / VP8X）。只需檔頭前 ~30 bytes。
 * 非合法 WebP / bytes 不足 → null。
 */
export function readWebpSize(bytes: Uint8Array): SkinSheetMeta | null {
  if (bytes.length < 16) return null
  if (fourCC(bytes, 0) !== 'RIFF') return null
  if (fourCC(bytes, 8) !== 'WEBP') return null

  const cc = fourCC(bytes, 12)

  if (cc === 'VP8 ') {
    // lossy keyframe：start code 0x9d 0x01 0x2a 在 offset 23；寬高各 14-bit LE 在 26/28
    if (bytes.length < 30) return null
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
    return { width, height }
  }

  if (cc === 'VP8L') {
    // lossless：offset 20 signature 0x2f；接著 14-bit (w-1)、14-bit (h-1)
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]
    const width = (((b1 & 0x3f) << 8) | b0) + 1
    const height = ((((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) & 0x3fff) + 1
    return { width, height }
  }

  if (cc === 'VP8X') {
    // extended：canvas 寬高各 24-bit LE，值 +1，在 offset 24 / 27
    if (bytes.length < 30) return null
    const width = ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0xffffff) + 1
    const height = ((bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) & 0xffffff) + 1
    return { width, height }
  }

  return null
}
