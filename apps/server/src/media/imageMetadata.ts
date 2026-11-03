import type { ChatImageMimeType } from "@tempass/shared";

export interface ImageDimensions {
  mimeType: ChatImageMimeType;
  width: number;
  height: number;
}

export type ImageInspection =
  | { ok: true; image: ImageDimensions }
  | { ok: false; reason: "unsupported" | "malformed" };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_DIMENSION = 16_384;

export function inspectImageBytes(buffer: Buffer): ImageInspection {
  if (looksLikeMarkup(buffer)) {
    return { ok: false, reason: "unsupported" };
  }

  if (startsWith(buffer, PNG_SIGNATURE)) {
    return inspectPng(buffer);
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return inspectJpeg(buffer);
  }

  if (startsWith(buffer, Buffer.from("GIF87a")) || startsWith(buffer, Buffer.from("GIF89a"))) {
    return inspectGif(buffer);
  }

  if (startsWith(buffer, Buffer.from("RIFF")) && startsWith(buffer.subarray(8), Buffer.from("WEBP"))) {
    return inspectWebp(buffer);
  }

  return { ok: false, reason: "unsupported" };
}

function inspectPng(buffer: Buffer): ImageInspection {
  if (buffer.length < 24) {
    return { ok: false, reason: "malformed" };
  }

  if (buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return { ok: false, reason: "malformed" };
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return dimensions("image/png", width, height);
}

function inspectJpeg(buffer: Buffer): ImageInspection {
  let offset = 2;

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= buffer.length) {
      break;
    }

    const marker = buffer[offset] ?? 0;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);

    if (segmentLength < 2) {
      return { ok: false, reason: "malformed" };
    }

    if (isStartOfFrame(marker)) {
      if (offset + 7 > buffer.length) {
        return { ok: false, reason: "malformed" };
      }

      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return dimensions("image/jpeg", width, height);
    }

    offset += segmentLength;
  }

  return { ok: false, reason: "malformed" };
}

function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function inspectGif(buffer: Buffer): ImageInspection {
  if (buffer.length < 10) {
    return { ok: false, reason: "malformed" };
  }

  return dimensions("image/gif", buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}

function inspectWebp(buffer: Buffer): ImageInspection {
  if (buffer.length < 16) {
    return { ok: false, reason: "malformed" };
  }

  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;

    if (dataStart + chunkSize > buffer.length) {
      return { ok: false, reason: "malformed" };
    }

    if (chunkType === "VP8X") {
      if (chunkSize < 10) {
        return { ok: false, reason: "malformed" };
      }

      const width = 1 + buffer.readUIntLE(dataStart + 4, 3);
      const height = 1 + buffer.readUIntLE(dataStart + 7, 3);
      return dimensions("image/webp", width, height);
    }

    if (chunkType === "VP8 ") {
      if (
        chunkSize < 10 ||
        buffer[dataStart + 3] !== 0x9d ||
        buffer[dataStart + 4] !== 0x01 ||
        buffer[dataStart + 5] !== 0x2a
      ) {
        return { ok: false, reason: "malformed" };
      }

      const width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      const height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
      return dimensions("image/webp", width, height);
    }

    if (chunkType === "VP8L") {
      if (chunkSize < 5 || buffer[dataStart] !== 0x2f) {
        return { ok: false, reason: "malformed" };
      }

      const b0 = buffer[dataStart + 1] ?? 0;
      const b1 = buffer[dataStart + 2] ?? 0;
      const b2 = buffer[dataStart + 3] ?? 0;
      const b3 = buffer[dataStart + 4] ?? 0;
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return dimensions("image/webp", width, height);
    }

    offset = dataStart + chunkSize + (chunkSize & 1);
  }

  return { ok: false, reason: "malformed" };
}

function dimensions(
  mimeType: ChatImageMimeType,
  width: number,
  height: number,
): ImageInspection {
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  ) {
    return { ok: false, reason: "malformed" };
  }

  return { ok: true, image: { mimeType, width, height } };
}

function looksLikeMarkup(buffer: Buffer): boolean {
  const prefix = buffer.subarray(0, 32).toString("utf8").trimStart().toLowerCase();
  return prefix.startsWith("<");
}

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return buffer.length >= prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}
