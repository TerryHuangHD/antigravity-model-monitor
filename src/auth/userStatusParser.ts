// Robust protobuf reader and parser for userStatusProtoBinaryBase64
export interface PlanDetailsView {
  email: string;
  name: string;
  tierId: string;
  description: string;
  planName: string;
  upgradeMessage: string;
  upgradeUrl: string;
  credits: number | null;
  features: {
    webSearch: boolean;
    browserAccess: boolean;
    knowledgeBase: boolean;
    mcpServers: boolean;
    gitCommitGen: boolean;
    contextWindow: number;
    autocompleteFastMode: boolean;
    canBuyCredits: boolean;
    teamsTier: string;
    internalTierId: string;
    tabToJump: boolean;
    stickyModels: boolean;
    commandModels: boolean;
    maxPremiumMsgs: number;
    chatInstructionsCharLimit: number;
    pinnedContextItems: number;
    localIndexSize: number;
    acceptedTos: boolean;
    customizeIcon: boolean;
    cascadeAutoRun: boolean;
    cascadeBackground: boolean;
    autoRunCommands: boolean;
    expBrowserFeatures: boolean;
  };
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

interface ProtoField {
  num: number;
  wireType: number;
  asNumber?: number;
  asString?: string;
  raw?: Buffer;
}

function decodeProto(data: Buffer): ProtoField[] {
  const out: ProtoField[] = [];
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
    const num = tag >> 3;

    if (wireType === 0) {
      try {
        const [val, after] = readVarint(data, next);
        out.push({ num, wireType, asNumber: val });
        offset = after;
      } catch {
        break;
      }
    } else if (wireType === 1) {
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
      out.push({
        num,
        wireType,
        asString: slice.toString('utf8'),
        raw: slice
      });
      offset = contentOffset + length;
    } else if (wireType === 5) {
      offset = next + 4;
    } else {
      break;
    }
  }
  return out;
}

function getField(fields: ProtoField[], num: number): ProtoField | undefined {
  return fields.find(f => f.num === num);
}

const UINT64_MINUS_ONE_THRESHOLD = Number('18446744073709550000');
const UINT64_MINUS_ONE = Number('18446744073709551615');

function getInt(fields: ProtoField[], num: number, def = 0): number {
  const f = getField(fields, num);
  if (f && f.asNumber !== undefined) {
    const val = f.asNumber;
    // Handle protobuf varint representation of -1
    if (val > UINT64_MINUS_ONE_THRESHOLD || val === UINT64_MINUS_ONE || val === -1) {
      return -1;
    }
    return val;
  }
  return def;
}

function getBool(fields: ProtoField[], num: number, def = false): boolean {
  const f = getField(fields, num);
  if (f && f.asNumber !== undefined) {
    return f.asNumber !== 0;
  }
  return def;
}

function getString(fields: ProtoField[], num: number, def = ''): string {
  const f = getField(fields, num);
  if (f && f.asString !== undefined) {
    return f.asString;
  }
  return def;
}

