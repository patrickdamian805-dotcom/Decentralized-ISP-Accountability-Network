# SpeedChain: Decentralized ISP Accountability Network

## Project Overview

**SpeedChain** is a Web3 platform built on the Stacks blockchain using Clarity smart contracts, designed to empower users frustrated with unreliable internet speeds from ISPs. Users perform blockchain-verified speed tests on their laptops, log complaints immutably via virtual logging, and trigger automated resolutions like in-person modem replacements or refunds through smart contracts. 

This solves real-world problems such as:
- **ISP Evasion of Accountability**: ISPs often dismiss speed complaints without evidence; SpeedChain provides tamper-proof, verifiable logs.
- **Manual Dispute Resolution Delays**: Traditional processes take weeks; smart contracts automate verification and fulfillment.
- **Modem Hardware Failures**: Users waste time on self-diagnosis; the platform coordinates verified in-person replacements with service providers.
- **Lack of Transparency in Service SLAs**: Blockchain ensures auditable compliance with promised speeds (e.g., 100Mbps minimum).
- **User Trust Erosion**: Decentralized incentives (e.g., token rewards for valid complaints) encourage participation and fair ISP behavior.

The platform integrates with browser extensions for seamless speed testing (using WebRTC for peer-to-peer verification) and oracles (e.g., Chainlink on Stacks) for off-chain data like geolocation and modem diagnostics. Users stake tokens to file complaints, recoverable upon validation, creating economic alignment.

Key Features:
- Virtual logging of speed tests with cryptographic proofs (e.g., Merkle trees of test data).
- Smart contract-driven workflows for complaint lifecycle.
- Integration with logistics partners for modem replacements.
- Governance token ($SPD) for DAO voting on ISP partnerships.

## Technical Architecture

The core is 6 Clarity smart contracts, deployed on Stacks mainnet/testnet. They form a modular system for user onboarding, data integrity, dispute handling, and fulfillment. Contracts use traits for composability and SIP-005 for upgrades.

### 1. **UserRegistry** (User Onboarding & Identity)
   - Manages user profiles (wallet addresses linked to verified laptop IDs via zero-knowledge proofs).
   - Functions: `register-user`, `update-profile`, `get-user-status`.
   - Solves: Prevents sybil attacks; ensures one complaint per device.
   - Storage: Mapping of principal to user struct (laptop-hash, registration-timestamp).

### 2. **SpeedTestLogger** (Virtual Logging of Tests)
   - Records blockchain-verified speed tests: Users submit hashed results (download/upload speeds, latency) timestamped via block height.
   - Integrates oracle for external verification (e.g., multiple test runs averaged).
   - Functions: `log-speed-test`, `verify-test`, `query-test-history`.
   - Solves: Immutable evidence of subpar performance; virtual logging avoids central servers.
   - Storage: List of test records with Merkle root for batch proofs.

### 3. **ComplaintEscrow** (Filing & Staking)
   - Users stake $SPD tokens to file complaints, referencing a logged test.
   - Escrow holds stake until resolution; slashed for frivolous claims.
   - Functions: `file-complaint`, `release-stake`, `slash-stake`.
   - Solves: Deters spam; funds resolutions (e.g., modem shipping costs).
   - Storage: Mapping of complaint ID to escrow struct (stake-amount, status).

### 4. **VerificationOracle** (Automated Validation)
   - Uses oracles to cross-check complaints against ISP SLAs and historical tests.
   - Threshold-based approval (e.g., <80% of promised speed for 3+ tests).
   - Functions: `submit-oracle-data`, `validate-complaint`, `emit-resolution-event`.
   - Solves: Objective, decentralized verification without human bias.
   - Storage: Pending validation queue.

