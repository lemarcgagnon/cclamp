import React, { useMemo, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, Grid, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { ClampParams } from '../types';
import { generateFrameGeometry, generateScrewGeometry } from '../utils/geometry';

interface ViewerProps {
  params: ClampParams;
  showScrew: boolean;
  setRef: (refs: { frame: THREE.Mesh | null, screw: THREE.Mesh | null }) => void;
}

const Model: React.FC<ViewerProps> = ({ params, showScrew, setRef }) => {
  const frameRef = useRef<THREE.Mesh>(null);
  const screwRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    setRef({ frame: frameRef.current, screw: screwRef.current });
  });

  // Generate frame with threaded hole for 3D printing compatibility
  const frameGeometry = useMemo(() => generateFrameGeometry(params), [params]);
  const screwGeometry = useMemo(() => generateScrewGeometry(params), [params]);
  
  // Calculate visual position matching the centered geometry
  const screwXOffset = params.depth * params.screwPosition;
  const minJawLen = screwXOffset + params.screwRadius + (params.thickness * 0.6);
  const actualDepth = Math.max(params.depth, minJawLen);

  const geometryCenterX = (actualDepth - params.thickness) / 2;
  const finalScrewX = screwXOffset - geometryCenterX;

  // Screw positioning:
  // Screw geometry: pad at Y≈0 (bottom), shaft up to Y=screwLength, handle above that
  // Frame after centering: opening from Y≈-height/2 to Y≈+height/2
  // Screw pad should be inside the opening, handle ABOVE the frame

  // Position screw so the pad is in the middle of the opening (Y=0 after centering)
  const screwYPosition = 0; // Pad at center of opening 

  return (
    <group>
      {/* The C-Frame */}
      <mesh ref={frameRef} geometry={frameGeometry} castShadow receiveShadow>
        <meshStandardMaterial 
            color="#3b82f6" 
            roughness={0.4} 
            metalness={0.6}
            side={THREE.DoubleSide} 
        />
      </mesh>

      {/* The Screw - conditionally rendered */}
      {showScrew && (
        <mesh
          ref={screwRef}
          geometry={screwGeometry}
          position={[finalScrewX, screwYPosition, 0]}
          rotation={[0, 0, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color="#9ca3af"
            roughness={0.3}
            metalness={0.8}
          />
        </mesh>
      )}
    </group>
  );
};

const Viewer: React.FC<ViewerProps> = (props) => {
  return (
    <div className="w-full h-screen bg-gray-950">
      <Canvas shadows camera={{ position: [80, 80, 120], fov: 45 }}>
        <fog attach="fog" args={['#111827', 150, 400]} />
        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 1.5} />
        
        <Stage environment="city" intensity={0.6} adjustCamera={false}>
          <Model {...props} />
        </Stage>
        
        <Grid 
            renderOrder={-1} 
            position={[0, -props.params.height, 0]} 
            infiniteGrid 
            cellSize={10} 
            sectionSize={50} 
            fadeDistance={250} 
            sectionColor="#4b5563" 
            cellColor="#374151" 
        />
        
        <Environment preset="warehouse" />
      </Canvas>
    </div>
  );
};

export default Viewer;