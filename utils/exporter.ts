import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';

export const downloadSTL = (mesh: THREE.Object3D, filename: string) => {
  const exporter = new STLExporter();
  const str = exporter.parse(mesh, { binary: true });
  const blob = new Blob([str], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.style.display = 'none';
  document.body.appendChild(link);
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  document.body.removeChild(link);
};
