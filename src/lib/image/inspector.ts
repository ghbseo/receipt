import { INPUT_LIMITS } from '../../domain/constants'

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export interface InspectedImage {
  mime: SupportedImageMime
  width: number
  height: number
}

/** Inspects trusted header fields without asking a decoder to allocate pixels. */
export function inspectImage(bytes: Uint8Array): InspectedImage {
  if (isPng(bytes)) {
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') {
      throw new Error('손상된 PNG 이미지입니다.')
    }
    const view = dataView(bytes)
    return dimensions(
      'image/png',
      view.getUint32(16, false),
      view.getUint32(20, false),
    )
  }

  if (isJpeg(bytes)) {
    const { width, height } = jpegDimensions(bytes)
    return dimensions('image/jpeg', width, height)
  }

  if (isWebp(bytes)) {
    const { width, height, animated } = webpDimensions(bytes)
    if (animated) throw new Error('움직이는 WebP 이미지는 지원하지 않습니다.')
    return dimensions('image/webp', width, height)
  }

  throw new Error('JPG, PNG, WebP 형식의 이미지만 첨부할 수 있습니다.')
}

export function validatePixelCount(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('이미지 크기 정보를 읽을 수 없습니다.')
  }
  if (width * height > INPUT_LIMITS.pixels) {
    throw new Error('이미지 해상도는 2,400만 픽셀 이하여야 합니다.')
  }
}

function dimensions(
  mime: SupportedImageMime,
  width: number,
  height: number,
): InspectedImage {
  validatePixelCount(width, height)
  return { mime, width, height }
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return signature.every((value, index) => bytes[index] === value)
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 16 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WEBP'
  )
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = dataView(bytes)
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ])
  let offset = 2

  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break

    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > bytes.length) break

    const segmentLength = view.getUint16(offset, false)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error('손상된 JPG 이미지입니다.')
    }
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) throw new Error('손상된 JPG 이미지입니다.')
      return {
        height: view.getUint16(offset + 3, false),
        width: view.getUint16(offset + 5, false),
      }
    }
    offset += segmentLength
  }

  throw new Error('JPG 이미지의 크기 정보를 읽을 수 없습니다.')
}

function webpDimensions(bytes: Uint8Array): {
  width: number
  height: number
  animated: boolean
} {
  const view = dataView(bytes)
  let offset = 12
  let width = 0
  let height = 0
  let animated = false

  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(bytes, offset, offset + 4)
    const chunkLength = view.getUint32(offset + 4, true)
    const dataOffset = offset + 8
    if (dataOffset + chunkLength > bytes.length) {
      throw new Error('손상된 WebP 이미지입니다.')
    }

    if (chunkType === 'ANIM' || chunkType === 'ANMF') animated = true

    if (chunkType === 'VP8X' && chunkLength >= 10) {
      animated ||= (bytes[dataOffset] & 0x02) !== 0
      width = 1 + readUint24LittleEndian(bytes, dataOffset + 4)
      height = 1 + readUint24LittleEndian(bytes, dataOffset + 7)
    } else if (chunkType === 'VP8 ' && chunkLength >= 10) {
      if (
        bytes[dataOffset + 3] === 0x9d &&
        bytes[dataOffset + 4] === 0x01 &&
        bytes[dataOffset + 5] === 0x2a
      ) {
        width = view.getUint16(dataOffset + 6, true) & 0x3fff
        height = view.getUint16(dataOffset + 8, true) & 0x3fff
      }
    } else if (chunkType === 'VP8L' && chunkLength >= 5 && bytes[dataOffset] === 0x2f) {
      const b0 = bytes[dataOffset + 1]
      const b1 = bytes[dataOffset + 2]
      const b2 = bytes[dataOffset + 3]
      const b3 = bytes[dataOffset + 4]
      width = 1 + b0 + ((b1 & 0x3f) << 8)
      height = 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10)
    }

    offset = dataOffset + chunkLength + (chunkLength % 2)
  }

  if (width <= 0 || height <= 0) {
    throw new Error('WebP 이미지의 크기 정보를 읽을 수 없습니다.')
  }
  return { width, height, animated }
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let result = ''
  for (let index = start; index < end && index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index])
  }
  return result
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
