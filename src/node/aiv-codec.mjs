import { explode, implode } from 'node-pkware/simple';

const WIDTH = 100;
const HEIGHT = 100;
const TILE_COUNT = WIDTH * HEIGHT;

const SECTION_IDS = {
  x_view: 2001,
  y_view: 2002,
  random_state: 2003,
  bmap_size: 2004,
  bmap_tile: 2005,
  gmap: 2006,
  bmap_id: 2007,
  bmap_step: 2008,
  step_current: 2009,
  step_total: 2010,
  pause_step: 2011,
  tarr: 2012,
  tmap: 2013,
  pause: 2014
};

const SECTION_ORDER = [
  'x_view', 'y_view', 'random_state', 'bmap_size', 'bmap_tile', 'gmap',
  'bmap_id', 'bmap_step', 'step_current', 'step_total', 'pause_step',
  'tarr', 'tmap', 'pause'
];

const COMPRESSED = new Set(['bmap_size', 'bmap_tile', 'bmap_id', 'bmap_step', 'tmap']);
const EDITED_SECTIONS = new Set([
  'bmap_size', 'bmap_tile', 'bmap_id', 'bmap_step', 'step_current',
  'pause_step', 'tarr', 'tmap', 'pause'
]);

const AIV_BUILDING_IDS = {
  HIGH_WALL: 10, LOW_WALL: 11, HIGH_CRENAL: 12, LOW_CRENAL: 13,
  MOAT_A: 20, PITCH_DITCH: 24
};

const AIV_TO_MAPPER = [
  110, 111, 112, 113, 114, 180, 312, 98, 61, 86, 144, 145, 146, 147, 105, 0, 0, 0, 0, 0,
  82, 50, 83, 85, 84, 87, 81, 88, 89, 65, 52, 51, 56, 55, 90, 91, 77, 0, 0, 0,
  80, 72, 73, 70, 78, 71, 74, 75, 76, 92, 54, 95, 96, 97, 93, 330, 342, 0, 0, 0,
  175, 324, 313, 318, 169, 166, 325, 327, 0, 0, 176, 301, 177, 305, 307, 308, 306, 310, 311
];

const MAPPER_TO_AIV = new Map();
AIV_TO_MAPPER.forEach((mapperId, index) => {
  if (mapperId && !MAPPER_TO_AIV.has(mapperId)) MAPPER_TO_AIV.set(mapperId, index + 30);
});

function asBytes(input) {
  if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected AIV data as an ArrayBuffer or Uint8Array.');
}

function exactBuffer(bytes) {
  const view = asBytes(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    const bytes = asBytes(part);
    result.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return result;
}

function uint32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, Number(value) >>> 0, true);
  return bytes;
}

function int32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, Number(value) | 0, true);
  return bytes;
}

function uint16ArrayBytes(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, Number(value) >>> 0, true));
  return bytes;
}

function uint32ArrayBytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, Number(value) >>> 0, true));
  return bytes;
}

function int32ArrayBytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, Number(value) | 0, true));
  return bytes;
}

function readUint16Array(bytes, expectedLength) {
  const source = asBytes(bytes);
  if (source.byteLength < expectedLength * 2) throw new Error('AIV uint16 section is shorter than expected.');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  return Array.from({ length: expectedLength }, (_, index) => view.getUint16(index * 2, true));
}

function readUint32Array(bytes, expectedLength) {
  const source = asBytes(bytes);
  if (source.byteLength < expectedLength * 4) throw new Error('AIV uint32 section is shorter than expected.');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  return Array.from({ length: expectedLength }, (_, index) => view.getUint32(index * 4, true));
}

function readInt32Array(bytes) {
  const source = asBytes(bytes);
  const count = Math.floor(source.byteLength / 4);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  return Array.from({ length: count }, (_, index) => view.getInt32(index * 4, true));
}

function translateOffset(offset, invertX = false, invertY = true) {
  let x = offset % WIDTH;
  let y = Math.floor(offset / HEIGHT);
  if (invertX) x = WIDTH - 1 - x;
  if (invertY) y = HEIGHT - 1 - y;
  return y * HEIGHT + x;
}

