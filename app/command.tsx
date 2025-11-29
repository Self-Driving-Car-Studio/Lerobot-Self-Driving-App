import { FontAwesome, Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy'; // [추가] 안정적인 파일 읽기를 위해 추가
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

// [상수] 다국어 텍스트 정의
const TRANSLATIONS = {
  ko: {
    headerTitle: '로봇 도우미',
    status_waiting: '대기 중',
    status_thinking: '생각 중...',
    status_listening: '듣고 있어요...',
    status_processing: '처리 중...',
    status_error: '오류 발생',
    status_emergency: '긴급 상황',
    status_stop: '비상 정지',
    status_send_fail: '전송 실패',
    
    greeting: (name: string) => `${name}님, 무엇을 도와드릴까요?`,
    system_sos_sent: '🚨 긴급 호출이 발송되었습니다.',
    system_stop: '🛑 로봇을 비상 정지시켰습니다.',
    
    btn_yes: '네',
    btn_no: '아니오',
    btn_yes_action: '네, 해주세요.',
    btn_no_action: '아니요.',
    
    msg_canceled: '취소했습니다.',
    msg_sos_confirm: '긴급 호출을 하시겠습니까?',
    msg_stop_confirm: '로봇을 정지합니다.',
    
    input_placeholder: '메시지 입력...',
    input_listening: '듣고 있어요...',
    
    modal_title: '긴급 호출',
    modal_desc: '보호자에게 긴급 메시지를\n보내시겠습니까?',
    modal_yes: '예 (호출)',
    modal_no: '아니요',
    
    mic_perm_title: '권한 거부',
    mic_perm_desc: '마이크 권한이 필요합니다.',
    
    ttsLocale: 'ko-KR',
  },
  en: {
    headerTitle: 'Assistant',
    status_waiting: 'Standby',
    status_thinking: 'Thinking...',
    status_listening: 'Listening...',
    status_processing: 'Processing...',
    status_error: 'Error',
    status_emergency: 'Emergency',
    status_stop: 'Stopped',
    status_send_fail: 'Send Failed',
    
    greeting: (name: string) => `Hello ${name}, how can I help you?`,
    system_sos_sent: '🚨 Emergency call sent.',
    system_stop: '🛑 Robot emergency stop activated.',
    
    btn_yes: 'Yes',
    btn_no: 'No',
    btn_yes_action: 'Yes, please.',
    btn_no_action: 'No.',
    
    msg_canceled: 'Canceled.',
    msg_sos_confirm: 'Do you want to make an emergency call?',
    msg_stop_confirm: 'Stopping the robot.',
    
    input_placeholder: 'Enter message...',
    input_listening: 'Listening...',
    
    modal_title: 'Emergency Call',
    modal_desc: 'Send an emergency message\nto your guardian?',
    modal_yes: 'Yes (Call)',
    modal_no: 'No',
    
    mic_perm_title: 'Permission Denied',
    mic_perm_desc: 'Microphone permission is required.',
    
    ttsLocale: 'en-US',
  }
};

type LanguageType = 'ko' | 'en';

type StatusKey = 
  | 'status_waiting'
  | 'status_thinking'
  | 'status_listening'
  | 'status_processing'
  | 'status_error'
  | 'status_emergency'
  | 'status_stop'
  | 'status_send_fail';

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
  // [수정] lang 파라미터 수신 (로그인 화면에서 전달받음)
  const { userId, userName, lang } = useLocalSearchParams<{ userId: string, userName: string, lang?: string }>();
  const user = { id: userId || 'guest', name: userName || 'User' };
  const socket = useSocket();

  // [수정] 전달받은 lang 파라미터로 초기 언어 설정 (기본값 'ko')
  const [language, setLanguage] = useState<LanguageType>(lang === 'en' ? 'en' : 'ko');
  const t = TRANSLATIONS[language];

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  
  const [robotStatusKey, setRobotStatusKey] = useState<StatusKey>('status_waiting');
  const [robotEmotion, setRobotEmotion] = useState<'happy' | 'listening' | 'thinking' | 'error'>('happy');
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const [recording, setRecording] = useState<Audio.Recording | undefined>(undefined);
  const [isRecording, setIsRecording] = useState(false);
  const [sosModalVisible, setSosModalVisible] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);
  const silentSoundRef = useRef<Audio.Sound | null>(null);
  const hasGreeted = useRef(false); // [추가] 중복 인사 방지용

  // [초기화] 앱 진입 시 무음 파일 미리 로드
  useEffect(() => {
    const loadSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: SILENT_AUDIO_URI },
          { shouldPlay: false, volume: 0 }
        );
        silentSoundRef.current = sound;
        console.log('[Audio] 🔇 무음 파일 미리 로드 완료');
      } catch (error) {
        console.log('[Audio] 무음 파일 로드 실패', error);
      }
    };

    loadSound();

    return () => {
      if (silentSoundRef.current) {
        silentSoundRef.current.unloadAsync();
      }
    };
  }, []);

  // 1. 오디오 모드 설정
  const setModePlayback = async () => {
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
    } catch (e) {
      logStep('Audio', `❌ 재생 모드 설정 실패: ${e}`);
    }
  };

  const setModeRecord = async () => {
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
    } catch (e) {
      logStep('Audio', `❌ 녹음 모드 설정 실패: ${e}`);
    }
  };

  useEffect(() => {
    setModePlayback();
  }, []);

  // 2. TTS 함수
  const speak = async (text: string) => {
    logStep('TTS', `🗣️ 말하기 요청: "${text}"`);
    Speech.stop();
    
    if (!isRecording && !recording) {
        await setModePlayback();
        await delay(200);
    }

    setIsSpeaking(true);
    Speech.speak(text, {
      language: t.ttsLocale,
      rate: 0.9,
      pitch: 1.0,
      onDone: () => {
        setIsSpeaking(false);
        setRobotEmotion('happy');
      },
      onError: () => {
        setIsSpeaking(false);
      },
    });
  };

  const addMessage = useCallback((msg: Omit<Message, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(), ...msg },
    ]);
  }, []);

  // [추가] 채팅창 자동 스크롤 핸들러
  const handleContentSizeChange = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  // 3. 소켓 핸들러
  useEffect(() => {
    // [수정] 인사 중복 방지 로직 적용
    if (!hasGreeted.current) {
        const greetText = t.greeting(user.name);
        addMessage({ sender: 'bot', text: greetText, type: 'simple' });
        speak(greetText);
        hasGreeted.current = true;
    }

    if (!socket) {
      logStep('Socket', '⚠️ 연결 안 됨');
      return;
    }

    const handleUserSpeech = (data: { text: string }) => {
      addMessage({ sender: 'user', text: data.text, type: 'simple' });
      setRobotStatusKey('status_thinking');
      setRobotEmotion('thinking');
    };

    const handleCommandResponse = async (response: any) => {
      setRobotStatusKey('status_waiting');
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
      socket.off('user-speech', handleUserSpeech);
      socket.off('command-response', handleCommandResponse);
      Speech.stop();
    };
  }, [socket, user.name, addMessage, language]); // language 변경 시 재구독

  const sendMessage = () => {
    if (inputText.trim().length === 0) return;
    addMessage({ sender: 'user', text: inputText, type: 'simple' });
    setRobotStatusKey('status_processing');
    setRobotEmotion('thinking');
    
    if (socket) {
      // [수정] lang 필드 추가 전송
      socket.emit('command', { userId: user.id, text: inputText, lang: language });
    }
    setInputText('');
  };

  // 4. 녹음 시작/종료
  const startRecording = async () => {
    try {
      Speech.stop();
      setIsSpeaking(false);

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(t.mic_perm_title, t.mic_perm_desc);
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
      setRobotStatusKey('status_listening');
      setRobotEmotion('listening');
    } catch (err) {
      logStep('Record', `❌ 시작 실패: ${err}`);
      setRobotStatusKey('status_error');
      setRobotEmotion('error');
    }
  };

  const stopRecordingAndSend = async () => {
    setIsRecording(false);
    setRobotStatusKey('status_thinking');
    setRobotEmotion('thinking');
    
    const currentRecording = recording;
    setRecording(undefined);

    if (!currentRecording) return;

    try {
      await currentRecording.stopAndUnloadAsync();
      await delay(300);
      await Audio.setIsEnabledAsync(true);
      await delay(500);

      // [Sound Kick]
      try {
        if (silentSoundRef.current) {
          await silentSoundRef.current.replayAsync();
          await delay(1000);
        } else {
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
      
      const uri = currentRecording.getURI();
      if (uri && socket) {
        // [수정] FileSystem을 이용한 안정적인 파일 읽기 (Android 호환성)
        try {
            const base64Data = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
            });
            
            // [수정] lang 필드 추가하여 오디오 전송
            socket.emit('audio-upload', {
                audioData: base64Data,
                format: 'm4a',
                userId: user.id,
                lang: language // 현재 언어 설정 전달
            });
        } catch (fileErr) {
            console.log('File read error:', fileErr);
            throw fileErr;
        }
      }
    } catch (error) {
      logStep('Record', `❌ 에러: ${error}`);
      setRobotStatusKey('status_send_fail');
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
      addMessage({ sender: 'user', text: t.btn_yes_action, type: 'simple' });
      // [수정] lang 필드 추가
      socket?.emit('action-confirm', { userId: user.id, command: action, lang: language });
    } else {
      addMessage({ sender: 'user', text: t.btn_no_action, type: 'simple' });
      speak(t.msg_canceled);
    }
  };

  const handleSOSRequest = () => {
    setSosModalVisible(true);
    speak(t.msg_sos_confirm);
  };

  const confirmSOS = () => {
    setSosModalVisible(false);
    addMessage({ sender: 'system', text: t.system_sos_sent, type: 'simple' });
    setRobotStatusKey('status_emergency');
    setRobotEmotion('error');
    speak(t.system_sos_sent);
    // [수정] lang 필드 추가 (서버가 긴급 상황 로그를 해당 언어로 남기거나 처리할 수 있도록)
    socket?.emit('command', { userId: user.id, text: 'SOS 긴급 호출', lang: language });
  };

  const cancelSOS = () => {
    setSosModalVisible(false);
    speak(t.msg_canceled);
  };

  const handleEmergencyStop = () => {
    setRobotStatusKey('status_stop');
    setRobotEmotion('error');
    addMessage({ sender: 'system', text: t.system_stop, type: 'simple' });
    speak(t.msg_stop_confirm);

    if (socket) {
      // [수정] lang 필드 추가
      socket.emit('pause', { userId: user.id, text: '로봇 비상 정지', lang: language });
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
              <Text style={styles.headerTitle}>{t.headerTitle}</Text>
              <Text style={[styles.headerStatus, robotStatusKey === 'status_emergency' && styles.statusEmergency]}>
                {t[robotStatusKey] as string}
              </Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={[styles.circleButton, styles.stopButton]} 
              onPress={handleEmergencyStop} 
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="pause" size={28} color="white" />
              <Text style={styles.buttonLabel}>STOP</Text>
            </TouchableOpacity>

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
          // [수정] onContentSizeChange로 자동 스크롤 개선
          onContentSizeChange={handleContentSizeChange}
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
                    <Text style={styles.actionBtnText}>{t.btn_yes}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.noBtn]} onPress={() => handleConfirmAction(item.id, item.actionCommand || '', false)}>
                    <Text style={[styles.actionBtnText, { color: '#333' }]}>{t.btn_no}</Text>
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
            placeholder={isRecording ? t.input_listening : t.input_placeholder}
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
              <Text style={styles.modalTitle}>{t.modal_title}</Text>
              <Text style={styles.modalDesc}>{t.modal_desc}</Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnYes]} onPress={confirmSOS}>
                  <Text style={styles.modalBtnText}>{t.modal_yes}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, styles.modalBtnNo]} onPress={cancelSOS}>
                  <Text style={[styles.modalBtnText, {color:'#333'}]}>{t.modal_no}</Text>
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
  headerRight: { flexDirection: 'row', gap: 10, alignItems: 'center' }, 
  statusContainer: { justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111' },
  headerStatus: { fontSize: 16, color: '#0ea5e9', fontWeight: '600' },
  statusEmergency: { color: '#dc2626', fontWeight: 'bold' },
  
  // 로봇 얼굴 스타일
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
  stopButton: { backgroundColor: '#374151' }, 
  sosButton: { backgroundColor: '#dc2626' }, 
  buttonLabel: { color: 'white', fontWeight: 'bold', marginTop: 2, fontSize: 11 },
  
  chatArea: { flex: 1, backgroundColor: '#f0f2f5' },
  chatContent: { padding: 15, paddingBottom: 20, flexGrow: 1 },
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