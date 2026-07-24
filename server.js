import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { 
  initDb, 
  dbAll, 
  dbRun, 
  getOrCreateUser, 
  updateUserAuthorization 
} from './db.js';
import { processMessage, botEvents } from './botLogic.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static administrative dashboard files
app.use(express.static(path.resolve('public')));

// Initialize database and start server
async function startServer() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Servidor do Comunica Finanças rodando na porta ${PORT}`);
    console.log(`Acesse o Dashboard Administrativo em: http://localhost:${PORT}`);
  });
}

// ----------------------------------------------------
// 1. WEBHOOK RECEPTOR DE WHATSAPP
// ----------------------------------------------------
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Webhook Recebido] Payload:', JSON.stringify(payload));

    let phone = '';
    let text = '';
    let name = '';

    // Evolution API format
    if (payload.event === 'messages.upsert' && payload.data) {
      const data = payload.data;
      const key = data.key || {};
      
      if (key.fromMe) {
        return res.status(200).send('Mensagem enviada pelo próprio bot ignorada.');
      }

      phone = key.remoteJid ? key.remoteJid.split('@')[0] : '';
      name = data.pushName || '';

      const message = data.message || {};
      text = message.conversation || 
             (message.extendedTextMessage && message.extendedTextMessage.text) || 
             (message.imageMessage && message.imageMessage.caption) || 
             '';
    } 
    // Z-API format
    else if (payload.phone && payload.text) {
      phone = payload.phone;
      name = payload.senderName || '';
      text = payload.text.message || '';
      
      if (payload.fromMe) {
        return res.status(200).send('Mensagem enviada pelo próprio bot ignorada.');
      }
    } 
    // Generic / Custom formats
    else {
      phone = payload.phone || payload.number;
      text = payload.text || payload.message;
      name = payload.name || payload.sender || '';
    }

    if (!phone || !text) {
      return res.status(400).send('Telefone e texto da mensagem são obrigatórios.');
    }

    // Process message asynchronously
    processMessage(phone, text, name).catch(err => {
      console.error('[Erro] Falha ao processar mensagem no fluxo:', err);
    });

    return res.status(200).send('Mensagem recebida e em processamento.');
  } catch (error) {
    console.error('Erro no webhook de WhatsApp:', error);
    return res.status(500).send('Erro interno no servidor.');
  }
});

// ----------------------------------------------------
// 2. ENDPOINTS DA API DO DASHBOARD
// ----------------------------------------------------

// List all authorized contacts
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbAll(`SELECT * FROM users ORDER BY is_authorized DESC, created_at DESC`);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new contact manually
app.post('/api/users', async (req, res) => {
  const { phone, name, is_authorized } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Número de telefone é obrigatório.' });
  }
  const cleanPhone = String(phone).replace(/\D/g, '');
  try {
    await getOrCreateUser(cleanPhone, name);
    await updateUserAuthorization(cleanPhone, is_authorized === 1 || is_authorized === true);
    res.json({ success: true, message: 'Contato cadastrado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update contact details
app.put('/api/users/:phone', async (req, res) => {
  const { phone } = req.params;
  const { name, is_authorized } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nome do contato é obrigatório.' });
  }
  try {
    await dbRun(`UPDATE users SET name = ? WHERE phone = ?`, [name, phone]);
    if (is_authorized !== undefined) {
      await updateUserAuthorization(phone, is_authorized === 1 || is_authorized === true);
    }
    res.json({ success: true, message: 'Cadastro do contato atualizado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update authorization switch
app.put('/api/users/:phone/authorize', async (req, res) => {
  const { phone } = req.params;
  const { is_authorized } = req.body;
  try {
    await updateUserAuthorization(phone, is_authorized);
    res.json({ success: true, message: 'Autorização atualizada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a contact
app.delete('/api/users/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    await dbRun(`DELETE FROM users WHERE phone = ?`, [phone]);
    res.json({ success: true, message: 'Usuário removido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all payment rules
app.get('/api/payment-rules', async (req, res) => {
  try {
    const rules = await dbAll(`SELECT * FROM payment_rules ORDER BY start_date ASC`);
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new payment rule
app.post('/api/payment-rules', async (req, res) => {
  const { start_date, end_date, is_allowed, response_message } = req.body;
  if (!start_date || !end_date || response_message === undefined) {
    return res.status(400).json({ error: 'Data de início, data final e mensagem de resposta são obrigatórios.' });
  }
  try {
    const result = await dbRun(`
      INSERT INTO payment_rules (start_date, end_date, is_allowed, response_message)
      VALUES (?, ?, ?, ?)
    `, [start_date, end_date, is_allowed ? 1 : 0, response_message]);
    res.json({ success: true, id: result.id, message: 'Regra de pagamento criada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a payment rule
app.put('/api/payment-rules/:id', async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date, is_allowed, response_message } = req.body;
  if (!start_date || !end_date || response_message === undefined) {
    return res.status(400).json({ error: 'Data de início, data final e mensagem de resposta são obrigatórios.' });
  }
  try {
    await dbRun(`
      UPDATE payment_rules 
      SET start_date = ?, end_date = ?, is_allowed = ?, response_message = ? 
      WHERE id = ?
    `, [start_date, end_date, is_allowed ? 1 : 0, response_message, id]);
    res.json({ success: true, message: 'Regra de pagamento atualizada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a payment rule
app.delete('/api/payment-rules/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun(`DELETE FROM payment_rules WHERE id = ?`, [id]);
    res.json({ success: true, message: 'Regra de pagamento removida com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List Interaction Logs
app.get('/api/interactions', async (req, res) => {
  const { phone, limit = 100 } = req.query;
  try {
    let logs;
    if (phone) {
      logs = await dbAll(`
        SELECT * FROM interactions 
        WHERE phone = ? 
        ORDER BY created_at ASC 
        LIMIT ?
      `, [phone, Number(limit)]);
    } else {
      logs = await dbAll(`
        SELECT i.*, u.name 
        FROM interactions i 
        LEFT JOIN users u ON i.phone = u.phone 
        ORDER BY i.created_at DESC 
        LIMIT ?
      `, [Number(limit)]);
    }
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List Active Sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await dbAll(`
      SELECT s.*, u.name 
      FROM sessions s 
      LEFT JOIN users u ON s.phone = u.phone 
      ORDER BY s.updated_at DESC
    `);
    sessions.forEach(s => {
      s.temp_data = JSON.parse(s.temp_data || '{}');
    });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simulate message from the phone mockup
app.post('/api/simulate-message', async (req, res) => {
  const { phone, text, name } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ error: 'Telefone e texto da mensagem são obrigatórios.' });
  }
  const cleanPhone = String(phone).replace(/\D/g, '');

  try {
    await processMessage(cleanPhone, text, name);
    res.json({ success: true, message: 'Mensagem simulada enviada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. SERVER-SENT EVENTS (SSE) FOR REAL-TIME LIVE UPDATE
// ----------------------------------------------------
let clients = [];

app.get('/api/live-chats', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(':ok\n\n');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

botEvents.on('message', (msgData) => {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(msgData)}\n\n`);
  });
});

startServer();
