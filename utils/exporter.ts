import * as THREE from 'three';
// @ts-ignore - types not available but module works
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
// @ts-ignore - types not available but module works
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/**
 * Download a Three.js mesh as STL file
 * Note: STL format loses topology information - use GLB for manifold preservation
 */
export const downloadSTL = (mesh: THREE.Object3D, filename: string) => {
  const exporter = new STLExporter();
  const str = exporter.parse(mesh, { binary: true });
  const blob = new Blob([str], { type: 'application/octet-stream' });
  downloadBlob(blob, filename);
};

/**
 * Download a Three.js mesh as GLB file (binary glTF)
 * GLB preserves more mesh information than STL
 */
export const downloadGLB = (mesh: THREE.Object3D, filename: string) => {
  const exporter = new GLTFExporter();

  exporter.parse(
    mesh,
    (result: ArrayBuffer) => {
      const blob = new Blob([result], { type: 'application/octet-stream' });
      downloadBlob(blob, filename);
    },
    (error: Error) => {
      console.error('GLB export failed:', error);
    },
    { binary: true }
  );
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

/**
 * Download mesh in the user's preferred format
 */
export const downloadMesh = (
  mesh: THREE.Object3D,
  filename: string,
  format: 'stl' | 'glb' = 'stl'
) => {
  if (format === 'glb') {
    downloadGLB(mesh, filename.replace(/\.stl$/i, '.glb'));
  } else {
    downloadSTL(mesh, filename);
  }
};
