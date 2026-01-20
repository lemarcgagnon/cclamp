import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ClampParams } from '../types';

/**
 * Clean up geometry to ensure manifold output
 */
function cleanupGeometry(geometry: THREE.BufferGeometry, tolerance: number = 0.0001): THREE.BufferGeometry {
  let cleaned = mergeVertices(geometry, tolerance);
  cleaned.computeVertexNormals();

  // Remove NaN values
  const positions = cleaned.attributes.position.array;
  for (let i = 0; i < positions.length; i++) {
    if (!isFinite(positions[i])) {
      positions[i] = 0;
    }
  }
  cleaned.attributes.position.needsUpdate = true;

  return cleaned;
}

/**
 * Prepare geometry for CSG - ensures it's ready for boolean operations
 */
function prepareForCSG(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const prepared = geometry.clone();
  prepared.clearGroups();
  prepared.addGroup(0, prepared.index ? prepared.index.count : prepared.attributes.position.count, 0);

  if (!prepared.attributes.normal) {
    prepared.computeVertexNormals();
  }

  return prepared;
}

/**
 * Create a SOLID torus (ring) - guaranteed watertight
 * Used for thread grooves instead of open tube geometry
 */
function createSolidTorus(
  radius: number,      // Distance from center to tube center
  tubeRadius: number,  // Radius of the tube
  radialSegments: number,
  tubularSegments: number
): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(radius, tubeRadius, radialSegments, tubularSegments);
  // Torus is already a closed solid - no open edges
  return geo;
}

/**
 * Create thread rings for the screw shaft
 * Uses solid torus shapes instead of open tubes - guaranteed manifold
 */
function createThreadRings(
  shaftRadius: number,
  length: number,
  pitch: number,
  startY: number,
  quality: number
): THREE.BufferGeometry | null {
  const turns = Math.floor(length / pitch);
  if (turns < 1) return null;

  const csgMaterial = new THREE.MeshBasicMaterial();
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = false;

  const radialSegments = quality === 1 ? 8 : quality === 2 ? 12 : 16;
  const tubularSegments = quality === 1 ? 24 : quality === 2 ? 32 : 48;

  // Groove dimensions
  const grooveDepth = pitch * 0.25;
  const grooveRadius = shaftRadius + grooveDepth * 0.5;

  let resultBrush: ReturnType<typeof Brush.prototype.constructor> | null = null;

  // Create a torus ring at each thread position
  for (let i = 0; i < turns; i++) {
    const y = startY + (i + 0.5) * pitch;

    const torus = createSolidTorus(grooveRadius, grooveDepth, radialSegments, tubularSegments);
    // Rotate torus to be horizontal (XZ plane) and position at Y
    torus.rotateX(Math.PI / 2);
    torus.translate(0, y, 0);

    const torusBrush = new Brush(prepareForCSG(torus), csgMaterial);
    torusBrush.updateMatrixWorld();

    if (resultBrush === null) {
      resultBrush = torusBrush;
    } else {
      resultBrush = evaluator.evaluate(resultBrush, torusBrush, ADDITION);
    }
  }

  if (!resultBrush) return null;

  return cleanupGeometry(resultBrush.geometry);
}

/**
 * Create thread rings for the hole (female threads)
 * Solid torus shapes that will be added to hole cutter
 */
function createHoleThreadRings(
  holeRadius: number,
  length: number,
  pitch: number,
  quality: number
): THREE.BufferGeometry | null {
  const turns = Math.floor(length / pitch);
  if (turns < 1) return null;

  const csgMaterial = new THREE.MeshBasicMaterial();
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = false;

  const radialSegments = quality === 1 ? 8 : quality === 2 ? 12 : 16;
  const tubularSegments = quality === 1 ? 24 : quality === 2 ? 32 : 48;

  // Thread ridge dimensions - extends outward from cylinder
  const ridgeHeight = pitch * 0.35;
  const ridgeRadius = holeRadius;

  let resultBrush: ReturnType<typeof Brush.prototype.constructor> | null = null;

  for (let i = 0; i < turns; i++) {
    const y = -length / 2 + (i + 0.5) * pitch;

    const torus = createSolidTorus(ridgeRadius, ridgeHeight, radialSegments, tubularSegments);
    torus.rotateX(Math.PI / 2);
    torus.translate(0, y, 0);

    const torusBrush = new Brush(prepareForCSG(torus), csgMaterial);
    torusBrush.updateMatrixWorld();

    if (resultBrush === null) {
      resultBrush = torusBrush;
    } else {
      resultBrush = evaluator.evaluate(resultBrush, torusBrush, ADDITION);
    }
  }

  if (!resultBrush) return null;

  return cleanupGeometry(resultBrush.geometry);
}

