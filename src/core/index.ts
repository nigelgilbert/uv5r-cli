/** Public surface of core. cli imports core through this file. */
export { SerialTransport, findAioc, resolveTarget, AIOC_VENDOR_ID, AIOC_PRODUCT_ID } from './transport.ts';
export type { Transport } from './transport.ts';

export { Session, SETTLE_MS, IDLE_LIMIT_MS, settle, hex, attempt } from './protocol.ts';
export type { Ident, AttemptOutcome } from './protocol.ts';

export { MAGICS, DEFAULT_MAGIC, SCAN_ORDER, FOREIGN_MAGICS, PROGRAM_MAGICS, BASETYPES, DTMF_TABLES, magicByName, parseIdent, classify } from './ident.ts';
export type { Family, Magic, MagicName, IdentFlags, Classification, ParsedIdent } from './ident.ts';

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
  SCAN_WRONG_ACK_PAUSE_MS,
  PROGRAM_PAUSE_MS,
  identify,
} from './radio.ts';
export type { ChannelPayload, MalformedRecord, ChannelResult, RadioStatus, HoldResult, SessionOptions, IdentifyAttempt, IdentifyAnswer, IdentifyResult } from './radio.ts';

export { parsePlan, readPlan } from './plan.ts';
export type { Plan, PlanEntry } from './plan.ts';

export { BaofengError, UsageError, TransportError, TimeoutError, DeviceStateError, BusyError, UnexpectedError, REASONS, RETRY, withDetail } from './errors.ts';
export type { ErrorKind, ErrorReason, Retry, Guidance } from './errors.ts';
