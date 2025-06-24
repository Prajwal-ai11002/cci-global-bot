import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Users, Award, Briefcase, Trash2, Download, Mic, Volume2, Pause, Menu, X, MapPin, Clock } from 'lucide-react';

const CCIGlobalChatbot = () => {
  const [messages, setMessages] = useState([
    {
      id: 1,
      text: "Hello! I'm your CCI Global assistant. I can help you with information about our BPO services, locations, industries we serve, and more. What would you like to know?",
      sender: 'bot',
      timestamp: new Date().toISOString(),
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [suggestedQuestions, setSuggestedQuestions] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [careersInfo, setCareersInfo] = useState({});
  const [showCareers, setShowCareers] = useState(false);
  const [requiresCustomerInfo, setRequiresCustomerInfo] = useState(false);
  const [missingFields, setMissingFields] = useState([]);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const audioRef = useRef(null);
  const recordingStartTimeRef = useRef(null);
  const [currentPlayingMessageId, setCurrentPlayingMessageId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const MIN_RECORDING_DURATION = 1000;

  // const API_BASE_URL = process.env.REACT_APP_API_URL;
  const API_BASE_URL = 'http://localhost:8000'
 console.log('API_BASE_URL:', API_BASE_URL);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const fetchCareersInfo = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/conversation/` + userId);
        if (!response.ok) throw new Error('Failed to fetch careers info');
        const data = await response.json();
        setCareersInfo(data.customer_info || {});
      } catch (error) {
        console.error('Failed to fetch careers info:', error);
      }
    };
    
    const checkConnection = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);
        setIsConnected(response.ok);
      } catch (error) {
        setIsConnected(false);
        console.error('Backend connection failed:', error);
      }
    };
    fetchCareersInfo();
    checkConnection();
  }, []);

  const getUserId = () => {
    if (!window.cciUserId) {
      window.cciUserId = 'user_' + Math.random().toString(36).substr(2, 9);
    }
    return window.cciUserId;
  };

  const userId = getUserId();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let interval;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingDuration(prev => prev + 100);
      }, 100);
    } else {
      setRecordingDuration(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const generateTTSForMessage = async (text, messageId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/generate-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'alloy' })
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.audio_response) {
        const audioBlob = new Blob([Uint8Array.from(atob(data.audio_response), c => c.charCodeAt(0))], { type: 'audio/mp3' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setMessages(prev => prev.map(msg => 
          msg.id === messageId ? { ...msg, audio_url: audioUrl } : msg
        ));
        return audioUrl;
      }
      return null;
    } catch (error) {
      console.error('TTS generation failed:', error);
      setMessages(prev => [...prev, {
        id: messages.length + 1,
        text: "Failed to generate audio for this message. Please try again.",
        sender: 'bot',
        timestamp: new Date().toISOString()
      }]);
      return null;
    }
  };

  const sendMessageToAPI = async (message) => {
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, user_id: userId, is_voice: false, generate_tts: false })
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return {
        ...data,
        audio_response: null,
        requires_customer_info: data.requires_customer_info || false,
        missing_fields: data.missing_fields || [],
        customer_info_complete: data.customer_info_complete || false
      };
    } catch (error) {
      console.error('API call failed:', error);
      return {
        response: "I'm sorry, I'm having trouble connecting to the server. Please check if the backend is running.",
        timestamp: new Date().toISOString(),
        suggested_questions: [],
        requires_customer_info: false,
        missing_fields: [],
        audio_url: null
      };
    }
  };

  const sendVoiceToAPI = async (audioBlob) => {
    try {
      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
      });
      reader.readAsDataURL(audioBlob);
      const base64data = await base64Promise;

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "", user_id: userId, is_voice: true, audio_data: base64data, generate_tts: false })
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return {
        ...data,
        requires_customer_info: data.requires_customer_info || false,
        missing_fields: data.missing_fields || [],
        customer_info_complete: data.customer_info_complete || false
      };
    } catch (error) {
      console.error('Voice API call failed:', error);
      setMessages(prev => [...prev, {
        id: messages.length + 1,
        text: `I'm sorry, I couldn't process your voice input: ${error.message}. Please ensure your microphone is working, speak clearly, and try again, or type your message.`,
        sender: 'bot',
        timestamp: new Date().toISOString()
      }]);
      return null;
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || isProcessing) return;

    setIsProcessing(true);
    const userMessage = { id: messages.length + 1, text: inputText, sender: 'user', timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputText;
    setInputText('');
    setIsTyping(true);

    const apiResponse = await sendMessageToAPI(currentInput);

    setRequiresCustomerInfo(apiResponse.requires_customer_info);
    setMissingFields(apiResponse.missing_fields);

    setTimeout(() => {
      const botResponse = {
        id: messages.length + 2,
        text: apiResponse.response,
        sender: 'bot',
        timestamp: apiResponse.timestamp,
        audio_url: null
      };
      setMessages(prev => [...prev, botResponse]);
      setSuggestedQuestions(apiResponse.suggested_questions || []);
      setIsTyping(false);
      setIsProcessing(false);
    }, 1000);
  };

  const startRecording = async () => {
    if (isProcessing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 44100,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      });
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.start(100);
      mediaRecorderRef.current = { stream, mediaRecorder };
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error.name, error.message);
      setIsRecording(false);
      setMessages(prev => [...prev, {
        id: messages.length + 1,
        text: `Failed to access microphone: ${error.message}. Please check permissions and ensure your microphone is connected.`,
        sender: 'bot',
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !isRecording || isProcessing) return;

    setIsProcessing(true);
    const { stream, mediaRecorder } = mediaRecorderRef.current;
    const durationMs = Date.now() - recordingStartTimeRef.current;

    if (durationMs < MIN_RECORDING_DURATION) {
      setIsRecording(false);
      setMessages(prev => [...prev, {
        id: messages.length + 1,
        text: "Recording too short. Please record for at least 1 second.",
        sender: 'bot',
        timestamp: new Date().toISOString()
      }]);
      stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
      setIsProcessing(false);
      return;
    }

    const stopPromise = new Promise(resolve => {
      mediaRecorder.onstop = () => resolve(new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' }));
    });

    mediaRecorder.stop();
    stream.getTracks().forEach(track => track.stop());
    setIsRecording(false);

    const userMessage = { id: messages.length + 1, text: "Processing voice message...", sender: 'user', timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const audioBlob = await stopPromise;
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioData = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioData);
      const wavBlob = await convertToWav(audioBuffer);

      const apiResponse = await sendVoiceToAPI(wavBlob);
      if (!apiResponse) {
        setIsTyping(false);
        setIsProcessing(false);
        return;
      }

      setRequiresCustomerInfo(apiResponse.requires_customer_info);
      setMissingFields(apiResponse.missing_fields);

      setTimeout(() => {
        const botResponse = {
          id: messages.length + 2,
          text: apiResponse.response,
          sender: 'bot',
          timestamp: apiResponse.timestamp,
          audio_url: null,
        };
        setMessages(prev => [
          ...prev.slice(0, -1),
          { ...prev[prev.length - 1], text: apiResponse.transcribed_text || "Voice message processed" },
          botResponse
        ]);
        setSuggestedQuestions(apiResponse.suggested_questions || []);
        setIsTyping(false);
        setIsProcessing(false);
      }, 1000);
    } catch (error) {
      console.error('Error processing audio:', error);
      setMessages(prev => [...prev, {
        id: messages.length + 1,
        text: "Error processing audio. Please try again or type your message.",
        sender: 'bot',
        timestamp: new Date().toISOString()
      }]);
      setIsTyping(false);
      setIsProcessing(false);
    } finally {
      mediaRecorderRef.current = null;
    }
  };

  const convertToWav = async (audioBuffer) => {
    const numChannels = 1;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1;
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = audioBuffer.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const channelData = audioBuffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < channelData.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  };

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const toggleAudio = async (messageId) => {
    if (audioRef.current) {
      const message = messages.find(msg => msg.id === messageId);
      if (isPlaying && currentPlayingMessageId === messageId) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlaying(false);
        setCurrentPlayingMessageId(null);
      } else if (message && message.audio_url) {
        audioRef.current.src = message.audio_url;
        audioRef.current.play().catch(err => console.error('Audio play failed:', err));
        setIsPlaying(true);
        setCurrentPlayingMessageId(messageId);
      } else if (message && !message.audio_url) {
        const audioUrl = await generateTTSForMessage(message.text, messageId);
        if (audioUrl) {
          audioRef.current.src = audioUrl;
          audioRef.current.play().catch(err => console.error('Audio play failed:', err));
          setIsPlaying(true);
          setCurrentPlayingMessageId(messageId);
        }
      }
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickQuestion = (question) => {
    setInputText(question);
  };

  const clearConversation = async () => {
    try {
      await fetch(`${API_BASE_URL}/users/${userId}`, { method: 'DELETE' });
      setMessages([{
        id: 1,
        text: "Hello! I'm your CCI Global assistant. I can help you with information about our BPO services, locations, industries we serve, and more. What would you like to know?",
        sender: 'bot',
        timestamp: new Date().toISOString()
      }]);
      setSuggestedQuestions([]);
      setAudioUrl(null);
      setIsPlaying(false);
      setRequiresCustomerInfo(false);
      setMissingFields([]);
      setHasConfirmed(false);
      setIsProcessing(false);
    } catch (error) {
      console.error('Failed to clear conversation:', error);
    }
  };

  const exportConversation = () => {
    const conversationText = messages.map(msg =>
      `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.sender.toUpperCase()}: ${msg.text}${msg.audio_url ? ' [Audio Response]' : ''}`
    ).join('\n\n');
    const blob = new Blob([conversationText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cci-global-chat-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const quickQuestions = [
    "What services do you offer?",
    "Where are your offices located?",
    "What industries do you serve?",
    "Why choose CCI Global?",
    "How can I contact you?",
    "Tell me about your recent expansion",
    "What career opportunities do you have?"
  ];

  const toggleCareers = async () => {
    if (!showCareers) {
      try {
        const response = await fetch(`${API_BASE_URL}/careers-info`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch careers info');
        const data = await response.json();
        setCareersInfo(data || {});
      } catch (error) {
        console.error('Failed to fetch careers info:', error);
        setCareersInfo({ text: "Sorry, I couldn't fetch career opportunities. Please try again or contact careers@cci.com." });
      }
    }
    setShowCareers(!showCareers);
  };

  return (
    <div className="min-h-screen bg-blue-900 text-white flex flex-col">
      <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 shadow-lg border-b border-blue-800 sticky top-0 z-50">
        <div className="flex items-center justify-between p-2 transition-all duration-300 ease-in-out hover:shadow-xl">
          <div className="flex items-center space-x-3 animate-slide-in-left">
            <div className="w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center">
              <img src="/white-Logo-cci-global.png" alt="CCI Global Logo" className="w-full h-full object-contain transition-transform duration-300 hover:scale-105" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg sm:text-xl font-bold text-white animate-pulse-slow">CCI Global ChatBOT</h1>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-orange-500' : 'bg-red-500'} animate-ping`}></div>
                <span className="text-sm text-gray-300">{isConnected ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleCareers}
              className="p-2 text-gray-300 hover:bg-blue-600 rounded-lg transition-all duration-200 hover:scale-110"
              title="View Careers"
            >
              <Briefcase className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowStats(!showStats)}
              className="p-2 text-gray-300 hover:bg-blue-600 rounded-lg transition-all duration-200 hover:scale-110 md:hidden"
            >
              <Menu className="w-6 h-6" />
            </button>
            <button
              onClick={exportConversation}
              className="p-2 text-gray-300 hover:bg-blue-600 rounded-lg transition-all duration-200 hover:scale-110"
              title="Export Chat"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={clearConversation}
              className="p-2 text-gray-300 hover:bg-blue-600 rounded-lg transition-all duration-200 hover:scale-110"
              title="Clear Chat"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className={`${showStats || !isMobile ? 'block' : 'hidden'} bg-blue-800 text-white p-2 transition-opacity duration-300 ease-in-out`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div className="space-y-1">
              <Users className="w-6 h-6 mx-auto opacity-80 text-gray-200" />
              <div className="text-sm font-semibold text-white">15,000+</div>
              <div className="text-xs opacity-80 text-gray-300">Staff</div>
            </div>
            <div className="space-y-1">
              <Briefcase className="w-6 h-6 mx-auto opacity-80 text-gray-200" />
              <div className="text-sm font-semibold text-white">80+</div>
              <div className="text-xs opacity-80 text-gray-300">Clients</div>
            </div>
            <div className="space-y-1">
              <Award className="w-6 h-6 mx-auto opacity-80 text-gray-200" />
              <div className="text-sm font-semibold text-white">Top Tier</div>
              <div className="text-xs opacity-80 text-gray-300">BPO</div>
            </div>
          </div>
        </div>
        {showCareers && (
          <div className="p-2 bg-blue-900 border-t border-blue-800 transition-opacity duration-300 ease-in-out">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-lg font-semibold text-white">Career Opportunities</h2>
              <button onClick={toggleCareers} className="text-gray-300 hover:text-white transition-colors duration-200">
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-gray-300">{careersInfo.text || "Loading career information..."}</p>
          </div>
        )}
        <div className="p-2 bg-blue-900 border-t border-blue-800 transition-opacity duration-300 ease-in-out">
          <div className="flex flex-wrap gap-2">
            {(suggestedQuestions.length > 0 ? suggestedQuestions : quickQuestions.slice(0, isMobile ? 2 : 4)).map((question, index) => (
              <button
                key={index}
                onClick={() => handleQuickQuestion(question)}
                className="px-3 py-1.5 bg-blue-700 text-white rounded-full text-sm border border-blue-600 hover:bg-blue-600 hover:border-blue-500 transition-all duration-200 hover:scale-105"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white text-blue-900">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} px-2`}
            >
              <div
                className={`max-w-[85%] md:max-w-md lg:max-w-lg ${message.sender === 'user'
                    ? 'bg-blue-100 text-blue-900 rounded-l-2xl rounded-tr-2xl rounded-br-md shadow-md border border-blue-200'
                    : 'bg-blue-100 text-blue-900 rounded-r-2xl rounded-tl-2xl rounded-bl-md shadow-md border border-blue-200'
                  } p-3 sm:p-4 relative`}
              >
                <div className="flex items-start space-x-2 sm:space-x-3">
                  {message.sender === 'bot' && (
                    <div className="w-6 h-6 sm:w-8 sm:h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <Bot className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {message.text}
                    </div>
                    {message.sender === 'bot' && (
                      <button
                        onClick={() => toggleAudio(message.id)}
                        className={`mt-2 sm:mt-3 inline-flex items-center space-x-1 sm:space-x-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm transition-colors ${isPlaying && currentPlayingMessageId === message.id
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                      >
                        {isPlaying && currentPlayingMessageId === message.id ? (
                          <>
                            <Pause className="w-3 h-3 sm:w-4 h-4" />
                            <span>Stop</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3 sm:w-4 h-4" />
                            <span>{message.audio_url ? 'Play' : 'Speak'}</span>
                          </>
                        )}
                      </button>
                    )}
                    <div className={`text-xs mt-1 sm:mt-2 text-blue-700`}>
                      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {message.sender === 'user' && (
                    <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <User className="w-3 h-3 sm:w-4 h-4 text-gray-700" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start px-2">
              <div className="bg-blue-100 rounded-r-2xl rounded-tl-2xl rounded-bl-md shadow-md border border-blue-200 p-3 sm:p-4">
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-blue-600 rounded-full flex items-center justify-center">
                    <Bot className="w-3 h-3 sm:w-4 h-4 text-white" />
                  </div>
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-400 rounded-full animate-bounce"></div>
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>
      <div className="bg-blue-900 border-t border-blue-800 p-3 sm:p-4 sticky bottom-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end space-x-2 sm:space-x-3">
            <div className="flex-1 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="w-full p-2 sm:p-3 pr-10 border border-blue-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm bg-white text-blue-900 placeholder-gray-500"
                rows="1"
                style={{ minHeight: '40px', maxHeight: '100px' }}
                disabled={isRecording}
              />
            </div>
            <div className="relative">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-200 ${isRecording
                    ? 'bg-red-600 text-white hover:bg-red-700 scale-105'
                    : 'bg-blue-700 text-white hover:bg-blue-600'
                  } ${isTyping ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={isTyping}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
              >
                <Mic className={`w-4 h-4 sm:w-5 sm:h-5 ${isRecording ? 'animate-pulse' : ''}`} />
              </button>
              {isRecording && (
                <div className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                  {(recordingDuration / 1000).toFixed(1)}s
                </div>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isTyping || isRecording}
              className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500 text-white rounded-full flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 disabled:hover:bg-blue-500"
            >
              <Send className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
          {!isConnected && (
            <div className="mt-2 p-2 sm:p-3 bg-red-900 border border-red-800 rounded-lg">
              <div className="flex items-center space-x-2 text-red-200">
                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                <span className="text-sm">Connection lost. Please check your internet connection.</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <audio ref={audioRef} hidden onEnded={() => { setIsPlaying(false); setCurrentPlayingMessageId(null); }} />
    </div>
  );
};

export default CCIGlobalChatbot;