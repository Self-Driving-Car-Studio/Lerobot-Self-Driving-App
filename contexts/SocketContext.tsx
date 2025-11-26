import React, { createContext, useContext, useMemo } from 'react';
import { io, Socket } from 'socket.io-client'; // ⚠️ [수정] Socket 타입 import

// ⚠️ 실제 서버 주소로 변경하세요
const SERVER_URL = 'http://192.168.0.21:3000';

// ⚠️ [수정] 컨텍스트에 명시적인 타입 지정
export const SocketContext = createContext<Socket | null>(null);

export const useSocket = () => {
  return useContext(SocketContext);
};

interface SocketProviderProps {
  children: React.ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const socket = useMemo(() => io(SERVER_URL, { transports: ['websocket'] }), []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}