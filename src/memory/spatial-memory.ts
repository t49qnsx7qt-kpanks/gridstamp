/**
 * 3-Tier Spatial Memory System (Bio-inspired)
 *
 * Short-term: 30Hz live perception buffer (~30s window, 1M splats max)
 * Mid-term: Episodic memories with semantic tags (~hours, 100K splats)
 * Long-term: Merkle-signed persistent room maps (~forever, 10K splats/room)
 *
 * Consolidation: short → mid (similarity clustering) → long (Merkle signing)
 * Eviction: LRU for short, confidence-weighted for mid, never for long
 */
import { MerkleTree } from 'merkletreejs';
import type {
  ShortTermEntry,
  EpisodicMemory,
  LongTermMemory,
  ConsolidationEvent,
  MemoryTier,
  GaussianSplat,
  SplatScene,
  CameraFrame,
  Vec3,
  AABB,
} from '../types/index.js';
import { sha256, hmacSign, generateNonce } from '../utils/crypto.js';
import { vec3Distance } from '../utils/math.js';

// ============================================================
// SHORT-TERM MEMORY (live perception buffer)
// ============================================================

export class ShortTermMemory {
  private entries: ShortTermEntry[] = [];
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number = 900, ttlMs: number = 30_000) {
    this.maxEntries = maxEntries; // ~30s at 30fps
    this.ttlMs = ttlMs;
  }

  /** Add frame + splats from current perception */
  add(frame: CameraFrame, splats: GaussianSplat[]): void {
    const now = Date.now();
    this.entries.push({
      frame,
      splats,
      timestamp: now,
      expiresAt: now + this.ttlMs,
    });
    this.evict();
  }

  /** Evict expired entries and enforce max capacity */
  private evict(): void {
    const now = Date.now();
    this.entries = this.entries.filter(e => e.expiresAt > now);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /** Get all current entries */
  getAll(): readonly ShortTermEntry[] {
    this.evict();
    return [...this.entries];
  }

  /** Get total splat count across all entries */
  getSplatCount(): number {
    return this.entries.reduce((sum, e) => sum + e.splats.length, 0);
  }

  /** Get most recent N entries */
  getRecent(n: number): readonly ShortTermEntry[] {
    this.evict();
    return this.entries.slice(-n);
  }

  /** Clear all short-term memory */
  clear(): void {
    this.entries = [];
  }

  get count(): number {
    this.evict();
    return this.entries.length;
  }
}

// ============================================================
// MID-TERM EPISODIC MEMORY
// ============================================================

export class MidTermMemory {
  private memories: Map<string, EpisodicMemory> = new Map();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  /** Store an episodic memory from consolidated short-term entries */
  store(scene: SplatScene, location: Vec3, tags: string[] = []): EpisodicMemory {
    const memory: EpisodicMemory = {
      id: generateNonce(16),
      scene,
      location,
      timestamp: Date.now(),
      tags,
      confidence: 1.0,
    };
    this.memories.set(memory.id, memory);
    this.enforceCapacity();
    return memory;
  }

