import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, boolCV, listCV, tupleCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_LEASE_ID = 101;
const ERR_NO_PAYMENT_HISTORY = 102;
const ERR_THRESHOLD_FAILED = 103;
const ERR_INVALID_RULES = 104;
const ERR_RENEWAL_IN_PROGRESS = 105;
const ERR_PERIOD_MISMATCH = 106;
const ERR_CALCULATION_OVERFLOW = 107;
const ERR_ORACLE_NOT_VERIFIED = 108;
const ERR_GRACE_PERIOD_EXCEEDED = 109;
const ERR_MIN_PAYMENTS_NOT_MET = 110;
const ERR_INVALID_THRESHOLD = 111;
const ERR_INVALID_PERIOD = 112;
const ERR_LEASE_NOT_FOUND = 113;
const ERR_UPDATE_FAILED = 114;

interface LeaseRules {
  threshold: number;
  period: number;
  durationExtension: number;
  minPayments: number;
  graceDays: number;
}

interface EvaluationHistory {
  timestamp: number;
  metThreshold: boolean;
  onTimeCount: number;
  totalCount: number;
  ratio: number;
}

interface RenewalStatus {
  lastRenewed: number;
  nextEligible: number;
  active: boolean;
  extensions: number;
}

interface PaymentRecord {
  amount: number;
  timestamp: number;
  onTime: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class PaymentTrackerMock {
  history: Map<number, PaymentRecord[]> = new Map();
  getHistory(leaseId: number): Result<PaymentRecord[]> {
    const h = this.history.get(leaseId);
    return h ? { ok: true, value: h } : { ok: false, value: ERR_NO_PAYMENT_HISTORY };
  }
}

class LeaseFactoryMock {
  terms: Map<number, number> = new Map();
  getTerm(leaseId: number): Result<number> {
    const t = this.terms.get(leaseId);
    return t !== undefined ? { ok: true, value: t } : { ok: false, value: ERR_LEASE_NOT_FOUND };
  }
  updateTerm(leaseId: number, newTerm: number): Result<boolean> {
    this.terms.set(leaseId, newTerm);
    return { ok: true, value: true };
  }
}

class RenewalCheckerMock {
  state: {
    nextEvaluationId: number;
    maxEvaluations: number;
    oraclePrincipal: string;
    defaultThreshold: number;
    defaultPeriod: number;
    gracePeriod: number;
    leaseRules: Map<number, LeaseRules>;
    evaluationHistory: Map<string, EvaluationHistory>;
    renewalStatus: Map<number, RenewalStatus>;
    blockHeight: number;
  } = {
    nextEvaluationId: 0,
    maxEvaluations: 500,
    oraclePrincipal: "ST1TEST",
    defaultThreshold: 90,
    defaultPeriod: 12,
    gracePeriod: 30,
    leaseRules: new Map(),
    evaluationHistory: new Map(),
    renewalStatus: new Map(),
    blockHeight: 100,
  };
  caller: string = "ST1TEST";
  paymentTracker: PaymentTrackerMock;
  leaseFactory: LeaseFactoryMock;

  constructor() {
    this.paymentTracker = new PaymentTrackerMock();
    this.leaseFactory = new LeaseFactoryMock();
    this.reset();
  }

  reset() {
    this.state = {
      nextEvaluationId: 0,
      maxEvaluations: 500,
      oraclePrincipal: "ST1TEST",
      defaultThreshold: 90,
      defaultPeriod: 12,
      gracePeriod: 30,
      leaseRules: new Map(),
      evaluationHistory: new Map(),
      renewalStatus: new Map(),
      blockHeight: 100,
    };
    this.caller = "ST1TEST";
    this.paymentTracker.history.clear();
    this.leaseFactory.terms.clear();
  }

  isOracle(caller: string): Result<boolean> {
    return caller === this.state.oraclePrincipal ? { ok: true, value: true } : { ok: false, value: ERR_ORACLE_NOT_VERIFIED };
  }

