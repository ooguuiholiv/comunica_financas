import axios from 'axios';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import { 
  getOrCreateUser, 
  getSession, 
  updateSession, 
  clearSession, 
  logInteraction,
  dbAll,
  dbGet
} from './db.js';

dotenv.config();

export const botEvents = new EventEmitter();

// Helper to format date into DD/MM/YYYY for messages
function formatFriendlyDate(isoDateStr) {
  if (!isoDateStr) return '';
  const [year, month, day] = isoDateStr.split('-');
  return `${day}/${month}/${year}`;
}

// Main response sender
export async function sendResponse(phone, text, stateBefore, stateAfter) {
  // Save to SQLite
  await logInteraction(phone, 'outgoing', text, stateBefore, stateAfter);
  
  // Emit event for real-time web simulator update
  botEvents.emit('message', { phone, direction: 'outgoing', message: text, stateBefore, stateAfter });

  // Send message via real WhatsApp API if configured
  if (process.env.WA_API_URL) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (process.env.WA_API_TOKEN) {
        headers['apikey'] = process.env.WA_API_TOKEN;
        headers['Authorization'] = `Bearer ${process.env.WA_API_TOKEN}`;
      }

      const payload = {};
      if (process.env.WA_API_TYPE === 'z-api') {
        payload.phone = phone;
        payload.message = text;
      } else {
        payload.number = phone;
        payload.text = text;
        payload.textMessage = { text: text };
      }

      console.log(`[WhatsApp Outgoing] POST a: ${process.env.WA_API_URL}`);
      await axios.post(process.env.WA_API_URL, payload, { headers });
    } catch (err) {
      console.error(`Erro ao enviar WhatsApp para ${phone}:`, err.message);
    }
  } else {
    console.log(`[Simulador WhatsApp] Enviado para ${phone}:\n${text}\n`);
  }
}

// Parse text to extract dates in Brazilian formats (DD/MM/YYYY, DD/MM/YY, DD/MM)
export function parseDates(text) {
  const dateRegex = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g;
  const matches = [];
  let match;

  const currentYear = new Date().getFullYear(); // e.g. 2026

  while ((match = dateRegex.exec(text)) !== null) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    let year = match[3] ? parseInt(match[3], 10) : currentYear;

    // Handle 2-digit years
    if (match[3] && match[3].length === 2) {
      year = 2000 + year;
    }

    // Check validity
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      // Pad to standard YYYY-MM-DD
      const pad = (n) => String(n).padStart(2, '0');
      const isoStr = `${year}-${pad(month)}-${pad(day)}`;
      matches.push(isoStr);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Sort dates to establish a clean range
  matches.sort();

  if (matches.length === 1) {
    return {
      startDate: matches[0],
      endDate: matches[0]
    };
  }

  return {
    startDate: matches[0],
    endDate: matches[matches.length - 1]
  };
}

// Process incoming message
export async function processMessage(phone, text, pushName = '') {
  const cleanPhone = String(phone).replace(/\D/g, '');
  const rawText = String(text).trim();

  // Get/Create User
  const user = await getOrCreateUser(cleanPhone, pushName);

  // Load Session and log incoming message
  const session = await getSession(cleanPhone);
  const stateBefore = session.state;
  await logInteraction(cleanPhone, 'incoming', rawText, stateBefore, stateBefore);

  botEvents.emit('message', { phone: cleanPhone, direction: 'incoming', message: rawText, stateBefore, stateAfter: stateBefore });

  // Verify if contact is authorized to interact with the bot
  if (!user.is_authorized) {
    console.log(`[Bloqueado] Mensagem de ${cleanPhone} ignorada (não autorizado).`);
    return;
  }

  const cleanTextLower = rawText.toLowerCase();

  // Global cancel/exit commands
  if (/\b(sair|cancelar|encerrar|fim|tchau|obrigado|obrigada)\b/.test(cleanTextLower)) {
    await clearSession(cleanPhone);
    await sendResponse(
      cleanPhone, 
      `Atendimento encerrado. Obrigado! Digite qualquer mensagem se precisar de uma nova consulta.`, 
      stateBefore, 
      'START'
    );
    return;
  }

  try {
    let state = session.state;
    let tempData = session.temp_data || {};

    if (state === 'START') {
      // Try to parse dates from the message immediately
      const parsedRange = parseDates(rawText);

      if (parsedRange) {
        // Date found! Run query directly
        await handlePaymentsQuery(cleanPhone, parsedRange, stateBefore);
      } else {
        // No date found: trigger greeting and ask for date
        const greeting = `Olá, ${user.name}! Sou o assistente virtual de pagamentos.\n\nPor favor, informe a *data* ou o *período* de vencimento que deseja consultar para saber se será possível realizar pagamentos.\n\n*Exemplos de envio:*\n👉 _28/07/2026_\n👉 _25/07 a 31/07_`;
        await sendResponse(cleanPhone, greeting, 'START', 'AWAIT_DATE_QUERY');
        await updateSession(cleanPhone, 'AWAIT_DATE_QUERY', tempData);
      }
      return;
    }

    if (state === 'AWAIT_DATE_QUERY') {
      const parsedRange = parseDates(rawText);

      if (parsedRange) {
        await handlePaymentsQuery(cleanPhone, parsedRange, stateBefore);
      } else {
        const errorMsg = `⚠️ Desculpe, não consegui identificar uma data ou período válido na sua mensagem.\n\nPor favor, informe uma data no formato *DD/MM/AAAA* ou um período (ex: *28/07* ou *28/07 a 31/07*).`;
        await sendResponse(cleanPhone, errorMsg, 'AWAIT_DATE_QUERY', 'AWAIT_DATE_QUERY');
      }
      return;
    }

    if (state === 'AWAIT_POST_QUERY') {
      const isYes = /^(1|sim|s|quero|voltar|menu)$/i.test(cleanTextLower);
      const isNo = /^(2|nao|não|n|fim|sair)$/i.test(cleanTextLower);

      if (isYes) {
        const promptMsg = `Certo! Qual a nova data ou período que deseja consultar? (Ex: _05/08_)`;
        await sendResponse(cleanPhone, promptMsg, 'AWAIT_POST_QUERY', 'AWAIT_DATE_QUERY');
        await updateSession(cleanPhone, 'AWAIT_DATE_QUERY', {});
      } else if (isNo) {
        const byeMsg = `Atendimento concluído. Caso precise de mais informações no futuro, basta me enviar uma mensagem. Tenha um ótimo dia!`;
        await sendResponse(cleanPhone, byeMsg, 'AWAIT_POST_QUERY', 'START');
        await clearSession(cleanPhone);
      } else {
        const invalidMsg = `Opção inválida. Por favor, responda apenas:\n1 - *Sim* (para fazer outra consulta)\n2 - *Não* (para encerrar)`;
        await sendResponse(cleanPhone, invalidMsg, 'AWAIT_POST_QUERY', 'AWAIT_POST_QUERY');
      }
      return;
    }

  } catch (err) {
    console.error("Erro no processamento da máquina de estados:", err);
    await sendResponse(cleanPhone, `⚠️ Ocorreu um erro interno ao processar sua solicitação. A sessão foi reiniciada.`, stateBefore, 'START');
    await clearSession(cleanPhone);
  }
}

