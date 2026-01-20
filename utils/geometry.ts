import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ClampParams } from '../types';

/**
 * Clean up geometry for manifold output
 */
function cleanupGeometry(geometry: THREE.BufferGeometry, tolerance: number = 0.0001): THREE.BufferGeometry {
  let cleaned = mergeVertices(geometry, tolerance);
  cleaned.computeVertexNormals();
  return cleaned;
}

/**
 * Prepare geometry for CSG
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
 * Create a threaded cylinder profile for LatheGeometry
 * This builds the thread grooves directly into the 2D profile
 * No CSG needed - guaranteed watertight
 */
function createThreadedProfile(
  radius: number,
  length: number,
  pitch: number,
  threadDepth: number
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const turns = Math.floor(length / pitch);

  // Start at center bottom
  points.push(new THREE.Vector2(0, 0));
  points.push(new THREE.Vector2(radius - threadDepth, 0));

  // Create sawtooth thread profile going up
  for (let i = 0; i < turns; i++) {
    const baseY = i * pitch;
    // Thread valley (inner)
    points.push(new THREE.Vector2(radius - threadDepth, baseY));
    // Thread peak (outer) - middle of pitch
    points.push(new THREE.Vector2(radius, baseY + pitch * 0.5));
    // Next valley
    points.push(new THREE.Vector2(radius - threadDepth, baseY + pitch));
  }

  // Top of shaft
  const topY = turns * pitch;
  points.push(new THREE.Vector2(radius - threadDepth, topY));
  points.push(new THREE.Vector2(0, topY));

  return points;
}

/**
 * Create hole cutter profile with thread ridges built in
 */
function createThreadedHoleProfile(
  radius: number,
  length: number,
  pitch: number,
  threadDepth: number
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const turns = Math.floor(length / pitch);

  // Start at center bottom
  points.push(new THREE.Vector2(0, 0));
  points.push(new THREE.Vector2(radius, 0));

  // Create sawtooth thread ridges going up (opposite of screw - ridges go outward)
  for (let i = 0; i < turns; i++) {
    const baseY = i * pitch;
    // Thread base (at radius)
    points.push(new THREE.Vector2(radius, baseY));
    // Thread ridge peak (outer)
    points.push(new THREE.Vector2(radius + threadDepth, baseY + pitch * 0.5));
    // Back to base
    points.push(new THREE.Vector2(radius, baseY + pitch));
  }

  // Top
  const topY = turns * pitch;
  points.push(new THREE.Vector2(radius, topY));
  points.push(new THREE.Vector2(0, topY));

  return points;
}

/**
 * Generates the C-Clamp Frame with threaded hole
 */
export const generateFrameGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { height, depth, thickness, width, screwRadius, screwPosition, tolerance, quality, threadPitch } = params;

  const curveSegments = quality === 1 ? 16 : quality === 2 ? 24 : 32;
  const latheSegments = quality === 1 ? 24 : quality === 2 ? 36 : 48;

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
    const coreRadius = screwRadius + tolerance;
    const threadDepth = threadPitch * 0.3;

    const csgMaterial = new THREE.MeshNormalMaterial();
    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false;

    const frameBrush = new Brush(frameGeometry, csgMaterial);
    frameBrush.updateMatrixWorld();

    // Create threaded hole cutter using LatheGeometry - guaranteed watertight
    const holeProfile = createThreadedHoleProfile(coreRadius, cutLength, threadPitch, threadDepth);
    const holeGeo = new THREE.LatheGeometry(holeProfile, latheSegments);

    // Center the lathe geometry vertically
    holeGeo.translate(0, -cutLength / 2, 0);

    const holeBrush = new Brush(prepareForCSG(holeGeo), csgMaterial);
    const holeY = height + thickness / 2;
    holeBrush.position.set(screwX, holeY, width / 2);
    holeBrush.updateMatrixWorld();

    // Subtract hole from frame
    const result = evaluator.evaluate(frameBrush, holeBrush, SUBTRACTION);

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
 * Generates a SOLID Threaded Screw using LatheGeometry
 * The thread profile is built into the 2D shape - no CSG for threads
 * Guaranteed manifold because LatheGeometry creates closed revolution solid
 */
export const generateScrewGeometry = (params: ClampParams): THREE.BufferGeometry => {
  const { screwRadius, screwLength, threadPitch, quality } = params;

  const latheSegments = quality === 1 ? 24 : quality === 2 ? 36 : 48;
  const segments = quality === 1 ? 24 : quality === 2 ? 32 : 48;
  const threadDepth = threadPitch * 0.25;

  try {
    const csgMaterial = new THREE.MeshBasicMaterial();
    const evaluator = new Evaluator();
    evaluator.attributes = ['position', 'normal'];
    evaluator.useGroups = false;

    // 1. Create threaded shaft using LatheGeometry - single watertight mesh
    const shaftProfile = createThreadedProfile(screwRadius, screwLength, threadPitch, threadDepth);
    const shaftGeo = new THREE.LatheGeometry(shaftProfile, latheSegments);

    // 2. Create flat pressure pad - simple solid cylinder
    const padRadius = screwRadius * 1.6;
    const padThickness = 4;
    const padGeo = new THREE.CylinderGeometry(padRadius, padRadius, padThickness, segments, 1, false);
    padGeo.translate(0, -padThickness / 2, 0);

    // Merge pad with shaft
    let resultBrush = new Brush(prepareForCSG(padGeo), csgMaterial);
    resultBrush.updateMatrixWorld();

    // Position shaft on top of pad
    const shaftBrush = new Brush(prepareForCSG(shaftGeo), csgMaterial);
    shaftBrush.position.set(0, padThickness, 0);
    shaftBrush.updateMatrixWorld();

    resultBrush = evaluator.evaluate(resultBrush, shaftBrush, ADDITION);

    // 3. T-HANDLE
    const handleLength = screwRadius * 6;
    const handleRadius = screwRadius * 0.5;
    const handleY = padThickness + screwLength + handleRadius * 2;

    // Handle bar
    const handleBarGeo = new THREE.CylinderGeometry(handleRadius, handleRadius, handleLength, segments, 1, false);
    handleBarGeo.rotateZ(Math.PI / 2);
    handleBarGeo.translate(0, handleY, 0);

    const handleBrush = new Brush(prepareForCSG(handleBarGeo), csgMaterial);
    handleBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, handleBrush, ADDITION);

    // Handle collar
    const collarGeo = new THREE.CylinderGeometry(screwRadius, screwRadius, handleRadius * 4, segments, 1, false);
    collarGeo.translate(0, padThickness + screwLength + handleRadius, 0);

    const collarBrush = new Brush(prepareForCSG(collarGeo), csgMaterial);
    collarBrush.updateMatrixWorld();
    resultBrush = evaluator.evaluate(resultBrush, collarBrush, ADDITION);

    // Knobs
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

    // Move everything up so pad bottom is at Y=0
    let finalGeo = resultBrush.geometry;
    finalGeo.translate(0, padThickness / 2, 0);
    finalGeo = cleanupGeometry(finalGeo);

    return finalGeo;

  } catch (err) {
    console.error("Screw generation failed:", err);
    const fallback = new THREE.CylinderGeometry(screwRadius, screwRadius, screwLength, 32, 1, false);
    fallback.translate(0, screwLength / 2, 0);
    return cleanupGeometry(fallback);
  }
};