  setOracle(newOracle: string): Result<boolean> {
    if (this.caller !== this.state.oraclePrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.oraclePrincipal = newOracle;
    return { ok: true, value: true };
  }

  setDefaultThreshold(newThresh: number): Result<boolean> {
    const oracleRes = this.isOracle(this.caller);
    if (!oracleRes.ok) return oracleRes;
    if (newThresh > 100 || newThresh <= 0) return { ok: false, value: ERR_INVALID_THRESHOLD };
    this.state.defaultThreshold = newThresh;
    return { ok: true, value: true };
  }

  setDefaultPeriod(newPeriod: number): Result<boolean> {
    const oracleRes = this.isOracle(this.caller);
    if (!oracleRes.ok) return oracleRes;
    if (newPeriod <= 0) return { ok: false, value: ERR_INVALID_PERIOD };
    this.state.defaultPeriod = newPeriod;
    return { ok: true, value: true };
  }

  setGracePeriod(newGrace: number): Result<boolean> {
    const oracleRes = this.isOracle(this.caller);
    if (!oracleRes.ok) return oracleRes;
    this.state.gracePeriod = newGrace;
    return { ok: true, value: true };
  }

  setLeaseRules(leaseId: number, rules: LeaseRules): Result<boolean> {
    if (leaseId <= 0) return { ok: false, value: ERR_INVALID_LEASE_ID };
    if (rules.threshold > 100 || rules.threshold <= 0) return { ok: false, value: ERR_INVALID_THRESHOLD };
    if (rules.period <= 0) return { ok: false, value: ERR_INVALID_PERIOD };
    if (rules.minPayments <= 0) return { ok: false, value: ERR_MIN_PAYMENTS_NOT_MET };
    if (rules.graceDays > this.state.gracePeriod) return { ok: false, value: ERR_GRACE_PERIOD_EXCEEDED };
    this.state.leaseRules.set(leaseId, rules);
    return { ok: true, value: true };
  }

  calculateOnTimeRatio(history: PaymentRecord[], period: number): Result<number> {
    const total = history.length;
    const onTime = history.filter(p => p.onTime).length;
    const periodPayments = Math.min(total, period);
    if (periodPayments <= 0) return { ok: false, value: ERR_PERIOD_MISMATCH };
    const divRes = onTime / periodPayments;
    const ratio = Math.floor(divRes * 100);
    if (ratio > 100) return { ok: true, value: 100 };
    return { ok: true, value: ratio };
  }

  meetsThreshold(history: PaymentRecord[], rules: LeaseRules): boolean {
    const total = history.length;
    const ratioRes = this.calculateOnTimeRatio(history, rules.period);
    const ratio = ratioRes.ok ? ratioRes.value : 0;
    return total >= rules.minPayments && ratio >= rules.threshold;
  }

  checkAndRenew(leaseId: number): Result<number> {
    if (leaseId <= 0) return { ok: false, value: ERR_INVALID_LEASE_ID };
    let rules = this.state.leaseRules.get(leaseId);
    if (!rules) {
      rules = { threshold: this.state.defaultThreshold, period: this.state.defaultPeriod, durationExtension: 12, minPayments: 6, graceDays: this.state.gracePeriod };
    }
    const historyRes = this.paymentTracker.getHistory(leaseId);
    if (!historyRes.ok) return historyRes;
    const history = historyRes.value;
    let status = this.state.renewalStatus.get(leaseId);
    if (!status) status = { lastRenewed: 0, nextEligible: 0, active: true, extensions: 0 };
    if (!status.active) return { ok: false, value: ERR_RENEWAL_IN_PROGRESS };
    if (this.state.blockHeight < status.nextEligible) return { ok: false, value: ERR_GRACE_PERIOD_EXCEEDED };
    const meets = this.meetsThreshold(history, rules);
    if (!meets) return { ok: false, value: ERR_THRESHOLD_FAILED };
    const currentTermRes = this.leaseFactory.getTerm(leaseId);
    if (!currentTermRes.ok) return { ok: false, value: ERR_LEASE_NOT_FOUND };
    const newTerm = currentTermRes.value + rules.durationExtension;
    const updateRes = this.leaseFactory.updateTerm(leaseId, newTerm);
    if (!updateRes.ok) return { ok: false, value: ERR_UPDATE_FAILED };
    this.state.renewalStatus.set(leaseId, {
      lastRenewed: this.state.blockHeight,
      nextEligible: this.state.blockHeight + rules.period,
      active: true,
      extensions: status.extensions + 1,
    });
    const ratioRes = this.calculateOnTimeRatio(history, rules.period);
    const ratio = ratioRes.ok ? ratioRes.value : 0;
    this.state.evaluationHistory.set(`${leaseId}-${this.state.nextEvaluationId}`, {
      timestamp: this.state.blockHeight,
      metThreshold: true,
      onTimeCount: history.filter(p => p.onTime).length,
      totalCount: history.length,
      ratio,
    });
    this.state.nextEvaluationId++;
    return { ok: true, value: newTerm };
  }

  manualEvaluation(leaseId: number): Result<boolean> {
    const oracleRes = this.isOracle(this.caller);
    if (!oracleRes.ok) return oracleRes;
    if (leaseId <= 0) return { ok: false, value: ERR_INVALID_LEASE_ID };
    let rules = this.state.leaseRules.get(leaseId);
    if (!rules) {
      rules = { threshold: this.state.defaultThreshold, period: this.state.defaultPeriod, durationExtension: 12, minPayments: 6, graceDays: this.state.gracePeriod };
    }
    const historyRes = this.paymentTracker.getHistory(leaseId);
    if (!historyRes.ok) return historyRes;
    const history = historyRes.value;
    const meets = this.meetsThreshold(history, rules);
    if (meets) {
      const renewRes = this.checkAndRenew(leaseId);
      return renewRes.ok ? { ok: true, value: true } : { ok: false, value: false };
    }
    return { ok: true, value: false };
  }

  getLeaseRules(leaseId: number): LeaseRules | null {
    return this.state.leaseRules.get(leaseId) || null;
  }

  getEvaluationHistory(leaseId: number, evalId: number): EvaluationHistory | null {
    return this.state.evaluationHistory.get(`${leaseId}-${evalId}`) || null;
  }

  getRenewalStatus(leaseId: number): RenewalStatus | null {
    return this.state.renewalStatus.get(leaseId) || null;
  }

  getEvaluationCount(): Result<number> {
    return { ok: true, value: this.state.nextEvaluationId };
  }
}

describe("RenewalChecker", () => {
  let contract: RenewalCheckerMock;

  beforeEach(() => {
    contract = new RenewalCheckerMock();
    contract.reset();
  });

  it("sets lease rules successfully", () => {
    const rules: LeaseRules = { threshold: 85, period: 10, durationExtension: 12, minPayments: 5, graceDays: 20 };
    const result = contract.setLeaseRules(1, rules);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const stored = contract.getLeaseRules(1);
    expect(stored).toEqual(rules);
  });

  it("rejects invalid threshold in rules", () => {
    const rules: LeaseRules = { threshold: 101, period: 10, durationExtension: 12, minPayments: 5, graceDays: 20 };
    const result = contract.setLeaseRules(1, rules);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_THRESHOLD);
  });

  it("rejects invalid lease id", () => {
    const rules: LeaseRules = { threshold: 85, period: 10, durationExtension: 12, minPayments: 5, graceDays: 20 };
    const result = contract.setLeaseRules(0, rules);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LEASE_ID);
  });

