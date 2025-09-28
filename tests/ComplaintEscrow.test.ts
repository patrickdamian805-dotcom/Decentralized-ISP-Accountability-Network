// complaint-escrow.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Complaint {
  user: string;
  testId: number;
  stake: number;
  status: string;
  timestamp: number;
  expiry: number;
  description: string;
}

interface Dispute {
  ispParty: string;
  evidenceHash: Uint8Array;
  status: string;
  timestamp: number;
}

interface HistoryEvent {
  eventType: string;
  actor: string;
  timestamp: number;
  details: string;
}

interface ContractState {
  complaints: Map<number, Complaint>;
  disputes: Map<number, Dispute>;
  complaintHistory: Map<string, HistoryEvent>; // Key as `${complaintId}-${eventId}`
  complaintCounter: number;
  totalStaked: number;
  paused: boolean;
  owner: string;
  governanceHook: string | null;
  historyCounters: Map<number, number>; // Per complaint history counter
}

class ComplaintEscrowMock {
  private state: ContractState = {
    complaints: new Map(),
    disputes: new Map(),
    complaintHistory: new Map(),
    complaintCounter: 0,
    totalStaked: 0,
    paused: false,
    owner: "deployer",
    governanceHook: null,
    historyCounters: new Map(),
  };

  private MIN_STAKE = 1000000;
  private COMPLAINT_TIMEOUT = 144;
  private MAX_DESCRIPTION_LEN = 500;
  private ERR_NOT_AUTHORIZED = 100;
  private ERR_INVALID_TEST = 101;
  private ERR_COMPLAINT_NOT_FOUND = 103;
  private ERR_INVALID_STATUS = 104;
  private ERR_ORACLE_FAILURE = 105;
  private ERR_COMPLAINT_EXPIRED = 108;
  private ERR_DISPUTE_ALREADY_EXISTS = 113;
  private ERR_NO_DISPUTE = 114;
  private ERR_INVALID_DISPUTE_PARTY = 115;
  private ERR_PAUSED = 111;
  private ERR_INVALID_PARAM = 110;

  // Mock block height for testing
  private mockBlockHeight = 1000;

  fileComplaint(
    caller: string,
    testId: number,
    description: string,
    testExists: boolean = true
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (description.length > this.MAX_DESCRIPTION_LEN) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    if (!testExists) {
      return { ok: false, value: this.ERR_INVALID_TEST };
    }
    const complaintId = this.state.complaintCounter + 1;
    this.state.complaints.set(complaintId, {
      user: caller,
      testId,
      stake: this.MIN_STAKE,
      status: "pending",
      timestamp: this.mockBlockHeight,
      expiry: this.mockBlockHeight + this.COMPLAINT_TIMEOUT,
      description,
    });
    this.state.complaintCounter = complaintId;
    this.state.totalStaked += this.MIN_STAKE;
    this.logHistory(complaintId, "filed", description);
    return { ok: true, value: complaintId };
  }

