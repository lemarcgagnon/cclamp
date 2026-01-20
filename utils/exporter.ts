import * as THREE from 'three';
// @ts-ignore
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { exportTo3MF } from 'three-3mf-exporter';

/**
 * Download a Three.js mesh as STL file
 * Note: STL format loses topology - use 3MF for better 3D printing results
 */
export const downloadSTL = (mesh: THREE.Object3D, filename: string) => {
  const exporter = new STLExporter();
  const str = exporter.parse(mesh, { binary: true });
  const blob = new Blob([str], { type: 'application/octet-stream' });
  downloadBlob(blob, filename);
};

/**
 * Download a Three.js mesh as 3MF file
 * 3MF is the recommended format for 3D printing - supports colors, materials, and is manifold-safe
 * BambuStudio compatible
 */
export const download3MF = async (mesh: THREE.Object3D, filename: string) => {
  try {
    const blob = await exportTo3MF(mesh, {
      compression: 'standard',
    });
    downloadBlob(blob, filename.replace(/\.stl$/i, '.3mf'));
  } catch (err) {
    console.error('3MF export failed:', err);
    // Fallback to STL
    downloadSTL(mesh, filename);
  }
};

/**
 * Helper to download a blob as a file
 */
function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.style.display = 'none';
  document.body.appendChild(link);
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
