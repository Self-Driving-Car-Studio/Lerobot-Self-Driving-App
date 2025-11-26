import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
// ⚠️ [수정 1] Camera -> CameraView, CameraType 제거
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useSocket } from '../contexts/SocketContext';

// User 타입 정의
interface User {
  id: string;
  name: string;
}

export default function AuthScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [statusMessage, setStatusMessage] = useState('카메라를 바라봐 주세요...');
  const socket = useSocket();
  const cameraRef = useRef<CameraView>(null); 
  const intervalRef = useRef<number | null>(null);
  const isFocused = useIsFocused(); 

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!socket) return;

    const handleAuthSuccess = (user: User) => {
      console.log('인증 성공:', user.name);
      setStatusMessage(`${user.name}님, 환영합니다.`);
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      setTimeout(() => {
        router.replace({
          pathname: '/command',
          params: { userId: user.id, userName: user.name },
        });
      }, 1000);
    };
    
    const handleAuthFail = () => {
      setStatusMessage('인증에 실패했습니다. 다시 시도해 주세요.');
    };

    socket.on('auth-success', handleAuthSuccess);
    socket.on('auth-fail', handleAuthFail);

    if (isFocused && permission?.granted) {
      startStreaming();
    } else if (isFocused && !permission?.granted) {
      setStatusMessage('카메라 권한을 허용해 주세요.');
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      socket.off('auth-success', handleAuthSuccess);
      socket.off('auth-fail', handleAuthFail);
    };
  }, [socket, isFocused, permission]);

const startStreaming = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(async () => {
      if (cameraRef.current) {
        try {
          // --- [로그 1] ---
          console.log("--- 1. 찰칵 시도 ---"); 
          
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.2,
            base64: true,
            skipProcessing: true,
          });

          if (photo && photo.base64) {
            // --- [로그 2] ---
            // (중요!) Base64 데이터의 길이를 확인합니다.
            console.log(`--- 2. 사진 촬영 성공 (크기: ${photo.base64.length}) ---`);
            
            console.log(`--- 3. 소켓 정보 확인 (${socket}) ---`);

            socket?.emit('identify-face', photo.base64);
            
            // --- [로그 3] ---
            console.log("--- 4. 소켓으로 전송 완료 ---");
          
          } else {
            console.log("--- 2. 사진 촬영 실패 (데이터 없음) ---");
          }
        } catch (error) {
          // --- [로그 4] ---
          console.log('--- ‼️ 스냅샷 오류 ---', error);
        }
      }
    }, 5000); // 1초 간격
  };

  if (!permission) {
    return <View />; // 권한 상태 로딩 중
  }

  if (!permission.granted) {
    // 권한이 거부된 경우
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>
          얼굴 인식을 위해 카메라 권한이 필요합니다.
        </Text>
      </View>
    );
  }

  // 권한이 승인된 경우
  return (
    <View style={styles.container}>
      {/* ⚠️ [수정 4] <Camera> -> <CameraView> */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        // ⚠️ [수정 5] type={CameraType.front} -> facing="front"
        facing="front"
        // ⚠️ [수정 6] autoFocus={false} -> autoFocus="off"
        autofocus="off"
      />
      <View style={styles.overlay}>
        <Text style={styles.statusText}>{statusMessage}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20,
  },
  statusText: {
    fontSize: 18,
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});