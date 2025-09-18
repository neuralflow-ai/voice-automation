# Vision Point WhatsApp Automation Bot

A production-ready Node.js automation bot that connects to WhatsApp via Baileys, processes editorial content through Perplexity AI, generates Urdu voiceovers using ElevenLabs TTS, and distributes results across WhatsApp groups.

## Features

- 🔗 **WhatsApp Integration**: Connects via Baileys library with session persistence
- 🤖 **AI Content Generation**: Uses Perplexity AI to create 9-minute Urdu news scripts
- 🎵 **Text-to-Speech**: Generates professional voiceovers using ElevenLabs
- 📱 **Multi-Group Distribution**: Automatically sends scripts and visuals to designated groups
- 🔄 **Real-time Processing**: Monitors "Content" group for new editorial topics
- ✅ **Feedback System**: Reacts to processed messages with checkmarks

## Prerequisites

- Node.js 16.0.0 or higher
- WhatsApp account
- Perplexity AI API key
- ElevenLabs API key and voice ID

## Quick Setup

### 1. Install Dependencies

```bash
npm init -y
npm install @whiskeysockets/baileys @hapi/boom pino qrcode-terminal axios dotenv fs-extra path
```

### 2. Configure Environment Variables (Optional)

The bot comes pre-configured with API keys, but you can override them:

1. Copy `.env.example` to `.env` (optional):
   ```bash
   cp .env.example .env
   ```

2. Configure your API keys in the `.env` file:
   - **Perplexity API**: Get from https://www.perplexity.ai/settings/api
   - **ElevenLabs API**: Get from https://elevenlabs.io/app/speech-synthesis
   - **Voice ID**: Choose your preferred voice from ElevenLabs

3. To use different credentials, uncomment and modify in `.env`:
   ```env
   PERPLEXITY_API_KEY=your_custom_key
   ELEVENLABS_API_KEY=your_custom_key
   ELEVENLABS_VOICE_ID=your_voice_id
   SESSION_DIR=./session
   ```

### 3. Create Required WhatsApp Groups

Create these groups in WhatsApp (exact names required):
- **"Content"** - Where editorial topics are posted
- **"Demo script"** - Where generated scripts and audio are sent
- **"Demo visual"** - Where related visuals and links are sent

### 4. Run the Bot

```bash
node app.js
```

### 5. Authenticate WhatsApp

1. Scan the QR code with your WhatsApp mobile app
2. Wait for "All required groups found! Bot is ready." message
3. The bot is now monitoring the "Content" group

## How It Works

### Workflow

1. **Monitor**: Bot listens to the "Content" WhatsApp group
2. **Process**: When a new text message is posted:
   - Sends the editorial to Perplexity AI for script generation
   - Extracts the Urdu script and related visuals
   - Converts the script to audio using ElevenLabs TTS
3. **Distribute**: 
   - Sends script and audio to "Demo script" group
   - Sends visual resources to "Demo visual" group
   - Reacts with ✅ on the original message

### Script Generation

The bot generates:
- **9-minute Urdu news scripts** (1200-1500 words)
- **Professional Pakistani media tone** (like Geo/ARY anchors)
- **Related visual resources**:
  - 4-6 YouTube video links
  - 6-8 news article links
  - 5-6 image links

### Audio Generation

- Uses ElevenLabs multilingual TTS model
- Optimized voice settings for news broadcasting
- Handles long scripts with automatic chunking
- Saves audio files to `./output/voiceovers/`

## API Configuration

### Perplexity AI
- **Model**: `sonar`
- **Max Tokens**: 1000 (for 1-minute test scripts)
- **Temperature**: 0.7

### ElevenLabs TTS
- **Model**: `eleven_multilingual_v2` (most advanced v3 for better Urdu pronunciation)
- **Voice ID**: `1t3sfuW00ixjYR0WrUwv` (Female Anchor)
- **Voice Settings**:
  - Stability: 0.5
  - Similarity Boost: 0.8
  - Style: 0.3
  - Speaker Boost: Enabled

## File Structure

```
auto system/
├── app.js              # Main application file
├── package.json        # Dependencies and scripts
├── .env.example        # Environment variables template
├── .env               # Your API keys (create this)
├── session/           # WhatsApp session data (auto-created)
└── output/
    └── voiceovers/     # Generated audio files
```

## Error Handling

- **Missing Groups**: Bot exits if required WhatsApp groups aren't found
- **API Failures**: Graceful error logging with partial result delivery
- **Character Limits**: Automatic truncation for Perplexity (1500 words) and ElevenLabs (5000 chars)
- **Connection Issues**: Automatic WhatsApp reconnection
- **Message Chunking**: Large scripts split into 3500-character chunks

## Troubleshooting

### Common Issues

1. **"Missing groups" error**:
   - Ensure group names are exactly: "Content", "Demo script", "Demo visual"
   - Check that your WhatsApp account is admin/member of all groups

2. **QR code not appearing**:
   - Clear the `./session` folder and restart
   - Ensure no other WhatsApp Web sessions are active

3. **API errors**:
   - Verify your API keys in `.env`
   - Check API quotas and billing status
   - Ensure ElevenLabs voice ID is correct

4. **Audio not generating**:
   - Check ElevenLabs API key and voice ID
   - Verify the `./output/voiceovers/` directory exists
   - Check script length (max 5000 characters for TTS)

### Logs

The bot provides detailed logging:
- ✅ Connection status
- 📝 Group discovery
- 📨 Message processing
- 🔄 API calls
- 📤 Result distribution
- ❌ Error details

## Security Notes

- Never commit your `.env` file to version control
- Keep your API keys secure and rotate them regularly
- The bot only processes text messages from the "Content" group
- Session data is stored locally for WhatsApp authentication

## License

MIT License - Feel free to modify and distribute as needed.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the console logs for error details
3. Verify all prerequisites are met
4. Ensure API services are operational