import { describe, expect, it } from 'vitest'

import { inspectImage, validatePixelCount } from './inspector'

const writeAscii = (bytes: Uint8Array, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index)
  }
}

const png = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  writeAscii(bytes, 12, 'IHDR')
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return bytes
}

const jpeg = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], 0)
  bytes.set([0xff, 0xc0, 0x00, 0x0b, 0x08], 8)
  const view = new DataView(bytes.buffer)
  view.setUint16(13, height, false)
  view.setUint16(15, width, false)
  bytes.set([0x01, 0x01, 0x11, 0x00], 17)
  return bytes
}

const extendedWebp = (
  width: number,
  height: number,
  animation = false,
): Uint8Array => {
  const bytes = new Uint8Array(30)
  writeAscii(bytes, 0, 'RIFF')
  writeAscii(bytes, 8, 'WEBP')
  writeAscii(bytes, 12, 'VP8X')
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 22, true)
  view.setUint32(16, 10, true)
  bytes[20] = animation ? 0x02 : 0
  const widthMinusOne = width - 1
  const heightMinusOne = height - 1
  bytes.set(
    [widthMinusOne, widthMinusOne >> 8, widthMinusOne >> 16].map(
      (value) => value & 0xff,
    ),
    24,
  )
  bytes.set(
    [heightMinusOne, heightMinusOne >> 8, heightMinusOne >> 16].map(
      (value) => value & 0xff,
    ),
    27,
  )
  return bytes
}

describe('inspectImage', () => {
  it('reads PNG dimensions from a valid magic header', () => {
    expect(inspectImage(png(1_200, 2_400))).toEqual({
      mime: 'image/png',
      width: 1_200,
      height: 2_400,
    })
  })

  it('walks JPEG segments and reads a start-of-frame marker', () => {
    expect(inspectImage(jpeg(640, 480))).toEqual({
      mime: 'image/jpeg',
      width: 640,
      height: 480,
    })
  })

  it('reads extended WebP dimensions', () => {
    expect(inspectImage(extendedWebp(1_025, 2_049))).toEqual({
      mime: 'image/webp',
      width: 1_025,
      height: 2_049,
    })
  })

  it('rejects an animated WebP from its VP8X feature bit', () => {
    expect(() => inspectImage(extendedWebp(320, 240, true))).toThrow(
      '움직이는 WebP',
    )
  })

  it.each([
    ['unknown magic bytes', new Uint8Array([0x47, 0x49, 0x46, 0x38])],
    ['a truncated PNG', png(20, 20).slice(0, 20)],
    ['a JPEG without a frame header', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
  ])('rejects %s', (_label, bytes) => {
    expect(() => inspectImage(bytes)).toThrow()
  })

  it('rejects a WebP chunk whose declared size exceeds the file', () => {
    const bytes = extendedWebp(10, 10)
    new DataView(bytes.buffer).setUint32(16, 100, true)
    expect(() => inspectImage(bytes)).toThrow('손상된 WebP')
  })

  it('rejects images above 24 megapixels before decoding', () => {
    expect(() => inspectImage(png(6_000, 4_001))).toThrow('2,400만 픽셀')
  })
})

describe('validatePixelCount', () => {
  it('accepts exactly 24 megapixels and rejects invalid dimensions', () => {
    expect(() => validatePixelCount(6_000, 4_000)).not.toThrow()
    expect(() => validatePixelCount(0, 100)).toThrow('크기 정보')
    expect(() => validatePixelCount(1.5, 100)).toThrow('크기 정보')
  })
})
