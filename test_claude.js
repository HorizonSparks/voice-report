const { callClaude } = require('./server/services/ai/anthropicClient');
require('dotenv').config();

async function test() {
  try {
    console.log("Testing Claude API call...");
    console.log("Using API Key:", process.env.ANTHROPIC_API_KEY ? "Configured (ends in " + process.env.ANTHROPIC_API_KEY.slice(-5) + ")" : "MISSING");
    const res = await callClaude({
      systemPrompt: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Say hello!" }],
      tracking: { service: "test-support" }
    });
    console.log("SUCCESS!");
    console.log("Claude replied:", res.text);
  } catch (err) {
    console.error("FAILED to call Claude:");
    console.error(err);
  }
}
test();
