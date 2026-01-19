import React from 'react';
import { ClampParams } from '../types';
import { Download, Layers, Grid, MoveHorizontal, Eye, EyeOff, Settings } from 'lucide-react';

interface ControlsProps {
  params: ClampParams;
  setParams: React.Dispatch<React.SetStateAction<ClampParams>>;
  showScrew: boolean;
  setShowScrew: React.Dispatch<React.SetStateAction<boolean>>;
  onExportAssembled: () => void;
  onExportSeparated: () => void;
}

const Slider = ({ label, value, min, max, step, onChange, highlight = false }: { label: string, value: number, min: number, max: number, step: number, onChange: (val: number) => void, highlight?: boolean }) => (
  <div className="mb-4">
    <div className="flex justify-between mb-1">
      <label className={`text-xs font-medium uppercase tracking-wider ${highlight ? 'text-blue-300' : 'text-gray-400'}`}>{label}</label>
      <span className={`text-xs font-mono ${highlight ? 'text-white' : 'text-blue-400'}`}>{typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : value}{label.includes('Ratio') ? '' : 'mm'}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`w-full h-2 rounded-lg appearance-none cursor-pointer transition-colors ${highlight ? 'bg-blue-900 accent-blue-400' : 'bg-gray-700 accent-blue-500 hover:accent-blue-400'}`}
    />
  </div>
);

const Controls: React.FC<ControlsProps> = ({ params, setParams, showScrew, setShowScrew, onExportAssembled, onExportSeparated }) => {

  const update = (key: keyof ClampParams, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-gray-900/95 border-l border-gray-800 p-6 overflow-y-auto backdrop-blur-sm z-10 shadow-2xl flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">C-Clamp Studio</h1>
        <p className="text-xs text-gray-500">Procedural Manufacturing Generator</p>
      </div>

      {/* Screw Visibility Toggle */}
      <div className="mb-6">
        <button
          onClick={() => setShowScrew(!showScrew)}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 border ${
            showScrew
              ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-600'
              : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500'
          }`}
        >
          {showScrew ? <Eye size={18} /> : <EyeOff size={18} />}
          {showScrew ? 'Hide Screw (View Hole)' : 'Show Screw'}
        </button>
        {!showScrew && (
          <p className="text-[10px] text-amber-400 mt-2 text-center">
            Screw hidden - inspect the threaded hole in the frame
          </p>
        )}
      </div>

      <div className="flex-1 space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Grid size={16} /> Dimensions
          </h2>
          <Slider label="Opening Height" value={params.height} min={20} max={200} step={1} onChange={(v) => update('height', v)} />
          <Slider label="Throat Depth" value={params.depth} min={20} max={150} step={1} onChange={(v) => update('depth', v)} />
          <Slider label="Frame Thickness" value={params.thickness} min={8} max={40} step={1} onChange={(v) => update('thickness', v)} />
          <Slider label="Frame Width" value={params.width} min={10} max={60} step={1} onChange={(v) => update('width', v)} />
        </section>

        <section className="pt-4 border-t border-gray-800">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <MoveHorizontal size={16} /> Positioning
          </h2>
          <Slider 
            label="Screw Position (Throat)" 
            value={params.screwPosition} 
            min={0.1} 
            max={1.0} 
            step={0.01} 
            onChange={(v) => update('screwPosition', v)} 
            highlight
          />
          <p className="text-[10px] text-gray-500 -mt-2 mb-2">Adjusts screw location along the throat depth.</p>
        </section>

        <section className="pt-4 border-t border-gray-800">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Layers size={16} /> Screw Mechanism
          </h2>
          <Slider label="Screw Radius" value={params.screwRadius} min={3} max={20} step={0.5} onChange={(v) => update('screwRadius', v)} />
          <Slider label="Thread Pitch" value={params.threadPitch} min={1} max={5} step={0.1} onChange={(v) => update('threadPitch', v)} />
          <Slider label="Tolerance" value={params.tolerance} min={0.1} max={2.0} step={0.1} onChange={(v) => update('tolerance', v)} />
        </section>

        <section className="pt-4 border-t border-gray-800">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Settings size={16} /> Quality
          </h2>
          <div className="mb-4">
            <div className="flex justify-between mb-2">
              <label className="text-xs font-medium uppercase tracking-wider text-gray-400">Mesh Quality</label>
              <span className="text-xs font-mono text-blue-400">
                {params.quality === 1 ? 'Draft' : params.quality === 2 ? 'Normal' : 'High'}
              </span>
            </div>
            <div className="flex gap-2">
              {[1, 2, 3].map((q) => (
                <button
                  key={q}
                  onClick={() => update('quality', q)}
                  className={`flex-1 py-2 px-3 rounded text-xs font-medium transition-all ${
                    params.quality === q
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {q === 1 ? 'Draft' : q === 2 ? 'Normal' : 'High'}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-2">Higher quality = more polygons, slower but better for printing.</p>
          </div>
        </section>
      </div>

      <div className="mt-8 space-y-3 pt-6 border-t border-gray-800">
        <button 
          onClick={onExportAssembled}
          className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 border border-gray-600"
        >
          <Download size={18} />
          Export Assembled
        </button>
        <button 
          onClick={onExportSeparated}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2"
        >
          <Download size={18} />
          Export Parts
        </button>
      </div>
    </div>
  );
};

export default Controls;