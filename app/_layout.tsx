import { Stack } from 'expo-router';
import React from 'react';
import { SocketProvider } from '../contexts/SocketContext'; // 1단계에서 만든 파일

export default function RootLayout() {
  return (
    // 1. SocketProvider로 앱 전체를 감쌉니다.
    <SocketProvider>
      {/* 2. Stack 네비게이터를 설정합니다. */}
      <Stack screenOptions={{ headerShown: false }}>
        {/* AuthScreen (app/index.tsx) */}
        <Stack.Screen name="index" /> 
        
        {/* CommandScreen (app/command.tsx) */}
        <Stack.Screen name="command" />
      </Stack>
    </SocketProvider>
  );
}