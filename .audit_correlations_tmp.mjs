import 'dotenv/config';
const { sequelize } = await import('./src/config/database.js');

const scenarios = ['expansion', 'soft_landing', 'recession', 'stagflation'];
const PSD_EPSILON = 1e-6;
const CORRELATION_EPSILON = 1e-6;
const MAX_CORRELATION_CELL_DELTA = 0.02;
const NEAREST_CORRELATION_TOLERANCE = 1e-10;
const NEAREST_CORRELATION_MAX_ITERATIONS = 100;

const rawRows = await sequelize.query(
  'SELECT isin1, isin2, expansion, recession, stagflation, soft_landing FROM etf_correlations ORDER BY isin1, isin2',
  { type: sequelize.QueryTypes.SELECT }
);
const etfs = await sequelize.query('SELECT id, isin, name FROM anagrafica_etf ORDER BY isin', { type: sequelize.QueryTypes.SELECT });
const allIsins = etfs.map((row) => row.isin);

const createMatrix = (size, value = 0) => Array.from({ length: size }, () => Array(size).fill(value));
const cloneMatrix = (matrix) => matrix.map((row) => [...row]);
const transpose = (matrix) => matrix[0].map((_, column) => matrix.map((row) => row[column]));
const subtractMatrices = (left, right) => left.map((row, rowIndex) => row.map((value, columnIndex) => value - right[rowIndex][columnIndex]));
const frobeniusNorm = (matrix) => Math.sqrt(matrix.reduce((total, row) => total + row.reduce((rowTotal, value) => rowTotal + value * value, 0), 0));
const maximumAbsoluteDifference = (left, right) => {
  let maximum = 0;
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < left.length; column += 1) {
      maximum = Math.max(maximum, Math.abs(left[row][column] - right[row][column]));
    }
  }
  return maximum;
};
const calculateMaxCellDelta = (original, corrected) => {
  let maximum = 0;
  for (let row = 0; row < original.length; row += 1) {
    for (let column = row + 1; column < original.length; column += 1) {
      maximum = Math.max(maximum, Math.abs(corrected[row][column] - original[row][column]));
    }
  }
  return maximum;
};
const assertCorrelationMatrixStructure = (matrix, scenario) => {
  if (matrix.length === 0) throw new Error(`EMPTY_CORRELATION_MATRIX:${scenario}`);
  for (let row = 0; row < matrix.length; row += 1) {
    if (matrix[row].length !== matrix.length) throw new Error(`INVALID_CORRELATION_MATRIX_DIMENSION:${scenario}`);
    for (let column = 0; column < matrix.length; column += 1) {
      const value = matrix[row][column];
      if (!Number.isFinite(value)) throw new Error(`INVALID_NUMERIC_VALUE:${scenario}:${row}:${column}`);
      if (value < -1 - CORRELATION_EPSILON || value > 1 + CORRELATION_EPSILON) throw new Error(`INVALID_ETF_CORRELATION_VALUE:${scenario}:${value}`);
      if (Math.abs(value - matrix[column][row]) > CORRELATION_EPSILON) throw new Error(`ASYMMETRIC_CORRELATION_MATRIX:${scenario}`);
    }
    if (Math.abs(matrix[row][row] - 1) > CORRELATION_EPSILON) throw new Error(`INVALID_CORRELATION_DIAGONAL:${scenario}:${row}`);
  }
};
const symmetricEigenDecomposition = (matrix, scenario) => {
  const size = matrix.length;
  const working = cloneMatrix(matrix);
  const eigenvectors = createMatrix(size, 0);
  for (let index = 0; index < size; index += 1) eigenvectors[index][index] = 1;
  const maximumIterations = Math.max(1, size * size * NEAREST_CORRELATION_MAX_ITERATIONS);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    let pivotRow = 0;
    let pivotColumn = 1;
    let maximumOffDiagonal = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(working[row][column]);
        if (magnitude > maximumOffDiagonal) {
          maximumOffDiagonal = magnitude;
          pivotRow = row;
          pivotColumn = column;
        }
      }
    }
    if (maximumOffDiagonal <= NEAREST_CORRELATION_TOLERANCE || size === 1) {
      const eigenvalues = working.map((row, index) => row[index]);
      return { eigenvalues, eigenvectors };
    }
    const app = working[pivotRow][pivotRow];
    const aqq = working[pivotColumn][pivotColumn];
    const apq = working[pivotRow][pivotColumn];
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) continue;
      const aip = working[index][pivotRow];
      const aiq = working[index][pivotColumn];
      working[index][pivotRow] = cosine * aip - sine * aiq;
      working[pivotRow][index] = working[index][pivotRow];
      working[index][pivotColumn] = sine * aip + cosine * aiq;
      working[pivotColumn][index] = working[index][pivotColumn];
    }
    working[pivotRow][pivotRow] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    working[pivotColumn][pivotColumn] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    working[pivotRow][pivotColumn] = 0;
    working[pivotColumn][pivotRow] = 0;
    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index][pivotRow];
      const viq = eigenvectors[index][pivotColumn];
      eigenvectors[index][pivotRow] = cosine * vip - sine * viq;
      eigenvectors[index][pivotColumn] = sine * vip + cosine * viq;
    }
  }
  throw new Error(`EIGENDECOMPOSITION_FAILED:${scenario}`);
};
const reconstructSymmetricMatrix = (eigenvectors, eigenvalues) => {
  const size = eigenvalues.length;
  const result = createMatrix(size, 0);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let value = 0;
      for (let index = 0; index < size; index += 1) value += eigenvectors[row][index] * eigenvalues[index] * eigenvectors[column][index];
      result[row][column] = value;
    }
  }
  return result;
};
const projectToPsd = (matrix, scenario) => {
  const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(matrix, scenario);
  return reconstructSymmetricMatrix(eigenvectors, eigenvalues.map((value) => Math.max(0, value)));
};
const projectToUnitDiagonal = (matrix) => matrix.map((row, rowIndex) => row.map((value, columnIndex) => rowIndex === columnIndex ? 1 : value));
const multiplyMatrices = (left, right) => {
  const rows = left.length;
  const columns = right[0]?.length ?? 0;
  const shared = right.length;
  const result = createMatrix(rows, 0);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let value = 0;
      for (let index = 0; index < shared; index += 1) value += left[row][index] * right[index][column];
      result[row][column] = value;
    }
  }
  return result;
};
const nearestCorrelationMatrix = (matrix, scenario) => {
  let current = cloneMatrix(matrix);
  const dykstraCorrection = createMatrix(matrix.length, 0);
  for (let iteration = 1; iteration <= NEAREST_CORRELATION_MAX_ITERATIONS; iteration += 1) {
    const previous = current;
    const residual = subtractMatrices(previous, dykstraCorrection);
    const projectedPsd = projectToPsd(residual, scenario);
    const correctedDykstra = subtractMatrices(projectedPsd, residual);
    current = projectToUnitDiagonal(projectedPsd);
    if (maximumAbsoluteDifference(current, previous) <= NEAREST_CORRELATION_TOLERANCE) {
      return { matrix: current, iterations: iteration };
    }
  }
  throw new Error(`CORRELATION_MATRIX_CORRECTION_FAILED:${scenario}`);
};
const getMinimumEigenvalue = (matrix, scenario) => Math.min(...symmetricEigenDecomposition(matrix, scenario).eigenvalues);
const getConditionNumber = (matrix, scenario) => {
  const eigenvalues = symmetricEigenDecomposition(matrix, scenario).eigenvalues.map(Math.abs);
  const positive = eigenvalues.filter((value) => value > CORRELATION_EPSILON);
  return positive.length === eigenvalues.length ? Math.max(...positive) / Math.min(...positive) : null;
};
const buildFactor = (matrix, scenario) => {
  const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(matrix, scenario);
  const hasNegativeEigenvalue = eigenvalues.some((eigenvalue) => eigenvalue < 0);
  const roots = eigenvalues.map((eigenvalue) => {
    if (eigenvalue < -PSD_EPSILON) throw new Error(`CORRELATION_MATRIX_NOT_PSD:${scenario}:${eigenvalue}`);
    return Math.sqrt(Math.max(0, eigenvalue));
  });
  const factor = eigenvectors.map((row) => row.map((value, index) => value * roots[index]));
  if (hasNegativeEigenvalue) {
    for (let row = 0; row < factor.length; row += 1) {
      const rowVariance = factor[row].reduce((total, value) => total + value * value, 0);
      const scale = Math.sqrt(rowVariance);
      factor[row] = factor[row].map((value) => value / scale);
    }
  }
  const factorProduct = multiplyMatrices(factor, transpose(factor));
  const operationalMatrix = hasNegativeEigenvalue ? factorProduct : matrix;
  const reconstructionError = maximumAbsoluteDifference(factorProduct, operationalMatrix);
  return { factor, eigenvalues, operationalMatrix, reconstructionError, rebuiltOperationalMatrix: hasNegativeEigenvalue };
};

