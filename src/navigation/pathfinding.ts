/**
 * Navigation — A* and RRT* pathfinding in 3D space
 *
 * A*: Optimal for grid-based environments (warehouses, structured spaces)
 * RRT*: Optimal for continuous spaces with complex obstacles (outdoor, unstructured)
 *
 * Both integrate with place cell activations for biologically-plausible navigation.
 */
import type {
  Vec3,
  Path,
  Waypoint,
  PathAlgorithm,
  AABB,
} from '../types/index.js';
import { vec3Distance, vec3Sub, vec3Add, vec3Scale, vec3Normalize } from '../utils/math.js';
import { generateNonce } from '../utils/crypto.js';

// ============================================================
// OCCUPANCY GRID (collision checking)
// ============================================================

/** 3D occupancy grid for collision detection */
export class OccupancyGrid {
  private grid: Uint8Array;
  readonly resolution: number; // meters per cell
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly origin: Vec3;

  constructor(
    bounds: AABB,
    resolution: number = 0.1,
  ) {
    this.resolution = resolution;
    this.origin = bounds.min;
    this.sizeX = Math.ceil((bounds.max.x - bounds.min.x) / resolution);
    this.sizeY = Math.ceil((bounds.max.y - bounds.min.y) / resolution);
    this.sizeZ = Math.ceil((bounds.max.z - bounds.min.z) / resolution);
    this.grid = new Uint8Array(this.sizeX * this.sizeY * this.sizeZ);
  }

  /** Convert world position to grid index */
  private toIndex(pos: Vec3): number | null {
    const ix = Math.floor((pos.x - this.origin.x) / this.resolution);
    const iy = Math.floor((pos.y - this.origin.y) / this.resolution);
    const iz = Math.floor((pos.z - this.origin.z) / this.resolution);
    if (ix < 0 || ix >= this.sizeX || iy < 0 || iy >= this.sizeY || iz < 0 || iz >= this.sizeZ) {
      return null;
    }
    return ix + iy * this.sizeX + iz * this.sizeX * this.sizeY;
  }

  /** Mark a position as occupied */
  setOccupied(pos: Vec3): void {
    const idx = this.toIndex(pos);
    if (idx !== null) this.grid[idx] = 1;
  }

  /** Check if a position is free */
  isFree(pos: Vec3): boolean {
    const idx = this.toIndex(pos);
    if (idx === null) return false; // out of bounds = not free
    return this.grid[idx] === 0;
  }

  /** Check if a straight line between two points is collision-free */
  isLineFree(from: Vec3, to: Vec3, stepSize: number = 0.05): boolean {
    const dist = vec3Distance(from, to);
    const steps = Math.ceil(dist / stepSize);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const point: Vec3 = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };
      if (!this.isFree(point)) return false;
    }
    return true;
  }
}

// ============================================================
// A* PATHFINDING
// ============================================================

interface AStarNode {
  position: Vec3;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // g + h
  parent: AStarNode | null;
  key: string;
}

function positionKey(pos: Vec3, resolution: number): string {
  const x = Math.round(pos.x / resolution);
  const y = Math.round(pos.y / resolution);
  const z = Math.round(pos.z / resolution);
  return `${x},${y},${z}`;
}

/**
 * A* pathfinding in 3D space
 * Uses 26-connected grid (all diagonal neighbors)
 */
export function aStarPath(
  start: Vec3,
  goal: Vec3,
  grid: OccupancyGrid,
  maxIterations: number = 100_000,
): Vec3[] | null {
  const resolution = grid.resolution;
  const startKey = positionKey(start, resolution);

  const startNode: AStarNode = {
    position: start,
    g: 0,
    h: vec3Distance(start, goal),
    f: vec3Distance(start, goal),
    parent: null,
    key: startKey,
  };

  const openSet = new Map<string, AStarNode>();
  const closedSet = new Set<string>();
  openSet.set(startKey, startNode);

  // 26-connected neighbors (3D)
  const neighbors: Vec3[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        neighbors.push({
          x: dx * resolution,
          y: dy * resolution,
          z: dz * resolution,
        });
      }
    }
  }

  let iterations = 0;
  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f in open set
    let current: AStarNode | null = null;
    for (const node of openSet.values()) {
      if (!current || node.f < current.f) {
        current = node;
      }
    }
    if (!current) break;

    // Check if we reached the goal
    if (vec3Distance(current.position, goal) < resolution * 1.5) {
      return reconstructPath(current);
    }

    openSet.delete(current.key);
    closedSet.add(current.key);

    // Explore neighbors
    for (const offset of neighbors) {
      const neighborPos = vec3Add(current.position, offset);
      const neighborKey = positionKey(neighborPos, resolution);

      if (closedSet.has(neighborKey)) continue;
      if (!grid.isFree(neighborPos)) continue;

      const g = current.g + vec3Distance(current.position, neighborPos);
      const existing = openSet.get(neighborKey);

      if (!existing || g < existing.g) {
        const h = vec3Distance(neighborPos, goal);
        const node: AStarNode = {
          position: neighborPos,
          g,
          h,
          f: g + h,
          parent: current,
          key: neighborKey,
        };
        openSet.set(neighborKey, node);
      }
    }
  }

  return null; // no path found
}

function reconstructPath(node: AStarNode): Vec3[] {
  const path: Vec3[] = [];
  let current: AStarNode | null = node;
  while (current) {
    path.unshift(current.position);
    current = current.parent;
  }
  return path;
}

// ============================================================
// RRT* PATHFINDING
// ============================================================

