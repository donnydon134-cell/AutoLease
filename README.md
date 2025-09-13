# 🔄 AutoLease: Automated Rental Renewals on Blockchain

Welcome to AutoLease, the decentralized platform revolutionizing real estate rentals! Built on the Stacks blockchain with Clarity smart contracts, this project automates lease renewals based on payment history, eliminating disputes, late fees, and paperwork hassles for landlords and tenants alike.

## ✨ Features

🏠 **Smart Lease Creation**: Generate tamper-proof rental agreements with customizable terms
💳 **On-Chain Payment Tracking**: Record rent payments via STX or SIP-10 tokens for seamless history
🔄 **Auto-Renewal Execution**: Automatically extend leases if payment thresholds are met
⚠️ **Dispute Resolution**: Escrow funds and oracle-based verification for missed payments
📊 **Tenant/Landlord Dashboards**: Query lease status, history, and renewal eligibility
🔔 **Notifications & Alerts**: Trigger off-chain events for upcoming renewals or defaults
🔒 **Secure Eviction Clauses**: Conditional logic for handling breaches without intermediaries
📈 **Analytics & Reporting**: Generate payment summaries and compliance proofs

## 🛠 How It Works

**For Landlords**

- Deploy a new lease contract with terms like duration, rent amount, and renewal criteria
- Receive automated STX payments and track them on-chain
- Set rules: e.g., auto-renew if 90% of payments are on-time over 12 months
- Use oracle integration to verify off-chain events like property inspections

**For Tenants**

- Sign the lease digitally and make payments via integrated wallets
- View your payment history and renewal status in real-time
- Opt into auto-renewal for hassle-free extensions

**Under the Hood**

Payments flow into an escrow contract. A renewal checker contract scans history periodically (via cron-like triggers on Stacks). If conditions pass, it executes renewal by updating the master lease— all immutable and transparent!

## 📋 Smart Contracts (8 Total)

This project leverages 8 interconnected Clarity smart contracts for robust, gas-efficient operations:

1. **LeaseFactory**: Deploys new lease instances and manages global registry
2. **PaymentEscrow**: Holds rent funds, releases on approval, and handles refunds
3. **PaymentTracker**: Logs transactions with timestamps and verifies history
4. **RenewalChecker**: Evaluates payment data against rules for auto-execution
5. **DisputeResolver**: Manages claims, votes, or oracle resolutions for conflicts
6. **NotificationHub**: Emits events for off-chain alerts (e.g., via Stacks' Gauntlet)
7. **AnalyticsQuery**: Provides read-only functions for lease stats and proofs
8. **EvictionGuard**: Enforces termination clauses based on breach conditions

Each contract is modular, upgradable via Clarity's traits, and tested for security.

## 🚀 Getting Started

Clone the repo, install Clarity tools, and deploy to Stacks testnet. Check `contracts/` for full code— let's make renting fair and futuristic! 

*Powered by Stacks & Clarity* 🚀