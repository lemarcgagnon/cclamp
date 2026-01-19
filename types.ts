export interface ClampParams {
  height: number;      // Inner height of the clamp (gap)
  depth: number;       // Throat depth
  thickness: number;   // Wall thickness of the frame
  width: number;       // Width of the frame (extrusion depth)
  screwRadius: number; // Radius of the screw
  tolerance: number;   // Gap between screw and hole for printing
  screwLength: number; // Total length of the screw
  threadPitch: number; // Distance between threads
  screwPosition: number; // 0 to 1 ratio along the throat
  quality: number;     // 1=draft, 2=normal, 3=high (affects segments)
}

export const DEFAULT_PARAMS: ClampParams = {
  height: 60,
  depth: 40,
  thickness: 12,
  width: 20,
  screwRadius: 6,
  tolerance: 0.4,
  screwLength: 85,
  threadPitch: 2.5,
  screwPosition: 0.85,
  quality: 2,
};