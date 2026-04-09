/**
 * @robomnemo/core — Type definitions
 * Embodied spatial memory + payment verification for autonomous robots
 */

// ============================================================
// GEOMETRY & SPATIAL PRIMITIVES
// ============================================================

/** 3D position in world coordinates (meters) */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Quaternion rotation (unit quaternion, ||q|| = 1) */
export interface Quaternion {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 6-DOF pose: position + orientation */
export interface Pose {
  readonly position: Vec3;
  readonly orientation: Quaternion;
  readonly timestamp: number; // Unix ms
}

/** 4x4 transformation matrix (row-major) */
export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/** Axis-aligned bounding box */
export interface AABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

// ============================================================
// CAMERA & PERCEPTION
// ============================================================

/** Camera intrinsic parameters */
export interface CameraIntrinsics {
  readonly fx: number; // focal length x (pixels)
  readonly fy: number; // focal length y (pixels)
  readonly cx: number; // principal point x
  readonly cy: number; // principal point y
  readonly width: number;
  readonly height: number;
  readonly distortion?: readonly number[]; // radial + tangential coefficients
}

/** Stereo camera baseline */
export interface StereoConfig {
  readonly baseline: number; // meters between cameras
  readonly intrinsics: CameraIntrinsics;
  readonly minDepth: number; // meters
  readonly maxDepth: number; // meters
}

/** Raw camera frame with metadata */
export interface CameraFrame {
  readonly id: string;
  readonly timestamp: number;
  readonly rgb: Uint8Array; // RGB pixel data
  readonly width: number;
  readonly height: number;
  readonly depth?: Float32Array; // depth map in meters
  readonly pose?: Pose; // camera pose at capture time
  readonly hmac?: string; // HMAC-SHA256 signature
  readonly sequenceNumber: number; // monotonic counter for replay detection
}

/** Depth map with confidence */
export interface DepthMap {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly confidence?: Float32Array; // per-pixel confidence [0,1]
}

/** Camera hardware abstraction */
export enum CameraType {
  OAK_D_PRO = 'oak-d-pro',
  OAK_D_LONG_RANGE = 'oak-d-lr',
  OAK_4_D_PRO = 'oak-4-d-pro',
  REALSENSE_D455 = 'realsense-d455',
  ZED_2I = 'zed-2i',
  SIMULATED = 'simulated',
}

export interface CameraConfig {
  readonly type: CameraType;
  readonly role: 'foveal' | 'peripheral';
  readonly stereo: StereoConfig;
  readonly fps: number;
  readonly autoExposure: boolean;
}

// ============================================================
// 3D GAUSSIAN SPLATTING
// ============================================================

/**
 * Single 3D Gaussian splat (59 parameters)
 * Position (3) + Covariance/Scale (3) + Rotation (4) + Opacity (1)
 * + SH coefficients (48 for degree 3)
 */
export interface GaussianSplat {
  readonly position: Vec3;
  readonly scale: Vec3; // log-scale
  readonly rotation: Quaternion;
  readonly opacity: number; // sigmoid-activated, [0,1]
  readonly shCoeffs: Float32Array; // spherical harmonics (48 floats for degree 3)
}

/** Gaussian splat scene (collection of splats) */
export interface SplatScene {
  readonly id: string;
  readonly splats: GaussianSplat[];
  readonly count: number;
  readonly boundingBox: AABB;
  readonly createdAt: number;
  readonly merkleRoot?: string; // SHA-256 Merkle root of splat data
}

/** Rendered view from a splat scene */
export interface RenderedView {
  readonly rgb: Uint8Array;
  readonly depth: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly pose: Pose;
  readonly renderTimeMs: number;
}

// ============================================================
// SPATIAL MEMORY (3-TIER)
// ============================================================

export enum MemoryTier {
  SHORT = 'short',   // 1M splats, 30Hz live, ~30s window
  MID = 'mid',       // 100K splats, episodic, minutes-hours
  LONG = 'long',     // 10K/room, Merkle-signed, persistent
}

/** Short-term memory entry (live perception) */
export interface ShortTermEntry {
  readonly frame: CameraFrame;
  readonly splats: GaussianSplat[];
  readonly timestamp: number;
  readonly expiresAt: number; // auto-evict after TTL
}

/** Mid-term episodic memory */
export interface EpisodicMemory {
  readonly id: string;
  readonly scene: SplatScene;
  readonly location: Vec3;
  readonly timestamp: number;
  readonly tags: readonly string[]; // semantic labels
  readonly confidence: number; // [0,1] how reliable
}

/** Long-term persistent memory (Merkle-signed) */
export interface LongTermMemory {
  readonly id: string;
  readonly roomId: string;
  readonly scene: SplatScene;
  readonly merkleRoot: string;
  readonly merkleProof: readonly string[];
  readonly signature: string; // HMAC-SHA256
  readonly createdAt: number;
  readonly lastVerified: number;
  readonly splatCount: number;
}

/** Memory consolidation event (short → mid → long) */
export interface ConsolidationEvent {
  readonly from: MemoryTier;
  readonly to: MemoryTier;
  readonly entryCount: number;
  readonly compressionRatio: number;
  readonly timestamp: number;
}

// ============================================================
// PLACE CELLS & GRID CELLS (Bio-inspired navigation)
// ============================================================

/** Place cell — fires at specific location (O'Keefe, 1971) */
export interface PlaceCell {
  readonly id: string;
  readonly center: Vec3; // preferred location
  readonly radius: number; // firing field radius (meters)
  readonly peakRate: number; // max firing rate (Hz)
  activation(position: Vec3): number; // Gaussian falloff [0,1]
}

/** Grid cell — hexagonal tiling (Moser & Moser, 2005) */
export interface GridCell {
  readonly id: string;
  readonly spacing: number; // grid period (meters)
  readonly orientation: number; // grid orientation (radians)
  readonly phase: Vec3; // phase offset
  activation(position: Vec3): number; // periodic activation [0,1]
}

/** Spatial code — combined place + grid cell population vector */
export interface SpatialCode {
  readonly placeCellActivations: ReadonlyMap<string, number>;
  readonly gridCellActivations: ReadonlyMap<string, number>;
  readonly estimatedPosition: Vec3;
  readonly confidence: number;
  readonly timestamp: number;
}

// ============================================================
// NAVIGATION
// ============================================================

export enum PathAlgorithm {
  A_STAR = 'a-star',
  RRT_STAR = 'rrt-star',
}

export enum ReferenceFrame {
  EGOCENTRIC = 'ego',    // robot-centered
  ALLOCENTRIC = 'allo',  // world-centered
}

/** Navigation waypoint */
export interface Waypoint {
  readonly position: Vec3;
  readonly orientation?: Quaternion;
  readonly speed?: number; // m/s
  readonly tolerance: number; // meters
}

/** Planned path */
export interface Path {
  readonly id: string;
  readonly waypoints: readonly Waypoint[];
  readonly algorithm: PathAlgorithm;
  readonly totalDistance: number; // meters
  readonly estimatedTime: number; // seconds
  readonly cost: number; // path cost metric
  readonly collisionFree: boolean;
  readonly createdAt: number;
}

// ============================================================
// SPATIAL VERIFICATION & PAYMENT
// ============================================================

/** Spatial similarity metrics */
export interface SpatialMetrics {
  readonly ssim: number;     // Structural Similarity [0,1]
  readonly lpips: number;    // Learned Perceptual Image Patch Similarity [0,1] (lower = more similar)
  readonly depthMAE: number; // Depth Mean Absolute Error (meters)
  readonly composite: number; // Weighted composite score [0,1]
}

/** Verification thresholds */
export interface VerificationThresholds {
  readonly minSSIM: number;        // default 0.75
  readonly maxLPIPS: number;       // default 0.25
  readonly maxDepthMAE: number;    // default 0.5 meters
  readonly minComposite: number;   // default 0.75
}

/** Spatial proof — cryptographic proof that robot is at claimed location */
export interface SpatialProof {
  readonly id: string;
  readonly robotId: string;
  readonly claimedPose: Pose;
  readonly actualFrame: CameraFrame;
  readonly expectedRender: RenderedView;
  readonly metrics: SpatialMetrics;
  readonly passed: boolean;
  readonly memoryMerkleRoot: string; // ties to long-term memory
  readonly merkleProof: readonly string[];
  readonly timestamp: number;
  readonly signature: string; // HMAC-SHA256 of proof payload
  readonly nonce: string; // replay prevention
  readonly hardwareAttestation?: string; // device identity
}

/** Payment settlement tied to spatial proof */
export interface SpatialSettlement {
  readonly id: string;
  readonly proof: SpatialProof;
  readonly amount: number;
  readonly currency: string;
  readonly status: SettlementStatus;
  readonly payerRobotId: string;
  readonly payeeId: string;
  readonly initiatedAt: number;
  readonly settledAt?: number;
  readonly failureReason?: string;
}

export enum SettlementStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  SETTLED = 'settled',
  FAILED = 'failed',
  DISPUTED = 'disputed',
}

