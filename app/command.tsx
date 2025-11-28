import { FontAwesome, Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// [오디오 초기화용 무음 파일]
const SILENT_AUDIO_URI = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAAAATGF2YzU4LjU0AAAAAAAAAAAAAAAAJAAAAAAAAAAAASAA82xZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA//OEZAAAAAAIAAAAAIQAASAAAAAAAAAAAA0OVmn/+5BAAAABuYywAAAAAxlQAAAAEBQWAAAAAAAkAQAAAAAAABABAAAAAAAAAAAAAA';

// --- [유틸리티] 지연 함수 ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- [유틸리티] 로그 함수 ---
const logStep = (tag: string, message: string) => {
  const time = new Date().toISOString().split('T')[1].slice(0, -1);
  console.log(`[${time}] [${tag}] ${message}`);
};

interface Message {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  type?: 'simple' | 'confirm';
  actionCommand?: string;
  isAnswered?: boolean;
}

const RobotFace = ({ emotion, isSpeaking }: { emotion: string; isSpeaking: boolean }) => {
  const eyeColor = emotion === 'error' ? '#ff4d4d' : '#333';
  return (
    <View style={styles.robotFaceContainer}>
      <View style={[styles.robotHead, isSpeaking && styles.robotSpeaking]}>
        <View style={styles.eyesContainer}>
          <View style={[styles.eye, { backgroundColor: eyeColor }, emotion === 'listening' && styles.eyeBlinking]} />
          <View style={[styles.eye, { backgroundColor: eyeColor }, emotion === 'listening' && styles.eyeBlinking]} />
        </View>
        <View style={[styles.mouth, emotion === 'happy' && styles.mouthHappy]} />
      </View>
    </View>
  );
};

export default function CommandScreen() {
  const { userId, userName } = useLocalSearchParams<{ userId: string, userName: string }>();
  const user = { id: userId || 'guest', name: userName || '사용자' };
  const socket = useSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [robotStatus, setRobotStatus] = useState('대기 중');
  const [robotEmotion, setRobotEmotion] = useState<'happy' | 'listening' | 'thinking' | 'error'>('happy');
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const [recording, setRecording] = useState<Audio.Recording | undefined>(undefined);
  const [isRecording, setIsRecording] = useState(false);
  const [sosModalVisible, setSosModalVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // [추가] 무음 사운드 객체를 저장할 Ref
  const silentSoundRef = useRef<Audio.Sound | null>(null);

  // [추가] 앱 진입 시 무음 파일 미리 로드 (1번만 실행됨)
  useEffect(() => {
    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: SILENT_AUDIO_URI },
          { shouldPlay: false, volume: 0 } // 미리 로드만 하고 재생은 안 함, 볼륨 0
        );
        silentSoundRef.current = sound;
        console.log('[Audio] 🔇 무음 파일 미리 로드 완료');
      } catch (error) {
        console.log('[Audio] 무음 파일 로드 실패', error);
      }
    };

    loadSound();

    // 앱 종료 시 메모리 해제
    return () => {
      if (silentSoundRef.current) {
        silentSoundRef.current.unloadAsync();
      }
    };
  }, []);

  // =================================================================
  // 1. 오디오 모드 설정
  // =================================================================
  const setModePlayback = async () => {
    logStep('Audio', '🔊 재생 모드(Playback) 설정 진입');
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false, // 미러링 중에는 false가 라우팅 변경에 유리함
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        // allowsAirPlayIOS: true,  <-- 이 줄 삭제됨 (존재하지 않음)
        interruptionModeIOS: InterruptionModeIOS.DoNotMix, 
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
      logStep('Audio', '✅ 재생 모드 설정 완료');
    } catch (e) {
      logStep('Audio', `❌ 재생 모드 설정 실패: ${e}`);
    }
  };

  const setModeRecord = async () => {
    logStep('Audio', '🎤 녹음 모드(Record) 설정 진입');
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });
      logStep('Audio', '✅ 녹음 모드 설정 완료');
    } catch (e) {
      logStep('Audio', `❌ 녹음 모드 설정 실패: ${e}`);
    }
  };

  useEffect(() => {
    setModePlayback();
  }, []);

  // =================================================================
  // 2. TTS 함수
  // =================================================================
  const speak = async (text: string) => {
    logStep('TTS', `🗣️ 말하기 요청: "${text}"`);
    Speech.stop();
    
    if (!isRecording && !recording) {
        await setModePlayback();
        await delay(200);
    }

    setIsSpeaking(true);
    Speech.speak(text, {
      language: 'ko-KR',
      rate: 0.9,
      pitch: 1.0,
      onStart: () => logStep('TTS', '▶️ 시작됨'),
      onDone: () => {
        logStep('TTS', '⏹️ 완료됨');
        setIsSpeaking(false);
        setRobotEmotion('happy');
      },
      onError: (e) => {
        logStep('TTS', `⚠️ 에러: ${e}`);
        setIsSpeaking(false);
      },
    });
  };

  const addMessage = useCallback((msg: Omit<Message, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(), ...msg },
    ]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // =================================================================
  // 3. 소켓 핸들러
  // =================================================================
  useEffect(() => {
    const greetingTimer = setTimeout(() => {
        addMessage({ sender: 'bot', text: `${user.name}님, 무엇을 도와드릴까요?`, type: 'simple' });
        speak(`${user.name}님, 무엇을 도와드릴까요?`);
    }, 800);

    if (!socket) {
      logStep('Socket', '⚠️ 연결 안 됨');
      return;
    }

    const handleUserSpeech = (data: { text: string }) => {
      logStep('Socket', `📩 user-speech: ${data.text}`);
      addMessage({ sender: 'user', text: data.text, type: 'simple' });
      setRobotStatus('생각 중...');
      setRobotEmotion('thinking');
    };

    const handleCommandResponse = async (response: any) => {
      logStep('Socket', `📩 command-response: ${JSON.stringify(response)}`);
      setRobotStatus('대기 중');
      setRobotEmotion('happy');

      if (response.recognized_text) {
        addMessage({ sender: 'user', text: response.recognized_text, type: 'simple' });
      } else if (response.meta && response.meta.recognized_text) {
         addMessage({ sender: 'user', text: response.meta.recognized_text, type: 'simple' });
      }

      addMessage({
        sender: 'bot',
        text: response.text,
        type: response.type,
        actionCommand: response.meta, 
        isAnswered: false,
      });

      await speak(response.text);
    };

    socket.on('user-speech', handleUserSpeech);
    socket.on('command-response', handleCommandResponse);

    return () => {
      clearTimeout(greetingTimer);
      socket.off('user-speech', handleUserSpeech);
      socket.off('command-response', handleCommandResponse);
      Speech.stop();
    };
  }, [socket, user.name, addMessage]);

  const sendMessage = () => {
    if (inputText.trim().length === 0) return;
    logStep('UI', `텍스트 전송: ${inputText}`);
    addMessage({ sender: 'user', text: inputText, type: 'simple' });
    setRobotStatus('처리 중...');
    setRobotEmotion('thinking');
    
    if (socket) {
      socket.emit('command', { userId: user.id, text: inputText });
    }
    setInputText('');
  };

  // =================================================================
  // 4. 녹음 시작/종료 (Dummy Sound 포함)
  // =================================================================
  const startRecording = async () => {
    logStep('Record', '버튼 클릭: 녹음 시작');
    try {
      Speech.stop();
      setIsSpeaking(false);

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert("권한 거부", "마이크 권한이 필요합니다.");
        return;
      }

      await Audio.setIsEnabledAsync(false);
      await delay(50);
      await setModeRecord();
      await Audio.setIsEnabledAsync(true);
      await delay(100);

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(recording);
      setIsRecording(true);
      setRobotStatus('듣고 있어요...');
      setRobotEmotion('listening');
      logStep('Record', '🔴 녹음 활성화 됨');
    } catch (err) {
      logStep('Record', `❌ 시작 실패: ${err}`);
      setRobotStatus('오류 발생');
      setRobotEmotion('error');
    }
  };

  // 2. 녹음 종료 및 전송 (미러링 딜레이 대응)
  const stopRecordingAndSend = async () => {
    logStep('Record', '⏹️ 녹음 종료 트리거');
    setIsRecording(false);
    setRobotStatus('처리 중...');
    setRobotEmotion('thinking');
    
    const currentRecording = recording;
    setRecording(undefined);

    if (!currentRecording) return;

    try {
      // 1. 녹음 중단
      await currentRecording.stopAndUnloadAsync();
      
      // 하드웨어 해제 대기 (미러링 환경 고려 300ms)
      await delay(300);

      // ------------------------------------------------------------------
      // [삭제됨] Audio.setIsEnabledAsync(false/true) 제거
      // 엔진을 끄지 않고 바로 모드만 변경하여 볼륨 UI 팝업을 방지합니다.
      // ------------------------------------------------------------------
      
      await Audio.setIsEnabledAsync(true);
      await delay(500);

      // [Dummy Sound Kick - 재사용 버전]
      logStep('Audio', '📢 스피커 강제 개방 시도 (Replay)');
      try {
        if (silentSoundRef.current) {
          // [핵심] 새로 만드는 게 아니라, 있는 걸 처음부터 다시 재생
          await silentSoundRef.current.replayAsync();
          
          // AirPlay 전송 대기 (1초 유지)
          await delay(1000);
          
          // 주의: 여기서 unloadAsync() 하지 않음! (계속 쓸 거니까)
          logStep('Audio', '✅ 스피커 개방 성공');
        } else {
            // 만약 로드가 안 됐다면 비상용으로 새로 생성 (예외 처리)
            const { sound } = await Audio.Sound.createAsync(
                { uri: SILENT_AUDIO_URI },
                { shouldPlay: true, volume: 0 }
            );
            await delay(1000);
            await sound.unloadAsync();
        }
      } catch (soundErr) {
        logStep('Audio', `⚠️ 스피커 개방 실패: ${soundErr}`);
      }
      
      // 4. 전송 로직 (기존 동일)
      const uri = currentRecording.getURI();
      if (uri && socket) {
        const base64String = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64',
        });
        socket.emit('audio-upload', {
          audioData: base64String,
          format: 'm4a',
          userId: user.id
        });
      }
    } catch (error) {
      logStep('Record', `❌ 에러: ${error}`);
      setRobotStatus("전송 실패");
      setRobotEmotion('error');
    }
  };
  
  const handleMicPress = () => {
    if (isRecording) {
      stopRecordingAndSend();
    } else {
      startRecording();
    }
  };

  // --- UI 핸들러 ---
  const handleConfirmAction = (messageId: string, action: string, isYes: boolean) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, isAnswered: true } : msg
    ));

    if (isYes) {
      addMessage({ sender: 'user', text: '네, 해주세요.', type: 'simple' });
      socket?.emit('action-confirm', { userId: user.id, command: action });
    } else {
      addMessage({ sender: 'user', text: '아니요.', type: 'simple' });
      speak("취소했습니다.");
    }
  };

  const handleSOSRequest = () => {
    setSosModalVisible(true);
    speak("긴급 호출을 하시겠습니까?");
  };

  const confirmSOS = () => {
    setSosModalVisible(false);
    addMessage({ sender: 'system', text: '🚨 긴급 호출이 발송되었습니다.', type: 'simple' });
    setRobotStatus('긴급 상황');
    setRobotEmotion('error');
    speak("긴급 호출이 발송되었습니다.");
    socket?.emit('command', { userId: user.id, text: 'SOS 긴급 호출' });
  };

  const cancelSOS = () => {
    setSosModalVisible(false);
    speak("취소되었습니다.");
  };

  // [신규] 비상 정지 핸들러 (모달 없음, 즉시 실행)
  const handleEmergencyStop = () => {
    logStep('Command', '🛑 비상 정지 버튼 클릭');
    
    // UI 즉시 피드백
    setRobotStatus('비상 정지');
    setRobotEmotion('error');
    addMessage({ sender: 'system', text: '🛑 로봇을 비상 정지시켰습니다.', type: 'simple' });
    speak("로봇을 정지합니다.");

    // 소켓으로 'pause' 전송
    if (socket) {
      socket.emit('pause', { userId: user.id, text: '로봇 비상 정지'});
      logStep('Socket', '📤 pause 이벤트 전송 완료');
    }
  };

