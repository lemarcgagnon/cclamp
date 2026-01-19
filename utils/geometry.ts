import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { ClampParams } from '../types';

/**
 * Helper to generate the thread path points
 */
const getHelixPoints = (radius: number, length: number, pitch: number) => {
  const points: THREE.Vector3[] = [];
  const turns = length / pitch;
  
  const extraTurns = 1;
  const startY = -pitch * extraTurns;
  const endY = length + pitch * extraTurns;
  
  const totalAngle = (turns + extraTurns * 2) * Math.PI * 2;
  
  if (length <= 0 || pitch <= 0) return [];

  const segments = Math.ceil(turns * 16); 
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * totalAngle;
    const y = startY + t * (endY - startY);
    points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return points;
};

/**
 * Generates the C-Clamp Frame Geometry with threaded hole
 * Always creates proper threads for 3D printing compatibility
 * @param params Clamp parameters
 */
export const generateFrameGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { height, depth, thickness, width, screwRadius, screwPosition, tolerance } = params;
  
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
    steps: 1,
    depth: width,
    bevelEnabled: true,
    bevelThickness: 1,
    bevelSize: 1,
    bevelSegments: 2,
    curveSegments: 12,
  };

  const frameGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  // CSG PREP: Flatten groups.
  // This is CRITICAL. The Brush expects a single material group if we pass a single material.
  frameGeometry.clearGroups();
  frameGeometry.addGroup(0, frameGeometry.attributes.position.count, 0);

  // 3. CSG Operations - Cut threaded hole
  try {
    const cutLength = thickness * 3;

    // Check if libraries loaded
    if (!Brush || !Evaluator) {
        console.warn("CSG libraries not available.");
        frameGeometry.center();
        return frameGeometry;
    }

    const csgMaterial = new THREE.MeshNormalMaterial();

    const frameBrush = new Brush(frameGeometry, csgMaterial);
    frameBrush.updateMatrixWorld();

    // ALWAYS use threaded hole for 3D printing compatibility
    // The cutter shape = screw shape + tolerance = creates matching grooves
    const cutterGeo = generateThreadedHoleCutter(
      screwRadius,
      tolerance,
      cutLength,
      params.threadPitch
    );

    const cutterBrush = new Brush(cutterGeo, csgMaterial);
    // Position hole in BOTTOM arm (Y = -thickness to 0)
    // The screw enters from below and pushes up against the workpiece
    // Top arm (Y = height to height+thickness) stays solid as the anvil
    const holeY = height + thickness / 2; // Bottom arm in shape coords
    cutterBrush.position.set(screwX, holeY, params.width / 2);
    cutterBrush.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];

    const result = evaluator.evaluate(frameBrush, cutterBrush, SUBTRACTION);

    const finalGeo = result.geometry;
    finalGeo.center();
    return finalGeo;

  } catch (err) {
    console.error("CSG Operation Failed:", err);
    frameGeometry.center();
    return frameGeometry;
  }
};

/**
 * Generate a MANIFOLD threaded hole cutter using CSG
 * Creates a cylinder with helical thread grooves that will receive the screw
 */
function generateThreadedHoleCutter(
  screwRadius: number,
  tolerance: number,
  length: number,
  threadPitch: number
): THREE.BufferGeometry {
  const csgMaterial = new THREE.MeshBasicMaterial();
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];

  // Thread dimensions - make them prominent!
  const threadDepth = threadPitch * 0.5;  // Deep threads
  const tubeRadius = threadPitch * 0.45;  // Thick tube for visibility

  // Core hole radius
  const coreRadius = screwRadius + tolerance;

  // 1. Create main cylinder for the hole
  const coreGeo = new THREE.CylinderGeometry(coreRadius, coreRadius, length, 32);
  let resultBrush = new Brush(coreGeo, csgMaterial);
  resultBrush.updateMatrixWorld();

  // 2. Create helical thread groove - tube must OVERLAP with cylinder!
  const turns = Math.floor(length / threadPitch);
  if (turns >= 1) {
    const helixPoints: THREE.Vector3[] = [];
    const pointsPerTurn = 24;  // More points for smoother helix
    const totalPoints = turns * pointsPerTurn;

    // Helix center at coreRadius so tube overlaps with cylinder
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
      // Large tube that extends OUTWARD from the cylinder surface
      const tubeGeo = new THREE.TubeGeometry(curve, totalPoints * 2, tubeRadius, 12, false);

      const threadBrush = new Brush(tubeGeo, csgMaterial);
      threadBrush.updateMatrixWorld();

      // UNION adds the helical tube to the cylinder
      // This creates a cylinder with helical bulges
      // When subtracted from frame = hole with helical grooves
      resultBrush = evaluator.evaluate(resultBrush, threadBrush, ADDITION);
    }
  }

  const geo = resultBrush.geometry;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a MANIFOLD Threaded Screw Geometry suitable for 3D printing
 * Uses CSG UNION operations to create a watertight solid mesh
 * Based on real C-clamp design: flat pad at bottom, T-handle with knobs at top
 */