// ============================================================
// ANTI-SPOOFING
// ============================================================

export enum ThreatType {
  REPLAY_ATTACK = 'replay',
  ADVERSARIAL_PATCH = 'adversarial-patch',
  DEPTH_INJECTION = 'depth-injection',
  MEMORY_POISONING = 'memory-poisoning',
  CAMERA_TAMPERING = 'camera-tampering',
  MAN_IN_THE_MIDDLE = 'mitm',
}

export enum ThreatSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** Detected threat */
export interface ThreatDetection {
  readonly type: ThreatType;
  readonly severity: ThreatSeverity;
  readonly confidence: number; // [0,1]
  readonly details: string;
  readonly frameId?: string;
  readonly timestamp: number;
  readonly mitigationApplied: boolean;
}

/** Frame integrity check result */
export interface FrameIntegrity {
  readonly frameId: string;
  readonly hmacValid: boolean;
  readonly sequenceValid: boolean; // no gaps in sequence numbers
  readonly timingValid: boolean; // within expected jitter bounds
  readonly threats: readonly ThreatDetection[];
}

// ============================================================
// AGENT API (top-level)
// ============================================================

export interface RoboMnemoConfig {
  readonly robotId: string;
  readonly cameras: readonly CameraConfig[];
  readonly hmacSecret: string; // MUST be provided, no defaults
  readonly verificationThresholds?: Partial<VerificationThresholds>;
  readonly memoryConfig?: {
    readonly shortTermTTL?: number; // ms, default 30000
    readonly midTermMaxEntries?: number; // default 1000
    readonly longTermStoragePath?: string;
  };
  readonly navigationConfig?: {
    readonly defaultAlgorithm?: PathAlgorithm;
    readonly maxPlanningTime?: number; // ms
    readonly safetyMargin?: number; // meters
  };
}

/** Main agent interface */
export interface RoboMnemoAgent {
  /** Capture and process current camera view */
  see(): Promise<CameraFrame>;

  /** Store current spatial context to memory */
  remember(tags?: string[]): Promise<EpisodicMemory>;

  /** Plan and execute navigation to target */
  navigate(target: Vec3, options?: { algorithm?: PathAlgorithm }): Promise<Path>;

  /** Verify robot is at claimed location via spatial proof */
  verifySpatial(claimedPose?: Pose): Promise<SpatialProof>;

  /** Settle payment with spatial proof requirement */
  settle(params: {
    amount: number;
    currency: string;
    payeeId: string;
    spatialProof: boolean;
  }): Promise<SpatialSettlement>;

  /** Get current spatial code (place + grid cell activations) */
  getSpatialCode(): SpatialCode;

  /** Get memory statistics */
  getMemoryStats(): {
    shortTerm: { count: number; oldestMs: number };
    midTerm: { count: number; totalSplats: number };
    longTerm: { count: number; rooms: number };
  };

  /** Shutdown and persist state */
  shutdown(): Promise<void>;
}
