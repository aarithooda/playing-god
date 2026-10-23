import React from 'react';

interface BodyProps {
  name: string;
  mass: number;
  radius: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

interface BodyInspectorProps {
  body: BodyProps | null;
  onUpdate: (updates: Partial<BodyProps>) => void;
}

export const BodyInspector: React.FC<BodyInspectorProps> = ({ body, onUpdate }) => {
  if (!body) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      right: '20px',
      width: '250px',
      pointerEvents: 'auto',
      background: 'rgba(0, 0, 0, 0.8)',
      padding: '15px',
      borderRadius: '8px',
      border: '1px solid #444',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Body Inspector</h3>

      <div style={fieldGroup}>
        <label style={labelStyle}>Name</label>
        <input
          style={inputStyle}
          value={body.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Mass (kg)</label>
        <input
          style={inputStyle}
          type="number"
          value={body.mass}
          onChange={(e) => onUpdate({ mass: parseFloat(e.target.value) || 0 })}
        />
      </div>

      <div style={fieldGroup}>
        <label style={labelStyle}>Radius (km)</label>
        <input
          style={inputStyle}
          type="number"
          value={body.radius}
          onChange={(e) => onUpdate({ radius: parseFloat(e.target.value) || 0 })}
        />
      </div>

      <div style={{ marginTop: '15px', borderTop: '1px solid #333', paddingTop: '10px' }}>
        <p style={{ fontSize: '11px', opacity: 0.6, margin: '0 0 5px 0' }}>Position (X, Y, Z)</p>
        <div style={{ display: 'flex', gap: '5px' }}>
          {body.position.map((val, i) => (
            <input key={i} style={inputStyle} type="number" value={val} readOnly />
          ))}
        </div>
      </div>
    </div>
  );
};

const fieldGroup: React.CSSProperties = {
  marginBottom: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  opacity: 0.7
};

const inputStyle: React.CSSProperties = {
  background: '#222',
  border: '1px solid #444',
  color: 'white',
  padding: '4px',
  borderRadius: '4px',
  fontSize: '13px'
};