  it("fails renewal on threshold", () => {
    contract.paymentTracker.history.set(1, [
      { amount: 100, timestamp: 50, onTime: false },
      { amount: 100, timestamp: 60, onTime: false },
    ]);
    contract.leaseFactory.terms.set(1, 12);
    const result = contract.checkAndRenew(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_THRESHOLD_FAILED);
  });

  it("uses default rules when not set", () => {
    contract.paymentTracker.history.set(1, Array(13).fill(0).map(() => ({ amount: 100, timestamp: 0, onTime: true })));
    contract.leaseFactory.terms.set(1, 12);
    const result = contract.checkAndRenew(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(24);
  });

  it("manual evaluation by non-oracle fails", () => {
    contract.caller = "ST2FAKE";
    const result = contract.manualEvaluation(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_NOT_VERIFIED);
  });

  it("sets default threshold successfully", () => {
    const result = contract.setDefaultThreshold(80);
    expect(result.ok).toBe(true);
    expect(contract.state.defaultThreshold).toBe(80);
  });

  it("rejects invalid default threshold", () => {
    const result = contract.setDefaultThreshold(101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_THRESHOLD);
  });

  it("gets renewal status", () => {
    contract.state.renewalStatus.set(1, { lastRenewed: 100, nextEligible: 112, active: true, extensions: 2 });
    const status = contract.getRenewalStatus(1);
    expect(status).toEqual({ lastRenewed: 100, nextEligible: 112, active: true, extensions: 2 });
  });

  it("parses uint with Clarity", () => {
    const cv = uintCV(100);
    expect(cv.value.toString()).toBe("100");
  });

  it("rejects renewal in progress", () => {
    contract.state.renewalStatus.set(1, { lastRenewed: 0, nextEligible: 0, active: false, extensions: 0 });
    contract.paymentTracker.history.set(1, [{ amount: 100, timestamp: 50, onTime: true }]);
    const result = contract.checkAndRenew(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RENEWAL_IN_PROGRESS);
  });

  it("rejects grace period exceeded", () => {
    contract.state.renewalStatus.set(1, { lastRenewed: 0, nextEligible: 200, active: true, extensions: 0 });
    contract.state.blockHeight = 150;
    contract.paymentTracker.history.set(1, [{ amount: 100, timestamp: 50, onTime: true }]);
    const result = contract.checkAndRenew(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_GRACE_PERIOD_EXCEEDED);
  });
});