/**
 * Generates the C-Clamp Frame Geometry with threaded hole
 * All geometry is solid and watertight
 */
export const generateFrameGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { height, depth, thickness, width, screwRadius, screwPosition, tolerance, quality } = params;

  const curveSegments = quality === 1 ? 16 : quality === 2 ? 24 : 32;

  // C-Frame Shape
  const shape = new THREE.Shape();

  const screwX = depth * screwPosition;
  const minJawLen = screwX + screwRadius + (thickness * 0.6);
  const actualDepth = Math.max(depth, minJawLen);

  const innerH = height;
  const innerD = actualDepth;

  shape.moveTo(0, 0);
  shape.lineTo(0, innerH);
  shape.lineTo(innerD, innerH);
  shape.lineTo(innerD, innerH + thickness);
  shape.lineTo(-thickness, innerH + thickness);
  shape.lineTo(-thickness, -thickness);
  shape.lineTo(innerD, -thickness);
  shape.lineTo(innerD, 0);
  shape.lineTo(0, 0);

  const extrudeSettings = {
    steps: 2,
    depth: width,
    bevelEnabled: true,
    bevelThickness: 1,
    bevelSize: 1,
    bevelSegments: 3,
    curveSegments: curveSegments,
  };

  let frameGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  frameGeometry = prepareForCSG(frameGeometry);

  try {
    const cutLength = thickness * 3;

    if (!Brush || !Evaluator) {
      console.warn("CSG libraries not available.");
      frameGeometry.center();
      return cleanupGeometry(frameGeometry);
    }

    const csgMaterial = new THREE.MeshNormalMaterial();
    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false;

    const frameBrush = new Brush(frameGeometry, csgMaterial);
    frameBrush.updateMatrixWorld();

    // Create hole cutter - SOLID cylinder (closed ends)
    const radialSegments = quality === 1 ? 24 : quality === 2 ? 32 : 48;
    const coreRadius = screwRadius + tolerance;

    // CylinderGeometry with openEnded=false is a CLOSED solid
    const coreGeo = new THREE.CylinderGeometry(
      coreRadius, coreRadius, cutLength,
      radialSegments, 1, false  // false = closed ends = solid
    );

    let holeCutter = new Brush(prepareForCSG(coreGeo), csgMaterial);
    holeCutter.updateMatrixWorld();

    // Add thread ridges to hole cutter using solid torus rings
    const threadRings = createHoleThreadRings(coreRadius, cutLength * 0.8, params.threadPitch, quality);
    if (threadRings) {
      const threadBrush = new Brush(prepareForCSG(threadRings), csgMaterial);
      threadBrush.updateMatrixWorld();
      holeCutter = evaluator.evaluate(holeCutter, threadBrush, ADDITION);
    }

    // Position hole cutter
    const holeY = height + thickness / 2;
    const cutterBrush = new Brush(holeCutter.geometry, csgMaterial);
    cutterBrush.position.set(screwX, holeY, params.width / 2);
    cutterBrush.updateMatrixWorld();

    // Subtract hole from frame
    const result = evaluator.evaluate(frameBrush, cutterBrush, SUBTRACTION);

    let finalGeo = result.geometry;
    finalGeo.center();
    finalGeo = cleanupGeometry(finalGeo);

    return finalGeo;

  } catch (err) {
    console.error("CSG Operation Failed:", err);
    frameGeometry.center();
    return cleanupGeometry(frameGeometry);
  }
};

