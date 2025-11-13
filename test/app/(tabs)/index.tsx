// 📁 app/(tabs)/index.tsx (수정본)

import React from 'react';
import { StatusBar } from 'expo-status-bar';
// 💡 [수정] React.lazy와 Suspense를 제거하고, 일반적인 import로 복원
import FaceRecognitionScreen from '../../components/FaceRecognitionScreen'; 

export default function TabOneScreen() {
  return (
    <>
      <StatusBar style="light" />
      <FaceRecognitionScreen />
    </>
  );
}