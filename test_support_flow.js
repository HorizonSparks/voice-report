/**
 * Reproduces exactly what the setImmediate block in support.js does.
 * Uses the real conversation data already in the DB.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { callClaude } = require('./server/services/ai/anthropicClient');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT) || 5434,
  database: process.env.PG_DATABASE || 'horizon',
  user: process.env.PG_USER || 'horizon_spark',
  password: process.env.PG_PASSWORD || '8oS4oc2hyYhyq698CPSqXbA1',
  options: '-c search_path=voicereport',
});

async function run() {
  // Use the real conversation_id from the DB
  const conversation_id = 'conv_ad5bffc1-97d';
  
  try {
    // Step 1: Load history (same as setImmediate block)
    console.log('Step 1: Loading conversation history...');
    const { rows: history } = await pool.query(
      "SELECT sender_type, content, message_type FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [conversation_id]
    );
    console.log(`  Found ${history.length} messages`);

    // Step 2: Load conversation context
    console.log('Step 2: Loading conversation context...');
    const { rows: convo } = await pool.query(
      "SELECT screen_context, current_route, person_name FROM support_conversations WHERE id = $1",
      [conversation_id]
    );
    console.log('  Convo:', JSON.stringify(convo[0]));

    const customerName = convo[0]?.person_name || 'customer';
    const currentRoute = convo[0]?.current_route || 'unknown page';
    const screenCtx = convo[0]?.screen_context || {};

    // Step 3: Build messages for Claude
    console.log('Step 3: Building messages for Claude...');
    const formattedMessages = [];
    let contextStr = `Customer Name: ${customerName}\nCurrent Route: ${currentRoute}\nScreen Context: ${JSON.stringify(screenCtx)}\n\n`;

    history.forEach((m, idx) => {
      let contentStr = m.content;
      if (idx === 0) {
        contentStr = contextStr + contentStr;
      }
      formattedMessages.push({
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: contentStr
      });
    });
    console.log(`  Built ${formattedMessages.length} messages for Claude`);
    console.log('  Messages:', JSON.stringify(formattedMessages.map(m => ({ role: m.role, preview: m.content.slice(0, 60) }))));

    // Step 4: Call Claude (exactly as in setImmediate)
    console.log('Step 4: Calling Claude...');
    const systemPrompt = `You are Sparks AI, the helpful technical support assistant for Horizon Sparks.
The human support operators are currently ONLINE and can intervene to take over this conversation at any moment.
Your job is to read the customer's message and provide a helpful, polite, and professional automatic response.
Detect the user's language and respond in the same language (e.g., reply in Spanish if the user writes in Spanish, or English if they write in English).`;

    const result = await callClaude({
      systemPrompt,
      messages: formattedMessages,
      tracking: {
        personId: 'test-person',
        companyId: null,
        service: 'support-autoreply',
        extra: { project_id: 'default' }
      }
    });

    console.log('  Claude result.text:', result.text ? result.text.slice(0, 200) : '(empty!)');

    // Step 5: Try to insert the reply
    if (result.text) {
      console.log('Step 5: Inserting AI reply into support_messages...');
      const replyMsgId = 'smsg_test_' + Date.now();
      
      // Exact same INSERT as in setImmediate block:
      await pool.query(
        `INSERT INTO support_messages (id, conversation_id, company_id, person_id, person_name, sender_type, content, message_type, created_at)
         VALUES ($1, $2, $3, $4, $5, 'support', $6, 'text', NOW())`,
        [replyMsgId, conversation_id, null, 'test-person-id', 'Sparks AI', result.text]
      );
      console.log('  INSERT succeeded! Reply ID:', replyMsgId);

      // Step 6: Update conversation
      console.log('Step 6: Updating conversation last_message...');
      await pool.query(
        "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'waiting' WHERE id = $2",
        [result.text.substring(0, 200), conversation_id]
      );
      console.log('  UPDATE succeeded!');
      console.log('\n✅ FULL FLOW SUCCEEDED. AI reply was inserted into DB!');
    } else {
      console.log('  ⚠️  result.text is empty — nothing to insert.');
    }

  } catch (err) {
    console.error('\n❌ ERROR in flow:');
    console.error('  Message:', err.message);
    console.error('  Detail:', err.detail);
    console.error('  Hint:', err.hint);
    console.error('  Code:', err.code);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

run();