/**
 * Generates a SOLID Threaded Screw Geometry
 * All components are closed solids - no open geometry
 */
export const generateScrewGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { screwRadius, screwLength, threadPitch, quality } = params;

  // Higher segments for solid, watertight geometry
  const segments = quality === 1 ? 24 : quality === 2 ? 32 : 48;
  const csgMaterial = new THREE.MeshBasicMaterial();

  try {
    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false;

    // 1. FLAT PRESSURE PAD - solid cylinder (closed ends)
    const padRadius = screwRadius * 1.6;
    const padThickness = 4;
    const padGeo = new THREE.CylinderGeometry(
      padRadius, padRadius, padThickness,
      segments, 1, false  // closed = solid
    );
    padGeo.translate(0, padThickness / 2, 0);

    let resultBrush = new Brush(prepareForCSG(padGeo), csgMaterial);
    resultBrush.updateMatrixWorld();

    // 2. Main screw shaft - solid cylinder
    const shaftGeo = new THREE.CylinderGeometry(
      screwRadius, screwRadius, screwLength,
      segments, 1, false  // closed = solid
    );
    shaftGeo.translate(0, padThickness + screwLength / 2, 0);

    const shaftBrush = new Brush(prepareForCSG(shaftGeo), csgMaterial);
    shaftBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, shaftBrush, ADDITION);

    // 3. T-HANDLE - all solid geometry
    const handleLength = screwRadius * 6;
    const handleRadius = screwRadius * 0.5;
    const handleY = padThickness + screwLength + handleRadius * 2;

    // Handle bar - solid cylinder
    const handleBarGeo = new THREE.CylinderGeometry(
      handleRadius, handleRadius, handleLength,
      segments, 1, false
    );
    handleBarGeo.rotateZ(Math.PI / 2);
    handleBarGeo.translate(0, handleY, 0);

    const handleBrush = new Brush(prepareForCSG(handleBarGeo), csgMaterial);
    handleBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, handleBrush, ADDITION);

    // Handle collar - solid cylinder
    const collarGeo = new THREE.CylinderGeometry(
      screwRadius * 1.0, screwRadius * 1.0, handleRadius * 4,
      segments, 1, false
    );
    collarGeo.translate(0, padThickness + screwLength + handleRadius, 0);

    const collarBrush = new Brush(prepareForCSG(collarGeo), csgMaterial);
    collarBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, collarBrush, ADDITION);

    // Spherical knobs - spheres are inherently solid
    const knobRadius = handleRadius * 1.8;
    const sphereSegments = Math.max(16, segments / 2);

    const knobGeo1 = new THREE.SphereGeometry(knobRadius, sphereSegments, sphereSegments / 2);
    knobGeo1.translate(-handleLength / 2, handleY, 0);
    const knobBrush1 = new Brush(prepareForCSG(knobGeo1), csgMaterial);
    knobBrush1.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, knobBrush1, ADDITION);

    const knobGeo2 = new THREE.SphereGeometry(knobRadius, sphereSegments, sphereSegments / 2);
    knobGeo2.translate(handleLength / 2, handleY, 0);
    const knobBrush2 = new Brush(prepareForCSG(knobGeo2), csgMaterial);
    knobBrush2.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, knobBrush2, ADDITION);

    // 4. Thread grooves - subtract solid torus rings
    const threadGrooves = createThreadRings(
      screwRadius,
      screwLength,
      threadPitch,
      padThickness,
      quality
    );

    if (threadGrooves) {
      const threadBrush = new Brush(prepareForCSG(threadGrooves), csgMaterial);
      threadBrush.updateMatrixWorld();
      resultBrush = evaluator.evaluate(resultBrush, threadBrush, SUBTRACTION);
    }

    let finalGeo = resultBrush.geometry;
    finalGeo = cleanupGeometry(finalGeo);

    return finalGeo;

  } catch (err) {
    console.error("Screw CSG failed:", err);
    const fallback = new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, 32, 1, false);
    fallback.translate(0, screwLength / 2, 0);
    return cleanupGeometry(fallback);
  }
};