export function parseUserStatusProto(b64: string): PlanDetailsView {
  // Set solid default values
  const result: PlanDetailsView = {
    email: '',
    name: '',
    tierId: 'g1-pro-tier',
    description: 'Google AI Pro',
    planName: 'GOOGLE AI PRO',
    upgradeUrl: 'https://antigravity.google/g1-upgrade',
    upgradeMessage: 'You can upgrade to the Google AI Ultra plan to receive the highest rate limits.',
    credits: 1000,
    features: {
      webSearch: true,
      browserAccess: true,
      knowledgeBase: true,
      mcpServers: true,
      gitCommitGen: true,
      contextWindow: 16384,
      autocompleteFastMode: true,
      canBuyCredits: true,
      teamsTier: 'TEAMS_TIER_PRO',
      internalTierId: 'g1-pro-tier',
      tabToJump: true,
      stickyModels: true,
      commandModels: true,
      maxPremiumMsgs: -1,
      chatInstructionsCharLimit: 600,
      pinnedContextItems: -1,
      localIndexSize: -1,
      acceptedTos: true,
      customizeIcon: true,
      cascadeAutoRun: true,
      cascadeBackground: true,
      autoRunCommands: true,
      expBrowserFeatures: true
    }
  };

  if (!b64) return result;

  try {
    const buf = Buffer.from(b64.trim(), 'base64');
    const topFields = decodeProto(buf);

    // Extract basic top-level details
    result.name = getString(topFields, 3, result.name);
    result.email = getString(topFields, 7, result.email);

    // Extract plan details block (Field 36)
    const f36 = getField(topFields, 36);
    if (f36 && f36.raw) {
      const f36Fields = decodeProto(f36.raw);
      result.tierId = getString(f36Fields, 1, result.tierId);
      result.features.internalTierId = result.tierId;
      result.description = getString(f36Fields, 2, result.description);
      result.planName = getString(f36Fields, 3, result.planName).toUpperCase();
      result.upgradeUrl = getString(f36Fields, 7, result.upgradeUrl);
      result.upgradeMessage = getString(f36Fields, 8, result.upgradeMessage);
      
      const sub14 = getField(f36Fields, 14);
      if (sub14 && sub14.raw) {
        const sub14Fields = decodeProto(sub14.raw);
        result.credits = getInt(sub14Fields, 2, 1000);
      }
    }

    // Extract plan settings (Field 13)
    const f13 = getField(topFields, 13);
    if (f13 && f13.raw) {
      const f13Fields = decodeProto(f13.raw);
      const sub1 = getField(f13Fields, 1);
      if (sub1 && sub1.raw) {
        const sub1Fields = decodeProto(sub1.raw);

        // Map teams tier
        const teamsTierInt = getInt(sub1Fields, 1, 2);
        if (teamsTierInt === 2) {
          result.features.teamsTier = 'TEAMS_TIER_PRO';
        } else if (teamsTierInt === 1) {
          result.features.teamsTier = 'TEAMS_TIER_FREE';
        } else {
          result.features.teamsTier = `TEAMS_TIER_${teamsTierInt}`;
        }

        // Map booleans and numbers
        result.features.webSearch = getBool(sub1Fields, 3, true);
        result.features.browserAccess = getBool(sub1Fields, 4, true);
        result.features.maxPremiumMsgs = getInt(sub1Fields, 6, -1);
        result.features.contextWindow = getInt(sub1Fields, 7, 16384);
        result.features.chatInstructionsCharLimit = getInt(sub1Fields, 8, 600);
        result.features.pinnedContextItems = getInt(sub1Fields, 9, -1);
        result.features.localIndexSize = getInt(sub1Fields, 10, -1);
        result.features.tabToJump = getBool(sub1Fields, 15, true);
        result.features.stickyModels = getBool(sub1Fields, 18, true);
        result.features.commandModels = getBool(sub1Fields, 19, true);
        result.features.autocompleteFastMode = getBool(sub1Fields, 20, true);
        result.features.acceptedTos = getBool(sub1Fields, 22, true);
        result.features.customizeIcon = getBool(sub1Fields, 23, true);

        // Map Cascade settings (Tag 24 nested)
        const sub24 = getField(sub1Fields, 24);
        if (sub24 && sub24.raw) {
          const sub24Fields = decodeProto(sub24.raw);
          result.features.cascadeAutoRun = getBool(sub24Fields, 5, true);
          result.features.cascadeBackground = getBool(sub24Fields, 7, true);
          result.features.knowledgeBase = getBool(sub24Fields, 5, true);
          result.features.gitCommitGen = getBool(sub24Fields, 7, true);
        }

        result.features.autoRunCommands = getBool(sub1Fields, 25, true);
        result.features.expBrowserFeatures = getBool(sub1Fields, 27, true);
        result.features.canBuyCredits = getBool(sub1Fields, 29, true);
        result.features.mcpServers = getBool(sub1Fields, 31, true);
      }
    }
  } catch (err) {
    // Fail silently and return defaults to avoid extension crash
    console.error('[userStatusParser] failed to parse protobuf, using defaults:', err);
  }

  return result;
}