return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0} 
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <RobotFace emotion={robotEmotion} isSpeaking={isSpeaking} />
            <View style={styles.statusContainer}>
              <Text style={styles.headerTitle}>로봇 도우미</Text>
              <Text style={[styles.headerStatus, robotStatus === '긴급 상황' && styles.statusEmergency]}>
                {robotStatus}
              </Text>
            </View>
          </View>

          {/* 오른쪽 버튼 영역 (STOP + SOS) */}
          <View style={styles.headerRight}>
            
            {/* 비상 정지 버튼 (STOP) */}
            <TouchableOpacity 
              style={[styles.circleButton, styles.stopButton]} 
              onPress={handleEmergencyStop} 
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="pause" size={28} color="white" />
              <Text style={styles.buttonLabel}>STOP</Text>
            </TouchableOpacity>

            {/* SOS 버튼 */}
            <TouchableOpacity 
              style={[styles.circleButton, styles.sosButton]} 
              onPress={handleSOSRequest} 
              activeOpacity={0.7}
            >
              <MaterialIcons name="phone-in-talk" size={28} color="white" />
              <Text style={styles.buttonLabel}>SOS</Text>
            </TouchableOpacity>

          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatContent}
          renderItem={({ item }) => (
            <View style={{ marginBottom: 16 }}>
              <View style={[
                styles.messageBubble,
                item.sender === 'user' ? styles.userBubble : 
                item.sender === 'system' ? styles.systemBubble : styles.botBubble,
              ]}>
                <Text style={[
                  styles.messageText,
                  item.sender === 'user' ? styles.userText : 
                  item.sender === 'system' ? styles.systemText : styles.botText,
                ]}>
                  {item.text}
                </Text>
              </View>
              {item.sender === 'bot' && item.type === 'confirm' && !item.isAnswered && (
                <View style={styles.buttonGroup}>
                  <TouchableOpacity style={[styles.actionBtn, styles.yesBtn]} onPress={() => handleConfirmAction(item.id, item.actionCommand || '', true)}>
                    <Text style={styles.actionBtnText}>네</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.noBtn]} onPress={() => handleConfirmAction(item.id, item.actionCommand || '', false)}>
                    <Text style={[styles.actionBtnText, { color: '#333' }]}>아니오</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          style={styles.chatArea}
        />

        <View style={styles.inputContainer}>
          <TouchableOpacity style={[styles.micButton, isRecording && styles.micButtonRecording]} onPress={handleMicPress}>
            <FontAwesome name={isRecording ? "stop" : "microphone"} size={24} color="white" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isRecording ? "듣고 있어요..." : "메시지 입력..."}
            placeholderTextColor="#999"
            onSubmitEditing={sendMessage}
            editable={!isRecording}
          />
          <TouchableOpacity style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} onPress={sendMessage} disabled={!inputText.trim()}>
            <Ionicons name="send" size={24} color="white" />
          </TouchableOpacity>
        </View>

        <Modal animationType="fade" transparent={true} visible={sosModalVisible} onRequestClose={cancelSOS}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <MaterialIcons name="campaign" size={60} color="#dc2626" />
              <Text style={styles.modalTitle}>긴급 호출</Text>
              <Text style={styles.modalDesc}>보호자에게 긴급 메시지를{"\n"}보내시겠습니까?</Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnYes]} onPress={confirmSOS}>
                  <Text style={styles.modalBtnText}>예 (호출)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnNo]} onPress={cancelSOS}>
                  <Text style={[styles.modalBtnText, {color:'#333'}]}>아니요</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 15, backgroundColor: 'white', 
    borderBottomWidth: 2, borderColor: '#e5e7eb', marginTop: Platform.OS === 'android' ? 30 : 0,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerRight: { flexDirection: 'row', gap: 10 }, // 버튼 간격
  statusContainer: { justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111' },
  headerStatus: { fontSize: 16, color: '#0ea5e9', fontWeight: '600' },
  statusEmergency: { color: '#dc2626', fontWeight: 'bold' },
  robotFaceContainer: { marginRight: 15 },
  robotHead: {
    width: 60, height: 60, backgroundColor: '#e0f2fe', borderRadius: 30,
    borderWidth: 2, borderColor: '#0ea5e9', justifyContent: 'center', alignItems: 'center',
  },
  robotSpeaking: { borderColor: '#22c55e', borderWidth: 3 },
  eyesContainer: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  eye: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#333' },
  eyeBlinking: { opacity: 0.5 },
  mouth: { width: 20, height: 4, borderRadius: 2, backgroundColor: '#333' },
  mouthHappy: { height: 8, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: 'transparent', borderWidth: 2, borderTopWidth: 0, borderColor: '#333' },
  
  // 버튼 공통 스타일
  circleButton: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  stopButton: { backgroundColor: '#374151' }, // 진한 회색 (STOP)
  sosButton: { backgroundColor: '#dc2626' }, // 빨간색 (SOS)
  
  buttonLabel: { color: 'white', fontWeight: 'bold', marginTop: 2, fontSize: 11 },
  
  chatArea: { flex: 1, backgroundColor: '#f0f2f5' },
  chatContent: { 
    padding: 15, 
    paddingBottom: 20,
    flexGrow: 1,
  },
  messageBubble: {
    padding: 16, borderRadius: 20, maxWidth: '85%',
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, elevation: 1,
  },
  userBubble: { backgroundColor: '#3b82f6', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: 'white', alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  systemBubble: { backgroundColor: '#fef2f2', alignSelf: 'center', borderColor: '#fca5a5', borderWidth: 2, alignItems: 'center' },
  messageText: { fontSize: 18, lineHeight: 26 },
  userText: { color: 'white' },
  botText: { color: '#1f2937' },
  systemText: { color: '#991b1b', fontWeight: 'bold', textAlign: 'center' },
  buttonGroup: { flexDirection: 'row', marginTop: 8, marginLeft: 4, gap: 10, justifyContent: 'flex-start' },
  actionBtn: {
    paddingVertical: 12, paddingHorizontal: 25, borderRadius: 15, elevation: 3, minWidth: 80, alignItems: 'center',
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1,
  },
  yesBtn: { backgroundColor: '#3b82f6' },
  noBtn: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  actionBtnText: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', padding: 15,
    backgroundColor: 'white', borderTopWidth: 1, borderColor: '#e5e7eb',
  },
  micButton: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#9ca3af', justifyContent: 'center', alignItems: 'center', marginRight: 10, elevation: 2,
  },
  micButtonRecording: {
    backgroundColor: '#ef4444', borderWidth: 3, borderColor: '#fecaca',
  },
  input: {
    flex: 1, height: 56, borderColor: '#d1d5db', borderWidth: 2, borderRadius: 28,
    paddingHorizontal: 20, fontSize: 18, backgroundColor: '#f9fafb', marginRight: 10, color: '#111',
  },
  sendButton: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#3b82f6',
    justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  sendButtonDisabled: { backgroundColor: '#9ca3af' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: 'white', borderRadius: 24, padding: 30, alignItems: 'center', elevation: 10 },
  modalTitle: { fontSize: 28, fontWeight: 'bold', color: '#dc2626', marginVertical: 10 },
  modalDesc: { fontSize: 18, color: '#4b5563', textAlign: 'center', marginBottom: 30, lineHeight: 26 },
  modalButtons: { flexDirection: 'row', width: '100%', gap: 15 },
  modalBtn: { flex: 1, paddingVertical: 18, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  modalBtnYes: { backgroundColor: '#dc2626' },
  modalBtnNo: { backgroundColor: '#e5e7eb', borderWidth: 1, borderColor: '#d1d5db' },
  modalBtnText: { fontSize: 20, fontWeight: 'bold', color: 'white' },
});