  validateComplaint(
    complaintId: number,
    isValid: boolean = true
  ): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(complaintId);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (complaint.status !== "pending") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (this.mockBlockHeight >= complaint.expiry) {
      return { ok: false, value: this.ERR_COMPLAINT_EXPIRED };
    }
    complaint.status = isValid ? "validated" : "rejected";
    this.logHistory(complaintId, isValid ? "validated" : "rejected", "Oracle decision");
    return { ok: true, value: isValid };
  }

  releaseStake(complaintId: number): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(complaintId);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (complaint.status !== "rejected") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    this.state.totalStaked -= complaint.stake;
    complaint.status = "resolved";
    this.logHistory(complaintId, "stake-released", "Rejected complaint");
    return { ok: true, value: true };
  }

  slashStake(complaintId: number): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(complaintId);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (complaint.status !== "rejected") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    // Simulate slash by reducing total staked
    this.state.totalStaked -= complaint.stake;
    complaint.status = "resolved";
    this.logHistory(complaintId, "stake-slashed", "Frivolous complaint");
    return { ok: true, value: true };
  }

  triggerResolution(complaintId: number, success: boolean = true): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(complaintId);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (complaint.status !== "validated") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (!success) {
      return { ok: false, value: this.ERR_ORACLE_FAILURE };
    }
    complaint.status = "resolved";
    this.logHistory(complaintId, "resolved", "Modem replacement initiated");
    return { ok: true, value: true };
  }

  initiateDispute(
    complaintId: number,
    evidenceHash: Uint8Array,
    ispParty: string
  ): ClarityResponse<boolean> {
    const complaint = this.state.complaints.get(complaintId);
    if (!complaint) {
      return { ok: false, value: this.ERR_COMPLAINT_NOT_FOUND };
    }
    if (complaint.status !== "validated") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    if (this.state.disputes.has(complaintId)) {
      return { ok: false, value: this.ERR_DISPUTE_ALREADY_EXISTS };
    }
    this.state.disputes.set(complaintId, {
      ispParty,
      evidenceHash,
      status: "open",
      timestamp: this.mockBlockHeight,
    });
    complaint.status = "disputed";
    this.logHistory(complaintId, "dispute-initiated", "ISP challenge");
    return { ok: true, value: true };
  }

  resolveDispute(
    caller: string,
    complaintId: number,
    acceptUser: boolean
  ): ClarityResponse<boolean> {
    const dispute = this.state.disputes.get(complaintId);
    if (!dispute) {
      return { ok: false, value: this.ERR_NO_DISPUTE };
    }
    if (caller !== dispute.ispParty) {
      return { ok: false, value: this.ERR_INVALID_DISPUTE_PARTY };
    }
    if (dispute.status !== "open") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    dispute.status = acceptUser ? "resolved" : "escalated";
    const complaint = this.state.complaints.get(complaintId)!;
    complaint.status = acceptUser ? "validated" : "rejected";
    this.logHistory(complaintId, "dispute-resolved", acceptUser ? "User accepted" : "Escalated");
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setGovernanceHook(caller: string, newHook: string): ClarityResponse<boolean> {
    if (caller !== this.state.owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.governanceHook = newHook;
    return { ok: true, value: true };
  }

  transferOwnership(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (caller !== this.state.owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.owner = newOwner;
    return { ok: true, value: true };
  }

  getComplaint(complaintId: number): ClarityResponse<Complaint | null> {
    return { ok: true, value: this.state.complaints.get(complaintId) ?? null };
  }

  getDispute(complaintId: number): ClarityResponse<Dispute | null> {
    return { ok: true, value: this.state.disputes.get(complaintId) ?? null };
  }

  getHistoryEvent(complaintId: number, eventId: number): ClarityResponse<HistoryEvent | null> {
    const key = `${complaintId}-${eventId}`;
    return { ok: true, value: this.state.complaintHistory.get(key) ?? null };
  }

  getTotalStaked(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalStaked };
  }

  getContractStatus(): ClarityResponse<{ paused: boolean; owner: string; governance: string | null }> {
    return {
      ok: true,
      value: {
        paused: this.state.paused,
        owner: this.state.owner,
        governance: this.state.governanceHook,
      },
    };
  }

  getComplaintCount(): ClarityResponse<number> {
    return { ok: true, value: this.state.complaintCounter };
  }

  private logHistory(complaintId: number, eventType: string, details: string) {
    let counter = this.state.historyCounters.get(complaintId) ?? 0;
    counter += 1;
    const key = `${complaintId}-${counter}`;
    this.state.complaintHistory.set(key, {
      eventType,
      actor: "mock-actor",
      timestamp: this.mockBlockHeight,
      details,
    });
    this.state.historyCounters.set(complaintId, counter);
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  isp1: "isp_1",
};

describe("ComplaintEscrow Contract", () => {
  let contract: ComplaintEscrowMock;

  beforeEach(() => {
    contract = new ComplaintEscrowMock();
    vi.resetAllMocks();
  });

  it("should file a new complaint successfully", () => {
    const result = contract.fileComplaint(accounts.user1, 1, "Slow internet");
    expect(result).toEqual({ ok: true, value: 1 });
    const complaint = contract.getComplaint(1).value as Complaint;
    expect(complaint.status).toBe("pending");
    expect(complaint.stake).toBe(1000000);
    expect(contract.getTotalStaked()).toEqual({ ok: true, value: 1000000 });
  });

  it("should prevent filing when paused", () => {
    contract.pause(accounts.deployer);
    const result = contract.fileComplaint(accounts.user1, 1, "Slow internet");
    expect(result).toEqual({ ok: false, value: 111 });
  });

  it("should validate a complaint", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    const result = contract.validateComplaint(1, true);
    expect(result).toEqual({ ok: true, value: true });
    const complaint = contract.getComplaint(1).value as Complaint;
    expect(complaint.status).toBe("validated");
  });

  it("should reject expired complaint validation", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract["mockBlockHeight"] += 200; // Simulate time pass
    const result = contract.validateComplaint(1);
    expect(result).toEqual({ ok: false, value: 108 });
  });

  it("should release stake for rejected complaint", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract.validateComplaint(1, false);
    const result = contract.releaseStake(1);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getTotalStaked()).toEqual({ ok: true, value: 0 });
    const complaint = contract.getComplaint(1).value as Complaint;
    expect(complaint.status).toBe("resolved");
  });

  it("should slash stake for rejected complaint", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract.validateComplaint(1, false);
    const result = contract.slashStake(1);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getTotalStaked()).toEqual({ ok: true, value: 0 });
  });

  it("should trigger resolution for validated complaint", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract.validateComplaint(1, true);
    const result = contract.triggerResolution(1);
    expect(result).toEqual({ ok: true, value: true });
    const complaint = contract.getComplaint(1).value as Complaint;
    expect(complaint.status).toBe("resolved");
  });

  it("should initiate dispute for validated complaint", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract.validateComplaint(1, true);
    const evidence = new Uint8Array(32);
    const result = contract.initiateDispute(1, evidence, accounts.isp1);
    expect(result).toEqual({ ok: true, value: true });
    const dispute = contract.getDispute(1).value as Dispute;
    expect(dispute.status).toBe("open");
    const complaint = contract.getComplaint(1).value as Complaint;
    expect(complaint.status).toBe("disputed");
  });

  it("should resolve dispute", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract.validateComplaint(1, true);
    const evidence = new Uint8Array(32);
    contract.initiateDispute(1, evidence, accounts.isp1);
    const result = contract.resolveDispute(accounts.isp1, 1, true);
    expect(result).toEqual({ ok: true, value: true });
    const dispute = contract.getDispute(1).value as Dispute;
    expect(dispute.status).toBe("resolved");
    const complaint = contract.getComplaint(1).value as Complaint;
    expect(complaint.status).toBe("validated");
  });

  it("should prevent invalid party from resolving dispute", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    contract.validateComplaint(1, true);
    const evidence = new Uint8Array(32);
    contract.initiateDispute(1, evidence, accounts.isp1);
    const result = contract.resolveDispute(accounts.user1, 1, true);
    expect(result).toEqual({ ok: false, value: 115 });
  });

  it("should log history events", () => {
    contract.fileComplaint(accounts.user1, 1, "Slow internet");
    const event = contract.getHistoryEvent(1, 1).value as HistoryEvent;
    expect(event.eventType).toBe("filed");
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pause(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    const status = contract.getContractStatus().value as { paused: boolean; owner: string; governance: string | null };
    expect(status.paused).toBe(true);

    const unpauseResult = contract.unpause(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    const newStatus = contract.getContractStatus().value as { paused: boolean; owner: string; governance: string | null };
    expect(newStatus.paused).toBe(false);
  });

  it("should set governance hook", () => {
    const result = contract.setGovernanceHook(accounts.deployer, "gov-address");
    expect(result).toEqual({ ok: true, value: true });
    const status = contract.getContractStatus().value as { paused: boolean; owner: string; governance: string | null };
    expect(status.governance).toBe("gov-address");
  });

  it("should transfer ownership", () => {
    const result = contract.transferOwnership(accounts.deployer, accounts.user1);
    expect(result).toEqual({ ok: true, value: true });
    const status = contract.getContractStatus().value as { paused: boolean; owner: string; governance: string | null };
    expect(status.owner).toBe(accounts.user1);
  });
});