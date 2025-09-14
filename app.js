/**
 * Vision Point WhatsApp Automation Bot
 * 
 * Setup Instructions:
 * 1) npm init -y
 * 2) npm i @whiskeysockets/baileys pino qrcode-terminal axios dotenv fs-extra path
 * 3) Create .env with:
 *    PERPLEXITY_API_KEY=your_key
 *    ELEVENLABS_API_KEY=your_key
 *    ELEVENLABS_VOICE_ID=your_voice_id
 *    SESSION_DIR=./session
 * 4) node app.js
 * 5) Scan QR code
 * 6) Ensure groups exist: "Content", "Demo script", "Demo visual"
 */

require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Environment variables
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || 'your_perplexity_api_key_here';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'your_elevenlabs_api_key_here';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'your_voice_id_here'; // Female anchor voice ID
// Using only Perplexity and ElevenLabs APIs as requested
const SESSION_DIR = process.env.SESSION_DIR || './session';

// Ensure output directory exists
fs.ensureDirSync('./output/voiceovers');

// Logger
const logger = pino({ level: 'info' });

// Group JIDs storage
let groupJIDs = {
  content: null,
  demoScript: null,
  demoVisual: null
};

// WhatsApp socket
let sock;

// Store current headlines for number selection
let currentHeadlines = {};

/**
 * Initialize WhatsApp connection
 */
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['Vision Point Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('\n🔗 Scan QR Code:');
      qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) ?
        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
      
      logger.info('Connection closed due to', lastDisconnect?.error, ', reconnecting', shouldReconnect);
      
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      logger.info('✅ WhatsApp connected successfully!');
      findGroupJIDs();
    }
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', handleIncomingMessages);
}

/**
 * Find and store group JIDs by name
 */
async function findGroupJIDs() {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups);
    
    for (const group of groupList) {
      const groupName = group.subject?.toLowerCase();
      
      if (groupName === 'content') {
        groupJIDs.content = group.id;
        logger.info(`📝 Found "Content" group: ${group.id}`);
      } else if (groupName === 'demo script') {
        groupJIDs.demoScript = group.id;
        logger.info(`📄 Found "Demo script" group: ${group.id}`);
      } else if (groupName === 'demo visual') {
        groupJIDs.demoVisual = group.id;
        logger.info(`🖼️ Found "Demo visual" group: ${group.id}`);
      }
    }
    
    // Validate all groups found
    const missingGroups = [];
    if (!groupJIDs.content) missingGroups.push('Content');
    if (!groupJIDs.demoScript) missingGroups.push('Demo script');
    if (!groupJIDs.demoVisual) missingGroups.push('Demo visual');
    
    if (missingGroups.length > 0) {
      logger.error(`❌ Missing groups: ${missingGroups.join(', ')}`);
      process.exit(1);
    }
    
    logger.info('🎯 All required groups found! Bot is ready.');
  } catch (error) {
    logger.error('Error finding groups:', error);
  }
}

/**
 * Handle incoming WhatsApp messages
 */
async function handleIncomingMessages(m) {
  try {
    const message = m.messages[0];
    if (!message || message.key.fromMe) return;
    
    const messageText = message.message?.conversation || 
                       message.message?.extendedTextMessage?.text;
    
    // Check for voice message in Content group
    const audioMessage = message.message?.audioMessage;
    
    // Debug logging
    console.log('📨 Received message:');
    console.log('- Remote JID:', message.key.remoteJid);
    console.log('- Content group JID:', groupJIDs.content);
    console.log('- Message text:', messageText);
    console.log('- Has audio:', !!audioMessage);
    console.log('- Is from Content group:', message.key.remoteJid === groupJIDs.content);
    
    // Handle voice messages in Content group
    if (audioMessage && message.key.remoteJid === groupJIDs.content) {
      console.log('🎤 Voice message detected in Content group');
      logger.info('🎤 Processing voice message from Content group...');
      await handleVoiceMessage(message, message.key.id, message.key.remoteJid);
      return;
    }
    
    // Check if message has text content
    if (messageText && messageText.trim().length > 0) {
      
      // Parse command type and content first
      const commandResult = parseCommand(messageText);
      console.log('🔍 Command parsing result:', commandResult);
      
      // Handle all commands from any chat (personal or group)
      if (commandResult && (commandResult.type === 'script' || commandResult.type === 'voice' || commandResult.type === 'voice_person' || commandResult.type === 'visuals' || commandResult.type === 'topic' || commandResult.type === 'agenda' || commandResult.type === 'number')) {
        console.log(`✅ Processing ${commandResult.type} command from any chat`);
        logger.info(`🎯 ${commandResult.type.toUpperCase()} command received: ${messageText.substring(0, 100)}...`);
        await handleCommand(commandResult, message.key.id, message.key.remoteJid);
        return;
      }
      
      // Handle non-command messages only from Content group (treat as editorial content)
      if (message.key.remoteJid === groupJIDs.content) {
        logger.info(`📨 New message in Content group: ${messageText.substring(0, 100)}...`);
        
        if (!commandResult) {
          console.log('📝 No command detected, treating as editorial content');
          // Default behavior - treat as editorial content
          await processEditorial(messageText, message.key.id);
        }
      } else {
        console.log('❌ Non-command message not from Content group - ignoring');
      }
    } else {
      console.log('❌ Message not processed - empty text');
    }
  } catch (error) {
    logger.error('Error handling message:', error);
  }
}

