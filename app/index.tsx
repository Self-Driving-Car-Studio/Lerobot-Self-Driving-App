import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// TTS 및 오디오 제어를 위한 라이브러리
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';

// --- [유틸리티] 지연 함수 (필수) ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// [상수] 무음 오디오 파일 (필수)
const SILENT_AUDIO_URI = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASAA82xZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA';

// User 타입 정의
interface User {
  id: string;
  name: string;
}

export default function AuthScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [statusMessage, setStatusMessage] = useState('로그인 버튼을 눌러주세요');
  const [isScanning, setIsScanning] = useState(false);

  const socket = useSocket();
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<number | null>(null);
  const isFocused = useIsFocused();
  
  // [추가] 무음 사운드 객체를 저장할 Ref
  const silentSoundRef = useRef<Audio.Sound | null>(null);

  // 1. 오디오 모드 설정 (AirPlay 대응 최적화)
  const setAudioToSpeaker = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false, // [중요] 미러링 시 false가 라우팅 전환에 유리
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
    } catch (error) {
      console.log('오디오 모드 설정 실패:', error);
    }
  };

  // 2. 초기화: 오디오 모드 및 무음 파일 미리 로드
  useEffect(() => {
    const initAudio = async () => {
      await setAudioToSpeaker();
      
      // 무음 파일 로드 (Singleton)
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: SILENT_AUDIO_URI },
          { shouldPlay: false, volume: 0 } // 미리 로드만 하고 재생은 안 함
        );
        silentSoundRef.current = sound;
        console.log('[Audio] 🔇 무음 파일 미리 로드 완료');
      } catch (error) {
        console.log('[Audio] 무음 파일 로드 실패', error);
      }
    };

    initAudio();

    // 언마운트 시 정리
    return () => {
      if (silentSoundRef.current) {
        silentSoundRef.current.unloadAsync();
      }
      Speech.stop();
    };
  }, []);

  // 3. 카메라 권한 체크
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // 4. 소켓 이벤트 및 인증 성공 로직
  useEffect(() => {
    if (!socket) return;

    const handleAuthSuccess = async (user: User) => {
      console.log('인증 성공:', user.name);
      
      // 상태 정리
      setIsScanning(false);
      stopStreaming();
      setStatusMessage(`${user.name}님, 환영합니다.`);

      await setAudioToSpeaker();

      // ============================================================
      // [핵심 추가] 스피커 예열 과정 (Kick & Wait)
      // 이 과정이 없으면 "OOO님" 부분이 스탠바이미에서 무조건 잘립니다.
      // ============================================================
      try {
        if (silentSoundRef.current) {
          // 무음 파일을 재생해서 TV 스피커를 강제로 켭니다.
          await silentSoundRef.current.replayAsync();
        }
        // TV 스피커가 켜지고 신호를 받을 때까지 0.8초 대기
        await delay(800); 
      } catch (e) {
        console.log('Audio Kick Failed', e);
      }
      // ============================================================

      // TTS 실행 (앞부분 쉼표 추가로 안전장치 마련)
      const successText = `, , ${user.name}님, 환영합니다.`;

      Speech.speak(successText, {
        language: 'ko-KR',
        pitch: 1.0,
        rate: 1.0,
        // [변경] setTimeout 대신 onDone 사용 (말이 끝나면 이동)
        onDone: () => {
           router.replace({
            pathname: '/command',
            params: { userId: user.id, userName: user.name },
          });
        }
      });
    };

    const handleAuthFail = () => {
      console.log('인증 실패 - 다시 시도 중...');
      // 계속 스캔하거나 메시지 변경
    };

    socket.on('auth-success', handleAuthSuccess);
    socket.on('auth-fail', handleAuthFail);

    return () => {
      stopStreaming();
      socket.off('auth-success', handleAuthSuccess);
      socket.off('auth-fail', handleAuthFail);
      Speech.stop();
    };
  }, [socket, isFocused]);

  // 5. 카메라 스트리밍 제어
  const stopStreaming = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsScanning(false);
  };

  const startStreaming = () => {
    if (intervalRef.current) return;
    
    setIsScanning(true);
    setStatusMessage('사용자를 확인하고 있습니다...');

    const captureAndSend = async () => {
      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.3, // 전송 속도를 위해 품질 낮춤
            base64: true,
            skipProcessing: true,
            shutterSound: false,
          });

          if (photo && photo.base64) {
            socket?.emit('identify-face', photo.base64);
          } 
        } catch (error) {
          console.log('--- 스냅샷 오류 ---', error);
        }
      }
    };

    captureAndSend(); // 즉시 1회 실행
    intervalRef.current = window.setInterval(captureAndSend, 1500); // 1.5초 간격으로 반복
  };

  const handleLoginPress = () => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    if (isScanning) return;
    
    // [선택 사항] 버튼 누를 때도 오디오 경로를 미리 한 번 찔러주면 더 좋습니다.
    if (silentSoundRef.current) {
        silentSoundRef.current.replayAsync().catch(() => {});
    }

    startStreaming();
  };

  if (!permission) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {permission.granted && (
        <CameraView
          ref={cameraRef}
          style={styles.hiddenCamera}
          facing="front"
          autofocus="off"
        />
      )}

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
            style={[styles.loginButton, isScanning && styles.loginButtonActive]} 
            onPress={handleLoginPress}
            activeOpacity={0.8}
            disabled={isScanning}
          >
            {isScanning ? (
               <MaterialCommunityIcons name="face-recognition" size={24} color="rgba(255,255,255,0.7)" style={styles.btnIcon} />
            ) : (
               <MaterialCommunityIcons name="face-recognition" size={24} color="white" style={styles.btnIcon} />
            )}
            <Text style={styles.loginButtonText}>
              {isScanning ? '인식 중...' : '로그인'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.statusText}>{statusMessage}</Text>

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
    backgroundColor: '#FFFFFF',
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    zIndex: -1,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  logoWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoIconContainer: {
    width: 120,
    height: 120,
    backgroundColor: '#0056b3',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
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
    color: '#555',
  },
  buttonWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  loginButton: {
    backgroundColor: '#0056b3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 60,
    borderRadius: 15,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  loginButtonActive: {
    backgroundColor: '#004494',
  },
  btnIcon: {
    marginRight: 10,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusText: {
    color: '#666',
    marginBottom: 20,
    fontSize: 18,
  },
  subButton: {
    padding: 10,
  },
  subButtonText: {
    color: '#888',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});