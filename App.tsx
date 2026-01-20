import React, { useState, useEffect, useRef } from 'react';
import Viewer from './components/Viewer';
import Controls from './components/Controls';
import { ClampParams, DEFAULT_PARAMS } from './types';
import { downloadSTL, download3MF } from './utils/exporter';
import { generateFrameGeometry } from './utils/geometry';
import * as THREE from 'three';

const App: React.FC = () => {
  const [params, setParams] = useState<ClampParams>(DEFAULT_PARAMS);
  const [showScrew, setShowScrew] = useState(true);

  const meshRefs = useRef<{ frame: THREE.Mesh | null, screw: THREE.Mesh | null }>({ frame: null, screw: null });

  // 1. Auto-adjust screw length to 110% of clamp opening + thickness
  useEffect(() => {
    const neededLength = (params.height + params.thickness) * 1.1;
    setParams(p => {
      if (Math.abs(p.screwLength - neededLength) > 1) {
        return { ...p, screwLength: neededLength };
      }
      return p;
    });
  }, [params.height, params.thickness]);

  // 2. Auto-adjust Frame Width
  useEffect(() => {
    const minWidth = (params.screwRadius * 2) + 6; 
    if (params.width < minWidth) {
       setParams(p => ({ ...p, width: minWidth }));
    }
  }, [params.screwRadius, params.width]);

  // 3. Ensure Screw doesn't hit the Spine
  useEffect(() => {
    const screwX = params.depth * params.screwPosition;
    const minX = params.screwRadius + 2; 
    
    if (screwX < minX) {
       let newPos = minX / params.depth;
       if (newPos > 0.9) newPos = 0.9;
       if (params.screwPosition < newPos) {
         setParams(p => ({...p, screwPosition: newPos}));
       }
    }
  }, [params.screwRadius, params.depth, params.screwPosition]);

  const handleExportAssembled = () => {
    const frameGeo = generateFrameGeometry(params);
    const frameMesh = new THREE.Mesh(frameGeo);
    
    // We can reuse the screw mesh from the viewer as it's already high enough quality
    // or clone it if it exists.
    if (!meshRefs.current.screw) return;
    const screwClone = meshRefs.current.screw.clone();
    
    const exportGroup = new THREE.Group();
    exportGroup.add(frameMesh);
    exportGroup.add(screwClone);
    exportGroup.updateMatrixWorld(true);
    
    downloadSTL(exportGroup, `c-clamp-assembled-${params.height}mm.stl`);
  };

  const handleExportSeparated = () => {
    // 1. Export Frame with threads
    const frameGeo = generateFrameGeometry(params);
    const frameMesh = new THREE.Mesh(frameGeo);
    downloadSTL(frameMesh, `c-clamp-frame-${params.height}mm.stl`);

    // 2. Export Screw
    if (!meshRefs.current.screw) return;
    const screwClone = meshRefs.current.screw.clone();
    screwClone.position.set(0, 0, 0);
    screwClone.rotation.set(0, 0, 0);
    downloadSTL(screwClone, `c-clamp-screw-${params.screwRadius}mm.stl`);
  };

  // 3MF Export handlers (recommended for 3D printing)
  const handleExport3MFAssembled = async () => {
    const frameGeo = generateFrameGeometry(params);
    const frameMesh = new THREE.Mesh(frameGeo);

    if (!meshRefs.current.screw) return;
    const screwClone = meshRefs.current.screw.clone();

    const exportGroup = new THREE.Group();
    exportGroup.add(frameMesh);
    exportGroup.add(screwClone);
    exportGroup.updateMatrixWorld(true);

    await download3MF(exportGroup, `c-clamp-assembled-${params.height}mm.3mf`);
  };

  const handleExport3MFSeparated = async () => {
    // 1. Export Frame
    const frameGeo = generateFrameGeometry(params);
    const frameMesh = new THREE.Mesh(frameGeo);
    await download3MF(frameMesh, `c-clamp-frame-${params.height}mm.3mf`);

    // 2. Export Screw
    if (!meshRefs.current.screw) return;
    const screwClone = meshRefs.current.screw.clone();
    screwClone.position.set(0, 0, 0);
    screwClone.rotation.set(0, 0, 0);
    await download3MF(screwClone, `c-clamp-screw-${params.screwRadius}mm.3mf`);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <Viewer
        params={params}
        showScrew={showScrew}
        setRef={(refs) => { meshRefs.current = refs; }}
      />
      <Controls
        params={params}
        setParams={setParams}
        showScrew={showScrew}
        setShowScrew={setShowScrew}
        onExportAssembled={handleExportAssembled}
        onExportSeparated={handleExportSeparated}
        onExport3MFAssembled={handleExport3MFAssembled}
        onExport3MFSeparated={handleExport3MFSeparated}
      />
      
      <div className="absolute top-4 left-4 pointer-events-none opacity-50">
        <div className="text-white text-xs font-mono">
          REACT THREE FIBER EXPORTER <br/>
          v1.2.0 (Stable Core)
        </div>
      </div>
    </div>
  );
};

export default App;