/**
 * Handle voice messages from Content group
 */
async function handleVoiceMessage(message, messageId, remoteJid) {
  try {
    logger.info('🎤 Starting voice message processing...');
    
    // Download the audio file
    const audioBuffer = await downloadMediaMessage(message, 'buffer', {}, {
      logger,
      reuploadRequest: sock.updateMediaMessage
    });
    
    if (!audioBuffer) {
      logger.error('❌ Failed to download audio message');
      return;
    }
    
    // Save audio file temporarily
    const tempAudioPath = path.join('./output/voiceovers', `temp_${Date.now()}.ogg`);
    await fs.writeFile(tempAudioPath, audioBuffer);
    logger.info(`💾 Audio saved temporarily: ${tempAudioPath}`);
    
    // Transcribe audio to text
    const transcribedText = await transcribeAudio(tempAudioPath);
    
    if (!transcribedText) {
      logger.error('❌ Failed to transcribe audio message');
      // Clean up temp file
      await fs.unlink(tempAudioPath);
      return;
    }
    
    logger.info(`📝 Transcribed text: ${transcribedText.substring(0, 100)}...`);
    
    // Process transcribed text through Perplexity as editorial content
    await processEditorial(transcribedText, messageId);
    
    // Clean up temp file
    await fs.unlink(tempAudioPath);
    logger.info('🗑️ Temporary audio file cleaned up');
    
  } catch (error) {
    logger.error('Error handling voice message:', error);
    console.error('🚨 Voice message error details:', error.message);
    console.error('🚨 Error stack:', error.stack);
  }
}

/**
 * Handle voice messages - Simple fallback without external transcription APIs
 */
async function transcribeAudio(audioFilePath) {
  try {
    logger.info('🎤 Processing voice message...');
    
    const fs = require('fs');
    
    // Check if audio file exists
    if (!fs.existsSync(audioFilePath)) {
      throw new Error('Audio file not found');
    }
    
    // Since you don't want external APIs, provide helpful guidance
    logger.info('📝 Voice message received - requesting text format for better processing');
    
    return `🎤 آپ کا آڈیو میسج موصول ہوا!

📝 بہتر نتائج کے لیے، براہ کرم اپنا مواد ٹیکسٹ میں بھیجیں:

• script: UN meeting between Pakistan and Israel
• topic: کوئی بھی موضوع

✨ یہ طریقہ زیادہ درست نتائج دیتا ہے!`;
    
  } catch (error) {
    logger.error('Error handling voice message:', error.message);
    
    // Fallback message
    logger.warn('🔄 Using fallback message for voice handling error');
    return 'معذرت، آڈیو میسج پروسیس کرنے میں خرابی ہوئی۔ براہ کرم اپنا مواد ٹیکسٹ میں بھیجیں۔';
  }
}

/**
 * Parse command from message text
 */
function parseCommand(messageText) {
  const text = messageText.trim();
  
  // Check for topic command (flexible format: topic:, Topic:, Topic :, topic :)
  const topicMatch = text.match(/^topic\s*:\s*([\s\S]+)$/i);
  if (topicMatch) {
    return {
      type: 'topic',
      content: topicMatch[1].trim()
    };
  }
  
  // Check for script command (flexible format: script:, Script:, Script :, script :)
  const scriptMatch = text.match(/^script\s*:\s*([\s\S]+)$/i);
  if (scriptMatch) {
    return {
      type: 'script',
      content: scriptMatch[1].trim()
    };
  }
  
  // Check for visuals command (flexible format: visuals:, Visuals:, Visuals :, visuals :)
  const visualsMatch = text.match(/^visuals\s*:\s*([\s\S]+)$/i);
  if (visualsMatch) {
    return {
      type: 'visuals',
      content: visualsMatch[1].trim()
    };
  }
  
  // Check for voice with specific person (e.g., "voice musawar abbasi: ...", "Voice Musawar Abbasi : ...")
  const voicePersonMatch = text.match(/^voice\s+([^:]+)\s*:\s*([\s\S]+)$/i);
  if (voicePersonMatch) {
    return {
      type: 'voice_person',
      voiceName: voicePersonMatch[1].trim(),
      content: voicePersonMatch[2].trim()
    };
  }
  
  // Check for general voice command (flexible format: voice:, Voice:, Voice :, voice :)
  const voiceMatch = text.match(/^voice\s*:\s*([\s\S]+)$/i);
  if (voiceMatch) {
    return {
      type: 'voice',
      content: voiceMatch[1].trim()
    };
  }
  
  // Check for agenda command (flexible format: agenda, Agenda)
  if (text.match(/^agenda$/i)) {
    return {
      type: 'agenda'
    };
  }
  
  // Check for number command (1-10 for headline selection)
  const numberMatch = text.match(/^(\d+)$/);
  if (numberMatch) {
    const num = parseInt(numberMatch[1]);
    if (num >= 1 && num <= 10) {
      return {
        type: 'number',
        number: num
      };
    }
  }
  
  return null; // No command detected
}

