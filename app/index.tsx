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

// --- [유틸리티] 지연 함수 ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// [상수] 무음 오디오 파일
const SILENT_AUDIO_URI = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASAA82xZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA';

// [상수] 다국어 텍스트 정의
const TRANSLATIONS = {
  ko: {
    title: '블라썸',
    subtitle: '로봇 도우미',
    loginBtn: '로그인',
    loginBtnScanning: '인식 중...',
    statusIdle: '로그인 버튼을 눌러주세요',
    statusScanning: '사용자를 확인하고 있습니다...',
    otherMethod: '다른 방법으로 로그인',
    welcomeMsg: (name: string) => `${name}님, 환영합니다.`,
    ttsLocale: 'ko-KR',
  },
  en: {
    title: 'Blossom',
    subtitle: 'Robot Assistant',
    loginBtn: 'Login',
    loginBtnScanning: 'Scanning...',
    statusIdle: 'Please press the login button',
    statusScanning: 'Verifying user...',
    otherMethod: 'Login with other methods',
    welcomeMsg: (name: string) => `Welcome, ${name}.`,
    ttsLocale: 'en-US',
  }
};

type LanguageType = 'ko' | 'en';

// User 타입 정의
interface User {
  id: string;
  name: string;
}

export default function AuthScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  
  // [상태] 언어 설정 ('ko' | 'en')
  const [language, setLanguage] = useState<LanguageType>('ko');
  
  // 현재 언어 팩 가져오기
  const t = TRANSLATIONS[language];

  // 상태 메시지는 언어 변경에 따라 동적으로 보여주기 위해
  // 고정된 문자열 state보다는 '상태 코드'나 현재 상태를 기반으로 렌더링하는 것이 좋으나,
  // 기존 구조 유지를 위해, 커스텀 메시지(예: 환영인사)가 없을 때만 t.statusIdle 등을 사용하도록 함.
  const [customStatusMessage, setCustomStatusMessage] = useState<string | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);

  const socket = useSocket();
  const cameraRef = useRef<CameraView>(null);
  // React Native 환경 호환성을 위해 window.setInterval 대신 NodeJS.Timeout 타입 사용
  const intervalRef = useRef<any>(null);
  const isFocused = useIsFocused();
  
  const silentSoundRef = useRef<Audio.Sound | null>(null);

  // 1. 오디오 모드 설정
  const setAudioToSpeaker = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
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

  // 2. 초기화
  useEffect(() => {
    const initAudio = async () => {
      await setAudioToSpeaker();
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: SILENT_AUDIO_URI },
          { shouldPlay: false, volume: 0 }
        );
        silentSoundRef.current = sound;
      } catch (error) {
        console.log('[Audio] 무음 파일 로드 실패', error);
      }
    };

    initAudio();

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

  // 4. 소켓 이벤트 및 인증 성공 로직 (language 의존성 추가)
  useEffect(() => {
    if (!socket) return;

    const handleAuthSuccess = async (user: User) => {
      console.log('인증 성공:', user.name);
      
      // 상태 정리
      setIsScanning(false);
      stopStreaming();
      
      // 현재 언어 기준으로 환영 메시지 생성
      const welcomeText = TRANSLATIONS[language].welcomeMsg(user.name);
      setCustomStatusMessage(welcomeText);

      await setAudioToSpeaker();

      // 스피커 예열
      try {
        if (silentSoundRef.current) {
          await silentSoundRef.current.replayAsync();
        }
        await delay(800); 
      } catch (e) {
        console.log('Audio Kick Failed', e);
      }

      // TTS 실행 (현재 언어 설정 반영)
      // 앞부분 쉼표 추가로 TTS 씹힘 방지
      const speechText = `, , ${welcomeText}`;
      
      Speech.speak(speechText, {
        language: TRANSLATIONS[language].ttsLocale, // 언어 코드 동적 적용
        pitch: 1.0,
        rate: 1.0,
        onDone: () => {
           // [수정] 언어 설정(lang)을 파라미터로 함께 전달
           router.replace({
            pathname: '/command',
            params: { userId: user.id, userName: user.name, lang: language },
          });
        }
      });
    };

    const handleAuthFail = () => {
      console.log('인증 실패 - 다시 시도 중...');
    };

    socket.on('auth-success', handleAuthSuccess);
    socket.on('auth-fail', handleAuthFail);

    return () => {
      stopStreaming();
      socket.off('auth-success', handleAuthSuccess);
      socket.off('auth-fail', handleAuthFail);
      Speech.stop();
    };
  }, [socket, isFocused, language]); // language가 바뀌면 핸들러도 최신 state(언어)를 알 수 있게 재등록

  // 5. 카메라 스트리밍 제어
  const stopStreaming = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsScanning(false);
    setCustomStatusMessage(null); // 스캔 중단 시 커스텀 메시지 초기화
  };

  const startStreaming = () => {
    if (intervalRef.current) return;
    
    setIsScanning(true);
    setCustomStatusMessage(null); // 스캔 시작하면 상태 메시지는 자동(t.statusScanning)으로 전환

    const captureAndSend = async () => {
      if (cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.3,
            base64: true,
            skipProcessing: true,
            shutterSound: false,
          });

          if (photo && photo.base64) {

            // [수정 후] 객체 형태로 이미지와 언어를 함께 전송 ✅
            socket?.emit('identify-face', {
                image: photo.base64,
                lang: language // 현재 선택된 언어 state ('ko' or 'en')
            });
          } 
        } catch (error) {
          console.log('--- 스냅샷 오류 ---', error);
        }
      }
    };

    captureAndSend();
    // window.setInterval 대신 전역 setInterval 사용 (RN 호환)
    intervalRef.current = setInterval(captureAndSend, 1500);
  };

  const handleLoginPress = () => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    if (isScanning) return;
    
    if (silentSoundRef.current) {
        silentSoundRef.current.replayAsync().catch(() => {});
    }

    startStreaming();
  };

  // 현재 상태에 따른 메시지 결정 함수
  const getDisplayStatusMessage = () => {
    if (customStatusMessage) return customStatusMessage; // 로그인 성공 등 특별 메시지
    if (isScanning) return t.statusScanning;             // 스캔 중 메시지
    return t.statusIdle;                                 // 대기 중 메시지
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

      {/* [추가] 언어 선택 버튼 영역 */}
      <View style={styles.langSwitchContainer}>
        <TouchableOpacity 
          onPress={() => setLanguage('ko')}
          style={[styles.langButton, language === 'ko' && styles.langButtonActive]}
        >
          <Text style={[styles.langText, language === 'ko' && styles.langTextActive]}>KOR</Text>
        </TouchableOpacity>
        <View style={styles.langDivider} />
        <TouchableOpacity 
          onPress={() => setLanguage('en')}
          style={[styles.langButton, language === 'en' && styles.langButtonActive]}
        >
          <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>ENG</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.contentContainer}>
        
        {/* 로고 영역 */}
        <View style={styles.logoWrapper}>
          <View style={styles.logoIconContainer}>
            <MaterialCommunityIcons name="robot" size={60} color="white" />
          </View>
          <Text style={styles.logoTitle}>{t.title}</Text>
          <Text style={styles.logoSubtitle}>{t.subtitle}</Text>
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
              {isScanning ? t.loginBtnScanning : t.loginBtn}
            </Text>
          </TouchableOpacity>

          <Text style={styles.statusText}>{getDisplayStatusMessage()}</Text>

          <TouchableOpacity style={styles.subButton}>
            <Text style={styles.subButtonText}>{t.otherMethod}</Text>
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
  // [추가] 언어 스위처 스타일
  langSwitchContainer: {
    position: 'absolute',
    top: 50,
    right: 20,
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    padding: 4,
    zIndex: 10,
    alignItems: 'center',
  },
  langButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  langButtonActive: {
    backgroundColor: '#0056b3',
  },
  langDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#ccc',
    marginHorizontal: 2,
  },
  langText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
  },
  langTextActive: {
    color: '#fff',
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
    textAlign: 'center',
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