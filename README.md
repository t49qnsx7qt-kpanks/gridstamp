# GridStamp

Spatial proof-of-presence for autonomous robots.

GridStamp gives robots the ability to prove where they are, remember where they've been, and get paid for verified operations. Built on 3D Gaussian Splatting, bio-inspired navigation (place cells + grid cells), and cryptographic spatial proofs.

## Why

Robots need to prove they actually did the job. A delivery robot needs to verify it reached the destination. A warehouse AMR needs spatial proof for billing. An inspection drone needs tamper-proof evidence it surveyed the site.

No existing SDK combines spatial memory, payment verification, and anti-spoofing in one package.

## Architecture

Six layers, each cryptographically isolated:

| Layer | What it does |
|-------|-------------|
| **Perception** | HMAC-signed camera frames, stereo depth fusion, dual-camera support |
| **Memory** | 3-tier spatial memory (short/mid/long-term) with Merkle tree integrity |
| **Navigation** | A* and RRT* pathfinding on 3D occupancy grids, place cells + grid cells |
| **Verification** | SSIM + LPIPS + depth comparison for spatial proof-of-location |
| **Anti-Spoofing** | Replay detection, adversarial patch detection, depth injection, canary honeypots |
| **Gamification** | Trust tiers, capability badges, streak multipliers, zone mastery, fleet leaderboard |

## Install

```bash
npm install gridstamp
```

## Quick Start

```typescript
import { createAgent } from 'gridstamp';

const agent = createAgent({
  robotId: 'DLV-001',
  cameras: [{ type: 'oak-d-pro', role: 'foveal', /* ... */ }],
  hmacSecret: process.env.GRIDSTAMP_SECRET, // min 32 chars
}, cameraDriver);

// Capture and verify
const frame = await agent.see();
const proof = await agent.verifySpatial();

// Settle payment only if spatial proof passes
const settlement = await agent.settle({
  amount: 15.00,
  currency: 'USD',
  payeeId: 'merchant-001',
  spatialProof: true,
});
```

## Trust Tiers

Robots earn trust through verified operations, similar to a credit score:

| Tier | Points | Fee | Max Tx | Verification |
|------|--------|-----|--------|-------------|
| Untrusted | 0 | 2.5x | $10 | Every operation |
| Probation | 100 | 2.0x | $50 | Every operation |
| Verified | 500 | 1.5x | $200 | Every 3rd |
| Trusted | 2,000 | 1.2x | $1,000 | Every 5th |
| Elite | 5,000 | 1.0x | $5,000 | Every 10th |
| Autonomous | 10,000 | 0.8x | $25,000 | Spot checks |

All tier changes are HMAC-signed. Spoofing attempts result in immediate two-tier demotion.

## Security Model

- Every camera frame is HMAC-SHA256 signed at capture time
- Cryptographic key derivation isolates subsystems (`deriveKey(master, 'frame-signing')`)
- Monotonic sequence numbers prevent replay attacks
- Canary landmarks detect memory poisoning
- Constant-time HMAC comparison prevents timing attacks
- Fail-closed: any integrity violation blocks payment

## Modules

```
gridstamp                    # Full SDK
gridstamp/perception         # Camera + depth
gridstamp/memory             # Spatial memory + place/grid cells
gridstamp/navigation         # Pathfinding
gridstamp/verification       # Spatial proofs + settlements
gridstamp/antispoofing       # Threat detection
gridstamp/gamification       # Trust tiers + badges + leaderboard
```

## Use Cases

- **Last-mile delivery** — Robot proves it reached the doorstep before payment settles
- **Warehouse operations** — AMRs earn trust tiers based on verified pick accuracy
- **Drone inspection** — Tamper-proof spatial evidence of site surveys
- **Autonomous trucking** — Spatial proof-of-delivery for freight settlements
- **Roofing/HVAC/Plumbing** — AI agents verify on-site work completion

## Requirements

- Node.js 20+
- TypeScript 5.6+

## License

Apache 2.0 — see [LICENSE](LICENSE)
