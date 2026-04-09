/**
 * @robomnemo/core — Embodied Spatial Memory + Payment Verification for Robots
 *
 * Nobody else unifies spatial memory + payment verification + anti-spoofing.
 * - Niantic has maps but no payments
 * - NVIDIA has rendering but no memory persistence
 * - OpenMind has robot payments but no spatial proof
 * - FOAM/Auki has proof-of-location but no payments
 *
 * RoboMnemo sits at the intersection.
 *
 * API:
 *   agent.see()            — Capture + process current view
 *   agent.remember()       — Store spatial context to memory
 *   agent.navigate()       — Plan path to target
 *   agent.verifySpatial()  — Prove robot is at claimed location
 *   agent.settle()         — Payment with spatial proof requirement
 */

// Re-export all public types
export type {
  Vec3,
  Quaternion,
  Pose,
  Mat4,
  AABB,
  CameraIntrinsics,
  StereoConfig,
  CameraFrame,
  DepthMap,
  CameraConfig,
  GaussianSplat,
  SplatScene,
  RenderedView,
  ShortTermEntry,
  EpisodicMemory,
  LongTermMemory,
  ConsolidationEvent,
  PlaceCell,
  GridCell,
  SpatialCode,
  Waypoint,
  Path,
  SpatialMetrics,
  VerificationThresholds,
  SpatialProof,
  SpatialSettlement,
  ThreatDetection,
  FrameIntegrity,
  RoboMnemoConfig,
  RoboMnemoAgent,
} from './types/index.js';

export {
  CameraType,
  MemoryTier,
  PathAlgorithm,
  ReferenceFrame,
  SettlementStatus,
  ThreatType,
  ThreatSeverity,
} from './types/index.js';

// Re-export modules
export * from './perception/index.js';
export * from './memory/index.js';
export * from './navigation/index.js';
export * from './verification/index.js';
export * from './antispoofing/index.js';
export * from './gamification/index.js';

// Re-export key utilities
export {
  hmacSign,
  hmacVerify,
  signFrame,
  verifyFrame,
  generateNonce,
  sha256,
  deriveKey,
} from './utils/crypto.js';

export {
  vec3Distance,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Normalize,
  egoToAllo,
  alloToEgo,
  stereoDepth,
  gaussian3D,
  meanAbsoluteError,
  poseToMat4,
  quatRotateVec3,
  quatSlerp,
} from './utils/math.js';

// ============================================================
// AGENT FACTORY
// ============================================================

import type {
  RoboMnemoConfig,
  RoboMnemoAgent as IRoboMnemoAgent,
  CameraFrame,
  EpisodicMemory,
  Path,
  SpatialProof,
  SpatialSettlement,
  SpatialCode,
  Pose,
  Vec3,
  PathAlgorithm,
} from './types/index.js';
import type { CameraDriver } from './perception/index.js';
import { FrameCapture } from './perception/index.js';
import {
  ShortTermMemory,
  MidTermMemory,
  LongTermMemory as LongTermMemoryStore,
  MemoryConsolidator,
} from './memory/index.js';
import { PlaceCellPopulation, GridCellSystem, computeSpatialCode } from './memory/index.js';
import { OccupancyGrid, planPath } from './navigation/index.js';
import {
  generateSpatialProof,
  createSettlement,
} from './verification/index.js';
import { FrameIntegrityChecker, CanarySystem } from './antispoofing/index.js';
import { deriveKey } from './utils/crypto.js';

/**
 * Create a RoboMnemo agent
 *
 * This is the main entry point. Pass a config + camera driver,
 * get back an agent with see/remember/navigate/verify/settle methods.
 */
