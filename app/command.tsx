import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
// 🎤 아이콘 추가 (FontAwesome)
import { FontAwesome, Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { useSocket } from '../contexts/SocketContext';

// --- [타입 정의] ---
interface Message {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  type?: 'simple' | 'confirm';
  actionCommand?: string;
  isAnswered?: boolean;
}

interface CommandResponse {
  type: 'simple' | 'confirm';
  text: string;
  action?: string;
}

// --- [컴포넌트] 로봇 얼굴 ---
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

  // --- 상태 관리 ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [robotStatus, setRobotStatus] = useState('대기 중');
  const [robotEmotion, setRobotEmotion] = useState<'happy' | 'listening' | 'thinking' | 'error'>('happy');
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // 🎤 음성 녹음 상태 (UI용)
  const [isRecording, setIsRecording] = useState(false);
  
  const [sosModalVisible, setSosModalVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // --- TTS 함수 ---
  const speak = (text: string) => {
    setIsSpeaking(true);
    Speech.speak(text, {
      language: 'ko-KR',
      rate: 0.9,
      onDone: () => {
        setIsSpeaking(false);
        setRobotEmotion('happy');
      },
      onError: () => setIsSpeaking(false),
    });
  };

  const addMessage = useCallback((msg: Omit<Message, 'id'>) => {
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(), ...msg },
    ]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  useEffect(() => {
    addMessage({ sender: 'bot', text: `${user.name}님, 무엇을 도와드릴까요?`, type: 'simple' });
    speak(`${user.name}님, 무엇을 도와드릴까요?`);

    if (!socket) return;

    const handleCommandResponse = (response: CommandResponse) => {
      setRobotStatus('대기 중');
      setRobotEmotion('happy');

      addMessage({
        sender: 'bot',
        text: response.text,
        type: response.type,
        actionCommand: response.action,
        isAnswered: false,
      });
      speak(response.text);
    };

    socket.on('command-response', handleCommandResponse);

    return () => {
      socket.off('command-response', handleCommandResponse);
      Speech.stop();
    };
  }, [socket, user.name, addMessage]);

  const sendMessage = () => {
    if (inputText.trim().length === 0) return;

    addMessage({ sender: 'user', text: inputText, type: 'simple' });
    setRobotStatus('처리 중...');
    setRobotEmotion('thinking');
    
    if (socket) {
      socket.emit('command', { userId: user.id, text: inputText });
    } else {
      setTimeout(() => {
        addMessage({ sender: 'bot', text: '서버 연결 안 됨', type: 'simple' });
      }, 500);
    }
    setInputText('');
  };

  // --- 🎤 음성 입력 시뮬레이션 핸들러 ---
  const toggleListening = () => {
    if (isRecording) {
      // 녹음 중지
      setIsRecording(false);
      setRobotStatus('대기 중');
      setRobotEmotion('happy');
    } else {
      // 녹음 시작
      setIsRecording(true);
      setRobotStatus('듣고 있어요...');
      setRobotEmotion('listening'); // 로봇이 귀를 기울임

      // [시뮬레이션] 2초 뒤에 가상의 텍스트 입력
      setTimeout(() => {
        // 실제로는 여기서 STT 라이브러리가 텍스트를 반환함
        setInputText("오늘 날씨 알려줘"); 
        setIsRecording(false);
        setRobotStatus('대기 중');
        setRobotEmotion('happy');
      }, 2000);
    }
  };

  const handleConfirmAction = (messageId: string, action: string, isYes: boolean) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, isAnswered: true } : msg
    ));

    if (isYes) {
      addMessage({ sender: 'user', text: '네, 해주세요.', type: 'simple' });
      setRobotStatus('실행 중...');
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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* 헤더 */}
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
          <TouchableOpacity 
            style={styles.sosButton} 
            onPress={handleSOSRequest}
            activeOpacity={0.7}
          >
            <MaterialIcons name="phone-in-talk" size={32} color="white" />
            <Text style={styles.sosText}>SOS</Text>
          </TouchableOpacity>
        </View>

        {/* 채팅 영역 */}
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
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.yesBtn]}
                    onPress={() => handleConfirmAction(item.id, item.actionCommand || '', true)}
                  >
                    <Text style={styles.actionBtnText}>네</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.noBtn]}
                    onPress={() => handleConfirmAction(item.id, item.actionCommand || '', false)}
                  >
                    <Text style={[styles.actionBtnText, { color: '#333' }]}>아니오</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          style={styles.chatArea}
        />

        {/* --- 🎤 수정된 입력 영역 --- */}
        <View style={styles.inputContainer}>
          {/* 마이크 버튼 */}
          <TouchableOpacity
            style={[styles.micButton, isRecording && styles.micButtonRecording]}
            onPress={toggleListening}
          >
            <FontAwesome name="microphone" size={24} color="white" />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isRecording ? "듣고 있어요..." : "명령 입력..."}
            placeholderTextColor="#999"
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity 
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} 
            onPress={sendMessage}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={24} color="white" />
          </TouchableOpacity>
        </View>

        {/* SOS 모달 */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={sosModalVisible}
          onRequestClose={cancelSOS}
        >
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
  
  // 헤더
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 15, backgroundColor: 'white', 
    borderBottomWidth: 2, borderColor: '#e5e7eb', marginTop: Platform.OS === 'android' ? 30 : 0,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  statusContainer: { justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#111' },
  headerStatus: { fontSize: 16, color: '#0ea5e9', fontWeight: '600' },
  statusEmergency: { color: '#dc2626', fontWeight: 'bold' },

  // 로봇 얼굴
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

  // SOS 버튼
  sosButton: {
    backgroundColor: '#dc2626', width: 70, height: 70, borderRadius: 35,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: "#dc2626", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5,
  },
  sosText: { color: 'white', fontWeight: 'bold', marginTop: 2, fontSize: 12 },

  // 채팅 영역
  chatArea: { flex: 1, backgroundColor: '#f0f2f5' },
  chatContent: { padding: 15, paddingBottom: 20 },
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

  // B타입 버튼
  buttonGroup: { flexDirection: 'row', marginTop: 8, marginLeft: 4, gap: 10, justifyContent: 'flex-start' },
  actionBtn: {
    paddingVertical: 12, paddingHorizontal: 25, borderRadius: 15, elevation: 3, minWidth: 80, alignItems: 'center',
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1,
  },
  yesBtn: { backgroundColor: '#3b82f6' },
  noBtn: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  actionBtnText: { fontSize: 18, fontWeight: 'bold', color: 'white' },

  // --- 🎤 입력창 스타일 (수정됨) ---
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', padding: 15,
    backgroundColor: 'white', borderTopWidth: 1, borderColor: '#e5e7eb',
  },
  micButton: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#9ca3af', // 평소 회색
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
    elevation: 2,
  },
  micButtonRecording: {
    backgroundColor: '#ef4444', // 녹음 중 빨간색
    borderWidth: 3, borderColor: '#fecaca',
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

  // 모달
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