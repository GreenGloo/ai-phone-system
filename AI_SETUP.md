# 🚀 AI Provider Setup - Claude vs OpenAI

## Why Claude 3.5 Sonnet is Superior for Phone AI

### **Claude Advantages:**
- **Better instruction following** - More reliable at complex booking logic
- **Superior conversation quality** - More natural, less robotic responses  
- **Better context understanding** - Handles automotive terminology and speech errors
- **More reliable JSON output** - Less likely to break response format
- **Longer context window** - Remembers more conversation history

### **OpenAI Advantages:**
- **Faster response times** - Generally quicker API responses
- **More established** - Widely used, more tutorials available
- **Function calling** - Built-in tool use capabilities

## Quick Setup

### 1. Get Claude API Key (Recommended)
1. Go to https://console.anthropic.com/
2. Create an account and get API key
3. Add to your `.env` file:
```bash
USE_CLAUDE=true
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

### 2. OpenAI Fallback
```bash
USE_CLAUDE=false  
OPENAI_API_KEY=sk-xxxxx
```

## Performance Comparison

| Feature | Claude 3.5 Sonnet | GPT-4o-mini |
|---------|-------------------|-------------|
| Conversation Quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Instruction Following | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Booking Accuracy | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Response Speed | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Cost | ⭐⭐⭐ | ⭐⭐⭐⭐ |

## Expected Results with Claude

**Before (OpenAI):**
Customer: "CID man"
AI: "When would you like to come in for CID?"

**After (Claude):**
Customer: "CID man" 
AI: "I can get you scheduled for an oil change! I have today at 2:00 PM, tomorrow at 9:00 AM, or tomorrow at 2:30 PM available. Which works best for you?"

## Switching Between Providers

Change the environment variable:
```bash
# Use Claude (recommended)
USE_CLAUDE=true

# Use OpenAI  
USE_CLAUDE=false
```

Restart your application and the system will automatically use your preferred AI provider.

## Cost Comparison

- **Claude 3.5 Sonnet**: ~$3 per 1M input tokens, $15 per 1M output tokens
- **GPT-4o-mini**: ~$0.15 per 1M input tokens, $0.60 per 1M output tokens

For a garage taking 50 calls/day with avg 5 AI responses per call:
- **Claude**: ~$5-10/month
- **OpenAI**: ~$1-3/month

**Recommendation**: Claude's superior booking accuracy will convert more calls to appointments, easily offsetting the small cost difference.