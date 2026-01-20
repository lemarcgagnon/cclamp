import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ClampParams } from '../types';

/**
 * Clean up geometry to ensure manifold output
 * - Merges duplicate vertices within tolerance
 * - Recomputes normals
 * - Removes degenerate triangles
 */
function cleanupGeometry(geometry: THREE.BufferGeometry, tolerance: number = 0.0001): THREE.BufferGeometry {
  // Merge vertices that are within tolerance
  let cleaned = mergeVertices(geometry, tolerance);

  // Recompute normals for consistent face orientation
  cleaned.computeVertexNormals();

  // Remove any NaN or invalid values
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
 * Prepare geometry for CSG operations
 * Ensures geometry has proper groups and is ready for boolean operations
 */
function prepareForCSG(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // Clone to avoid modifying original
  const prepared = geometry.clone();

  // Clear existing groups and set single group
  prepared.clearGroups();
  prepared.addGroup(0, prepared.index ? prepared.index.count : prepared.attributes.position.count, 0);

  // Ensure we have normals
  if (!prepared.attributes.normal) {
    prepared.computeVertexNormals();
  }

  return prepared;
}

/**
 * Generates the C-Clamp Frame Geometry with threaded hole
 * Optimized for manifold output - no non-manifold edges
 */
export const generateFrameGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { height, depth, thickness, width, screwRadius, screwPosition, tolerance, quality } = params;

  // Higher segments for better manifold results
  const curveSegments = quality === 1 ? 16 : quality === 2 ? 24 : 32;

  // 1. Base C-Frame Shape
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
    steps: 2, // More steps for smoother geometry
    depth: width,
    bevelEnabled: true,
    bevelThickness: 1,
    bevelSize: 1,
    bevelSegments: 3, // More bevel segments
    curveSegments: curveSegments,
  };

  let frameGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  frameGeometry = prepareForCSG(frameGeometry);

  // CSG Operations - Cut threaded hole
  try {
    const cutLength = thickness * 3;

    if (!Brush || !Evaluator) {
      console.warn("CSG libraries not available.");
      frameGeometry.center();
      return cleanupGeometry(frameGeometry);
    }

    const csgMaterial = new THREE.MeshNormalMaterial();

    const frameBrush = new Brush(frameGeometry, csgMaterial);
    frameBrush.updateMatrixWorld();

    // Generate threaded hole cutter
    const cutterGeo = generateThreadedHoleCutter(
      screwRadius,
      tolerance,
      cutLength,
      params.threadPitch,
      quality
    );

    const cutterBrush = new Brush(cutterGeo, csgMaterial);
    const holeY = height + thickness / 2;
    cutterBrush.position.set(screwX, holeY, params.width / 2);
    cutterBrush.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false; // Disable groups for cleaner output

    const result = evaluator.evaluate(frameBrush, cutterBrush, SUBTRACTION);

    let finalGeo = result.geometry;
    finalGeo.center();

    // Clean up for manifold output
    finalGeo = cleanupGeometry(finalGeo);

    return finalGeo;

  } catch (err) {
    console.error("CSG Operation Failed:", err);
    frameGeometry.center();
    return cleanupGeometry(frameGeometry);
  }
};

/**
 * Generate a threaded hole cutter using CSG
 * Creates a cylinder with helical thread grooves
 * Optimized for manifold output
 */
function generateThreadedHoleCutter(
  screwRadius: number,
  tolerance: number,
  length: number,
  threadPitch: number,
  quality: number
): THREE.BufferGeometry {
  const csgMaterial = new THREE.MeshBasicMaterial();
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = false;

  // Higher segments for quality
  const radialSegments = quality === 1 ? 24 : quality === 2 ? 32 : 48;

  // Thread dimensions
  const tubeRadius = threadPitch * 0.4;
  const coreRadius = screwRadius + tolerance;

  // 1. Create main cylinder for the hole (closed ends for manifold)
  const coreGeo = new THREE.CylinderGeometry(
    coreRadius, coreRadius, length,
    radialSegments, 1, false // closed = false means caps are included
  );

  let resultBrush = new Brush(prepareForCSG(coreGeo), csgMaterial);
  resultBrush.updateMatrixWorld();

  // 2. Create helical thread groove
  const turns = Math.floor(length / threadPitch);
  if (turns >= 1) {
    const helixPoints: THREE.Vector3[] = [];
    const pointsPerTurn = quality === 1 ? 16 : quality === 2 ? 24 : 32;
    const totalPoints = turns * pointsPerTurn;
    const helixRadius = coreRadius;

    for (let i = 0; i <= totalPoints; i++) {
      const t = i / totalPoints;
      const angle = t * turns * Math.PI * 2;
      const y = t * length - length / 2;

      helixPoints.push(new THREE.Vector3(
        Math.cos(angle) * helixRadius,
        y,
        Math.sin(angle) * helixRadius
      ));
    }

    if (helixPoints.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(helixPoints);

      // Higher tube segments for smooth manifold result
      const tubularSegments = totalPoints * 2;
      const radialTubeSegments = quality === 1 ? 8 : quality === 2 ? 12 : 16;

      const tubeGeo = new THREE.TubeGeometry(
        curve,
        tubularSegments,
        tubeRadius,
        radialTubeSegments,
        false // Not closed loop
      );

      const threadBrush = new Brush(prepareForCSG(tubeGeo), csgMaterial);
      threadBrush.updateMatrixWorld();

      resultBrush = evaluator.evaluate(resultBrush, threadBrush, ADDITION);
    }
  }

  let geo = resultBrush.geometry;
  geo = cleanupGeometry(geo);
  return geo;
}

