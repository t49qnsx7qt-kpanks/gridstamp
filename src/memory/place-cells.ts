/**
 * Place Cell & Grid Cell Model (Bio-inspired spatial coding)
 *
 * Based on Nobel Prize 2014 work:
 * - Place cells (O'Keefe, 1971): Neurons in hippocampus that fire at specific locations
 * - Grid cells (Moser & Moser, 2005): Neurons in entorhinal cortex with hexagonal firing patterns
 *
 * Together they form a biological GPS for spatial coding.
 * We use them to create robust position estimates from noisy sensor data.
 */
import type { Vec3, PlaceCell, GridCell, SpatialCode } from '../types/index.js';
import { vec3Distance, gaussian3D } from '../utils/math.js';
import { generateNonce } from '../utils/crypto.js';

// ============================================================
// PLACE CELLS
// ============================================================

/**
 * Create a place cell centered at a specific location
 * Activation follows a 3D Gaussian: peaks at center, falls off with distance
 */
export function createPlaceCell(
  center: Vec3,
  radius: number = 2.0, // meters — typical place field radius
  peakRate: number = 1.0,
): PlaceCell {
  const id = `pc_${generateNonce(8)}`;
  const sigma = radius / 2.0; // sigma = half the field radius

  return {
    id,
    center,
    radius,
    peakRate,
    activation(position: Vec3): number {
      return gaussian3D(position, center, sigma, peakRate);
    },
  };
}

/**
 * Place cell population — manages a set of place cells covering an environment
 */
export class PlaceCellPopulation {
  private cells: PlaceCell[] = [];
  private readonly minSpacing: number; // minimum distance between cell centers

  constructor(minSpacing: number = 1.5) {
    this.minSpacing = minSpacing;
  }

  /** Add a place cell (reject if too close to existing cell) */
  add(cell: PlaceCell): boolean {
    for (const existing of this.cells) {
      if (vec3Distance(existing.center, cell.center) < this.minSpacing) {
        return false; // too close to existing cell
      }
    }
    this.cells.push(cell);
    return true;
  }

  /**
   * Auto-generate place cells to cover a region
   * Uses a quasi-random distribution for even coverage
   */
  coverRegion(
    min: Vec3,
    max: Vec3,
    spacing: number = 2.0,
    radius: number = 2.0,
  ): number {
    let count = 0;
    for (let x = min.x; x <= max.x; x += spacing) {
      for (let y = min.y; y <= max.y; y += spacing) {
        for (let z = min.z; z <= max.z; z += spacing) {
          const cell = createPlaceCell({ x, y, z }, radius);
          if (this.add(cell)) count++;
        }
      }
    }
    return count;
  }

  /**
   * Get activation of all place cells for a position
   * Returns map of cell ID → activation level [0,1]
   */
  getActivations(position: Vec3): ReadonlyMap<string, number> {
    const activations = new Map<string, number>();
    for (const cell of this.cells) {
      const a = cell.activation(position);
      if (a > 0.01) { // threshold noise
        activations.set(cell.id, a);
      }
    }
    return activations;
  }

  /**
   * Estimate position from place cell activations (population vector decoding)
   * Weighted average of cell centers by activation level
   */
  decodePosition(activations: ReadonlyMap<string, number>): Vec3 {
    let totalWeight = 0;
    let wx = 0, wy = 0, wz = 0;

    for (const [id, activation] of activations) {
      const cell = this.cells.find(c => c.id === id);
      if (!cell) continue;
      wx += cell.center.x * activation;
      wy += cell.center.y * activation;
      wz += cell.center.z * activation;
      totalWeight += activation;
    }

    if (totalWeight < 1e-10) {
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x: wx / totalWeight,
      y: wy / totalWeight,
      z: wz / totalWeight,
    };
  }

  get count(): number {
    return this.cells.length;
  }
}

// ============================================================
// GRID CELLS
// ============================================================

/**
 * Create a grid cell with hexagonal firing pattern
 *
 * Grid cells fire at regular intervals forming a hexagonal tiling.
 * The activation is the sum of 3 cosine waves at 60° intervals.
 * Parameters: spacing (period), orientation (rotation), phase (offset)
 */
