# RoboMnemo

Bio-inspired spatial memory and payment verification for autonomous robots.

**IMPORTANT:** This is a SEPARATE project from MnemoPay. Do not mix codebases.

## Quick Commands

```bash
npm test              # Run all 87 tests
npx vitest run        # Same, explicit
npx tsc --noEmit      # Type check only
npm run build         # Compile to dist/
```

## Architecture

5 layers, each isolated with derived keys:

| Layer | Path | Purpose |
|-------|------|---------|
| Perception | src/perception/ | HMAC-signed frames, stereo depth |
| Memory | src/memory/ | Place cells, grid cells, Merkle-signed LTM |
| Navigation | src/navigation/ | A* + RRT* on 3D voxel grids |
| Verification | src/verification/ | SSIM/LPIPS spatial proofs → payments |
| Anti-spoofing | src/antispoofing/ | Replay, patches, depth injection, canaries |

## Security Model

- Every frame is HMAC-SHA256 signed at capture (timestamp + sequence in payload)
- Keys derived per subsystem: `deriveKey(masterSecret, 'frame-signing')` etc.
- Fail closed on any integrity violation
- Monotonic sequence numbers detect replay attacks
- Canary landmarks detect memory poisoning
- Constant-time HMAC comparison (timingSafeEqual)

## Key Types

- `CameraFrame` — RGB + depth + pose + HMAC + sequence
- `SpatialProof` — Rendered vs captured comparison with cryptographic signature
- `SpatialSettlement` — Payment contingent on spatial verification passing
- `RoboMnemoAgent` — Main API: see/remember/navigate/verifySpatial/settle

## Module Map

- `src/types/index.ts` — All interfaces and enums
- `src/utils/crypto.ts` — HMAC, SHA-256, nonces, key derivation
- `src/utils/math.ts` — Vec3, quaternions, coordinate transforms, Gaussian functions
- `src/perception/camera.ts` — FrameCapture, DualCameraSystem, depth fusion
- `src/memory/spatial-memory.ts` — ShortTermMemory (LRU+TTL), MidTermMemory, LongTermMemory (Merkle)
- `src/memory/place-cells.ts` — PlaceCell, GridCell, PlaceCellPopulation, GridCellSystem
- `src/navigation/pathfinding.ts` — OccupancyGrid, aStarPath, rrtStarPath
- `src/verification/spatial-proof.ts` — computeSSIM, approximateLPIPS, generateSpatialProof, createSettlement
- `src/antispoofing/detector.ts` — ReplayDetector, AdversarialPatchDetector, CanarySystem, FrameIntegrityChecker
- `src/index.ts` — createAgent() factory, re-exports everything
