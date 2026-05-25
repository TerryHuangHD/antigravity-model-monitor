// Diagnostic helpers for inspecting state.vscdb values.
// Used by the `agModelMonitor.dumpKeyValue` command; not on the main code path.

export interface FieldEntry {
  path: string;
  wireType: number;
  tag: number;
  byteLength?: number;
  asString?: string;
  asNumber?: number;
}

function readVarint(data: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < data.length) {
    const byte = data[pos];
    result += (byte & 0x7f) * Math.pow(2, shift);
    pos += 1;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7;
  }
  throw new Error('Incomplete varint');
}

function isLikelyText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let printable = 0;
  for (const b of buf) {
    // Tab, LF, CR or printable ASCII.
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) printable++;
  }
  return printable / buf.length > 0.9;
}

export function describeProtobuf(data: Buffer, maxDepth = 4, pathPrefix = ''): FieldEntry[] {
  const out: FieldEntry[] = [];
  let offset = 0;
  while (offset < data.length) {
    let tag: number;
    let next: number;
    try {
      [tag, next] = readVarint(data, offset);
    } catch {
      break;
    }
    const wireType = tag & 7;
    const fieldNum = tag >> 3;
    const fieldPath = pathPrefix ? `${pathPrefix}.${fieldNum}` : `${fieldNum}`;

    if (wireType === 0) {
      try {
        const [val, after] = readVarint(data, next);
        out.push({ path: fieldPath, wireType, tag, asNumber: val });
        offset = after;
      } catch {
        break;
      }
    } else if (wireType === 1) {
      out.push({ path: fieldPath, wireType, tag, byteLength: 8 });
      offset = next + 8;
    } else if (wireType === 2) {
      let length: number;
      let contentOffset: number;
      try {
        [length, contentOffset] = readVarint(data, next);
      } catch {
        break;
      }
      const slice = data.subarray(contentOffset, contentOffset + length);
      const entry: FieldEntry = { path: fieldPath, wireType, tag, byteLength: length };
      // Heuristics: if it looks like UTF-8 text, surface the string.
      if (isLikelyText(slice)) {
        entry.asString = slice.toString('utf8');
        out.push(entry);
      } else if (maxDepth > 0 && length > 0) {
        // Try to recurse as nested message.
        const nested = safeDescribe(slice, maxDepth - 1, fieldPath);
        if (nested && nested.length > 0) {
          out.push(entry);
          out.push(...nested);
        } else {
          entry.asString = `<${length} bytes binary>`;
          out.push(entry);
        }
      } else {
        entry.asString = `<${length} bytes binary>`;
        out.push(entry);
      }
      offset = contentOffset + length;
    } else if (wireType === 5) {
      out.push({ path: fieldPath, wireType, tag, byteLength: 4 });
      offset = next + 4;
    } else {
      break;
    }
  }
  return out;
}

function safeDescribe(data: Buffer, maxDepth: number, pathPrefix: string): FieldEntry[] | null {
  try {
    // Make sure the whole buffer parses cleanly — otherwise it's not a message.
    const result = describeProtobuf(data, maxDepth, pathPrefix);
    // Heuristic: if we managed to consume nothing, it isn't a nested message.
    if (result.length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

export function extractPrintableStrings(buf: Buffer, minLen = 6): string[] {
  const out: string[] = [];
  let current = '';
  for (const b of buf) {
    if (b >= 0x20 && b <= 0x7e) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= minLen) out.push(current);
      current = '';
    }
  }
  if (current.length >= minLen) out.push(current);
  return out;
}