/**
 * Handle different command types
 */
async function handleCommand(commandResult, messageId, remoteJid) {
  try {
    switch (commandResult.type) {
      case 'topic':
        logger.info('🎯 Processing topic command...');
        await processEditorial(commandResult.content, messageId);
        break;
        
      case 'script':
        logger.info('📝 Processing script-only command...');
        await processScriptOnly(commandResult.content, messageId, remoteJid);
        break;
        
      case 'visuals':
        logger.info('🎨 Processing visuals-only command...');
        await processVisualsOnly(commandResult.content, messageId, remoteJid);
        break;
        
      case 'voice':
        logger.info('🎤 Processing voice command with default voice...');
        await processVoiceOnly(commandResult.content, messageId, remoteJid);
        break;
        
      case 'voice_person':
        logger.info(`🎤 Processing voice command with ${commandResult.voiceName}...`);
        await processVoiceWithPerson(commandResult.content, commandResult.voiceName, messageId, remoteJid);
        break;
        
      case 'agenda':
        logger.info('📰 Processing agenda command...');
        await processAgenda(messageId, remoteJid);
        break;
        
      case 'number':
        logger.info(`🔢 Processing number command: ${commandResult.number}`);
        await processHeadlineSelection(commandResult.number, messageId, remoteJid);
        break;
        
      default:
        logger.warn(`Unknown command type: ${commandResult.type}`);
        break;
    }
  } catch (error) {
    logger.error('Error handling command:', error);
  }
}

/**
 * Process script-only command
 */
