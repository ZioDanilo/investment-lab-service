const MAGIC = 'MU64';
const VERSION = 1;
const PAYLOAD_TYPE_FULL = 1;
const PAYLOAD_TYPE_RETURNS_ONLY = 2;
const SCENARIO_MAP = {
  expansion: 0,
  soft_landing: 1,
  recession: 2,
  stagflation: 3
};
const SCENARIO_NAMES = ['expansion', 'soft_landing', 'recession', 'stagflation'];

const normalizeScenarioName = (scenario) => {
  const normalized = String(scenario ?? 'expansion').trim().toLowerCase();
  if (normalized === 'softlanding' || normalized === 'soft_landing' || normalized === 'soft landing') {
    return 'soft_landing';
  }
  if (normalized === 'recessione' || normalized === 'recession') {
    return 'recession';
  }
  if (normalized === 'stagflazione' || normalized === 'stagflation') {
    return 'stagflation';
  }
  if (normalized === 'expansion' || normalized === 'expansionary') {
    return 'expansion';
  }
  return 'expansion';
};

const encodeScenarioCode = (scenario) => {
  const normalized = normalizeScenarioName(scenario);
  const code = SCENARIO_MAP[normalized];
  return Number.isInteger(code) ? code : SCENARIO_MAP.expansion;
};

const decodeScenarioCode = (code) => {
  const normalizedCode = Number(code || 0);
  if (!Number.isInteger(normalizedCode) || normalizedCode < 0 || normalizedCode >= SCENARIO_NAMES.length) {
    return 'expansion';
  }
  return SCENARIO_NAMES[normalizedCode];
};

const toBuffer = (input) => {
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return Buffer.from(input || []);
};

const encodeMarketUniverseBinary = ({ runId, pathCount, monthCount, payloadType, returns, intensities, scenarios }) => {
  const normalizedRunId = String(runId || '');
  const normalizedPathCount = Number(pathCount || 0);
  const normalizedMonthCount = Number(monthCount || 0);
  const normalizedPayloadType = payloadType === 'RETURNS_ONLY' ? PAYLOAD_TYPE_RETURNS_ONLY : PAYLOAD_TYPE_FULL;

  if (!normalizedRunId) {
    throw new Error('Market Universe binary payload requires a runId');
  }
  if (!Number.isFinite(normalizedPathCount) || !Number.isFinite(normalizedMonthCount) || normalizedPathCount <= 0 || normalizedMonthCount <= 0) {
    throw new Error('Market Universe binary payload requires a positive path/month geometry');
  }

  const returnArray = Array.isArray(returns) ? returns.map((value) => Number(value)) : Array.from(returns || []);
  const expectedReturnCount = normalizedPathCount * normalizedMonthCount;
  if (returnArray.length !== expectedReturnCount) {
    throw new Error(`Binary payload return count mismatch: expected ${expectedReturnCount}, received ${returnArray.length}`);
  }

  const runIdBuffer = Buffer.from(normalizedRunId, 'utf8');
  const returnsBuffer = Buffer.from(new Float64Array(returnArray).buffer);
  let intensitiesBuffer = Buffer.alloc(0);
  let scenariosBuffer = Buffer.alloc(0);

  if (normalizedPayloadType === PAYLOAD_TYPE_FULL) {
    const intensityArray = Array.isArray(intensities) ? intensities.map((value) => Number(value)) : Array.from(intensities || []);
    const scenarioArray = Array.isArray(scenarios) ? scenarios : Array.from(scenarios || []);
    if (intensityArray.length !== expectedReturnCount) {
      throw new Error(`Binary FULL payload intensity count mismatch: expected ${expectedReturnCount}, received ${intensityArray.length}`);
    }
    if (scenarioArray.length !== expectedReturnCount) {
      throw new Error(`Binary FULL payload scenario count mismatch: expected ${expectedReturnCount}, received ${scenarioArray.length}`);
    }
    const encodedScenarios = Buffer.alloc(scenarioArray.length);
    for (let index = 0; index < scenarioArray.length; index += 1) {
      encodedScenarios[index] = encodeScenarioCode(scenarioArray[index]);
    }
    intensitiesBuffer = Buffer.from(new Float64Array(intensityArray).buffer);
    scenariosBuffer = encodedScenarios;
  }

  const headerSize = 4 + 2 + 1 + 1 + 4 + 4 + 4 + 4 + 4 + 4;
  const totalLength = headerSize + runIdBuffer.length + returnsBuffer.length + intensitiesBuffer.length + scenariosBuffer.length;
  const buffer = Buffer.allocUnsafe(totalLength);
  let offset = 0;

  buffer.write(MAGIC, offset, 4, 'ascii'); offset += 4;
  buffer.writeUInt16LE(VERSION, offset); offset += 2;
  buffer.writeUInt8(normalizedPayloadType, offset); offset += 1;
  buffer.writeUInt8(0, offset); offset += 1;
  buffer.writeUInt32LE(runIdBuffer.length, offset); offset += 4;
  buffer.writeUInt32LE(normalizedPathCount, offset); offset += 4;
  buffer.writeUInt32LE(normalizedMonthCount, offset); offset += 4;
  buffer.writeUInt32LE(expectedReturnCount, offset); offset += 4;
  buffer.writeUInt32LE(normalizedPayloadType === PAYLOAD_TYPE_FULL ? expectedReturnCount : 0, offset); offset += 4;
  buffer.writeUInt32LE(normalizedPayloadType === PAYLOAD_TYPE_FULL ? expectedReturnCount : 0, offset); offset += 4;

  runIdBuffer.copy(buffer, offset); offset += runIdBuffer.length;
  returnsBuffer.copy(buffer, offset); offset += returnsBuffer.length;
  intensitiesBuffer.copy(buffer, offset); offset += intensitiesBuffer.length;
  scenariosBuffer.copy(buffer, offset); offset += scenariosBuffer.length;

  if (offset !== totalLength) {
    throw new Error(`Binary payload length mismatch: expected ${totalLength}, wrote ${offset}`);
  }

  return buffer;
};