function reverseTranslateOffset(offset, invertX = false, invertY = true) {
  const translatedX = offset % WIDTH;
  const translatedY = Math.floor(offset / HEIGHT);
  const x = invertX ? WIDTH - 1 - translatedX : translatedX;
  const y = invertY ? HEIGHT - 1 - translatedY : translatedY;
  return y * HEIGHT + x;
}

function aivEnumToMapper(value) {
  if (value === 2) return 200;
  if (value === AIV_BUILDING_IDS.HIGH_WALL) return 25;
  if (value === AIV_BUILDING_IDS.LOW_WALL) return 46;
  if (value === AIV_BUILDING_IDS.HIGH_CRENAL) return 26;
  if (value === AIV_BUILDING_IDS.LOW_CRENAL) return 35;
  if (value >= 14 && value <= 19) return 181 + value - 14;
  if (value >= 20 && value <= 23) return 106;
  if (value === AIV_BUILDING_IDS.PITCH_DITCH) return 99;
  if (value - 30 > 0x4f) return 108;
  return AIV_TO_MAPPER[value - 30] || 108;
}

function mapperEnumToAiv(value) {
  const mapperId = Number(value);
  if (mapperId === 25) return AIV_BUILDING_IDS.HIGH_WALL;
  if (mapperId === 46) return AIV_BUILDING_IDS.LOW_WALL;
  if (mapperId === 26) return AIV_BUILDING_IDS.HIGH_CRENAL;
  if (mapperId === 35) return AIV_BUILDING_IDS.LOW_CRENAL;
  if (mapperId >= 181 && mapperId <= 186) return 14 + mapperId - 181;
  if (mapperId === 106) return AIV_BUILDING_IDS.MOAT_A;
  if (mapperId === 99) return AIV_BUILDING_IDS.PITCH_DITCH;
  if (mapperId === 108) return 110;
  return MAPPER_TO_AIV.get(mapperId) ?? null;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, value) => {
      let current = value;
      for (let bit = 0; bit < 8; bit += 1) current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
      return current >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of asBytes(bytes)) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeSection(packed, compressed, expectedLength) {
  if (!compressed) return asBytes(packed).slice();
  const bytes = asBytes(packed);
  if (bytes.byteLength < 12) throw new Error('Compressed AIV section has no compression header.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const uncompressedLength = header.getUint32(0, true);
  const compressedLength = header.getUint32(4, true);
  if (12 + compressedLength > bytes.byteLength) throw new Error('Compressed AIV section is truncated.');
  const compressedBytes = bytes.slice(12, 12 + compressedLength);
  const result = new Uint8Array(explode(exactBuffer(compressedBytes)));
  const requiredLength = uncompressedLength || expectedLength;
  if (requiredLength && result.byteLength !== requiredLength) {
    throw new Error(`AIV section decompressed to ${result.byteLength} bytes; expected ${requiredLength}.`);
  }
  return result;
}

function readDirectory(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 2036) throw new Error('The AIV file is too short to contain its directory.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directorySize = view.getUint32(0, true);
  const sectionCount = view.getUint32(8, true);
  const version = view.getUint32(12, true);
  if (directorySize < 2036 || directorySize > bytes.byteLength) throw new Error(`Invalid AIV directory size ${directorySize}.`);
  if (sectionCount < 1 || sectionCount > 100) throw new Error(`Invalid AIV section count ${sectionCount}.`);

  const arrayOffsets = { uncompressed: 32, length: 432, id: 832, compressed: 1232, offset: 1632 };
  const sections = new Map();
  const entries = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const id = view.getUint32(arrayOffsets.id + index * 4, true);
    const length = view.getUint32(arrayOffsets.length + index * 4, true);
    const uncompressedLength = view.getUint32(arrayOffsets.uncompressed + index * 4, true);
    const compressed = view.getUint32(arrayOffsets.compressed + index * 4, true) === 1;
    const offset = view.getUint32(arrayOffsets.offset + index * 4, true);
    const start = directorySize + offset;
    const end = start + length;
    if (end > bytes.byteLength) throw new Error(`AIV section ${id} extends past the end of the file.`);
    const packed = bytes.slice(start, end);
    const data = decodeSection(packed, compressed, uncompressedLength);
    sections.set(id, data);
    entries.push({ index, id, length, uncompressedLength, compressed, offset, packed, data });
  }
  return {
    directorySize,
    sectionCount,
    version,
    sections,
    entries,
    directoryBytes: bytes.slice(0, directorySize),
    sourceBytes: bytes.slice()
  };
}

