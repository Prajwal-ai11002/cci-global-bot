import openai
import base64
import io
from typing import Optional
import tempfile
import os
import logging
import wave
import contextlib
import numpy as np
from pydub import AudioSegment
import httpx
from dotenv import load_dotenv

load_dotenv()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SpeechService:
    def __init__(self):
        try:
            # Create a custom httpx client without proxies
            http_client = httpx.Client(
                timeout=30.0,
                verify=True
            )
            
            # Initialize with Groq API credentials using the custom client
            self.client = openai.OpenAI(
                api_key=os.getenv("GROQ_API_KEY"),
                base_url=os.getenv("GROQ_API_BASE"),
                http_client=http_client
            )
            logger.info("SpeechService initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize SpeechService: {str(e)}")
            raise

    def validate_audio_file(self, audio_bytes: bytes, file_path: str) -> tuple[bool, str]:
        """
        Validate audio file for size and duration
        Returns: (is_valid, error_message)
        """
        try:
            # Check file size (minimum 1KB)
            if len(audio_bytes) < 1024:
                return False, f"Audio file too small: {len(audio_bytes)} bytes. Minimum size should be 1KB."

            # Try to get audio duration using pydub
            try:
                audio = AudioSegment.from_file(file_path)
                duration_seconds = len(audio) / 1000.0  # Convert milliseconds to seconds
                
                if duration_seconds < 0.1:  # Minimum 100ms
                    return False, f"Audio duration too short: {duration_seconds:.2f} seconds. Minimum duration should be 0.1 seconds."
                
                logger.info(f"Audio file validation: size={len(audio_bytes)} bytes, duration={duration_seconds:.2f} seconds")
                return True, ""
                
            except Exception as e:
                logger.warning(f"Could not validate audio duration: {str(e)}")
                # If we can't validate duration, at least check the file size
                if len(audio_bytes) < 1024:
                    return False, f"Audio file too small: {len(audio_bytes)} bytes. Minimum size should be 1KB."
                return True, ""

        except Exception as e:
            return False, f"Error validating audio file: {str(e)}"

    def speech_to_text(self, audio_data: str) -> str:
        """
        Convert speech to text using Groq's Whisper model.
        
        Args:
            audio_data (str): Base64 encoded audio data
            
        Returns:
            str: Transcribed text
        """
        temp_audio_path = None
        try:
            # Validate input
            if not audio_data:
                raise ValueError("No audio data provided")

            # Decode base64 audio data
            try:
                audio_bytes = base64.b64decode(audio_data)
                logger.info(f"Successfully decoded base64 audio data, size: {len(audio_bytes)} bytes")
            except Exception as e:
                logger.error(f"Failed to decode base64 audio data: {str(e)}")
                raise ValueError("Invalid base64 audio data")

            # Create a temporary file to store the audio
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_audio:
                    temp_audio.write(audio_bytes)
                    temp_audio_path = temp_audio.name
                logger.info(f"Created temporary audio file at: {temp_audio_path}")
            except Exception as e:
                logger.error(f"Failed to create temporary audio file: {str(e)}")
                raise

            # Validate the audio file
            is_valid, error_message = self.validate_audio_file(audio_bytes, temp_audio_path)
            if not is_valid:
                raise ValueError(error_message)

            # Open the audio file and transcribe using Whisper
            try:
                with open(temp_audio_path, 'rb') as audio_file:
                    logger.info("Sending request to Whisper API")
                    transcription = self.client.audio.transcriptions.create(
                        model="whisper-large-v3",
                        file=audio_file,
                        
                        response_format="text"
                    )
                    logger.info("Successfully received transcription from Whisper API")
                    print("Transcription:", transcription.strip())
                    return transcription.strip()
            except openai.APIError as e:
                logger.error(f"Whisper API error: {str(e)}")
                raise Exception(f"Whisper API error: {str(e)}")
            except Exception as e:
                logger.error(f"Error during transcription: {str(e)}")
                raise

        except Exception as e:
            logger.error(f"Speech-to-text conversion failed: {str(e)}")
            raise Exception(f"Speech-to-text conversion failed: {str(e)}")
            
        finally:
            # Clean up the temporary file
            if temp_audio_path and os.path.exists(temp_audio_path):
                try:
                    os.unlink(temp_audio_path)
                    logger.info(f"Cleaned up temporary file: {temp_audio_path}")
                except Exception as e:
                    logger.warning(f"Failed to clean up temporary file {temp_audio_path}: {str(e)}")

    def text_to_speech(self, text: str, voice: str = "Mikail-PlayAI") -> str:

        """
        currently not working  
        using responsivevoice / responsivevoice.js in frontend only 
        """
        try:
            if not text:
                raise ValueError("No text provided for text-to-speech conversion")
            voice=  "Aaliyah-PlayAI"

            logger.info(f"Converting text to speech using voice: {voice}")
            # return "0000000000000000000"
            # Call the text-to-speech API
            response = self.client.audio.speech.create(
                model="playai-tts",
                voice=voice,
                input=text,
                response_format="mp3"
            )
            
            # Convert the response to base64
            audio_data = response.content
            base64_audio = base64.b64encode(audio_data).decode('utf-8')
            
            logger.info("Successfully generated speech from text")
            return base64_audio
            
        except Exception as e:
            logger.error(f"Text-to-speech conversion failed: {str(e)}")
            raise Exception(f"Text-to-speech conversion failed: {str(e)}") 