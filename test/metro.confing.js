// 📁 metro.config.js

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// AI 모델 파일을 애셋으로 인식하도록 확장자 추가
config.resolver.assetExts.push(
  'bin',     // .bin (모델 가중치)
  'json'   // .json (모델 구조)
);

module.exports = config;