function requireSection(directory, id) {
  const section = directory.sections.get(id);
  if (!section) throw new Error(`AIV section ${id} is missing.`);
  return section;
}

export function parseAiv(input, options = {}) {
  const { invertX = false, invertY = true, skipKeep = false } = options;
  const directory = readDirectory(input);
  const constructions = readUint16Array(requireSection(directory, SECTION_IDS.bmap_id), TILE_COUNT);
  const steps = readUint32Array(requireSection(directory, SECTION_IDS.bmap_step), TILE_COUNT);
  const pauses = new Set(readInt32Array(requireSection(directory, SECTION_IDS.pause_step)).filter(value => value > 0));
  const units = readInt32Array(requireSection(directory, SECTION_IDS.tarr));
  const pauseBytes = requireSection(directory, SECTION_IDS.pause);
  const pauseDelayAmount = pauseBytes.byteLength >= 4
    ? new DataView(pauseBytes.buffer, pauseBytes.byteOffset, pauseBytes.byteLength).getInt32(0, true)
    : 0;

  const keepSteps = new Set();
  let maxStep = 0;
  for (let offset = 0; offset < TILE_COUNT; offset += 1) {
    if (constructions[offset] === 38 && steps[offset] > 0) keepSteps.add(steps[offset]);
    if (steps[offset] > maxStep) maxStep = steps[offset];
  }
  const stepCount = maxStep + 1;
  const frames = Array.from({ length: Math.max(0, stepCount - 1) }, () => null);
  const processed = new Uint8Array(TILE_COUNT);
  const nonBuildingTypes = new Set([25, 46, 26, 35, 106, 99]);

  for (let offset = 0; offset < TILE_COUNT; offset += 1) {
    if (processed[offset]) continue;
    const construction = constructions[offset];
    const step = steps[offset];
    if (construction === 0 || construction === 1 || (construction === 2 && keepSteps.has(step)) || (skipKeep && construction === 38)) {
      processed[offset] = 1;
      continue;
    }
    const itemType = aivEnumToMapper(construction);
    if (nonBuildingTypes.has(itemType)) continue;
    processed[offset] = 1;
    if (step >= 1 && step < stepCount) {
      const frameIndex = step - 1;
      if (!frames[frameIndex]) {
        frames[frameIndex] = {
          itemType,
          tilePositionOfsets: [translateOffset(offset, invertX, invertY)],
          shouldPause: pauses.has(step)
        };
      }
    }
  }

  for (let offset = 0; offset < TILE_COUNT; offset += 1) {
    if (processed[offset]) continue;
    const construction = constructions[offset];
    const step = steps[offset];
    if (step >= 1 && step < stepCount) {
      const frameIndex = step - 1;
      if (!frames[frameIndex]) {
        frames[frameIndex] = { itemType: aivEnumToMapper(construction), tilePositionOfsets: [], shouldPause: pauses.has(step) };
      }
      frames[frameIndex].tilePositionOfsets.push(translateOffset(offset, invertX, invertY));
    }
  }

  const miscItems = [];
  for (let unitType = 0; unitType < 24; unitType += 1) {
    let number = 0;
    for (let entry = 0; entry < 10; entry += 1) {
      const location = units[unitType * 10 + entry] || 0;
      if (!location) continue;
      miscItems.push({ positionOfset: translateOffset(location, invertX, invertY), itemType: unitType, number });
      number += 1;
    }
  }

  return {
    pauseDelayAmount,
    // Old editors produced long runs of build steps with no surviving map
    // placement. They were commonly used as artificial delays and disappear
    // after ordinary edits anyway. Compact them here so legacy castles remain
    // practical to edit inside the UCP menu.
    frames: frames.filter(frame => (
      frame && Number.isFinite(Number(frame.itemType)) &&
      Array.isArray(frame.tilePositionOfsets) && frame.tilePositionOfsets.length > 0
    )),
    miscItems,
    extra: { version: directory.version, directory_size: directory.directorySize }
  };
}