### 5. **ResolutionHandler** (Modem Replacement & Refunds)
   - Triggers in-person actions: Upon validation, releases funds to logistics partners (e.g., via API calls to UPS) or refunds user.
   - Tracks fulfillment (e.g., replacement confirmation via oracle).
   - Functions: `init-replacement`, `confirm-fulfillment`, `process-refund`.
   - Solves: Automates modem swaps; ensures ISPs fulfill obligations via bonded contracts.
   - Storage: Resolution tracking map (complaint-ID to status, partner-address).

### 6. **GovernanceVault** (DAO & Incentives)
   - Holds $SPD treasury; enables voting on ISP blacklists or feature upgrades.
   - Rewards valid complainers with tokens from slashed stakes.
   - Functions: `propose-vote`, `execute-governance`, `distribute-rewards`.
   - Solves: Community-driven evolution; incentivizes honest participation.
   - Storage: Proposal structs and token balances.

These contracts interact via cross-contract calls (e.g., ComplaintEscrow calls VerificationOracle). Total gas efficiency is optimized with batch operations. Frontend (React + Stacks.js) handles UI, with a Chrome extension for speed tests.

## Deployment & Testing
- Deploy via Clarinet (local testing framework).
- Testnet: Use Stacks testnet for simulations.
- Audit: Recommend external review for escrow logic.

## Future Roadmap
- Mobile app integration.
- Multi-chain (e.g., bridge to Ethereum for broader oracles).
- AI-driven predictive maintenance for modems.

---

# README.md

```markdown
# SpeedChain: Decentralized ISP Accountability Network

[![Stacks](https://img.shields.io/badge/Stacks-Clarity-blue.svg)](https://stacks.co/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SpeedChain is a Web3 dApp on the Stacks blockchain that verifies internet speed complaints, logs them virtually, and automates modem replacements via smart contracts. Built with Clarity for secure, Bitcoin-secured execution.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18
- Clarinet CLI: `cargo install clarinet`
- Stacks wallet (e.g., Leather or Hiro)

### Installation
1. Clone the repo:
   ```
   git clone https://github.com/yourusername/speedchain.git
   cd speedchain
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Start local Stacks node:
   ```
   clarinet integrate
   ```

### Local Development
- Run tests: `clarinet test`
- Deploy to devnet: `clarinet deploy --network devnet`
- Frontend: `npm start` (runs on http://localhost:3000)

## 📁 Project Structure
```
contracts/
├── core/
│   ├── 1-user-registry.clar
│   ├── 2-speed-test-logger.clar
│   ├── 3-complaint-escrow.clar
│   ├── 4-verification-oracle.clar
│   ├── 5-resolution-handler.clar
│   └── 6-governance-vault.clar
├── interfaces/
│   └── traits.clar  # Shared traits
frontend/
├── src/
│   ├── components/SpeedTest.jsx
│   └── App.jsx
tests/
├── integration/
│   └── complaint-flow.ts
Clarity.toml
```

## 🔧 Smart Contracts Overview
See [ARCHITECTURE.md](./ARCHITECTURE.md) for details. Key contracts:

| Contract | Purpose | Key Functions |
|----------|---------|---------------|
| UserRegistry | User onboarding | `register-user`, `get-user-status` |
| SpeedTestLogger | Test logging | `log-speed-test`, `verify-test` |
| ComplaintEscrow | Staking & filing | `file-complaint`, `release-stake` |
| VerificationOracle | Validation | `validate-complaint` |
| ResolutionHandler | Fulfillment | `init-replacement`, `process-refund` |
| GovernanceVault | DAO incentives | `propose-vote`, `distribute-rewards` |

## 🛠️ Usage
1. **Register**: Connect wallet and register laptop via frontend.
2. **Run Speed Test**: Use browser extension to log test on-chain.
3. **File Complaint**: Stake $SPD and submit if below SLA.
4. **Resolution**: Auto-triggers modem replacement if valid.

## 🤝 Contributing
- Fork, branch, PR.
- Follow Clarity style guide.
- Run `clarinet check` before commit.

## 📄 License
MIT License. See [LICENSE](./LICENSE).