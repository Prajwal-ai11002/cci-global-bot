from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from speech_service import SpeechService
from openai import AsyncOpenAI
from pydantic import BaseModel, EmailStr, ValidationError
from typing import List, Dict, Any, Optional
import uvicorn
import openai
from datetime import datetime
import json
import re
import logging
from functools import lru_cache
import os
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CCI Global Dynamic Chatbot API", version="5.1.0")

# Groq API configuration
openai.api_key = os.getenv("GROQ_API_KEY")
openai.api_base = os.getenv("GROQ_API_BASE")

client = AsyncOpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url=os.getenv("GROQ_API_BASE")
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class CustomerInfo(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    is_complete: bool = False
    selected_position: Optional[str] = None
    conversation_context: Dict[str, Any] = {}

class ChatMessage(BaseModel):
    message: str
    user_id: str = "default"
    is_voice: bool = False
    audio_data: Optional[str] = None
    tts_voice: Optional[str] = "alloy"
    generate_tts: bool = False

class ChatResponse(BaseModel):
    response: str
    transcribed_text: str
    timestamp: str
    suggested_questions: List[str] = []
    requires_customer_info: bool = False
    missing_fields: List[str] = []
    audio_response: Optional[str] = None
    customer_info_complete: bool = False
    intent: Optional[str] = None
    confidence: Optional[float] = None

# In-memory storage
conversations: Dict[str, List[Dict[str, Any]]] = {}
customer_data: Dict[str, CustomerInfo] = {}

# Load knowledge base from JSON file
@lru_cache(maxsize=1)
def get_knowledge_base() -> Dict[str, Any]:
    try:
        with open("knowledge_base.json", "r") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.error("Knowledge base file not found")
        raise HTTPException(status_code=500, detail="Knowledge base file not found")
    except json.JSONDecodeError:
        logger.error("Invalid JSON in knowledge base file")
        raise HTTPException(status_code=500, detail="Invalid knowledge base format")

class IntentClassifier:
    """Dynamic intent classification for CCI Global chatbot"""
    
    def __init__(self, knowledge_base: Dict[str, Any]):
        self.client = AsyncOpenAI(
            api_key=os.getenv("GROQ_API_KEY"),
            base_url=os.getenv("GROQ_API_BASE")
        )
        self.knowledge_base = knowledge_base
    
    async def classify_intent(self, user_input: str, conversation_history: List[Dict]) -> Dict[str, Any]:
        """Classify user intent dynamically with context awareness"""
        
        context = ""
        if conversation_history:
            recent_msgs = conversation_history[-3:]
            context = "\n".join([
                f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
                for msg in recent_msgs
            ])
        
        career_keywords = ['join', 'career', 'job', 'position', 'vacancy', 'hiring', 'work', 'employment', 'opportunity', 'want to work']
        user_input_lower = user_input.lower()
        
        # Check context to avoid resetting if already in application process
        if any(keyword in user_input_lower for keyword in ['apply', 'yes', 'how to apply']) and any("selected_position" in str(hist) for hist in conversation_history):
            return {
                "intent": "application_continue",
                "confidence": 0.95,
                "entities": {},
                "requires_info_collection": True,
                "suggested_response_type": "application_step"
            }
        
        if any(keyword in user_input_lower for keyword in career_keywords):
            available_positions = self.knowledge_base.get("careers", {}).get("available_positions", {})
            for position_key, position_data in available_positions.items():
                position_title = position_data.get("title", "").lower()
                if position_title in user_input_lower:
                    return {
                        "intent": "specific_position_inquiry",
                        "confidence": 0.95,
                        "entities": {
                            "job_position": position_data["title"],
                            "position_key": position_key
                        },
                        "requires_info_collection": False,
                        "suggested_response_type": "position_details"
                    }
            
            return {
                "intent": "general_career_inquiry",
                "confidence": 0.9,
                "entities": {},
                "requires_info_collection": False,
                "suggested_response_type": "show_all_positions"
            }
        
        prompt = f"""You are an intent classifier for CCI Global, a BPO services company. 
Analyze the user's message and classify their intent. Return a JSON response with the following structure:

{{
    "intent": "one of: greeting, service_inquiry, support_request, information_gathering, other",
    "confidence": 0.0-1.0,
    "entities": {{
        "service_type": "if mentioned: customer_service, technical_support, omnichannel, digital_transformation, etc.",
        "information_needed": "what specific info they're asking for"
    }},
    "requires_info_collection": false,
    "suggested_response_type": "conversational, informational, detailed_explanation"
}}

Recent conversation context:
{context}

Current user message: "{user_input}"

Guidelines:
- greeting: hi, hello, etc.
- service_inquiry: asking about CCI's services, capabilities, pricing
- support_request: need help with something specific
- information_gathering: asking for general information about CCI
- other: anything else"""

        try:
            response = await self.client.chat.completions.create(
                model="llama3-70b-8192",
                messages=[
                    {"role": "system", "content": "You are an intent classification system. Return only valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=200
            )
            
            result = json.loads(response.choices[0].message.content.strip())
            return result
            
        except Exception as e:
            logger.error(f"Intent classification error: {str(e)}")
            return {
                "intent": "other",
                "confidence": 0.5,
                "entities": {},
                "requires_info_collection": False,
                "suggested_response_type": "conversational"
            }

class DynamicChatbotEngine:
    """Fully dynamic LLM-driven chatbot for CCI Global"""
    
    def __init__(self):
        self.knowledge_base = get_knowledge_base()
        self.intent_classifier = IntentClassifier(self.knowledge_base)
        self.voice_service = SpeechService()
        
    def format_all_positions(self) -> str:
        """Format all available positions concisely"""
        available_positions = self.knowledge_base.get("careers", {}).get("available_positions", {})
        
        if not available_positions:
            return "Sorry, no positions are available right now. Please check back later or visit www.cciglobal.com!"
        
        response_parts = ["Hey! Excited to see you want to work at CCI Global! Here are our current openings:\n"]
        
        for i, (position_key, position_data) in enumerate(available_positions.items(), 1):
            title = position_data.get("title", "Position")
            location = position_data.get("location", "Various locations")
            response_parts.append(f"{i}. {title} - {location}")
        
        response_parts.append("\nWhich one interests you? Just say the number or name, and I’ll give you details or help you apply!")
        
        return "\n".join(response_parts)
    
    def format_position_details(self, position_data: Dict[str, Any]) -> str:
        """Format detailed information about a specific position"""
        title = position_data.get("title", "Position")
        location = position_data.get("location", "Various locations")
        description = position_data.get("description", "Exciting role at CCI Global!")
        
        return f"Cool! Here’s the scoop on the {title} role:\n- Location: {location}\n- Description: {description}\nInterested? Say 'Yes' to apply, or ask me more!"
    
    async def generate_dynamic_response(self, user_input: str, customer_info: CustomerInfo, 
                              user_id: str, intent_data: Dict[str, Any]) -> tuple[str, List[str], bool, List[str]]:
        """Generate dynamic responses based on intent and conversation context"""
        
        intent = intent_data.get("intent", "other")
        entities = intent_data.get("entities", {})
        conversation_history = conversations.get(user_id, [])
        
        name = customer_info.name if customer_info.name else ""
        greeting = f"Hey {name}! " if name else "Hi there! "
        
        if intent == "general_career_inquiry":
            response_text = greeting + self.format_all_positions()
            suggestions = ["1 - Tell me more", "2 - I want to apply", "What skills do you need?"]
            return response_text, suggestions, False, []
        
        elif intent == "specific_position_inquiry":
            job_position = entities.get("job_position")
            position_key = entities.get("position_key")
            
            if not customer_info.selected_position:
                customer_info.selected_position = job_position
                customer_info.conversation_context["application_stage"] = "show_details"
            
            available_positions = self.knowledge_base.get("careers", {}).get("available_positions", {})
            position_data = available_positions.get(position_key, {})
            
            if position_data:
                response_text = greeting + self.format_position_details(position_data)
                suggestions = ["Yes, apply now!", "What are the requirements?", "Show another position"]
                return response_text, suggestions, False, []
        
        elif intent == "application_continue":
            if not customer_info.selected_position:
                response_text = "Oops! It seems you haven’t picked a position yet. Please choose one from: 1. Customer Service Representative or 2. Technical Support Specialist."
                suggestions = ["1 - Customer Service Representative", "2 - Technical Support Specialist", "Show me the list again"]
                return response_text, suggestions, False, []
            
            if not customer_info.conversation_context.get("collecting_info"):
                customer_info.conversation_context["collecting_info"] = True
                customer_info.conversation_context["waiting_for"] = "name"
                response_text = f"Awesome! Let’s get you started for {customer_info.selected_position}. What’s your full name?"
                suggestions = ["My name is [Your Full Name]", "Can I get more details?", "What’s next?"]
                return response_text, suggestions, True, ["name"]
            
            if customer_info.conversation_context.get("collecting_info"):
                waiting_for = customer_info.conversation_context.get("waiting_for")
                
                if waiting_for == "name" and not customer_info.name:
                    if len(user_input.split()) <= 4 and not user_input.lower().startswith(('i', 'my', 'the', 'a', 'can', 'what', 'how')):
                        customer_info.name = user_input.strip()
                        customer_info.conversation_context["waiting_for"] = "phone"
                        response_text = f"Thanks, {customer_info.name}! What’s your phone number?"
                        suggestions = ["My number is [phone number]", "Can we skip this?", "What’s after this?"]
                        return response_text, suggestions, True, ["phone"]
                
                elif waiting_for == "phone" and not customer_info.phone:
                    phone_match = re.search(r'\d{10}', user_input.replace('-', '').replace(' ', '').replace('(', '').replace(')', ''))
                    if phone_match:
                        customer_info.phone = re.sub(r'[^\d+]', '', user_input)
                        customer_info.conversation_context["waiting_for"] = "email"
                        response_text = f"Great, {customer_info.name}! What’s your email address?"
                        suggestions = ["My email is [email address]", "Can we do this later?", "What happens next?"]
                        return response_text, suggestions, True, ["email"]
                
                elif waiting_for == "email" and not customer_info.email:
                    if '@' in user_input and '.' in user_input:
                        try:
                            email_clean = user_input.lower().strip()
                            email_clean = re.sub(r'\bat\b', '@', email_clean, flags=re.IGNORECASE)
                            email_clean = re.sub(r'\bdot\b', '.', email_clean)
                            email_clean = re.sub(r'\s+', '', email_clean)
                            customer_info.email = EmailStr(email_clean)
                            customer_info.is_complete = True
                            customer_info.conversation_context["collecting_info"] = False
                            customer_info.conversation_context["waiting_for"] = None
                            response_text = f"Nice work, {customer_info.name}! Your application for {customer_info.selected_position} is submitted:\n- Name: {customer_info.name}\n- Phone: {customer_info.phone}\n- Email: {customer_info.email}\nOur team will reach out within 3-5 days. Best of luck!"
                            suggestions = ["Thanks!", "When will I hear back?", "Can I apply for another role?"]
                            return response_text, suggestions, False, []
                        except ValidationError:
                            response_text = f"Oops, that email doesn’t look right. Try again, like john@email.com"
                            suggestions = ["My email is [email address]", "Let’s skip this", "What’s next?"]
                            return response_text, suggestions, True, ["email"]
        
        return await self._generate_llm_response(user_input, customer_info, conversation_history, intent_data)
    
    async def _generate_llm_response(self, user_input: str, customer_info: CustomerInfo, 
                                   conversation_history: List[Dict], intent_data: Dict[str, Any]) -> tuple[str, List[str], bool, List[str]]:
        intent = intent_data.get("intent", "other")
        entities = intent_data.get("entities", {})
        
        context = self._build_conversation_context(conversation_history, customer_info)
        relevant_kb = self._extract_relevant_knowledge(intent, entities)
        
        system_prompts = {
            "greeting": "You are a friendly CCI Global representative. Welcome users warmly and ask how you can help.",
            "service_inquiry": "You are a knowledgeable CCI Global sales representative. Provide detailed service information.",
            "support_request": "You are a helpful CCI Global support representative providing assistance.",
            "information_gathering": "You are an informative CCI Global representative sharing accurate company information.",
            "other": "You are a professional CCI Global representative providing helpful assistance."
        }
        
        system_prompt = system_prompts.get(intent, system_prompts["other"])
        
        prompt = f"""{system_prompt}

CURRENT USER MESSAGE: "{user_input}"

CONVERSATION CONTEXT:
{context}

CCI GLOBAL KNOWLEDGE BASE:
{json.dumps(relevant_kb, indent=2)}

RESPONSE GUIDELINES:
1. Be conversational and friendly
2. Use information from the CCI Global knowledge base only
3. Address the user by name if available: {customer_info.name or ''}
4. Keep responses helpful and engaging
5. Always offer to help further
6. Be specific about CCI's services and capabilities
7. Do not ask about background, experience, or skills during the application process
8. Adapt responses based on the current conversation stage (e.g., position selection, application)"""

        try:
            response = await client.chat.completions.create(
                model="llama3-70b-8192",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=250
            )
            
            response_text = response.choices[0].message.content.strip()
            suggestions = await self._generate_dynamic_suggestions(user_input, response_text, intent_data)
            
            return response_text, suggestions, False, []
            
        except Exception as e:
            logger.error(f"LLM response generation error: {str(e)}")
            return (
                f"Hi! I’m here to help with CCI Global. What would you like to know?",
                ["Tell me about your services", "Are you hiring?", "How can you help me?"],
                False,
                []
            )
    
    def _build_conversation_context(self, history: List[Dict], customer_info: CustomerInfo) -> str:
        context_parts = []
        if customer_info.name or customer_info.email or customer_info.phone or customer_info.selected_position:
            context_parts.append("CUSTOMER INFO:")
            if customer_info.name:
                context_parts.append(f"- Name: {customer_info.name}")
            if customer_info.email:
                context_parts.append(f"- Email: {customer_info.email}")
            if customer_info.phone:
                context_parts.append(f"- Phone: {customer_info.phone}")
            if customer_info.selected_position:
                context_parts.append(f"- Interested Position: {customer_info.selected_position}")
        
        if history:
            context_parts.append("\nRECENT CONVERSATION:")
            recent_msgs = history[-3:]
            for msg in recent_msgs:
                role = "Customer" if msg['role'] == 'user' else "CCI Assistant"
                context_parts.append(f"{role}: {msg['content']}")
        
        return "\n".join(context_parts)
    
    def _extract_relevant_knowledge(self, intent: str, entities: Dict[str, Any]) -> Dict[str, Any]:
        relevant_sections = {}
        relevant_sections["company"] = self.knowledge_base.get("company", {})
        relevant_sections["contact_info"] = self.knowledge_base.get("contact_info", {})
        
        if intent == "service_inquiry":
            relevant_sections["services"] = self.knowledge_base.get("services", {})
            relevant_sections["industries"] = self.knowledge_base.get("industries", [])
            relevant_sections["locations"] = self.knowledge_base.get("locations", {})
            
        elif "career" in intent or intent == "application_continue":
            relevant_sections["careers"] = self.knowledge_base.get("careers", {})
            relevant_sections["locations"] = self.knowledge_base.get("locations", {})
            
        elif intent == "information_gathering":
            relevant_sections["services"] = self.knowledge_base.get("services", {})
            relevant_sections["team"] = self.knowledge_base.get("team", {})
            relevant_sections["locations"] = self.knowledge_base.get("locations", {})
            
        else:
            relevant_sections["services"] = self.knowledge_base.get("services", {})
        
        return relevant_sections
    
    async def _generate_dynamic_suggestions(self, user_input: str, response_text: str, 
                                          intent_data: Dict[str, Any]) -> List[str]:
        intent = intent_data.get("intent", "other")
        
        suggestions_map = {
            "greeting": ["What services do you offer?", "Are you hiring?", "Tell me about CCI Global"],
            "service_inquiry": ["What industries do you serve?", "How do you ensure quality?", "What’s your process?"],
            "general_career_inquiry": ["1 - Tell me more", "2 - I want to apply", "What skills do you need?"],
            "specific_position_inquiry": ["Yes, apply now!", "What are the requirements?", "Show another position"],
            "application_continue": ["My name is [Your Full Name]", "Can I get more details?", "What’s next?"]
        }
        
        return suggestions_map.get(intent, ["How can I help you?", "Tell me about your services", "Are there jobs?"])
    
    async def get_response(self, user_input: str, customer_info: CustomerInfo, user_id: str) -> tuple[str, List[str], bool, List[str]]:
        try:
            conversation_history = conversations.get(user_id, [])
            intent_data = await self.intent_classifier.classify_intent(user_input, conversation_history)
            
            response_text, suggested_questions, needs_info, missing_fields = await self.generate_dynamic_response(
                user_input, customer_info, user_id, intent_data
            )
            
            customer_info.conversation_context["last_intent"] = intent_data
            
            return response_text, suggested_questions, needs_info, missing_fields
            
        except Exception as e:
            logger.error(f"Error in get_response: {str(e)}")
            return (
                f"Sorry, something went wrong. Contact support@cciglobal.com for help.",
                ["Try again", "Tell me about CCI", "Need support?"],
                False,
                []
            )

# Initialize chatbot
chatbot = DynamicChatbotEngine()
voice_service = SpeechService()

def correct_email_pattern(text: str) -> str:
    if not text or not isinstance(text, str):
        return text
    
    if re.search(r'\bat\b.*\bdot\b', text, flags=re.IGNORECASE):
        text = re.sub(r'\bat\b', '@', text, flags=re.IGNORECASE)
        text = re.sub(r'\bdot\b', '.', text)
        text = re.sub(r'\s*@\s*', '@', text)
        text = re.sub(r'\s*\.\s*', '.', text)
    return text.strip()

@app.get("/")
async def root():
    return {"message": "CCI Global Dynamic Chatbot API v5.1.0 - Fully Dynamic & Context-Aware"}

@app.post("/generate_tts")
async def generate_tts(request: dict):
    try:
        text = request.get("text")
        voice = request.get("voice", "alloy")
        
        if not text:
            raise HTTPException(status_code=400, detail="Text is required")
        
        audio_response = voice_service.text_to_speech(text, voice=voice)
        
        return {
            "audio_response": audio_response,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"TTS generation error: {str(e)}")
        raise HTTPException(status_code=500, detail="TTS generation failed")

@app.post("/chat", response_model=ChatResponse)
async def chat(message: ChatMessage):
    try:
        user_id = message.user_id
        user_message = message.message.strip()

        if message.is_voice and message.audio_data:
            user_message = voice_service.speech_to_text(message.audio_data)
            logger.info(f"Converted speech to text: {user_message}")
            user_message = correct_email_pattern(user_message)

        if user_id not in conversations:
            conversations[user_id] = []
        if user_id not in customer_data:
            customer_data[user_id] = CustomerInfo()

        conversations[user_id].append({
            "role": "user",
            "content": user_message,
            "timestamp": datetime.now().isoformat()
        })

        customer_info = customer_data[user_id]
        response_text, suggestions, requires_info, missing_fields = await chatbot.get_response(
            user_message, customer_info, user_id
        )

        audio_response = None
        if message.generate_tts:
            audio_response = voice_service.text_to_speech(response_text, voice=message.tts_voice)

        conversations[user_id].append({
            "role": "assistant",
            "content": response_text,
            "timestamp": datetime.now().isoformat()
        })

        intent_info = customer_info.conversation_context.get("last_intent", {})

        return ChatResponse(
            response=response_text,
            transcribed_text=user_message,
            timestamp=datetime.now().isoformat(),
            suggested_questions=suggestions,
            requires_customer_info=requires_info,
            missing_fields=missing_fields,
            audio_response=audio_response,
            customer_info_complete=customer_info.is_complete,
            intent=intent_info.get("intent"),
            confidence=intent_info.get("confidence")
        )

    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while processing your request.")

@app.get("/conversation/{user_id}")
async def get_conversation(user_id: str):
    return {
        "messages": conversations.get(user_id, []),
        "customer_info": customer_data.get(user_id, CustomerInfo())
    }

@app.delete("/users/{user_id}")
async def clear_users(user_id: str):
    conversations[user_id] = []
    customer_data[user_id] = CustomerInfo()
    return {"message": "Conversation cleared"}

@app.get("/health")
async def get_health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)