import React from 'react';
import type { Vec3 } from '../../api/types';
import { formatNumber } from '../../sim/format';
import { theme } from './theme';

interface PlacementHintProps {
  /** Where the body would be created, in the physics frame (metres); null while the cursor is off the plane. */
  position: Vec3 | null;
  /** The body the new one is placed relative to; a separation readout is shown when present. */
  anchor?: { name: string; position: Vec3 } | null;
}

/** Instructions plus a live readout of the position a click would create the body at. */
export const PlacementHint: React.FC<PlacementHintProps> = ({ position, anchor }) => (
  <div role="status" style={{
    position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    width: 'max-content', maxWidth: 'calc(100% - 32px)',
    padding: '10px 16px', borderRadius: theme.radius, color: theme.text, background: theme.surface,
    border: `1px solid ${theme.accent}`, font: `13px ${theme.font}`, pointerEvents: 'none',
    textAlign: 'center',
  }}>
    <div>Move to preview · Scroll to adjust depth · Click to place and create · Esc to cancel</div>
    <div data-testid="placement-readout" style={{ marginTop: 4, fontFamily: theme.mono, color: theme.textMuted }}>
      {position
        ? `x ${formatNumber(position.x)} m · y ${formatNumber(position.y)} m · z ${formatNumber(position.z)} m`
        : 'x – · y – · z –'}
    </div>
    {anchor && (
      <div data-testid="placement-distance" style={{ marginTop: 4, fontFamily: theme.mono, color: theme.textMuted }}>
        {position
          ? `${anchor.name} → new body: ${formatNumber(Math.hypot(position.x - anchor.position.x, position.y - anchor.position.y, position.z - anchor.position.z))} m`
          : `${anchor.name} → new body: –`}
      </div>
    )}
  </div>
);