function applyTemplate(map, template, anchorX, anchorY, stepNumber) {
  const [width, height] = template.size.map(Number);
  if (anchorX < 0 || anchorY < 0 || anchorX + width > WIDTH || anchorY + height > HEIGHT) return false;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = (anchorY + row) * WIDTH + anchorX + column;
      map.id[index] = Number(template.bmap_id_template[row][column]) || 0;
      map.size[index] = Number(template.bmap_size_template[row][column]) || 0;
      map.tile[index] = Number(template.bmap_tile_template[row][column]) || 0;
      map.step[index] = stepNumber;
    }
  }
  return true;
}

function packPayload(input, compressed) {
  const bytes = asBytes(input);
  if (!compressed) return bytes.slice();
  const compressedBytes = new Uint8Array(implode(exactBuffer(bytes), 'binary', 'large'));
  return concatBytes([uint32Bytes(bytes.byteLength), uint32Bytes(compressedBytes.byteLength), uint32Bytes(crc32(bytes)), compressedBytes]);
}

function packSection(name, input) {
  return packPayload(input, COMPRESSED.has(name));
}

function repackPreservingSource(source, payloads) {
  const parsed = readDirectory(source);
  const nameById = new Map(Object.entries(SECTION_IDS).map(([name, id]) => [id, name]));
  const directory = parsed.directoryBytes.slice();
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const packedSections = [];
  let sectionOffset = 0;

  for (const entry of parsed.entries) {
    const name = nameById.get(entry.id);
    const changed = Boolean(name && EDITED_SECTIONS.has(name) && payloads[name]);
    const payload = changed ? asBytes(payloads[name]) : entry.data;
    const packed = changed ? packPayload(payload, entry.compressed) : entry.packed.slice();
    packedSections.push(packed);
    view.setUint32(32 + entry.index * 4, changed ? payload.byteLength : entry.uncompressedLength, true);
    view.setUint32(432 + entry.index * 4, packed.byteLength, true);
    view.setUint32(832 + entry.index * 4, entry.id, true);
    view.setUint32(1232 + entry.index * 4, entry.compressed ? 1 : 0, true);
    view.setUint32(1632 + entry.index * 4, sectionOffset, true);
    sectionOffset += packed.byteLength;
  }

  view.setUint32(4, sectionOffset, true);
  view.setUint32(8, parsed.entries.length, true);
  return concatBytes([directory, ...packedSections]);
}