// Helper to retrieve value from settings table
async function getSettingValue(key, defaultValue) {
  try {
    const row = await dbGet(`SELECT value FROM settings WHERE key = ?`, [key]);
    return row ? row.value : defaultValue;
  } catch (err) {
    console.error(`Erro ao carregar configuracao ${key}:`, err);
    return defaultValue;
  }
}

// Query SQLite for overlapping rules and format output
async function handlePaymentsQuery(phone, range, stateBefore) {
  const { startDate, endDate } = range;
  
  // Overlap condition: rule.start_date <= range.endDate AND rule.end_date >= range.startDate
  const rules = await dbAll(`
    SELECT * FROM payment_rules
    WHERE start_date <= ? AND end_date >= ?
    ORDER BY start_date ASC
  `, [endDate, startDate]);

  let responseText = '';
  const rangeStr = startDate === endDate 
    ? `no dia *${formatFriendlyDate(startDate)}*` 
    : `no período de *${formatFriendlyDate(startDate)}* a *${formatFriendlyDate(endDate)}*`;

  if (rules.length === 0) {
    // No custom rule matches, classify the date dynamically
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const today = new Date(todayStr);

    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    const nextWeekStr = nextWeek.toLocaleDateString('sv-SE');

    let template = '';
    const dateLabel = startDate === endDate 
      ? formatFriendlyDate(startDate)
      : `${formatFriendlyDate(startDate)} a ${formatFriendlyDate(endDate)}`;

    if (startDate < todayStr) {
      // Overdue (Data vencida)
      template = await getSettingValue(
        'msg_overdue', 
        '⚠️ A data consultada ({data}) já passou/venceu. Caso precise do comprovante ou queira justificar o pagamento, entre em contato diretamente com o financeiro.'
      );
    } else if (startDate >= todayStr && startDate <= nextWeekStr) {
      // Due within the week (Vencendo na semana)
      template = await getSettingValue(
        'msg_this_week', 
        'ℹ️ O pagamento para o dia {data} (vencimento esta semana) está programado. Se houver alguma pendência ou necessidade de justificativa, entre em contato.'
      );
    } else {
      // Future (Futura)
      template = await getSettingValue(
        'msg_future', 
        '📅 O pagamento para o dia {data} está agendado e programado para ser realizado normalmente na data de vencimento.'
      );
    }

    responseText = template.replace(/{data}/g, dateLabel);
  } else {
    // Format response combining all overlapping rules
    responseText = `ℹ️ *Status de Pagamentos ${rangeStr}:*\n\n`;
    
    rules.forEach((rule, idx) => {
      const rulePeriod = rule.start_date === rule.end_date
        ? `Dia ${formatFriendlyDate(rule.start_date)}`
        : `Período de ${formatFriendlyDate(rule.start_date)} a ${formatFriendlyDate(rule.end_date)}`;

      responseText += `*Regra #${idx + 1} (${rulePeriod}):*\n`;
      responseText += `${rule.response_message}\n\n`;
    });

    responseText = responseText.trim();
  }

  // Add navigation options
  responseText += `\n\n────────────────────\n*Deseja consultar outro período?*\n1 - *Sim*\n2 - *Não*`;

  await sendResponse(phone, responseText, stateBefore, 'AWAIT_POST_QUERY');
  await updateSession(phone, 'AWAIT_POST_QUERY', {});
}