const buildMatrixForScenario = (subsetIsins, scenarioName, rows) => {
  const indexByIsin = new Map();
  subsetIsins.forEach((isin, index) => indexByIsin.set(isin, index));
  const matrix = Array.from({ length: subsetIsins.length }, () => Array(subsetIsins.length).fill(0));
  for (let index = 0; index < subsetIsins.length; index += 1) matrix[index][index] = 1;
  for (const row of rows) {
    if (!subsetIsins.includes(row.isin1) || !subsetIsins.includes(row.isin2)) continue;
    const left = indexByIsin.get(row.isin1);
    const right = indexByIsin.get(row.isin2);
    const value = Number(row[scenarioName]);
    matrix[left][right] = value;
    matrix[right][left] = value;
  }
  return matrix;
};

const buildSnapshotForSubset = (subsetIsins, rows) => {
  const correlations = [];
  for (let left = 0; left < subsetIsins.length; left += 1) {
    for (let right = left + 1; right < subsetIsins.length; right += 1) {
      const isin1 = subsetIsins[left];
      const isin2 = subsetIsins[right];
      const row = rows.find((entry) => (entry.isin1 === isin1 && entry.isin2 === isin2) || (entry.isin1 === isin2 && entry.isin2 === isin1));
      if (!row) continue;
      const entry = { isin1, isin2 };
      for (const scenario of scenarios) entry[scenario] = Number(row[scenario]);
      correlations.push(entry);
    }
  }
  return { etfs: subsetIsins.map((isin) => ({ isin, name: isin })), correlations };
};

