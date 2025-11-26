import { useLocalSearchParams } from 'expo-router'; // ⚠️ route.params 대신 사용
import React, { useEffect, useRef, useState } from 'react';
import {
  Button, FlatList,
  KeyboardAvoidingView, Platform,
  StyleSheet,
  Text, TextInput,
  View,
} from 'react-native';
import { useSocket } from '../contexts/SocketContext';

// 메시지 타입 정의
interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
}

// 서버 응답 타입 정의
interface CommandResponse {
  text: string;
  speak?: boolean; // (음성 기능은 제외했지만, 타입은 남겨둘 수 있음)
}

export default function CommandScreen() {
  // ⚠️ 여기가 중요: Expo Router에서 파라미터를 받는 방식
  const { userId, userName } = useLocalSearchParams<{ userId: string, userName: string }>();
  // 파라미터로 사용자 객체 재구성
  const user = { id: userId, name: userName };
  
  const socket = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!socket) return;

    const handleCommandResponse = (response: CommandResponse) => {
      addMessage('bot', response.text);
    };

    socket.on('command-response', handleCommandResponse);
    
    // 환영 메시지 추가
    addMessage('bot', `${user.name}님, 무엇을 도와드릴까요?`);

    return () => {
      socket.off('command-response', handleCommandResponse);
    };
  }, [socket, user.name]); // user.name을 의존성 배열에 추가

  const addMessage = (sender: 'user' | 'bot', text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(), sender, text },
    ]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const sendMessage = () => {
    if (inputText.trim().length === 0) return;

    addMessage('user', inputText);
    socket?.emit('command', { userId: user.id, text: inputText });
    setInputText('');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.headerText}>{user.name}님 (로그인됨)</Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            style={[
              styles.messageBubble,
              item.sender === 'user' ? styles.userBubble : styles.botBubble,
            ]}
          >
            <Text 
              style={item.sender === 'user' ? styles.userText : styles.botText}
            >
              {item.text}
            </Text>
          </View>
        )}
        style={styles.chatArea}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="명령을 입력하세요..."
          onSubmitEditing={sendMessage}
        />
        <Button title="전송" onPress={sendMessage} />
      </View>
    </KeyboardAvoidingView>
  );
}

// (스타일은 이전과 동일, paddingTop만 수정)
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  header: { 
    padding: 15, 
    backgroundColor: 'white', 
    borderBottomWidth: 1, 
    borderColor: '#ddd',
    paddingTop: Platform.OS === 'android' ? 30 : 50, // SafeArea 고려
  },
  headerText: { fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  chatArea: { flex: 1, padding: 10 },
  messageBubble: {
    padding: 12,
    borderRadius: 15,
    marginBottom: 10,
    maxWidth: '80%',
  },
  userBubble: {
    backgroundColor: '#007bff',
    alignSelf: 'flex-end',
  },
  botBubble: {
    backgroundColor: '#e5e5ea',
    alignSelf: 'flex-start',
  },
  userText: { color: 'white', fontSize: 16 },
  botText: { color: 'black', fontSize: 16 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderTopWidth: 1,
    borderColor: '#ccc',
    backgroundColor: 'white',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10, 
  },
  input: {
    flex: 1,
    height: 40,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    marginRight: 10,
    backgroundColor: 'white',
  },
});