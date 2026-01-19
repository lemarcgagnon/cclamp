import * as THREE from 'three';
import Module from 'manifold-3d';
import { ClampParams } from '../types';

// Initialize manifold-3d WASM module
let wasm: Awaited<ReturnType<typeof Module>> | null = null;
let Manifold: typeof wasm.Manifold;
let CrossSection: typeof wasm.CrossSection;

export async function initManifold() {
  if (wasm) return;
  try {
    wasm = await Module();
    wasm.setup();
    Manifold = wasm.Manifold;
    CrossSection = wasm.CrossSection;
    console.log('Manifold-3d initialized successfully');
  } catch (err) {
    console.error('Failed to initialize manifold-3d:', err);
    throw err;
  }
}

// Check if manifold is initialized
export function isManifoldReady(): boolean {
  return wasm !== null;
}

/**
 * Convert Manifold mesh to Three.js BufferGeometry
 */
function manifoldToThreeGeometry(manifold: InstanceType<typeof Manifold>): THREE.BufferGeometry {
  const mesh = manifold.getMesh();

  const geometry = new THREE.BufferGeometry();

  // Extract positions (first 3 properties per vertex)
  const numVerts = mesh.numVert;
  const positions = new Float32Array(numVerts * 3);

  for (let i = 0; i < numVerts; i++) {
    const pos = mesh.position(i);
    positions[i * 3] = pos[0];
    positions[i * 3 + 1] = pos[1];
    positions[i * 3 + 2] = pos[2];
  }

  // Extract indices
  const numTris = mesh.numTri;
  const indices = new Uint32Array(numTris * 3);

  for (let i = 0; i < numTris; i++) {
    const verts = mesh.verts(i);
    indices[i * 3] = verts[0];
    indices[i * 3 + 1] = verts[1];
    indices[i * 3 + 2] = verts[2];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Create a helical thread path as a series of small cylinders unioned together
 * This creates a proper manifold helix for thread grooves
 */
function createHelicalThread(
  radius: number,
  length: number,
  pitch: number,
  tubeRadius: number,
  segments: number
): InstanceType<typeof Manifold> | null {
  const turns = Math.floor(length / pitch);
  if (turns < 1) return null;

  const pointsPerTurn = Math.max(12, segments);
  const totalPoints = turns * pointsPerTurn;

  // Create helix using small spheres/cylinders unioned together
  let result: InstanceType<typeof Manifold> | null = null;

  for (let i = 0; i < totalPoints; i++) {
    const t = i / totalPoints;
    const angle = t * turns * Math.PI * 2;
    const y = t * length;

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    // Create a small sphere at each point
    const sphere = Manifold.sphere(tubeRadius, 8);
    const translated = sphere.translate(x, y, z);

    if (result === null) {
      result = translated;
    } else {
      const newResult = result.add(translated);
      result.delete();
      translated.delete();
      result = newResult;
    }
    sphere.delete();
  }

  return result;
}

/**
 * Generates the C-Clamp Frame Geometry with threaded hole
 * Uses manifold-3d for guaranteed manifold output
 */
export const generateFrameGeometry = (params: ClampParams): THREE.BufferGeometry => {
  if (!wasm) {
    console.error('Manifold not initialized');
    return new THREE.BoxGeometry(1, 1, 1);
  }

  const { height, depth, thickness, width, screwRadius, screwPosition, tolerance, threadPitch, quality } = params;
  const segments = quality === 1 ? 16 : quality === 2 ? 24 : 32;

  const screwX = depth * screwPosition;
  const minJawLen = screwX + screwRadius + (thickness * 0.6);
  const actualDepth = Math.max(depth, minJawLen);

  try {
    // Create C-frame cross-section
    // The shape: bottom arm, vertical spine, top arm
    const innerH = height;
    const innerD = actualDepth;

    // Create the C-shape as a 2D cross-section then extrude
    // Points go CCW for the outer boundary
    const outerPoints: [number, number][] = [
      [-thickness, -thickness],           // bottom-left outer
      [innerD, -thickness],               // bottom-right
      [innerD, 0],                        // bottom arm inner right
      [0, 0],                             // bottom arm inner corner
      [0, innerH],                        // top arm inner corner
      [innerD, innerH],                   // top arm inner right
      [innerD, innerH + thickness],       // top-right outer
      [-thickness, innerH + thickness],   // top-left outer
    ];

    const crossSection = new CrossSection([outerPoints]);

    // Extrude to create 3D frame (along Z axis in manifold)
    let frame = crossSection.extrude(width, 1, 0, 1, true);
    crossSection.delete();

    // Rotate to match Three.js coordinate system (Y-up)
    // Manifold extrudes along Z, we want it along Z in our scene
    frame = frame.rotate(90, 0, 0);

    // Create threaded hole cutter
    const cutLength = thickness * 3;
    const coreRadius = screwRadius + tolerance;

    // Main cylinder for hole
    let holeCutter = Manifold.cylinder(cutLength, coreRadius, coreRadius, segments, true);

    // Add helical thread groove (tube that wraps around cylinder)
    const threadDepth = threadPitch * 0.5;
    const tubeRadius = threadPitch * 0.4;
    const helixRadius = coreRadius; // On the surface

    const helix = createHelicalThread(helixRadius, cutLength * 0.9, threadPitch, tubeRadius, segments);
    if (helix) {
      const translatedHelix = helix.translate(0, -cutLength * 0.45, 0);
      helix.delete();

      const combined = holeCutter.add(translatedHelix);
      holeCutter.delete();
      translatedHelix.delete();
      holeCutter = combined;
    }

    // Rotate hole cutter to align with Y axis (vertical)
    holeCutter = holeCutter.rotate(0, 0, 0); // Already along Y

    // Position hole in top arm
    const holeY = innerH + thickness / 2;
    const holeZ = 0; // Center of width
    const translatedCutter = holeCutter.translate(screwX, holeY, holeZ);
    holeCutter.delete();

    // Subtract hole from frame
    const result = frame.subtract(translatedCutter);
    frame.delete();
    translatedCutter.delete();

    // Convert to Three.js geometry
    const geometry = manifoldToThreeGeometry(result);
    result.delete();

    geometry.center();
    return geometry;

  } catch (err) {
    console.error('Frame generation failed:', err);
    return new THREE.BoxGeometry(10, 10, 10);
  }
};

/**
 * Generates a MANIFOLD Threaded Screw Geometry suitable for 3D printing
 * Uses manifold-3d for guaranteed manifold output
 */
export const generateScrewGeometry = (params: ClampParams): THREE.BufferGeometry => {
  if (!wasm) {
    console.error('Manifold not initialized');
    return new THREE.CylinderGeometry(5, 5, 20);
  }

  const { screwRadius, screwLength, threadPitch, quality } = params;
  const segments = quality === 1 ? 16 : quality === 2 ? 24 : 32;

  try {
    // 1. FLAT PRESSURE PAD at bottom
    const padRadius = screwRadius * 1.6;
    const padThickness = 4;
    let result = Manifold.cylinder(padThickness, padRadius, padRadius, segments, false);

    // 2. Main screw shaft - extends from pad upward
    const shaft = Manifold.cylinder(screwLength, screwRadius, screwRadius, segments, false);
    const translatedShaft = shaft.translate(0, padThickness, 0);
    shaft.delete();

    let newResult = result.add(translatedShaft);
    result.delete();
    translatedShaft.delete();
    result = newResult;

    // 3. T-HANDLE at top with spherical knobs
    const handleLength = screwRadius * 6;
    const handleRadius = screwRadius * 0.5;
    const handleY = padThickness + screwLength + handleRadius * 2;

    // Handle bar (horizontal cylinder rotated 90 degrees)
    const handleBar = Manifold.cylinder(handleLength, handleRadius, handleRadius, segments, true);
    const rotatedHandle = handleBar.rotate(0, 0, 90);
    handleBar.delete();
    const translatedHandle = rotatedHandle.translate(0, handleY, 0);
    rotatedHandle.delete();

    newResult = result.add(translatedHandle);
    result.delete();
    translatedHandle.delete();
    result = newResult;

    // Handle collar
    const collarHeight = handleRadius * 4;
    const collar = Manifold.cylinder(collarHeight, screwRadius * 1.0, screwRadius * 1.0, segments, false);
    const translatedCollar = collar.translate(0, padThickness + screwLength, 0);
    collar.delete();

    newResult = result.add(translatedCollar);
    result.delete();
    translatedCollar.delete();
    result = newResult;

    // Spherical knobs at handle ends
    const knobRadius = handleRadius * 1.8;

    const knob1 = Manifold.sphere(knobRadius, segments);
    const translatedKnob1 = knob1.translate(-handleLength / 2, handleY, 0);
    knob1.delete();

    newResult = result.add(translatedKnob1);
    result.delete();
    translatedKnob1.delete();
    result = newResult;

    const knob2 = Manifold.sphere(knobRadius, segments);
    const translatedKnob2 = knob2.translate(handleLength / 2, handleY, 0);
    knob2.delete();

    newResult = result.add(translatedKnob2);
    result.delete();
    translatedKnob2.delete();
    result = newResult;

    // 4. Cut thread grooves into the shaft
    const threadGrooves = createHelicalThread(
      screwRadius + 0.1,  // Slightly larger to cut into shaft
      screwLength,
      threadPitch,
      threadPitch * 0.35,
      segments
    );

    if (threadGrooves) {
      const translatedGrooves = threadGrooves.translate(0, padThickness, 0);
      threadGrooves.delete();

      newResult = result.subtract(translatedGrooves);
      result.delete();
      translatedGrooves.delete();
      result = newResult;
    }

    // Convert to Three.js geometry
    const geometry = manifoldToThreeGeometry(result);
    result.delete();

    return geometry;

  } catch (err) {
    console.error('Screw generation failed:', err);
    return new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, 32);
  }
};

/**
 * Export manifold mesh directly for 3MF export
 * Returns the raw manifold for external processing
 */
export function getManifoldForExport(
  params: ClampParams,
  includeScrew: boolean
): { frame: InstanceType<typeof Manifold>; screw?: InstanceType<typeof Manifold> } | null {
  if (!wasm) return null;

  // This would need a separate implementation that returns Manifolds directly
  // For now, we use the geometry functions
  return null;
}