const prepareCorrelationMatrixAudit = (snapshot, scenario) => {
  const assetIsins = snapshot.etfs.map((etf) => etf.isin);
  const indexByIsin = new Map(assetIsins.map((isin, index) => [isin, index]));
  const originalMatrix = createMatrix(assetIsins.length, 0);
  for (let index = 0; index < assetIsins.length; index += 1) originalMatrix[index][index] = 1;
  for (const correlation of snapshot.correlations) {
    const left = indexByIsin.get(correlation.isin1);
    const right = indexByIsin.get(correlation.isin2);
    const value = correlation[scenario];
    if (left === undefined || right === undefined) throw new Error(`INVALID_ETF_CORRELATION:${scenario}`);
    if (left === right) throw new Error(`INVALID_ETF_CORRELATION:${scenario}`);
    originalMatrix[left][right] = value;
    originalMatrix[right][left] = value;
  }
  assertCorrelationMatrixStructure(originalMatrix, scenario);
  const minimumEigenvalueBefore = getMinimumEigenvalue(originalMatrix, scenario);
  let candidateMatrix = originalMatrix;
  let correctionApplied = false;
  let operationalMatrix = originalMatrix;
  let correctionIterations = 0;
  let maxCellDelta = 0;
  let frobeniusDelta = 0;
  if (minimumEigenvalueBefore < -PSD_EPSILON) {
    const correction = nearestCorrelationMatrix(originalMatrix, scenario);
    candidateMatrix = correction.matrix;
    correctionIterations = correction.iterations;
    correctionApplied = true;
  }
  assertCorrelationMatrixStructure(candidateMatrix, scenario);
  const factorResult = buildFactor(candidateMatrix, scenario);
  operationalMatrix = factorResult.operationalMatrix;
  correctionApplied ||= factorResult.rebuiltOperationalMatrix;
  let guardFailure = null;
  if (correctionApplied) {
    assertCorrelationMatrixStructure(operationalMatrix, scenario);
    maxCellDelta = calculateMaxCellDelta(originalMatrix, operationalMatrix);
    frobeniusDelta = frobeniusNorm(subtractMatrices(operationalMatrix, originalMatrix));
    if (maxCellDelta > MAX_CORRELATION_CELL_DELTA) {
      guardFailure = {
        scenario,
        code: 'CORRELATION_MATRIX_CORRECTION_TOO_LARGE',
        maxCellDelta,
        threshold: MAX_CORRELATION_CELL_DELTA
      };
    }
  }
  const minimumEigenvalueAfter = getMinimumEigenvalue(operationalMatrix, scenario);
  if (minimumEigenvalueAfter < -PSD_EPSILON) throw new Error(`CORRELATION_MATRIX_NOT_PSD:${scenario}:${minimumEigenvalueAfter}`);
  return { scenario, assetIsins, originalMatrix, operationalMatrix, correctionApplied, minimumEigenvalueBefore, minimumEigenvalueAfter, maxCellDelta, frobeniusDelta, correctionIterations, factorResult, guardFailure };
};