export const generateScrewGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { screwRadius, screwLength, threadPitch, quality } = params;

  const segments = quality === 1 ? 16 : quality === 2 ? 24 : 32;
  const csgMaterial = new THREE.MeshBasicMaterial();

  try {
    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];

    // 1. FLAT PRESSURE PAD at bottom (like real C-clamp)
    // This is the base - screw shaft extends UP from here
    const padRadius = screwRadius * 1.6;
    const padThickness = 4;
    const padGeo = new THREE.CylinderGeometry(padRadius, padRadius, padThickness, segments);
    padGeo.translate(0, padThickness / 2, 0);
    let resultBrush = new Brush(padGeo, csgMaterial);
    resultBrush.updateMatrixWorld();

    // 2. Main screw shaft (solid cylinder) - extends from pad upward
    const shaftGeo = new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, segments);
    shaftGeo.translate(0, padThickness + screwLength / 2, 0);
    const shaftBrush = new Brush(shaftGeo, csgMaterial);
    shaftBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, shaftBrush, ADDITION);

    // 3. T-HANDLE at top with spherical knobs at ends
    const handleLength = screwRadius * 6;
    const handleRadius = screwRadius * 0.5;
    const handleY = padThickness + screwLength + handleRadius * 2;

    // Handle bar (horizontal)
    const handleBarGeo = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLength, segments);
    handleBarGeo.rotateZ(Math.PI / 2);
    handleBarGeo.translate(0, handleY, 0);
    const handleBrush = new Brush(handleBarGeo, csgMaterial);
    handleBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, handleBrush, ADDITION);

    // Handle collar (connects shaft to handle bar)
    const collarGeo = new THREE.CylinderGeometry(screwRadius * 1.0, screwRadius * 1.0, handleRadius * 4, segments);
    collarGeo.translate(0, padThickness + screwLength + handleRadius, 0);
    const collarBrush = new Brush(collarGeo, csgMaterial);
    collarBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, collarBrush, ADDITION);

    // Spherical knobs at handle ends (like reference image)
    const knobRadius = handleRadius * 1.8;
    const knobGeo1 = new THREE.SphereGeometry(knobRadius, segments, segments / 2);
    knobGeo1.translate(-handleLength / 2, handleY, 0);
    const knobBrush1 = new Brush(knobGeo1, csgMaterial);
    knobBrush1.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, knobBrush1, ADDITION);

    const knobGeo2 = new THREE.SphereGeometry(knobRadius, segments, segments / 2);
    knobGeo2.translate(handleLength / 2, handleY, 0);
    const knobBrush2 = new Brush(knobGeo2, csgMaterial);
    knobBrush2.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, knobBrush2, ADDITION);

    // 4. Cut thread grooves into the shaft using SUBTRACTION
    const threadGrooveGeo = createThreadGrooves(screwRadius, screwLength, threadPitch, segments, padThickness);
    if (threadGrooveGeo) {
      const threadBrush = new Brush(threadGrooveGeo, csgMaterial);
      threadBrush.updateMatrixWorld();
      resultBrush = evaluator.evaluate(resultBrush, threadBrush, SUBTRACTION);
    }

    const finalGeo = resultBrush.geometry;
    finalGeo.computeVertexNormals();
    return finalGeo;

  } catch (err) {
    console.error("Screw CSG failed:", err);
    // Fallback: simple cylinder
    const fallback = new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, 32);
    fallback.translate(0, screwLength / 2, 0);
    return fallback;
  }
};

/**
 * Create thread groove geometry for SUBTRACTION from screw shaft
 * Creates a helical groove that when subtracted creates thread appearance
 */
function createThreadGrooves(
  radius: number,
  length: number,
  pitch: number,
  segments: number,
  padThickness: number
): THREE.BufferGeometry | null {
  const grooveDepth = pitch * 0.3;
  const grooveRadius = radius + 0.1; // Slightly larger to ensure clean cut

  const turns = Math.floor(length / pitch);
  if (turns < 1) return null;

  // Create a tube that follows a helical path - this will be subtracted
  const helixPoints: THREE.Vector3[] = [];
  const pointsPerTurn = Math.max(8, segments / 2);
  const totalPoints = turns * pointsPerTurn;

  for (let i = 0; i <= totalPoints; i++) {
    const t = i / totalPoints;
    const angle = t * turns * Math.PI * 2;
    // Y starts above the pad (padThickness) and goes up for screwLength
    const y = padThickness + t * length;
    // Helix at the groove radius
    helixPoints.push(new THREE.Vector3(
      Math.cos(angle) * grooveRadius,
      y,
      Math.sin(angle) * grooveRadius
    ));
  }

  if (helixPoints.length < 2) return null;

  const curve = new THREE.CatmullRomCurve3(helixPoints);
  const tubeGeo = new THREE.TubeGeometry(
    curve,
    totalPoints * 2,
    pitch * 0.35, // Tube radius = groove width
    8,
    false
  );

  return tubeGeo;
}