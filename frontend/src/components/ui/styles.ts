import type React from 'react';

export const panelStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: 'rgba(0, 0, 0, 0.75)',
  padding: '15px',
  borderRadius: '8px',
  border: '1px solid #444',
  color: 'white',
  fontFamily: 'sans-serif',
};

export const btnStyle: React.CSSProperties = {
  padding: '5px 10px',
  cursor: 'pointer',
  background: '#333',
  color: 'white',
  border: '1px solid #555',
  borderRadius: '4px',
  fontSize: '12px',
};

export const inputStyle: React.CSSProperties = {
  background: '#222',
  border: '1px solid #444',
  color: 'white',
  padding: '4px',
  borderRadius: '4px',
  fontSize: '13px',
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = { fontSize: '12px', opacity: 0.7 };

export const fieldGroup: React.CSSProperties = {
  marginBottom: '10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

export const errorTextStyle: React.CSSProperties = { color: '#ff7777', fontSize: '11px' };
