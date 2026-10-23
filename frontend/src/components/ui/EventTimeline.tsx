import React from 'react';

interface EventRecord {
  id: string;
  time: string;
  type: 'COLLISION' | 'MERGER' | 'CREATE' | 'DELETE';
  description: string;
}

export const EventTimeline: React.FC = () => {
  // Temporary sample events
  const events: EventRecord[] = [
    { id: '1', time: '00:00', type: 'CREATE', description: 'Universe initialized' },
    { id: '2', time: '00:05', type: 'COLLISION', description: 'Mars impacted Earth' },
  ];

  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '20px',
      width: '280px',
      maxHeight: '400px',
      overflowY: 'auto',
      pointerEvents: 'auto',
      background: 'rgba(0, 0, 0, 0.7)',
      padding: '15px',
      borderRadius: '8px',
      border: '1px solid #444',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <h3 style={{ margin: '0 0 15px 0', fontSize: '14px', opacity: 0.8 }}>Event History</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {events.map(event => (
          <div key={event.id} style={{
            padding: '8px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '4px',
            fontSize: '12px',
            borderLeft: event.type === 'COLLISION' ? '3px solid #ff4444' : '3px solid #44ff44'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <strong>{event.type}</strong>
              <span style={{ opacity: 0.5 }}>{event.time}</span>
            </div>
            <div>{event.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