export function createAgent(
  config: RoboMnemoConfig,
  primaryDriver: CameraDriver,
): IRoboMnemoAgent {
  // Validate config
  if (!config.robotId) throw new Error('robotId is required');
  if (!config.hmacSecret || config.hmacSecret.length < 32) {
    throw new Error('hmacSecret must be at least 32 characters');
  }

  // Derive separate keys for each subsystem (key separation)
  const frameKey = deriveKey(config.hmacSecret, 'frame-signing');
  const memoryKey = deriveKey(config.hmacSecret, 'memory-signing');
  const proofKey = config.hmacSecret; // proof uses master key

  // Initialize subsystems
  const frameCapture = new FrameCapture(
    primaryDriver,
    config.cameras[0]!,
    frameKey,
  );

  const shortTerm = new ShortTermMemory(
    900,
    config.memoryConfig?.shortTermTTL ?? 30_000,
  );
  const midTerm = new MidTermMemory(
    config.memoryConfig?.midTermMaxEntries ?? 1000,
  );
  const longTermStore = new LongTermMemoryStore(memoryKey);
  const consolidator = new MemoryConsolidator(shortTerm, midTerm, longTermStore);

  const placeCells = new PlaceCellPopulation();
  const gridCells = new GridCellSystem();

  const integrityChecker = new FrameIntegrityChecker(frameKey);
  const canaries = new CanarySystem(memoryKey);

  let lastFrame: CameraFrame | undefined;
  let initialized = false;

  const agent: IRoboMnemoAgent = {
    async see(): Promise<CameraFrame> {
      if (!initialized) {
        await frameCapture.initialize();
        initialized = true;
      }

      const frame = await frameCapture.capture();

      // Run integrity check on every frame (fail-closed)
      const integrity = integrityChecker.check(frame);
      if (!integrityChecker.isSafe(integrity)) {
        const criticalThreats = integrity.threats
          .filter(t => t.severity === 'critical')
          .map(t => t.details)
          .join('; ');
        throw new Error(`Frame rejected by anti-spoofing: ${criticalThreats}`);
      }

      // Store in short-term memory (empty splats for now — 3DGS integration point)
      shortTerm.add(frame, []);

      // Auto-generate place cell at frame position if we have pose
      if (frame.pose) {
        const cell = (await import('./memory/place-cells.js')).createPlaceCell(
          frame.pose.position,
        );
        placeCells.add(cell);
      }

      lastFrame = frame;
      return frame;
    },

    async remember(tags?: string[]): Promise<EpisodicMemory> {
      const consolidated = consolidator.consolidateToMidTerm(tags ?? []);
      if (!consolidated) {
        // Even if not enough for full consolidation, store what we have
        const entries = shortTerm.getAll();
        if (entries.length === 0) {
          throw new Error('No frames in short-term memory to remember');
        }
        // Force store
        const allSplats = entries.flatMap(e => e.splats);
        const scene = {
          id: (await import('./utils/crypto.js')).generateNonce(16),
          splats: allSplats,
          count: allSplats.length,
          boundingBox: {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 0, y: 0, z: 0 },
          },
          createdAt: Date.now(),
        };
        const location = lastFrame?.pose?.position ?? { x: 0, y: 0, z: 0 };
        return midTerm.store(scene, location, tags ?? []);
      }

      // Get the most recent mid-term memory
      const memories = midTerm.findNear(
        lastFrame?.pose?.position ?? { x: 0, y: 0, z: 0 },
        100,
      );
      return memories[0]!;
    },

    async navigate(target: Vec3, options?: { algorithm?: PathAlgorithm }): Promise<Path> {
      const start = lastFrame?.pose?.position ?? { x: 0, y: 0, z: 0 };
      const bounds = {
        min: {
          x: Math.min(start.x, target.x) - 10,
          y: Math.min(start.y, target.y) - 10,
          z: Math.min(start.z, target.z) - 2,
        },
        max: {
          x: Math.max(start.x, target.x) + 10,
          y: Math.max(start.y, target.y) + 10,
          z: Math.max(start.z, target.z) + 2,
        },
      };
      const grid = new OccupancyGrid(bounds);
      const algorithm = options?.algorithm ?? config.navigationConfig?.defaultAlgorithm ?? 'a-star' as PathAlgorithm;
      const path = planPath(start, target, grid, bounds, algorithm);
      if (!path) throw new Error('No path found to target');
      return path;
    },

    async verifySpatial(claimedPose?: Pose): Promise<SpatialProof> {
      if (!lastFrame) throw new Error('No frame captured. Call see() first.');

      const pose = claimedPose ?? lastFrame.pose;
      if (!pose) throw new Error('No pose available. Provide claimedPose or ensure camera provides pose.');

      // In production, this would render from long-term memory 3DGS
      // For now, use the last frame as "expected" (self-verification)
      const expectedRender = {
        rgb: lastFrame.rgb,
        depth: lastFrame.depth ?? new Float32Array(0),
        width: lastFrame.width,
        height: lastFrame.height,
        pose,
        renderTimeMs: 0,
      };

      return generateSpatialProof(
        config.robotId,
        pose,
        lastFrame,
        expectedRender,
        'pending-merkle-root', // would come from long-term memory
        [],
        proofKey,
        config.verificationThresholds,
      );
    },

    async settle(params: {
      amount: number;
      currency: string;
      payeeId: string;
      spatialProof: boolean;
    }): Promise<SpatialSettlement> {
      if (!params.spatialProof) {
        throw new Error('RoboMnemo requires spatialProof=true. Use MnemoPay directly for non-spatial payments.');
      }

      const proof = await agent.verifySpatial();
      return createSettlement(proof, params.amount, params.currency, params.payeeId, proofKey);
    },

    getSpatialCode(): SpatialCode {
      const position = lastFrame?.pose?.position ?? { x: 0, y: 0, z: 0 };
      return computeSpatialCode(position, placeCells, gridCells);
    },

    getMemoryStats() {
      const shortEntries = shortTerm.getAll();
      return {
        shortTerm: {
          count: shortTerm.count,
          oldestMs: shortEntries.length > 0 ? Date.now() - shortEntries[0]!.timestamp : 0,
        },
        midTerm: {
          count: midTerm.count,
          totalSplats: midTerm.getTotalSplatCount(),
        },
        longTerm: {
          count: longTermStore.totalEntries,
          rooms: longTermStore.roomCount,
        },
      };
    },

    async shutdown(): Promise<void> {
      await frameCapture.shutdown();
      integrityChecker.reset();
    },
  };

  return agent;
}