interface RRTNode {
  position: Vec3;
  parent: RRTNode | null;
  cost: number;
  children: RRTNode[];
}

/**
 * RRT* (Rapidly-exploring Random Tree Star)
 * Asymptotically optimal for continuous spaces
 */
export function rrtStarPath(
  start: Vec3,
  goal: Vec3,
  grid: OccupancyGrid,
  bounds: AABB,
  options: {
    maxIterations?: number;
    stepSize?: number;
    goalBias?: number;
    rewireRadius?: number;
  } = {},
): Vec3[] | null {
  const {
    maxIterations = 5000,
    stepSize = 0.3,
    goalBias = 0.1,
    rewireRadius = 0.5,
  } = options;

  const root: RRTNode = { position: start, parent: null, cost: 0, children: [] };
  const nodes: RRTNode[] = [root];
  let bestGoalNode: RRTNode | null = null;

  for (let i = 0; i < maxIterations; i++) {
    // Sample random point (with goal bias)
    const sample = Math.random() < goalBias
      ? goal
      : randomPoint(bounds);

    // Find nearest node in tree
    const nearest = findNearest(nodes, sample);
    if (!nearest) continue;

    // Steer towards sample
    const direction = vec3Normalize(vec3Sub(sample, nearest.position));
    const newPos = vec3Add(nearest.position, vec3Scale(direction, stepSize));

    // Check collision
    if (!grid.isFree(newPos)) continue;
    if (!grid.isLineFree(nearest.position, newPos)) continue;

    // Find nearby nodes for potential rewiring
    const nearby = findNearby(nodes, newPos, rewireRadius);

    // Choose best parent (lowest cost path)
    let bestParent = nearest;
    let bestCost = nearest.cost + vec3Distance(nearest.position, newPos);

    for (const candidate of nearby) {
      const candidateCost = candidate.cost + vec3Distance(candidate.position, newPos);
      if (candidateCost < bestCost && grid.isLineFree(candidate.position, newPos)) {
        bestParent = candidate;
        bestCost = candidateCost;
      }
    }

    // Add new node
    const newNode: RRTNode = {
      position: newPos,
      parent: bestParent,
      cost: bestCost,
      children: [],
    };
    bestParent.children.push(newNode);
    nodes.push(newNode);

    // Rewire nearby nodes through new node if cheaper
    for (const candidate of nearby) {
      const newCandidateCost = newNode.cost + vec3Distance(newNode.position, candidate.position);
      if (newCandidateCost < candidate.cost && grid.isLineFree(newNode.position, candidate.position)) {
        // Remove from old parent's children
        if (candidate.parent) {
          const idx = candidate.parent.children.indexOf(candidate);
          if (idx >= 0) candidate.parent.children.splice(idx, 1);
        }
        candidate.parent = newNode;
        candidate.cost = newCandidateCost;
        newNode.children.push(candidate);
        propagateCostUpdate(candidate);
      }
    }

    // Check if we reached the goal
    if (vec3Distance(newPos, goal) < stepSize * 2) {
      if (!bestGoalNode || newNode.cost < bestGoalNode.cost) {
        bestGoalNode = newNode;
      }
    }
  }

  if (!bestGoalNode) return null;
  return reconstructRRTPath(bestGoalNode);
}

function randomPoint(bounds: AABB): Vec3 {
  return {
    x: bounds.min.x + Math.random() * (bounds.max.x - bounds.min.x),
    y: bounds.min.y + Math.random() * (bounds.max.y - bounds.min.y),
    z: bounds.min.z + Math.random() * (bounds.max.z - bounds.min.z),
  };
}

function findNearest(nodes: RRTNode[], target: Vec3): RRTNode | null {
  let best: RRTNode | null = null;
  let bestDist = Infinity;
  for (const node of nodes) {
    const dist = vec3Distance(node.position, target);
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

function findNearby(nodes: RRTNode[], target: Vec3, radius: number): RRTNode[] {
  return nodes.filter(n => vec3Distance(n.position, target) <= radius);
}

function propagateCostUpdate(node: RRTNode): void {
  for (const child of node.children) {
    child.cost = node.cost + vec3Distance(node.position, child.position);
    propagateCostUpdate(child);
  }
}

function reconstructRRTPath(node: RRTNode): Vec3[] {
  const path: Vec3[] = [];
  let current: RRTNode | null = node;
  while (current) {
    path.unshift(current.position);
    current = current.parent;
  }
  return path;
}

// ============================================================
// PATH PLANNING (unified interface)
// ============================================================

/**
 * Plan a path using the specified algorithm
 */
export function planPath(
  start: Vec3,
  goal: Vec3,
  grid: OccupancyGrid,
  bounds: AABB,
  algorithm: PathAlgorithm = 'a-star' as PathAlgorithm,
): Path | null {
  let points: Vec3[] | null;

  if (algorithm === 'rrt-star') {
    points = rrtStarPath(start, goal, grid, bounds);
  } else {
    points = aStarPath(start, goal, grid);
  }

  if (!points || points.length === 0) return null;

  // Convert points to waypoints
  const waypoints: Waypoint[] = points.map(pos => ({
    position: pos,
    tolerance: grid.resolution * 2,
  }));

  // Calculate total distance
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += vec3Distance(points[i - 1]!, points[i]!);
  }

  return {
    id: generateNonce(16),
    waypoints,
    algorithm,
    totalDistance,
    estimatedTime: totalDistance / 0.5, // assume 0.5 m/s robot speed
    cost: totalDistance,
    collisionFree: true,
    createdAt: Date.now(),
  };
}
