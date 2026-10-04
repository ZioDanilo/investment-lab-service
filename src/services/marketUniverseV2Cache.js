class MarketUniverseV2Cache {
  constructor({ maxEtfs = Number(process.env.MARKET_UNIVERSE_V2_CACHE_MAX_ETFS || 200) } = {}) {
    this.maxEtfs = Math.max(1, Number(maxEtfs) || 200);
    this.runId = null;
    this.run = null;
    this.etfs = new Map();
  }

  ensureRun(run) {
    const runId = String(run?.runId || '');
    if (!runId) return;
    if (this.runId !== runId) {
      this.runId = runId;
      this.run = run;
      this.etfs.clear();
    } else if (!this.run) {
      this.run = run;
    }
  }

  getRun() {
    return this.run;
  }

  setRun(run) {
    this.ensureRun(run);
    this.run = run;
  }

  getEtf(runId, isin) {
    if (String(runId || '') !== this.runId) return null;
    const key = String(isin || '').trim().toUpperCase();
    const value = this.etfs.get(key);
    if (!value) return null;
    this.etfs.delete(key);
    this.etfs.set(key, value);
    return value;
  }

  setEtf(runId, isin, values) {
    if (String(runId || '') !== this.runId) return;
    const key = String(isin || '').trim().toUpperCase();
    if (this.etfs.has(key)) this.etfs.delete(key);
    this.etfs.set(key, values);
    while (this.etfs.size > this.maxEtfs) {
      const oldestKey = this.etfs.keys().next().value;
      this.etfs.delete(oldestKey);
    }
  }

  invalidate() {
    this.runId = null;
    this.run = null;
    this.etfs.clear();
  }

  status() {
    return { runId: this.runId, cachedEtfs: this.etfs.size, maxEtfs: this.maxEtfs };
  }
}

module.exports = new MarketUniverseV2Cache();
