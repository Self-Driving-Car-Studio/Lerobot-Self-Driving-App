import React, { useState, useEffect, useRef } from 'react';
import { 
    StyleSheet, 
    Text, 
    View, 
    ActivityIndicator, 
    ViewStyle, 
    TextStyle 
} from 'react-native';

// 1. 임포트 (v13 버전에 맞게 수정 완료)
import {
    Camera as ExpoCamera, 
    CameraPictureOptions, 
    requestCameraPermissionsAsync,
    // 💡 [수정 1] 런타임 충돌을 일으키는 'CameraType' 객체를 import에서 제거
} from 'expo-camera';

// 💡 [수정 2] 'Camera' 타입을 'import type'으로 명시적으로 가져옴 (ts(2749) 오류 해결)
import type { Camera, FaceDetectionResult } from 'expo-camera';

import * as FaceDetector from 'expo-face-detector';

// (AI 모듈은 동적 로딩을 위해 여기서 import하지 않습니다)

// 💡 AI 결과 타입을 여기서 직접 정의
type RecognitionResult = {
    name: string | null;
    distance: number;
};

// 💡 [수정 3] 'ComponentRef' 대신 임포트한 'Camera' 타입을 직접 사용 (ts(2749) 오류 해결)
type CameraRefType = Camera | null; 

const pictureOptions: CameraPictureOptions = {
    quality: 0.2, 
    base64: true,
    skipProcessing: true,
};

const PROCESSING_DELAY_MS = 1000;
const DETECTION_INTERVAL_MS = 500;

export default function FaceRecognitionScreen(): React.JSX.Element {
    
    // --- 1. Hooks ---
    const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
    const [isModelLoading, setIsModelLoading] = useState<boolean>(true);
    const [personName, setPersonName] = useState<string>('인식 대기 중...');
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const cameraRef = useRef<CameraRefType>(null);
    const isMounted = useRef(true);

    // --- 2. 초기화 Effect ---
    useEffect(() => {
        (async () => {
            // AI 모델 로드는 'useEffect' 안에서 동적으로 임포트 (충돌 방지)
            setIsModelLoading(true);
            try {
                const { loadModel } = await import('../lib/mlService');
                await loadModel(); 
            } catch (e) {
                console.error("Failed to load model:", e);
            }
            if (isMounted.current) {
                setIsModelLoading(false);
            }
            
            // v13 방식으로 권한을 직접 요청
            const { status } = await requestCameraPermissionsAsync();
            if (isMounted.current) {
                setPermissionStatus(status);
            }
        })();
        
        return () => {
            isMounted.current = false;
        };
    }, []); // 1회만 실행

    // --- 3. 얼굴 감지 및 인식 처리 ---
    const handleFacesDetected = async ( facesResult: FaceDetectionResult ) => {
        if (isProcessing || facesResult.faces.length === 0) {
            // ... (얼굴 사라짐 처리)
            return;
        }

        setIsProcessing(true); 
        
        try {
            if (!cameraRef.current) return;
            const photo = await cameraRef.current.takePictureAsync(pictureOptions);

            if (isMounted.current) {
                setPersonName('인식 중...');
            }
            
            // AI 추론 함수도 여기서 동적으로 임포트
            const { runOnDeviceRecognition } = await import('../lib/recognitionService');
            const result = await runOnDeviceRecognition(photo.base64 as string) as RecognitionResult; 
            
            if (isMounted.current) {
                setPersonName(result.name ?? '알 수 없음');
            }
        } catch (error) {
            console.error("Recognition Error:", error);
            if (isMounted.current) {
                setPersonName('인식 오류');
            }
        } finally {
            setTimeout(() => {
                if (isMounted.current) {
                    setIsProcessing(false);
                }
            }, PROCESSING_DELAY_MS); 
        }
    };

    // --- 4. 권한 및 로딩 UI ---
    if (isModelLoading) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.infoText}>AI 모델 로드 중...</Text>
            </View>
        );
    }

    if (!permissionStatus) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.infoText}>카메라 권한 확인 중...</Text>
            </View>
        );
    }
    
    // 'PermissionStatus' 객체 대신 실제 문자열 값으로 비교
    if (permissionStatus === "undetermined") {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.infoText}>카메라 권한 요청 중...</Text>
            </View>
        );
    }
    
    if (permissionStatus === "denied") {
        return (
            <View style={styles.container}>
                <Text style={styles.infoText}>카메라 접근 권한이 필요합니다.</Text>
            </View>
        );
    }
    
    // --- 5. 최종 렌더링 (permissionStatus === "granted" 일 때) ---
    
    const resultBoxStyle = [
        styles.resultBox, 
        (personName === '인식 대기 중...' || personName === '인식 중...') && 
            { backgroundColor: 'rgba(0, 0, 0, 0.6)' },
        personName === '알 수 없음' && 
            { backgroundColor: 'rgba(255, 99, 71, 0.7)' },
        (personName !== '알 수 없음' && personName !== '인식 대기 중...' && personName !== '인식 중...') && 
            { backgroundColor: 'rgba(76, 175, 80, 0.7)' }
    ];
    
    
    return (
        <View style={styles.container}>
            <ExpoCamera 
                style={styles.camera} 
                // 💡 [수정 4] 'CameraType.front' 대신 'as any'로 타입 검사 우회
                type={"front" as any} 
                ref={cameraRef}
                onFacesDetected={handleFacesDetected}
                faceDetectorSettings={{
                    mode: FaceDetector.FaceDetectorMode.fast,
                    detectLandmarks: FaceDetector.FaceDetectorLandmarks.none,
                    runClassifications: FaceDetector.FaceDetectorLandmarks.none,
                    minDetectionInterval: DETECTION_INTERVAL_MS,
                    tracking: true,
                }}
            >
                <View style={styles.overlay}>
                    <View style={styles.recognitionFrame}>
                        <Text style={styles.instructionText}>얼굴을 중앙에 맞춰주세요</Text>
                    </View>
                    <View style={resultBoxStyle}>
                        <Text style={styles.resultText}>
                            {personName}
                        </Text>
                        {isProcessing && <ActivityIndicator color="#fff" style={{ marginLeft: 10 }} />}
                    </View>
                </View>
            </ExpoCamera>
        </View>
    );
}

// --- 6. 스타일시트 ---
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    infoText: {
        color: '#fff',
        fontSize: 18,
        marginTop: 20,
    },
    camera: {
        flex: 1,
        width: '100%',
    },
    overlay: {
        flex: 1,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
    },
    recognitionFrame: {
        width: 250,
        height: 350,
        borderWidth: 3,
        borderColor: 'rgba(255, 255, 255, 0.7)',
        borderRadius: 10,
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 20,
    },
    instructionText: {
        color: 'rgba(255, 255, 255, 0.9)',
        fontSize: 16,
    },
    resultBox: {
        position: 'absolute',
        bottom: 50,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 60,
    },
    resultText: {
        color: '#fff',
        fontSize: 24,
        fontWeight: 'bold',
    },
});