const summarizeScenario = (subsetIsins, scenarioName, rows) => {
  const rawMatrix = buildMatrixForScenario(subsetIsins, scenarioName, rows);
  const rawMin = getMinimumEigenvalue(rawMatrix, scenarioName);
  const snapshot = buildSnapshotForSubset(subsetIsins, rows);
  let result = null;
  let failure = null;
  try {
    result = prepareCorrelationMatrixAudit(snapshot, scenarioName);
  } catch (error) {
    failure = {
      scenario: scenarioName,
      code: error.code || error.message.split(':')[0],
      maxCellDelta: error.maxCellDelta ?? null,
      threshold: error.threshold ?? MAX_CORRELATION_CELL_DELTA,
      message: error.message
    };
  }
  const correctedMatrix = result ? result.operationalMatrix : null;
  const guardFailure = result?.guardFailure ?? null;
  const top = [];
  for (let left = 0; left < subsetIsins.length; left += 1) {
    for (let right = left + 1; right < subsetIsins.length; right += 1) {
      const rawValue = rawMatrix[left][right];
      const correctedValue = correctedMatrix ? correctedMatrix[left][right] : rawMatrix[left][right];
      top.push({
        isinA: subsetIsins[left],
        isinB: subsetIsins[right],
        raw: rawValue,
        corrected: correctedValue,
        delta: Math.abs(correctedValue - rawValue)
      });
    }
  }
  top.sort((a, b) => b.delta - a.delta);
  return {
    assetCount: subsetIsins.length,
    rawMinEigenvalue: rawMin,
    correctedMinEigenvalue: result ? result.minimumEigenvalueAfter : null,
    correctionMetric: result ? result.maxCellDelta : failure?.maxCellDelta ?? null,
    guardThreshold: MAX_CORRELATION_CELL_DELTA,
    pass: result ? (result.minimumEigenvalueAfter >= -PSD_EPSILON && result.maxCellDelta <= MAX_CORRELATION_CELL_DELTA && !guardFailure) : false,
    method: result ? (result.correctionApplied ? 'nearestCorrelationMatrix + PSD projection' : 'no correction required') : 'nearestCorrelationMatrix correction rejected by guard',
    topAlteredPairs: top.slice(0, 10),
    guardFailure,
    failure
  };
};

const fullSummary = {};
for (const scenario of scenarios) fullSummary[scenario] = summarizeScenario(allIsins, scenario, rawRows);
const portfolioRows = await sequelize.query('SELECT p.nome AS portfolio_name, pe."etfId" AS etf_id FROM portafogli p JOIN portafoglio_etf pe ON pe."portafoglioId" = p.id ORDER BY p.nome, pe."etfId"', { type: sequelize.QueryTypes.SELECT });
const etfById = new Map(etfs.map((row) => [row.id, row.isin]));
const portfolios = new Map();
for (const row of portfolioRows) {
  const current = portfolios.get(row.portfolio_name) || [];
  current.push(etfById.get(row.etf_id));
  portfolios.set(row.portfolio_name, current.filter(Boolean));
}
const subsetSummary = {};
for (const [portfolioName, subsetIsins] of [...portfolios.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const unique = [...new Set(subsetIsins)];
  if (unique.length < 2) continue;
  subsetSummary[portfolioName] = {};
  for (const scenario of scenarios) subsetSummary[portfolioName][scenario] = summarizeScenario(unique, scenario, rawRows);
}
console.log(JSON.stringify({
  fullUniverse: fullSummary,
  portfolioSubsets: subsetSummary,
  portfolioSizes: [...portfolios.entries()].map(([name, arr]) => ({ name, assetCount: [...new Set(arr)].length }))
}, null, 2));
await sequelize.close();
