import React from 'react';

export const ControlPanel: React.FC = () => {
  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      right: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      pointerEvents: 'auto',
      background: 'rgba(0, 0, 0, 0.7)',
      padding: '15px',
      borderRadius: '8px',
      border: '1px solid #444',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', opacity: 0.8 }}>Simulation</h3>
      <div style={{ display: 'flex', gap: '5px' }}>
        <button style={btnStyle}>Play</button>
        <button style={btnStyle}>Pause</button>
      </div>
      <button style={btnStyle}>Step Forward</button>
      <button style={btnStyle}>Reset Universe</button>
      <div style={{ marginTop: '10px' }}>
        <label style={{ fontSize: '12px', display: 'block', marginBottom: '5px' }}>Sim Speed</label>
        <input type="range" style={{ width: '100%' }} />
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: '5px 10px',
  cursor: 'pointer',
  background: '#333',
  color: 'white',
  border: '1px solid #555',
  borderRadius: '4px',
  fontSize: '12px'
};