async function processScriptOnly(content, messageId, remoteJid) {
  try {
    logger.info('📝 Generating script only...');
    
    const MASTER_PROMPT = `You are an AI Script Generator for Vision Point — a bold pro-Pakistan Urdu digital news channel. 
Your job is to monitor every incoming message in this WhatsApp group and create relevant news scripts based on the actual content provided.

Your task: 
1. Take the input message as the BASE NEWS ITEM. 
2. Create a FULL URDU SCRIPT in Vision Point style that focuses on the ACTUAL TOPIC mentioned in the base news item.
3. Script must always follow these rules: 
   - Length: Minimum 1300 words (9-minute monologue when spoken). 
   - Heading: Only ONE main subject heading (never more). 
   - Language: Urdu, spoken-anchor style, intellectual yet simple and emotional. 
   - Narrative: Focus on the actual topic provided. If it's about India, be critical of Modi/BJP/RSS. If it's about China-USA relations, focus on that. If it's about other countries, cover those topics appropriately.
   - Pakistani Perspective: Always provide analysis from Pakistan's strategic viewpoint and national interests.
   - Depth: Expand on the context with additional researched details, historic parallels, and global perspective relevant to the actual topic.
   - Tone: Serious, journalistic, research-based, emotional where needed, but always professional. 

4. DO NOT force India-related content if the base news item is about other topics. Focus on what's actually provided.
5. DO NOT summarize only — always expand into a full-fledged script with analysis, critique, narrative-building, and rhetorical questions for engagement. 

Output Format: 
- Start with ONE main heading (title of the script). 
- Then full monologue body text in Urdu. 

Your Goal: 
To automatically generate powerful, viral-ready Vision Point scripts that accurately reflect the input topic while maintaining Pakistan's perspective.`;
    
    const scriptPrompt = `${MASTER_PROMPT}\n\nBase News Item: ${content}`;
    
    const response = await callPerplexityAPI(scriptPrompt);
    
    if (response) {
      // Send script directly to the user
      await sock.sendMessage(remoteJid, {
        text: `📝 **Generated Script:**\n\n${response}`
      });
      
      logger.info('✅ Script sent successfully');
    } else {
      await sock.sendMessage(remoteJid, {
        text: '❌ Failed to generate script. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Error in processScriptOnly:', error);
    await sock.sendMessage(remoteJid, {
      text: '❌ Error generating script. Please try again.'
    });
  }
}

/**
 * Process visuals-only command
 */
async function processVisualsOnly(content, messageId, remoteJid) {
  try {
    logger.info('🎨 Generating visuals only...');
    
    const response = await callVisualsAPI(content);
    
    if (response) {
      // Send visuals directly to the user
      await sock.sendMessage(remoteJid, {
        text: response
      });
      
      logger.info('✅ Visuals sent successfully');
    } else {
      await sock.sendMessage(remoteJid, {
        text: '❌ Failed to generate visuals. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Error in processVisualsOnly:', error);
    await sock.sendMessage(remoteJid, {
      text: '❌ Error generating visuals. Please try again.'
    });
  }
}

/**
 * Process voice-only command with default voice
 */
async function processVoiceOnly(content, messageId, remoteJid) {
  try {
    logger.info('🎤 Generating voice with default voice (Female anchor)...');
    
    const audioPath = await generateAudio(content);
    
    if (audioPath) {
      // Send audio directly to the user
      await sock.sendMessage(remoteJid, {
        audio: { url: audioPath },
        mimetype: 'audio/mpeg',
        ptt: false
      });
      
      logger.info('✅ Voice message sent successfully');
    } else {
      await sock.sendMessage(remoteJid, {
        text: '❌ Failed to generate voice. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Error in processVoiceOnly:', error);
    await sock.sendMessage(remoteJid, {
      text: '❌ Error generating voice. Please try again.'
    });
  }
}

/**
 * Process voice command with specific person
 */
async function processVoiceWithPerson(content, voiceName, messageId, remoteJid) {
  try {
    logger.info(`🎤 Generating voice with ${voiceName}...`);
    
    // Get voice ID for the specified person
    const voiceId = await getVoiceId(voiceName);
    
    if (!voiceId) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Voice '${voiceName}' not found. Using default voice instead.`
      });
      // Fallback to default voice
      await processVoiceOnly(content, messageId, remoteJid);
      return;
    }
    
    // Generate audio with specific voice
    const audioPath = await generateAudioWithVoice(content, voiceId);
    
    if (audioPath) {
      // Send audio file as buffer
      const audioBuffer = await fs.readFile(audioPath);
      await sock.sendMessage(remoteJid, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: true
      });
      
      logger.info(`✅ Voice message with ${voiceName} sent successfully`);
    } else {
      await sock.sendMessage(remoteJid, {
        text: '❌ Failed to generate voice. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Error in processVoiceWithPerson:', error);
    await sock.sendMessage(remoteJid, {
      text: '❌ Error generating voice. Please try again.'
    });
  }
}

/**
 * Process editorial content through Perplexity and ElevenLabs
 */
async function processEditorial(editorial, messageId) {
  try {
    logger.info('🔄 Processing editorial...');
    
    // Step 1: Call Perplexity API
    const perplexityResponse = await callPerplexityAPI(editorial);
    if (!perplexityResponse) {
      logger.error('Failed to get response from Perplexity');
      return;
    }
    
    // Extract script and visuals
    const { script, visuals } = extractScriptAndVisuals(perplexityResponse);
    
    if (!script) {
      logger.error('Failed to extract script from Perplexity response');
      return;
    }
    
    // Step 2: Send results to WhatsApp groups (no audio or visuals for editorial/topic commands)
    await sendToWhatsAppGroups(script, null, null, editorial);
    
    // React with checkmark on original message
    await sock.sendMessage(groupJIDs.content, {
      react: { text: '✅', key: { id: messageId, remoteJid: groupJIDs.content } }
    });
    
    logger.info('✅ Editorial processing completed successfully!');
    
  } catch (error) {
    logger.error('Error processing editorial:', error);
  }
}

/**
 * Call Perplexity API with the editorial
 */
async function callPerplexityAPI(editorial) {
  try {
    const MASTER_PROMPT = `You are an AI Script Generator for Vision Point — a bold pro-Pakistan Urdu digital news channel. 
Your job is to monitor every incoming message in this WhatsApp group and create relevant news scripts based on the actual content provided.

Your task: 
1. Take the input message as the BASE NEWS ITEM. 
2. Create a FULL URDU SCRIPT in Vision Point style that focuses on the ACTUAL TOPIC mentioned in the base news item.
3. Script must always follow these rules: 
   - Length: Minimum 1300 words (9-minute monologue when spoken). 
   - Heading: Only ONE main subject heading (never more). 
   - Language: Urdu, spoken-anchor style, intellectual yet simple and emotional. 
   - Narrative: Focus on the actual topic provided. If it's about India, be critical of Modi/BJP/RSS. If it's about China-USA relations, focus on that. If it's about other countries, cover those topics appropriately.
   - Pakistani Perspective: Always provide analysis from Pakistan's strategic viewpoint and national interests.
   - Depth: Expand on the context with additional researched details, historic parallels, and global perspective relevant to the actual topic.
   - Tone: Serious, journalistic, research-based, emotional where needed, but always professional. 

4. DO NOT force India-related content if the base news item is about other topics. Focus on what's actually provided.
5. DO NOT summarize only — always expand into a full-fledged script with analysis, critique, narrative-building, and rhetorical questions for engagement. 

Output Format: 
- Start with ONE main heading (title of the script). 
- Then full monologue body text in Urdu. 

Your Goal: 
To automatically generate powerful, viral-ready Vision Point scripts that accurately reflect the input topic while maintaining Pakistan's perspective.`;

    const prompt = `${MASTER_PROMPT}

Base News Item: ${editorial}`;

    const response = await axios.post('https://api.perplexity.ai/chat/completions', {
      model: 'sonar',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 4000,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    logger.error('Perplexity API error:', error.message);
    if (error.response) {
      logger.error('Status:', error.response.status);
      logger.error('Data:', error.response.data);
    }
    return null;
  }
}

/**
 * Extract script and visuals from Perplexity response
 */
function extractScriptAndVisuals(response) {
  try {
    console.log('🔍 Raw Perplexity response:', response.substring(0, 500) + '...');
    
    // Extract script section - try multiple patterns
    let scriptMatch = response.match(/📝\s*\*\*Vision Point Script\*\*([\s\S]*?)(?:---|$)/i);
    
    // If first pattern fails, try alternative patterns
    if (!scriptMatch) {
      scriptMatch = response.match(/\*\*Vision Point Script\*\*([\s\S]*?)(?:---|$)/i);
    }
    if (!scriptMatch) {
      scriptMatch = response.match(/Vision Point Script([\s\S]*?)(?:---|$)/i);
    }
    if (!scriptMatch) {
      // If no specific pattern found, use the entire response as script
      console.log('⚠️ No specific script pattern found, using entire response');
      scriptMatch = [null, response];
    }
    
    let script = scriptMatch ? scriptMatch[1].trim() : '';
    
    // No visuals extraction for regular editorial processing
    const visuals = '';
    
    console.log('✅ Extracted script length:', script.length);
    console.log('✅ Extracted visuals length:', visuals.length);
    
    // Clean up script - remove markdown formatting if present
    if (script) {
      script = script.replace(/^\s*---\s*/gm, '').trim();
      
      // Log script length but do NOT truncate - send complete script as generated
      const words = script.split(/\s+/);
      logger.info(`Script contains ${words.length} words - sending complete script`);
    }
    
    return { script, visuals };
  } catch (error) {
    logger.error('Error extracting script and visuals:', error);
    console.log('🔍 Full response for debugging:', response);
    return { script: '', visuals: '' };
  }
}

/**
 * Generate audio using ElevenLabs TTS
 */
async function generateAudio(script) {
  try {
    if (!script || script.length === 0) {
      logger.warn('No script to convert to audio');
      return null;
    }
    
    // Handle ElevenLabs character limit (5000 chars)
    let textToConvert = script;
    if (script.length > 5000) {
      textToConvert = script.substring(0, 5000);
      logger.info('Script truncated for ElevenLabs (5000 char limit)');
    }
    
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text: textToConvert,
        model_id: 'eleven_v3', // ElevenLabs v3 alpha model for better Urdu pronunciation
        voice_settings: {
          stability: 0.5, // Natural setting for v3 alpha (Creative: 0.3, Natural: 0.5, Robust: 0.7)
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true
        }
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const audioPath = path.join('./output/voiceovers', `${timestamp}.mp3`);
    
    await fs.writeFile(audioPath, response.data);
    logger.info(`🎵 Audio generated: ${audioPath}`);
    
    return audioPath;
  } catch (error) {
    logger.error('ElevenLabs API error:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Generate audio with specific voice ID
 */
async function generateAudioWithVoice(script, voiceId) {
  try {
    if (!script || script.length === 0) {
      logger.warn('No script to convert to audio');
      return null;
    }
    
    // Handle ElevenLabs character limit (5000 chars)
    let textToConvert = script;
    if (script.length > 5000) {
      textToConvert = script.substring(0, 5000);
      logger.info('Script truncated for ElevenLabs (5000 char limit)');
    }
    
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text: textToConvert,
        model_id: 'eleven_v3', // ElevenLabs v3 alpha model for better Urdu pronunciation
        voice_settings: {
          stability: 0.5, // Natural setting for v3 alpha (Creative: 0.3, Natural: 0.5, Robust: 0.7)
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true
        }
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const audioPath = path.join('./output/voiceovers', `${timestamp}.mp3`);
    
    await fs.writeFile(audioPath, response.data);
    logger.info(`🎵 Audio generated with custom voice: ${audioPath}`);
    
    return audioPath;
  } catch (error) {
    logger.error('ElevenLabs API error with custom voice:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Call Perplexity API specifically for visual descriptions only
 */
async function callVisualsAPI(content) {
  try {
    const visualsPrompt = `You are an ELITE MEDIA RESEARCH SPECIALIST for Vision Point - Pakistan's premier Urdu daily news update YouTube channel. Your anchor Younus Qasmi has created content that needs professional visual support. 
🎯 PRIMARY MISSION Find VERIFIED, BROADCAST-READY VISUALS that exactly match the script narrative for seamless video editing integration. 
📋 CRITICAL VERIFICATION REQUIREMENTS 

COMPREHENSIVE CONTENT VERIFICATION MANDATORY: Access and verify every link's actual content before providing 

Confirm video timestamps show EXACTLY what script describes 
Cross-reference multiple sources for same events/claims 
Only provide links where visual content authentically supports narrative 
Test all links for accessibility (not blocked/removed/restricted) 

VISUAL QUALITY STANDARDS ✅ APPROVED VISUALS: 

Raw footage without commentary/anchors 
Clear, unblurred, professional quality 
Minimal or no watermarks 
Multiple camera angles for same events 
Official ceremonies, press conferences, statements 
Archival footage for historical context 
❌ STRICTLY REJECTED: 
Studio discussions/panel shows 
Heavy watermarks/news tickers blocking visuals 
Commentary over raw footage 
Duplicate angles from same source 

SOURCE HIERARCHY (Priority Order) Government/Official Channels (PIB, PMO, Foreign Office) 

Twitter/X 
YouTube 
International Media (BBC, Al Jazeera, Reuters, CNN) etc 
Pakistani Media (Dawn News, Geo News, ARY News) 
Facebook Official Pages 
🔍 RESEARCH DEPTH REQUIREMENTS MINIMUM CONTENT TARGETS: 15-20 YouTube links with verified timestamps 
10-15 news articles from credible sources 
5-8 official government/institutional sources 
3-5 expert analysis videos (if relevant) 
Historical context footage (when applicable) 
FACT-CHECKING PROTOCOL: Verify claims across minimum 3 independent sources 
Check dates, locations, participants match script 
Note any contradictory information 
Provide context for controversial claims 
Flag factual inaccuracies in script 
📝 OUTPUT FORMAT (WhatsApp-Ready) text 🎯 Script Line: [Exact Urdu and english text from script] 📹 [Direct working link] ⏱ [Start time] – [End time] 📝 [Precise description of visuals in this timeframe] ✅ Source: [Channel/Platform name, Date] 
-- NEWS VERIFICATION: 📰 [News article link] ✅ CONFIRMED: [What this source verifies from script] 
❌ if no suitable footage found then your work will be genenrating ai images visualizing that ⚡ SPECIAL INSTRUCTIONS FOR EACH SCRIPT SECTION: Identify key visual elements mentioned by anchor 
Find exact footage showing those specific scenes/events/people 
Verify timestamps correspond to relevant content 
Provide 1-2 best clips maximum per scene (different angles only) 
Include supporting news sources for credibility 
GEOGRAPHIC/POLITICAL CONTENT: Find footage from multiple international perspectives 
Include Pakistani government responses where relevant 
Provide historical context visuals for background 
Cross-verify controversial claims across sources 
QUALITY ASSURANCE CHECKLIST: Every link works and loads properly 
Timestamps verified to show claimed content 
Visual quality suitable for broadcast 
No duplicate footage from same angle/source 
Sources are credible and verifiable 
Content authentically supports script narrative 
🚨 CRITICAL SUCCESS FACTORS ACCURACY OVER QUANTITY - Better to reject poor footage than include unusable content 
EDITOR-FRIENDLY FORMAT - Clear timestamps and descriptions for easy editing 
CREDIBILITY FOCUS - Only verified, authentic sources 
SCRIPT ALIGNMENT - Visuals must support, not contradict, the narrative 
PROFESSIONAL STANDARD - Broadcast-quality footage only 
Now analyze the provided script and deliver ONLY verified, working links with content that specifically matches what Anchor Younus Qasmi is describing. Format everything for immediate WhatsApp sharing with the video editor. 
Make sure to also generate most of the images with ai visualizing all paragraphs and sentences meanings. (Script past)

Script Content: ${content}`;

    const response = await axios.post('https://api.perplexity.ai/chat/completions', {
      model: 'sonar',
      messages: [
        {
          role: 'user',
          content: visualsPrompt
        }
      ],
      max_tokens: 1500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    logger.error('Visuals API error:', error.message);
    if (error.response) {
      logger.error('Status:', error.response.status);
      logger.error('Data:', error.response.data);
    }
    return null;
  }
}

/**
 * Call Perplexity API specifically for headlines only
 */
async function callHeadlinesAPI() {
  try {
    const headlinesPrompt = `You are a news aggregator for Vision Point, a Pakistani news channel. Provide exactly 10 current top headlines with geographic prioritization as follows:

1. Pakistan (2-3 headlines) - Most important Pakistani news
2. India (1-2 headlines) - Major Indian developments
3. Israel/Middle East conflict (1-2 headlines) - Key Middle East developments
4. USA (1 headline) - Major US news
5. China and Russia (1 headline) - Important developments from China or Russia
6. Global/World news (1-2 headlines) - Other major international news

Format your response EXACTLY as follows:
📰 **Top 10 Headlines - Vision Point Agenda**

1. [Headline about Pakistan]
2. [Headline about Pakistan]
3. [Headline about India]
4. [Headline about Israel/Middle East]
5. [Headline about USA]
6. [Headline about China/Russia]
7. [Headline about Global news]
8. [Headline about Pakistan/India/Middle East]
9. [Headline about Global news]
10. [Headline about any major story]

💡 **Type a number (1-10) to get detailed script for any headline**

Make headlines concise but informative. Focus on breaking news and major developments from the last 24-48 hours. DO NOT generate any scripts - only provide the numbered headlines list.`;

    const response = await axios.post('https://api.perplexity.ai/chat/completions', {
      model: 'sonar',
      messages: [
        {
          role: 'user',
          content: headlinesPrompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    logger.error('Headlines API error:', error.message);
    if (error.response) {
      logger.error('Status:', error.response.status);
      logger.error('Data:', error.response.data);
    }
    return null;
  }
}

/**
 * Process agenda command - fetch top 10 headlines with geographic prioritization
 */
async function processAgenda(messageId, remoteJid) {
  try {
    logger.info('📰 Fetching top 10 headlines with geographic prioritization...');
    
    const response = await callHeadlinesAPI();
    
    if (response) {
      // Store headlines for number selection (extract from response)
      const headlineLines = response.split('\n').filter(line => line.match(/^\d+\./));
      currentHeadlines[remoteJid] = {
        headlines: headlineLines,
        timestamp: Date.now()
      };
      
      await sock.sendMessage(remoteJid, {
        text: response
      });
      
      logger.info('✅ Headlines sent successfully');
    } else {
      await sock.sendMessage(remoteJid, {
        text: '❌ Failed to fetch headlines. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Error in processAgenda:', error);
    await sock.sendMessage(remoteJid, {
      text: '❌ Error fetching headlines. Please try again.'
    });
  }
}

/**
 * Process headline selection by number
 */
async function processHeadlineSelection(number, messageId, remoteJid) {
  try {
    // Check if user has recent headlines
    const userHeadlines = currentHeadlines[remoteJid];
    if (!userHeadlines || (Date.now() - userHeadlines.timestamp) > 3600000) { // 1 hour expiry
      await sock.sendMessage(remoteJid, {
        text: '❌ No recent headlines found. Please type "agenda" first to get latest headlines.'
      });
      return;
    }
    
    if (number < 1 || number > userHeadlines.headlines.length) {
      await sock.sendMessage(remoteJid, {
        text: `❌ Invalid number. Please choose between 1-${userHeadlines.headlines.length}.`
      });
      return;
    }
    
    const selectedHeadline = userHeadlines.headlines[number - 1];
    logger.info(`🔢 Generating script for headline ${number}: ${selectedHeadline}`);
    
    // Extract headline text (remove number prefix)
    const headlineText = selectedHeadline.replace(/^\d+\.\s*/, '');
    
    const MASTER_PROMPT = `You are an AI Script Generator for Vision Point — a bold pro-Pakistan Urdu digital news channel. 
Your job is to monitor every incoming message in this WhatsApp group and create relevant news scripts based on the actual content provided.

Your task: 
1. Take the input message as the BASE NEWS ITEM. 
2. Create a FULL URDU SCRIPT in Vision Point style that focuses on the ACTUAL TOPIC mentioned in the base news item.
3. Script must always follow these rules: 
   - Length: Minimum 1300 words (9-minute monologue when spoken). 
   - Heading: Only ONE main subject heading (never more). 
   - Language: Urdu, spoken-anchor style, intellectual yet simple and emotional. 
   - Narrative: Focus on the actual topic provided. If it's about India, be critical of Modi/BJP/RSS. If it's about China-USA relations, focus on that. If it's about other countries, cover those topics appropriately.
   - Pakistani Perspective: Always provide analysis from Pakistan's strategic viewpoint and national interests.
   - Depth: Expand on the context with additional researched details, historic parallels, and global perspective relevant to the actual topic.
   - Tone: Serious, journalistic, research-based, emotional where needed, but always professional. 

4. IMPORTANT: Do NOT force India-related content if the topic is about something else. Focus on the actual subject matter provided.
5. DO NOT summarize only — always expand into a full-fledged script with analysis, critique, narrative-building, and rhetorical questions for engagement. 

Output Format: 
- Start with ONE main heading (title of the script). 
- Then full monologue body text in Urdu. 

Your Goal: 
To automatically generate powerful, viral-ready Vision Point scripts that accurately reflect the input topic while maintaining Pakistani perspective.`;

    const scriptPrompt = `${MASTER_PROMPT}

Base News Item (Headline ${number}): ${headlineText}`;
    
    const response = await callPerplexityAPI(scriptPrompt);
    
    if (response) {
      await sock.sendMessage(remoteJid, {
        text: response
      });
      
      logger.info(`✅ Script for headline ${number} sent successfully`);
    } else {
      await sock.sendMessage(remoteJid, {
        text: '❌ Failed to generate script. Please try again.'
      });
    }
  } catch (error) {
    logger.error('Error in processHeadlineSelection:', error);
    await sock.sendMessage(remoteJid, {
      text: '❌ Error generating script. Please try again.'
    });
  }
}

/**
 * Send results to WhatsApp groups
 */
async function sendToWhatsAppGroups(script, visuals, audioPath, originalTopic) {
  try {
    // Send to Demo script group
    if (script) {
      const shortTopic = originalTopic.substring(0, 50) + (originalTopic.length > 50 ? '...' : '');
      const heading = `📝 Vision Point Script (9 min) — ${shortTopic}`;
      
      // Send heading
      await sock.sendMessage(groupJIDs.demoScript, { text: heading });
      
      // Send script in chunks (3500 chars max)
      const chunks = chunkText(script, 3500);
      for (const chunk of chunks) {
        await sock.sendMessage(groupJIDs.demoScript, { text: chunk });
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
      
      // Send audio file if available
      if (audioPath && await fs.pathExists(audioPath)) {
        const audioBuffer = await fs.readFile(audioPath);
        await sock.sendMessage(groupJIDs.demoScript, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName: path.basename(audioPath)
        });
      }
    }
    
    // Send to Demo visual group
    if (visuals) {
      await sock.sendMessage(groupJIDs.demoVisual, { text: visuals });
    }
    
    logger.info('📤 Results sent to WhatsApp groups');
  } catch (error) {
    logger.error('Error sending to WhatsApp groups:', error);
  }
}

/**
 * Get voice ID by name from ElevenLabs
 */
async function getVoiceId(voiceName) {
  try {
    // Predefined voice mappings for better performance and reliability
    const voiceMappings = {
      'musawar abbasi': 'p2QMAuFNgXmBsO95wovm',
      'aftab nazeer': 'iclgq0atV8BdU3luuqFX',
      'faisal aziz': 'Dtl4nevROLF9XbYzd4Bj',
      'female anchor': 'BIcnYTh1FCI6LhJAcEuU',
      'default': 'BIcnYTh1FCI6LhJAcEuU' // Female anchor
    };
    
    // Normalize voice name to lowercase for case-insensitive matching
    const normalizedVoiceName = voiceName.toLowerCase().trim();
    
    // Check predefined mappings first
    if (voiceMappings[normalizedVoiceName]) {
      logger.info(`Found predefined voice: ${voiceName} (${voiceMappings[normalizedVoiceName]})`);
      return voiceMappings[normalizedVoiceName];
    }
    
    // Fallback to ElevenLabs API search
    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY
      }
    });
    
    const voice = response.data.voices.find(v => 
      v.name.toLowerCase().includes(normalizedVoiceName)
    );
    
    if (voice) {
      logger.info(`Found voice from API: ${voice.name} (${voice.voice_id})`);
      return voice.voice_id;
    }
    
    // If not found, use Female anchor as default
    logger.warn(`Voice '${voiceName}' not found, using default: Female anchor`);
    return voiceMappings['default'];
    
  } catch (error) {
    logger.error('Error fetching voices:', error.response?.data || error.message);
    // Return default voice on error
    return 'BIcnYTh1FCI6LhJAcEuU'; // Female anchor
  }
}

/**
 * Split text into chunks of specified size
 */
function chunkText(text, maxSize) {
  const chunks = [];
  let currentChunk = '';
  
  const sentences = text.split(/(?<=[۔!?])\s+/);
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
    }
    currentChunk += sentence + ' ';
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  logger.info('🛑 Shutting down gracefully...');
  if (sock) {
    sock.end();
  }
  process.exit(0);
});

// Start the application
logger.info('🚀 Starting Vision Point WhatsApp Bot...');
connectToWhatsApp().catch(error => {
  logger.error('Failed to start bot:', error);
  process.exit(1);
});