const decodeMarketUniverseBinary = (payload) => {
  const buffer = toBuffer(payload);
  if (buffer.length < 32) {
    throw new Error('Binary Market Universe payload is truncated');
  }

  if (buffer.toString('ascii', 0, 4) !== MAGIC) {
    throw new Error('Invalid binary payload magic');
  }

  const version = buffer.readUInt16LE(4);
  if (version !== VERSION) {
    throw new Error(`Unsupported binary payload version: ${version}`);
  }

  const payloadTypeCode = buffer.readUInt8(6);
  const payloadType = payloadTypeCode === PAYLOAD_TYPE_RETURNS_ONLY ? 'RETURNS_ONLY' : (payloadTypeCode === PAYLOAD_TYPE_FULL ? 'FULL' : null);
  if (!payloadType) {
    throw new Error(`Unsupported binary payload type: ${payloadTypeCode}`);
  }

  const runIdLength = buffer.readUInt32LE(8);
  const pathCount = buffer.readUInt32LE(12);
  const monthCount = buffer.readUInt32LE(16);
  const returnCount = buffer.readUInt32LE(20);
  const intensityCount = buffer.readUInt32LE(24);
  const scenarioCount = buffer.readUInt32LE(28);

  if (!Number.isFinite(pathCount) || !Number.isFinite(monthCount) || pathCount <= 0 || monthCount <= 0) {
    throw new Error('Binary Market Universe payload has invalid geometry');
  }

  const expectedReturnCount = pathCount * monthCount;
  if (returnCount !== expectedReturnCount) {
    throw new Error(`Binary Market Universe payload geometry mismatch: expected returns=${expectedReturnCount}, got ${returnCount}`);
  }

  let offset = 32;
  const runId = buffer.toString('utf8', offset, offset + runIdLength);
  offset += runIdLength;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const returnsArray = new Array(returnCount);
  for (let index = 0; index < returnCount; index += 1) {
    returnsArray[index] = view.getFloat64(offset + index * 8, true);
  }
  offset += returnCount * 8;

  let intensities = null;
  let scenarios = null;

  if (payloadType === 'FULL') {
    if (intensityCount !== returnCount || scenarioCount !== returnCount) {
      throw new Error('Binary FULL payload element counts do not match the run geometry');
    }
    intensities = new Array(returnCount);
    for (let index = 0; index < returnCount; index += 1) {
      intensities[index] = view.getFloat64(offset + index * 8, true);
    }
    offset += returnCount * 8;
    const scenarioBytes = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, returnCount);
    scenarios = Array.from(scenarioBytes).map((code) => decodeScenarioCode(code));
    offset += returnCount;
  }

  if (offset > buffer.length) {
    throw new Error('Binary Market Universe payload is truncated');
  }

  return {
    payloadType,
    version,
    runId,
    pathCount,
    monthCount,
    returnCount,
    intensityCount,
    scenarioCount,
    returns: Array.from(returnsArray),
    intensities,
    scenarios,
    rawBuffer: buffer
  };
};

module.exports = {
  MAGIC,
  VERSION,
  PAYLOAD_TYPE_FULL,
  PAYLOAD_TYPE_RETURNS_ONLY,
  encodeMarketUniverseBinary,
  decodeMarketUniverseBinary,
  encodeScenarioCode,
  decodeScenarioCode,
  SCENARIO_MAP,
  SCENARIO_NAMES,
  normalizeScenarioName
};