export function encodeAiv(document, templates, options = {}) {
  const { invertX = false, invertY = true, source = null, unchanged = false } = options;
  if (source && unchanged) return asBytes(source).slice();
  const map = {
    id: new Uint16Array(TILE_COUNT),
    step: new Uint32Array(TILE_COUNT),
    size: new Uint8Array(TILE_COUNT),
    tile: new Uint8Array(TILE_COUNT)
  };

  for (let coordinate = 0; coordinate < WIDTH; coordinate += 1) {
    for (const index of [coordinate, (HEIGHT - 1) * WIDTH + coordinate, coordinate * WIDTH, coordinate * WIDTH + WIDTH - 1]) {
      map.id[index] = 1;
      map.step[index] = 1;
    }
  }

  const frames = Array.isArray(document?.frames) ? document.frames : [];
  frames.forEach((frame, frameIndex) => {
    const stepNumber = frameIndex + 1;
    if (!frame || !Number.isFinite(Number(frame.itemType)) || !Array.isArray(frame.tilePositionOfsets)) return;
    const mapperId = Number(frame.itemType);
    const template = templates[String(mapperId)];
    for (const translatedOffset of frame.tilePositionOfsets) {
      const originalOffset = reverseTranslateOffset(Number(translatedOffset), invertX, invertY);
      const anchorY = Math.floor(originalOffset / WIDTH);
      const anchorX = originalOffset % WIDTH;
      if (template) {
        if (!applyTemplate(map, template, anchorX, anchorY, stepNumber)) continue;
        if (mapperId === 61) {
          for (let row = anchorY + 2; row < anchorY + 7 && row < HEIGHT; row += 1) {
            for (let column = anchorX + 7; column < anchorX + 12 && column < WIDTH; column += 1) {
              const index = row * WIDTH + column;
              map.id[index] = 2;
              map.size[index] = 1;
              map.tile[index] = 0;
              map.step[index] = stepNumber;
            }
          }
        }
      } else {
        const aivId = mapperEnumToAiv(mapperId);
        if (aivId == null || anchorX < 0 || anchorY < 0 || anchorX >= WIDTH || anchorY >= HEIGHT) continue;
        map.id[originalOffset] = aivId;
        map.step[originalOffset] = stepNumber;
      }
    }
  });

  if (!map.id.includes(38)) {
    const keepTemplate = templates['61'];
    if (keepTemplate) applyTemplate(map, keepTemplate, 50, 50, 1);
    else {
      map.id[5050] = 38;
      map.step[5050] = 1;
    }
  }

  const pauseSteps = frames
    .map((frame, index) => frame && frame.shouldPause ? index + 1 : null)
    .filter(Boolean);
  const pauses = [0, ...pauseSteps].slice(0, 50);
  while (pauses.length < 50) pauses.push(-1);

  const tarr = new Int32Array(240);
  const tmap = new Uint8Array(TILE_COUNT);
  for (const item of Array.isArray(document?.miscItems) ? document.miscItems : []) {
    const unitType = Number(item.itemType);
    const number = Number(item.number);
    if (!Number.isInteger(unitType) || unitType < 0 || unitType >= 24 || !Number.isInteger(number) || number < 0 || number >= 10) continue;
    const originalOffset = reverseTranslateOffset(Number(item.positionOfset), invertX, invertY);
    tarr[unitType * 10 + number] = originalOffset;
    if (originalOffset >= 0 && originalOffset < TILE_COUNT) tmap[originalOffset] = unitType + 1;
  }

  let highestStep = 0;
  for (const step of map.step) if (step > highestStep) highestStep = step;
  const payloads = {
    x_view: uint32Bytes(0),
    y_view: uint32Bytes(0),
    random_state: new Uint8Array(40016),
    bmap_size: map.size,
    bmap_tile: map.tile,
    gmap: new Uint8Array(TILE_COUNT),
    bmap_id: uint16ArrayBytes(Array.from(map.id)),
    bmap_step: uint32ArrayBytes(Array.from(map.step)),
    step_current: uint32Bytes(highestStep + 1),
    step_total: uint32Bytes(2),
    pause_step: int32ArrayBytes(pauses),
    tarr: int32ArrayBytes(Array.from(tarr)),
    tmap,
    pause: int32Bytes(Number(document?.pauseDelayAmount) || 0)
  };

  if (source) return repackPreservingSource(source, payloads);

  const packedSections = SECTION_ORDER.map(name => packSection(name, payloads[name]));
  const directorySize = 2036;
  const directory = new Uint8Array(directorySize);
  const view = new DataView(directory.buffer);
  const totalPayloadLength = packedSections.reduce((total, bytes) => total + bytes.byteLength, 0);
  view.setUint32(0, directorySize, true);
  view.setUint32(4, totalPayloadLength, true);
  view.setUint32(8, SECTION_ORDER.length, true);
  view.setUint32(12, 200, true);

  let sectionOffset = 0;
  SECTION_ORDER.forEach((name, index) => {
    view.setUint32(32 + index * 4, payloads[name].byteLength, true);
    view.setUint32(432 + index * 4, packedSections[index].byteLength, true);
    view.setUint32(832 + index * 4, SECTION_IDS[name], true);
    view.setUint32(1232 + index * 4, COMPRESSED.has(name) ? 1 : 0, true);
    view.setUint32(1632 + index * 4, sectionOffset, true);
    sectionOffset += packedSections[index].byteLength;
  });

  return concatBytes([directory, ...packedSections]);
}

export function bytesToBase64(input) {
  const bytes = asBytes(input);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export const internals = {
  WIDTH,
  HEIGHT,
  SECTION_IDS,
  aivEnumToMapper,
  mapperEnumToAiv,
  crc32,
  readDirectory,
  repackPreservingSource
};