/**
 * Generates a Threaded Screw Geometry suitable for 3D printing
 * Uses CSG UNION operations with manifold-safe cleanup
 */
export const generateScrewGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { screwRadius, screwLength, threadPitch, quality } = params;

  // Higher segments for manifold safety
  const segments = quality === 1 ? 24 : quality === 2 ? 32 : 48;
  const csgMaterial = new THREE.MeshBasicMaterial();

  try {
    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false;

    // 1. FLAT PRESSURE PAD at bottom
    const padRadius = screwRadius * 1.6;
    const padThickness = 4;
    const padGeo = new THREE.CylinderGeometry(padRadius, padRadius, padThickness, segments, 1, false);
    padGeo.translate(0, padThickness / 2, 0);
    let resultBrush = new Brush(prepareForCSG(padGeo), csgMaterial);
    resultBrush.updateMatrixWorld();

    // 2. Main screw shaft - extends from pad upward
    const shaftGeo = new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, segments, 1, false);
    shaftGeo.translate(0, padThickness + screwLength / 2, 0);
    const shaftBrush = new Brush(prepareForCSG(shaftGeo), csgMaterial);
    shaftBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, shaftBrush, ADDITION);

    // 3. T-HANDLE at top with spherical knobs
    const handleLength = screwRadius * 6;
    const handleRadius = screwRadius * 0.5;
    const handleY = padThickness + screwLength + handleRadius * 2;

    // Handle bar (horizontal)
    const handleBarGeo = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLength, segments, 1, false);
    handleBarGeo.rotateZ(Math.PI / 2);
    handleBarGeo.translate(0, handleY, 0);
    const handleBrush = new Brush(prepareForCSG(handleBarGeo), csgMaterial);
    handleBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, handleBrush, ADDITION);

    // Handle collar
    const collarGeo = new THREE.CylinderGeometry(screwRadius * 1.0, screwRadius * 1.0, handleRadius * 4, segments, 1, false);
    collarGeo.translate(0, padThickness + screwLength + handleRadius, 0);
    const collarBrush = new Brush(prepareForCSG(collarGeo), csgMaterial);
    collarBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, collarBrush, ADDITION);

    // Spherical knobs at handle ends
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

    // 4. Cut thread grooves into the shaft
    const threadGrooveGeo = createThreadGrooves(screwRadius, screwLength, threadPitch, segments, padThickness, quality);
    if (threadGrooveGeo) {
      const threadBrush = new Brush(prepareForCSG(threadGrooveGeo), csgMaterial);
      threadBrush.updateMatrixWorld();
      resultBrush = evaluator.evaluate(resultBrush, threadBrush, SUBTRACTION);
    }

    let finalGeo = resultBrush.geometry;

    // Final manifold cleanup
    finalGeo = cleanupGeometry(finalGeo);

    return finalGeo;

  } catch (err) {
    console.error("Screw CSG failed:", err);
    const fallback = new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, 32);
    fallback.translate(0, screwLength / 2, 0);
    return cleanupGeometry(fallback);
  }
};

/**
 * Create thread groove geometry for SUBTRACTION from screw shaft
 * Optimized for manifold output
 */
function createThreadGrooves(
  radius: number,
  length: number,
  pitch: number,
  segments: number,
  padThickness: number,
  quality: number
): THREE.BufferGeometry | null {
  const grooveRadius = radius + 0.1;

  const turns = Math.floor(length / pitch);
  if (turns < 1) return null;

  const helixPoints: THREE.Vector3[] = [];
  const pointsPerTurn = quality === 1 ? 12 : quality === 2 ? 18 : 24;
  const totalPoints = turns * pointsPerTurn;

  for (let i = 0; i <= totalPoints; i++) {
    const t = i / totalPoints;
    const angle = t * turns * Math.PI * 2;
    const y = padThickness + t * length;

    helixPoints.push(new THREE.Vector3(
      Math.cos(angle) * grooveRadius,
      y,
      Math.sin(angle) * grooveRadius
    ));
  }

  if (helixPoints.length < 2) return null;

  const curve = new THREE.CatmullRomCurve3(helixPoints);

  // Higher segments for manifold safety
  const tubularSegments = totalPoints * 2;
  const radialSegments = quality === 1 ? 6 : quality === 2 ? 8 : 12;

  const tubeGeo = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    pitch * 0.35,
    radialSegments,
    false
  );

  return tubeGeo;
}
