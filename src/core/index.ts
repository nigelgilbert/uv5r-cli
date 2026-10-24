/** Public surface of core. cli imports core through this file. */
export { SerialTransport, findAioc, resolveTarget, AIOC_VENDOR_ID, AIOC_PRODUCT_ID } from './transport.ts';
export type { Transport } from './transport.ts';

export { Session, SETTLE_MS, IDLE_LIMIT_MS, settle, hex } from './protocol.ts';
export type { Ident } from './protocol.ts';

export {
  CHANNEL_BASE,
  NAME_BASE,
  CHANNEL_COUNT,
  ADDR,
  BANDS,
  DCS_CODES,
  CTCSS_TONES,
  parseTone,
  formatTone,
  encodeTone,
  decodeTone,
  parseDecimal,
  parseFrequency,
  checkTenHz,
  checkBand,
  formatMhz,
  encodeLbcd,
  decodeLbcd,
  encodeChannel,
  encodeName,
  decodeName,
  decodeChannel,
  channelToJson,
  checkChannelNumber,
  SETTINGS_BASE,
  SETTINGS_SIZE,
  SETTINGS_COMMIT,
  SETTINGS_FIELDS,
  SETTING_NAMES,
  isSettingName,
  decodeSettings,
  settingValues,
  parseSettingValue,
  applySettings,
} from './codec.ts';
export type { Tone, Channel, ChannelSpec, ChannelJson, SettingName, Settings } from './codec.ts';

export {
  channelPayload,
  IMAGE_HEADER,
  readSettings,
  writeSettings,
  verifySettingsBlock,
  withSession,
  startFreshSession,
  verifySettingsInFreshSession,
  readStatus,
  readChannel,
  writeChannel,
  eraseChannel,
  dumpImage,
  RESTORE_RANGES,
  imageSettingsBlock,
  restoreImage,
  VERIFY_RANGES,
  verifyRestoredRanges,
  KEY_SIGNALS,
  holdPtt,
} from './radio.ts';
export type { ChannelPayload, MalformedRecord, ChannelResult, RadioStatus, HoldResult } from './radio.ts';

export { parsePlan, readPlan } from './plan.ts';
export type { Plan, PlanEntry } from './plan.ts';

export { BaofengError, UsageError, TransportError, TimeoutError, DeviceStateError, BusyError, UnexpectedError, REASONS, RETRY, withDetail } from './errors.ts';
export type { ErrorKind, ErrorReason, Retry, Guidance } from './errors.ts';