  /** Find memories near a location */
  findNear(location: Vec3, radiusMeters: number): readonly EpisodicMemory[] {
    const results: EpisodicMemory[] = [];
    for (const memory of this.memories.values()) {
      if (vec3Distance(memory.location, location) <= radiusMeters) {
        results.push(memory);
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Find memories by semantic tag */
  findByTag(tag: string): readonly EpisodicMemory[] {
    const results: EpisodicMemory[] = [];
    for (const memory of this.memories.values()) {
      if (memory.tags.includes(tag)) {
        results.push(memory);
      }
    }
    return results;
  }

  /** Get memory by ID */
  get(id: string): EpisodicMemory | undefined {
    return this.memories.get(id);
  }

  /** Evict lowest-confidence entries when at capacity */
  private enforceCapacity(): void {
    if (this.memories.size <= this.maxEntries) return;
    const sorted = [...this.memories.values()].sort((a, b) => a.confidence - b.confidence);
    const toRemove = sorted.slice(0, this.memories.size - this.maxEntries);
    for (const mem of toRemove) {
      this.memories.delete(mem.id);
    }
  }

  get count(): number {
    return this.memories.size;
  }

  getTotalSplatCount(): number {
    let total = 0;
    for (const mem of this.memories.values()) {
      total += mem.scene.count;
    }
    return total;
  }
}

// ============================================================
// LONG-TERM PERSISTENT MEMORY (Merkle-signed)
// ============================================================

export class LongTermMemory {
  private rooms: Map<string, LongTermMemory_Entry> = new Map();
  private readonly hmacSecret: string;

  constructor(hmacSecret: string) {
    if (!hmacSecret || hmacSecret.length < 32) {
      throw new Error('HMAC secret must be at least 32 characters');
    }
    this.hmacSecret = hmacSecret;
  }

  /** Persist an episodic memory as a Merkle-signed long-term entry */
  persist(roomId: string, scene: SplatScene): LongTermMemory {
    // Build Merkle tree from splat data
    const leaves = scene.splats.map(splat => {
      const data = this.serializeSplat(splat);
      return sha256(data);
    });

    // Handle empty scenes
    if (leaves.length === 0) {
      throw new Error('Cannot persist empty scene');
    }

    const tree = new MerkleTree(leaves, sha256, { sortPairs: true });
    const merkleRoot = tree.getHexRoot();
    const merkleProof = tree.getHexProof(leaves[0]!);

    // Sign the entire memory entry
    const signaturePayload = Buffer.from(
      `${roomId}:${merkleRoot}:${scene.count}:${Date.now()}`,
    );
    const signature = hmacSign(signaturePayload, this.hmacSecret);

    const entry: LongTermMemory = {
      id: generateNonce(16),
      roomId,
      scene,
      merkleRoot,
      merkleProof,
      signature,
      createdAt: Date.now(),
      lastVerified: Date.now(),
      splatCount: scene.count,
    };

    this.rooms.set(`${roomId}:${entry.id}`, entry as unknown as LongTermMemory_Entry);
    return entry;
  }

  /** Verify integrity of a long-term memory entry */
  verify(entry: LongTermMemory): boolean {
    // Rebuild Merkle tree and check root
    const leaves = entry.scene.splats.map(splat => {
      const data = this.serializeSplat(splat);
      return sha256(data);
    });

    if (leaves.length === 0) return false;

    const tree = new MerkleTree(leaves, sha256, { sortPairs: true });
    const computedRoot = tree.getHexRoot();
    return computedRoot === entry.merkleRoot;
  }

  /** Get all memories for a room */
  getRoom(roomId: string): readonly LongTermMemory[] {
    const results: LongTermMemory[] = [];
    for (const [key, value] of this.rooms.entries()) {
      if (key.startsWith(`${roomId}:`)) {
        results.push(value as unknown as LongTermMemory);
      }
    }
    return results;
  }

  /** Serialize a splat to deterministic bytes for hashing */
  private serializeSplat(splat: GaussianSplat): string {
    return JSON.stringify({
      p: [splat.position.x, splat.position.y, splat.position.z],
      s: [splat.scale.x, splat.scale.y, splat.scale.z],
      r: [splat.rotation.w, splat.rotation.x, splat.rotation.y, splat.rotation.z],
      o: splat.opacity,
      sh: Array.from(splat.shCoeffs),
    });
  }

  get roomCount(): number {
    const rooms = new Set<string>();
    for (const key of this.rooms.keys()) {
      rooms.add(key.split(':')[0]!);
    }
    return rooms.size;
  }

  get totalEntries(): number {
    return this.rooms.size;
  }
}

// Internal type alias to avoid name collision
type LongTermMemory_Entry = LongTermMemory;

// ============================================================
// MEMORY CONSOLIDATION ENGINE
// ============================================================

export class MemoryConsolidator {
  constructor(
    private readonly shortTerm: ShortTermMemory,
    private readonly midTerm: MidTermMemory,
    private readonly longTerm: LongTermMemory_LT,
    private readonly consolidationThreshold: number = 10, // entries before consolidation
  ) {}

  /**
   * Consolidate short-term → mid-term
   * Groups nearby frames into episodic memories
   */
  consolidateToMidTerm(tags: string[] = []): ConsolidationEvent | null {
    const entries = this.shortTerm.getAll();
    if (entries.length < this.consolidationThreshold) return null;

    // Merge all splats from recent entries into a scene
    const allSplats: GaussianSplat[] = [];
    for (const entry of entries) {
      allSplats.push(...entry.splats);
    }

    if (allSplats.length === 0) return null;

    // Compute centroid location
    let cx = 0, cy = 0, cz = 0;
    for (const splat of allSplats) {
      cx += splat.position.x;
      cy += splat.position.y;
      cz += splat.position.z;
    }
    const n = allSplats.length;
    const location: Vec3 = { x: cx / n, y: cy / n, z: cz / n };

    // Downsample to 100K max (mid-term budget)
    const downsampled = this.downsample(allSplats, 100_000);

    const scene: SplatScene = {
      id: generateNonce(16),
      splats: downsampled,
      count: downsampled.length,
      boundingBox: this.computeAABB(downsampled),
      createdAt: Date.now(),
    };

    this.midTerm.store(scene, location, tags);

    const event: ConsolidationEvent = {
      from: 'short' as MemoryTier,
      to: 'mid' as MemoryTier,
      entryCount: entries.length,
      compressionRatio: allSplats.length / downsampled.length,
      timestamp: Date.now(),
    };

    // Clear consolidated short-term entries
    this.shortTerm.clear();

    return event;
  }

  /** Downsample splats using voxel grid filtering */
  private downsample(splats: GaussianSplat[], maxCount: number): GaussianSplat[] {
    if (splats.length <= maxCount) return splats;

    // Simple stride-based downsampling (production would use voxel grid)
    const stride = Math.ceil(splats.length / maxCount);
    const result: GaussianSplat[] = [];
    for (let i = 0; i < splats.length && result.length < maxCount; i += stride) {
      result.push(splats[i]!);
    }
    return result;
  }

  /** Compute axis-aligned bounding box */
  private computeAABB(splats: GaussianSplat[]): AABB {
    if (splats.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const s of splats) {
      if (s.position.x < minX) minX = s.position.x;
      if (s.position.y < minY) minY = s.position.y;
      if (s.position.z < minZ) minZ = s.position.z;
      if (s.position.x > maxX) maxX = s.position.x;
      if (s.position.y > maxY) maxY = s.position.y;
      if (s.position.z > maxZ) maxZ = s.position.z;
    }
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }
}

// Alias for long-term memory class used in consolidator
type LongTermMemory_LT = InstanceType<typeof LongTermMemory>;