export function createGridCell(
  spacing: number = 1.0, // meters between grid vertices
  orientation: number = 0, // radians
  phase: Vec3 = { x: 0, y: 0, z: 0 },
): GridCell {
  const id = `gc_${generateNonce(8)}`;
  const k = (2 * Math.PI) / spacing; // wave number

  // Three direction vectors at 60° intervals (hexagonal)
  const dirs = [0, Math.PI / 3, 2 * Math.PI / 3].map(angle => {
    const a = angle + orientation;
    return { x: Math.cos(a), y: Math.sin(a) };
  });

  return {
    id,
    spacing,
    orientation,
    phase,
    activation(position: Vec3): number {
      // Sum of 3 cosine waves creates hexagonal pattern
      let sum = 0;
      for (const dir of dirs) {
        const proj = (position.x - phase.x) * dir.x + (position.y - phase.y) * dir.y;
        sum += Math.cos(k * proj);
      }
      // Normalize from [-3, 3] to [0, 1]
      return (sum + 3) / 6;
    },
  };
}

/**
 * Grid cell module — a group of grid cells with the same spacing but different phases
 * Multiple modules at different scales form a hierarchical coordinate system
 */
export class GridCellModule {
  private cells: GridCell[] = [];
  readonly spacing: number;
  readonly orientation: number;

  constructor(spacing: number, orientation: number, cellCount: number = 16) {
    this.spacing = spacing;
    this.orientation = orientation;

    // Generate cells with different random phases
    for (let i = 0; i < cellCount; i++) {
      const phase: Vec3 = {
        x: (Math.random() - 0.5) * spacing,
        y: (Math.random() - 0.5) * spacing,
        z: 0,
      };
      this.cells.push(createGridCell(spacing, orientation, phase));
    }
  }

  getActivations(position: Vec3): ReadonlyMap<string, number> {
    const activations = new Map<string, number>();
    for (const cell of this.cells) {
      activations.set(cell.id, cell.activation(position));
    }
    return activations;
  }

  get count(): number {
    return this.cells.length;
  }
}

/**
 * Multi-scale grid cell system
 * Uses modules at different spacings (like a multi-resolution ruler)
 * Typical ratios: 1:1.4:2:2.8 (approximate √2 scaling)
 */
export class GridCellSystem {
  private modules: GridCellModule[] = [];

  constructor(
    baseSpacing: number = 0.5,
    scaleRatio: number = Math.SQRT2,
    numModules: number = 4,
    cellsPerModule: number = 16,
  ) {
    for (let i = 0; i < numModules; i++) {
      const spacing = baseSpacing * Math.pow(scaleRatio, i);
      const orientation = (i * Math.PI) / (6 * numModules); // slight rotation per module
      this.modules.push(new GridCellModule(spacing, orientation, cellsPerModule));
    }
  }

  getActivations(position: Vec3): ReadonlyMap<string, number> {
    const all = new Map<string, number>();
    for (const module of this.modules) {
      for (const [id, activation] of module.getActivations(position)) {
        all.set(id, activation);
      }
    }
    return all;
  }

  get totalCells(): number {
    return this.modules.reduce((sum, m) => sum + m.count, 0);
  }
}

// ============================================================
// SPATIAL CODING — combined place + grid cell system
// ============================================================

/**
 * Compute full spatial code for a position
 * Combines place cell and grid cell activations into a population vector
 */
export function computeSpatialCode(
  position: Vec3,
  placeCells: PlaceCellPopulation,
  gridCells: GridCellSystem,
): SpatialCode {
  const placeActivations = placeCells.getActivations(position);
  const gridActivations = gridCells.getActivations(position);

  // Confidence based on number of active place cells
  const activePlaceCells = [...placeActivations.values()].filter(a => a > 0.1).length;
  const confidence = Math.min(1, activePlaceCells / 3); // 3+ active cells = full confidence

  // Position estimate from place cell decoding
  const estimatedPosition = placeCells.decodePosition(placeActivations);

  return {
    placeCellActivations: placeActivations,
    gridCellActivations: gridActivations,
    estimatedPosition,
    confidence,
    timestamp: Date.now(),
  };
}
