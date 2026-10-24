import React from 'react';
import type { Vec3 } from '../../api/types';
import { formatNumber } from '../../sim/format';

interface PlacementHintProps {
  /** Where the body would be created, in the physics frame (metres); null while the cursor is off the plane. */
  position: Vec3 | null;
}

/** Instructions plus a live readout of the position a click would create the body at. */
export const PlacementHint: React.FC<PlacementHintProps> = ({ position }) => (
  <div role="status" style={{
    position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)',
    padding: '10px 16px', borderRadius: 8, color: '#eef2f7', background: 'rgba(35, 40, 48, 0.9)',
    border: '1px solid rgba(220, 230, 240, 0.35)', font: '13px sans-serif', pointerEvents: 'none',
    textAlign: 'center', whiteSpace: 'nowrap',
  }}>
    <div>Move to preview · Scroll to adjust depth · Click to place and create · Esc to cancel</div>
    <div data-testid="placement-readout" style={{ marginTop: 4, fontFamily: 'monospace', opacity: 0.9 }}>
      {position
        ? `x ${formatNumber(position.x)} m · y ${formatNumber(position.y)} m · z ${formatNumber(position.z)} m`
        : 'x – · y – · z –'}
    </div>
  </div>
);
