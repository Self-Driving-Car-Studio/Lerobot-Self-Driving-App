import { MaterialCommunityIcons } from '@expo/vector-icons'; // 아이콘 사용을 위해 추가
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// User 타입 정의
interface User {
  id: string;
  name: string;
}

export default function AuthScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [statusMessage, setStatusMessage] = useState('얼굴 인식으로 로그인');
  const [isScanning, setIsScanning] = useState(false); // 스캔 중인지 상태 표시

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
      setIsScanning(false);
      
      stopStreaming(); // 성공 시 촬영 중단

      setTimeout(() => {
        router.replace({
          pathname: '/command',
          params: { userId: user.id, userName: user.name },
        });
      }, 1000);
    };

    const handleAuthFail = () => {
      // 실패해도 계속 시도하거나, 메시지만 변경
      console.log('인증 실패');
    };

    socket.on('auth-success', handleAuthSuccess);
    socket.on('auth-fail', handleAuthFail);

    // 화면에 들어왔을 때 권한이 있다면 자동으로 시작 (원치 않으면 이 부분 주석 처리하고 버튼 클릭으로만 작동하게 변경 가능)
    if (isFocused && permission?.granted) {
      startStreaming();
    }

    return () => {
      stopStreaming();
      socket.off('auth-success', handleAuthSuccess);
      socket.off('auth-fail', handleAuthFail);
    };
  }, [socket, isFocused, permission]);

  const stopStreaming = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startStreaming = () => {
    if (intervalRef.current) return; // 이미 실행 중이면 중복 실행 방지
    
    setIsScanning(true);
    setStatusMessage('사용자를 확인하고 있습니다...');

    intervalRef.current = window.setInterval(async () => {
      if (cameraRef.current) {
        try {
          // --- [로그 1] ---
          console.log("--- 1. 찰칵 시도 (백그라운드) ---");

          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.2,
            base64: true,
            skipProcessing: true,
            shutterSound: false, // 찰칵 소리 제거 (지원되는 기기에서만 동작)
          });

          if (photo && photo.base64) {
            console.log(`--- 2. 사진 촬영 성공 (크기: ${photo.base64.length}) ---`);
            socket?.emit('identify-face', photo.base64);
          } 
        } catch (error) {
          console.log('--- ‼️ 스냅샷 오류 ---', error);
        }
      }
    }, 3000); // 3초 간격 (너무 빠르면 과부하가 올 수 있어 조정)
  };

  // 버튼을 눌렀을 때 수동으로 다시 시작하는 함수
  const handleLoginPress = () => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    startStreaming();
  };

  if (!permission) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {/* [핵심 수정 사항] 
        카메라를 숨기기 위해 width: 1, height: 1, opacity: 0으로 설정합니다.
        display: 'none'을 하면 촬영이 안 될 수 있습니다.
      */}
      {permission.granted && (
        <CameraView
          ref={cameraRef}
          style={styles.hiddenCamera}
          facing="front"
          autofocus="off"
        />
      )}

      {/* UI 영역 */}
      <View style={styles.contentContainer}>
        
        {/* 로고 영역 */}
        <View style={styles.logoWrapper}>
          <View style={styles.logoIconContainer}>
            <MaterialCommunityIcons name="robot" size={60} color="white" />
          </View>
          <Text style={styles.logoTitle}>블라썸</Text>
          <Text style={styles.logoSubtitle}>로봇 도우미</Text>
        </View>

        {/* 버튼 영역 */}
        <View style={styles.buttonWrapper}>
          <TouchableOpacity 
            style={styles.loginButton} 
            onPress={handleLoginPress}
            activeOpacity={0.8}
          >
            {isScanning ? (
               // 스캔 중일 때 보여줄 아이콘/텍스트 (선택 사항)
               <MaterialCommunityIcons name="face-recognition" size={24} color="rgba(255,255,255,0.7)" style={styles.btnIcon} />
            ) : (
               <MaterialCommunityIcons name="face-recognition" size={24} color="white" style={styles.btnIcon} />
            )}
            <Text style={styles.loginButtonText}>{statusMessage}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.subButton}>
            <Text style={styles.subButtonText}>다른 방법으로 로그인</Text>
          </TouchableOpacity>
        </View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // 전체 배경 흰색
  },
  // 카메라를 시각적으로 숨김 (기능은 유지)
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: -1,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 80, // 상하 여백
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  // 로고 섹션 스타일
  logoWrapper: {
    alignItems: 'center',
    marginTop: 50,
  },
  logoIconContainer: {
    width: 100,
    height: 100,
    backgroundColor: '#0056b3', // 파란색 배경
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    // 그림자 효과
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  logoTitle: {
    fontSize: 40,
    fontWeight: '900',
    color: '#000',
    marginBottom: 5,
  },
  logoSubtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  // 버튼 섹션 스타일
  buttonWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  loginButton: {
    backgroundColor: '#0056b3', // 버튼 파란색
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 60,
    borderRadius: 15,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  btnIcon: {
    marginRight: 10,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  subButton: {
    padding: 10,
  },
  subButtonText: {
    color: '#555',
    fontSize: 16,
    textDecorationLine: 'underline', // 밑줄 (선택사항)
  },
});