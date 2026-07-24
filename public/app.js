// Global state of the dashboard
let users = [];
let rules = [];
let selectedPhone = '';
let eventSource = null;

// User Modal state
let isUserEditMode = false;
let editingPhone = '';

// Rule Modal state
let isRuleEditMode = false;
let editingRuleId = '';

// DOM Elements
const usersTableBody = document.getElementById('users-table-body');
const rulesTableBody = document.getElementById('rules-table-body');
const selectSimulatorUser = document.getElementById('select-simulator-user');
const chatMessagesContainer = document.getElementById('chat-messages-container');
const chatInputMessage = document.getElementById('chat-input-message');
const btnChatSend = document.getElementById('btn-chat-send');
const simulatorUserStatus = document.getElementById('simulator-user-status');
const simulatorUserStatusText = document.getElementById('simulator-user-status-text');

// Modals
const btnShowAddModal = document.getElementById('btn-show-add-modal');
const addUserModal = document.getElementById('add-user-modal');
const addUserForm = document.getElementById('add-user-form');

const btnShowRuleModal = document.getElementById('btn-show-rule-modal');
const ruleModal = document.getElementById('rule-modal');
const ruleForm = document.getElementById('rule-form');

// Stats Counters
const statAuthCount = document.getElementById('stat-auth-count');
const statRulesCount = document.getElementById('stat-rules-count');
const statMsgCount = document.getElementById('stat-msg-count');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  fetchDashboardData();
  fetchSettings();
  setupEventListeners();
  setupSSE();
});

// Configure DOM event listeners
function setupEventListeners() {
  // Show Add User Modal
  btnShowAddModal.addEventListener('click', () => {
    isUserEditMode = false;
    editingPhone = '';
    document.getElementById('modal-title').textContent = 'Adicionar Novo Contato';
    document.getElementById('input-phone').disabled = false;
    document.getElementById('input-phone').value = '';
    document.getElementById('input-name').value = '';
    document.getElementById('input-authorized').checked = true;
    document.getElementById('btn-submit-user').textContent = 'Salvar Contato';
    openModal('add-user-modal');
  });

  // Submit User Form
  addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('input-phone').value;
    const name = document.getElementById('input-name').value;
    const is_authorized = document.getElementById('input-authorized').checked ? 1 : 0;

    try {
      let res;
      if (isUserEditMode) {
        res = await fetch(`/api/users/${editingPhone}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, is_authorized })
        });
      } else {
        res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, name, is_authorized })
        });
      }
      const data = await res.json();
      if (data.success) {
        closeModal('add-user-modal');
        fetchDashboardData();
      } else {
        alert('Erro ao salvar contato: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Erro de rede ao salvar contato.');
    }
  });

  // Show Add Rule Modal
  btnShowRuleModal.addEventListener('click', () => {
    isRuleEditMode = false;
    editingRuleId = '';
    document.getElementById('rule-modal-title').textContent = 'Criar Nova Regra de Pagamento';
    document.getElementById('input-start-date').value = '';
    document.getElementById('input-end-date').value = '';
    document.getElementById('input-allowed').value = '1';
    document.getElementById('input-message').value = '';
    document.getElementById('btn-submit-rule').textContent = 'Salvar Regra';
    openModal('rule-modal');
  });

  // Submit Rule Form
  ruleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const start_date = document.getElementById('input-start-date').value;
    const end_date = document.getElementById('input-end-date').value;
    const is_allowed = document.getElementById('input-allowed').value === '1';
    const response_message = document.getElementById('input-message').value;

    try {
      let res;
      if (isRuleEditMode) {
        res = await fetch(`/api/payment-rules/${editingRuleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_date, end_date, is_allowed, response_message })
        });
      } else {
        res = await fetch('/api/payment-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_date, end_date, is_allowed, response_message })
        });
      }
      const data = await res.json();
      if (data.success) {
        closeModal('rule-modal');
        fetchDashboardData();
      } else {
        alert('Erro ao salvar regra: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Erro de rede ao salvar regra.');
    }
  });

  // Change user in simulator dropdown
  selectSimulatorUser.addEventListener('change', (e) => {
    selectedPhone = e.target.value;
    updateSimulatorUserStatus();
    loadSimulatorChatHistory();
  });

  // Send message from simulator mockup
  btnChatSend.addEventListener('click', sendSimulatorMessage);
  chatInputMessage.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendSimulatorMessage();
    }
  });

  // Refresh history
  const selectHistoryUser = document.getElementById('select-history-user');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');
  if (selectHistoryUser) selectHistoryUser.addEventListener('change', loadUserQueriesHistory);
  if (btnRefreshHistory) btnRefreshHistory.addEventListener('click', loadUserQueriesHistory);

  // Save settings button
  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) btnSaveSettings.addEventListener('click', saveSettings);
}

// Setup EventSource / SSE channel
function setupSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/live-chats');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[SSE Event]', data);

    // If the message is related to the currently simulated contact, push to chat UI
    if (data.phone === selectedPhone) {
      appendMessageToSimulator(data.direction, data.message, new Date().toISOString());
    }

    // Refresh UI totals and lists
    fetchDashboardData();
    
    // If we're on the history tab and looking at this user, refresh it
    const selectHistoryUser = document.getElementById('select-history-user');
    if (selectHistoryUser && selectHistoryUser.value === data.phone) {
      loadUserQueriesHistory();
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE connection lost. Reconnecting in 5s...', err);
    setTimeout(setupSSE, 5000);
  };
}

// Fetch all database records for general dashboard sync
async function fetchDashboardData() {
  try {
    const resUsers = await fetch('/api/users');
    users = await resUsers.json();
    
    const resRules = await fetch('/api/payment-rules');
    rules = await resRules.json();

    const resInteractions = await fetch('/api/interactions');
    const interactions = await resInteractions.json();

    renderUsersTable();
    renderRulesTable();
    updateSimulatorDropdown();
    updateHistoryUserDropdown();
    updateStatsCounters(interactions.length);
  } catch (err) {
    console.error('Erro ao sincronizar dados do painel:', err);
  }
}

// ============================================
// SETTINGS
// ============================================

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();

    const overdueEl = document.getElementById('setting-msg-overdue');
    const thisWeekEl = document.getElementById('setting-msg-this-week');
    const futureEl = document.getElementById('setting-msg-future');

    if (overdueEl && settings.msg_overdue) overdueEl.value = settings.msg_overdue;
    if (thisWeekEl && settings.msg_this_week) thisWeekEl.value = settings.msg_this_week;
    if (futureEl && settings.msg_future) futureEl.value = settings.msg_future;
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

async function saveSettings() {
  const overdueVal = document.getElementById('setting-msg-overdue').value.trim();
  const thisWeekVal = document.getElementById('setting-msg-this-week').value.trim();
  const futureVal = document.getElementById('setting-msg-future').value.trim();

  if (!overdueVal || !thisWeekVal || !futureVal) {
    alert('Preencha todas as mensagens antes de salvar.');
    return;
  }

  const settingsToSave = [
    { key: 'msg_overdue', value: overdueVal },
    { key: 'msg_this_week', value: thisWeekVal },
    { key: 'msg_future', value: futureVal }
  ];

  try {
    for (const s of settingsToSave) {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s)
      });
    }

    // Show success toast
    const toast = document.getElementById('settings-toast');
    if (toast) {
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 3500);
    }
  } catch (err) {
    console.error('Erro ao salvar configurações:', err);
    alert('Erro ao salvar. Verifique a conexão com o servidor.');
  }
}

// Render contacts list
function renderUsersTable() {
  usersTableBody.innerHTML = '';
  if (users.length === 0) {
    usersTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum contato cadastrado.</td></tr>`;
    return;
  }

  users.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight: 500;">${user.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${new Date(user.created_at).toLocaleDateString()}</div>
      </td>
      <td><code class="state-tag">${user.phone}</code></td>
      <td>
        <label class="switch">
          <input type="checkbox" ${user.is_authorized ? 'checked' : ''} onchange="toggleUserAuthorization('${user.phone}', this.checked)">
          <span class="slider"></span>
        </label>
        <span style="margin-left: 0.5rem;" class="badge ${user.is_authorized ? 'badge-auth' : 'badge-blocked'}">
          ${user.is_authorized ? 'Ativo' : 'Inativo'}
        </span>
      </td>
      <td>
        <button class="btn btn-edit" onclick="openEditUserModal('${user.phone}', '${user.name.replace(/'/g, "\\'")}', ${user.is_authorized})">Editar</button>
        <button class="btn btn-delete" onclick="deleteUser('${user.phone}')">Remover</button>
      </td>
    `;
    usersTableBody.appendChild(tr);
  });
}

// Render payment calendar rules list
function renderRulesTable() {
  rulesTableBody.innerHTML = '';
  if (rules.length === 0) {
    rulesTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhuma regra de pagamento cadastrada.</td></tr>`;
    return;
  }

  rules.forEach(rule => {
    const formatD = (isoStr) => {
      const [year, month, day] = isoStr.split('-');
      return `${day}/${month}/${year}`;
    };

    const periodStr = rule.start_date === rule.end_date 
      ? `<strong>${formatD(rule.start_date)}</strong>`
      : `<strong>${formatD(rule.start_date)}</strong> até <strong>${formatD(rule.end_date)}</strong>`;

    const statusBadge = rule.is_allowed
      ? `<span class="badge badge-allowed">✅ Permitidos</span>`
      : `<span class="badge badge-suspended">⚠️ Suspensos</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${periodStr}</td>
      <td>${statusBadge}</td>
      <td style="max-width: 350px; font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">${rule.response_message}</td>
      <td>
        <button class="btn btn-edit" onclick="openEditRuleModal(${rule.id}, '${rule.start_date}', '${rule.end_date}', ${rule.is_allowed}, '${rule.response_message.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')">Editar</button>
        <button class="btn btn-delete" onclick="deleteRule(${rule.id})">Remover</button>
      </td>
    `;
    rulesTableBody.appendChild(tr);
  });
}

// Update stats count widgets
function updateStatsCounters(totalMessagesCount) {
  const authCount = users.filter(u => u.is_authorized).length;
  statAuthCount.textContent = authCount;
  statRulesCount.textContent = rules.length;
  statMsgCount.textContent = totalMessagesCount;
}

// Populate simulator select menu
function updateSimulatorDropdown() {
  const currentSelection = selectSimulatorUser.value;
  selectSimulatorUser.innerHTML = '<option value="">-- Selecionar Contato --</option>';
  
  users.forEach(user => {
    const option = document.createElement('option');
    option.value = user.phone;
    option.textContent = `${user.name} (${user.phone})`;
    selectSimulatorUser.appendChild(option);
  });

  if (currentSelection && users.some(u => u.phone === currentSelection)) {
    selectSimulatorUser.value = currentSelection;
  } else {
    selectedPhone = '';
    updateSimulatorUserStatus();
    chatMessagesContainer.innerHTML = `<div class="system-message">Selecione um contato no menu superior do aparelho para iniciar a simulação.</div>`;
  }
}

// Populate history select menu
function updateHistoryUserDropdown() {
  const selectHistoryUser = document.getElementById('select-history-user');
  if (!selectHistoryUser) return;
  
  const currentSelection = selectHistoryUser.value;
  selectHistoryUser.innerHTML = '<option value="">-- Selecionar Contato --</option>';
  
  users.forEach(user => {
    const option = document.createElement('option');
    option.value = user.phone;
    option.textContent = `${user.name} (${user.phone})`;
    selectHistoryUser.appendChild(option);
  });
  
  if (currentSelection && users.some(u => u.phone === currentSelection)) {
    selectHistoryUser.value = currentSelection;
  }
}

// Update authorization switch
async function toggleUserAuthorization(phone, isAuthorized) {
  try {
    await fetch(`/api/users/${phone}/authorize`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_authorized: isAuthorized })
    });
    fetchDashboardData();
    if (phone === selectedPhone) {
      updateSimulatorUserStatus();
    }
  } catch (err) {
    console.error('Erro ao atualizar autorização:', err);
  }
}

// Delete user contact
async function deleteUser(phone) {
  if (!confirm('Deseja realmente remover este contato do sistema?')) return;
  try {
    await fetch(`/api/users/${phone}`, { method: 'DELETE' });
    fetchDashboardData();
  } catch (err) {
    console.error('Erro ao excluir usuário:', err);
  }
}

// Delete payment rule
async function deleteRule(id) {
  if (!confirm('Deseja realmente excluir esta regra de pagamento?')) return;
  try {
    await fetch(`/api/payment-rules/${id}`, { method: 'DELETE' });
    fetchDashboardData();
  } catch (err) {
    console.error('Erro ao excluir regra de pagamento:', err);
  }
}

// Update mockup visual tags for active simulated user
function updateSimulatorUserStatus() {
  const user = users.find(u => u.phone === selectedPhone);
  if (!user) {
    simulatorUserStatus.className = 'user-status-indicator';
    simulatorUserStatusText.textContent = 'Nenhum selecionado';
    return;
  }

  if (user.is_authorized) {
    simulatorUserStatus.className = 'user-status-indicator authorized';
    simulatorUserStatusText.textContent = 'Bot Ativo (Autorizado)';
  } else {
    simulatorUserStatus.className = 'user-status-indicator';
    simulatorUserStatusText.textContent = 'Bot Inativo (Ignorando)';
  }
}

// Load simulated phone chat history
async function loadSimulatorChatHistory() {
  if (!selectedPhone) return;

  chatMessagesContainer.innerHTML = '<div class="system-message">Carregando histórico...</div>';

  try {
    const res = await fetch(`/api/interactions?phone=${selectedPhone}`);
    const logs = await res.json();

    chatMessagesContainer.innerHTML = '';
    
    if (logs.length === 0) {
      chatMessagesContainer.innerHTML = '<div class="system-message">Conversa iniciada. Digite uma mensagem ou data para consultar pagamentos.</div>';
      return;
    }

    logs.forEach(log => {
      appendMessageToSimulator(log.direction, log.message, log.created_at);
    });
  } catch (err) {
    console.error('Erro ao carregar histórico de simulação:', err);
    chatMessagesContainer.innerHTML = '<div class="system-message error">Falha ao carregar histórico.</div>';
  }
}

// Append message balloon to mockup screen
function appendMessageToSimulator(direction, text, timestamp) {
  const systemMsg = chatMessagesContainer.querySelector('.system-message');
  if (systemMsg && (chatMessagesContainer.children.length === 1)) {
    systemMsg.remove();
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${direction}`;
  
  const time = new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  bubble.innerHTML = `${text.replace(/\n/g, '<br>')}<span class="time">${time}</span>`;
  
  chatMessagesContainer.appendChild(bubble);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// Send simulator message to the bot
async function sendSimulatorMessage() {
  const text = chatInputMessage.value.trim();
  if (!text || !selectedPhone) return;

  chatInputMessage.value = '';

  const user = users.find(u => u.phone === selectedPhone);
  const name = user ? user.name : 'Simulador';

  // Push incoming bubble immediately
  appendMessageToSimulator('incoming', text, new Date().toISOString());

  try {
    await fetch('/api/simulate-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: selectedPhone, text, name })
    });
  } catch (err) {
    console.error('Erro ao enviar simulação:', err);
  }
}

// Open modal pre-loaded with User data for editing
function openEditUserModal(phone, name, isAuthorized) {
  isUserEditMode = true;
  editingPhone = phone;
  
  document.getElementById('modal-title').textContent = 'Editar Contato';
  document.getElementById('input-phone').value = phone;
  document.getElementById('input-phone').disabled = true;
  document.getElementById('input-name').value = name;
  document.getElementById('input-authorized').checked = isAuthorized ? true : false;
  document.getElementById('btn-submit-user').textContent = 'Salvar Alterações';
  
  openModal('add-user-modal');
}

// Open modal pre-loaded with Rule data for editing
function openEditRuleModal(id, start_date, end_date, is_allowed, response_message) {
  isRuleEditMode = true;
  editingRuleId = id;
  
  document.getElementById('rule-modal-title').textContent = 'Editar Regra de Pagamento';
  document.getElementById('input-start-date').value = start_date;
  document.getElementById('input-end-date').value = end_date;
  document.getElementById('input-allowed').value = is_allowed ? '1' : '0';
  document.getElementById('input-message').value = response_message;
  document.getElementById('btn-submit-rule').textContent = 'Salvar Alterações';
  
  openModal('rule-modal');
}

// Modal triggers helper
function openModal(modalId) {
  document.getElementById(modalId).classList.add('open');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.remove('open');
  const form = modal.querySelector('form');
  if (form) form.reset();
}

// Tab switcher handler
function switchTab(tabName) {
  // Reset active classes
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(view => view.classList.remove('active'));

  // Set selected active
  document.getElementById(`tab-${tabName}`).classList.add('active');
  document.getElementById(`view-${tabName}`).classList.add('active');

  if (tabName === 'history') {
    updateHistoryUserDropdown();
    loadUserQueriesHistory();
  }

  if (tabName === 'settings') {
    fetchSettings();
  }
}

// Load logs timeline for the selected user
async function loadUserQueriesHistory() {
  const selectHistoryUser = document.getElementById('select-history-user');
  const timelineBody = document.getElementById('queries-timeline-body');
  const phone = selectHistoryUser.value;
  
  if (!phone) {
    timelineBody.innerHTML = `
      <div class="timeline-empty">
        Selecione um contato para visualizar o histórico detalhado de mensagens.
      </div>
    `;
    return;
  }
  
  timelineBody.innerHTML = '<div class="timeline-empty">Carregando histórico...</div>';
  
  try {
    const res = await fetch(`/api/interactions?phone=${phone}`);
    const logs = await res.json();
    
    timelineBody.innerHTML = '';
    
    if (logs.length === 0) {
      timelineBody.innerHTML = `
        <div class="timeline-empty">
          Nenhuma interação registrada para este contato.
        </div>
      `;
      return;
    }
    
    logs.forEach(log => {
      const dateStr = new Date(log.created_at).toLocaleTimeString('pt-BR') + ' - ' + new Date(log.created_at).toLocaleDateString('pt-BR');
      const item = document.createElement('div');
      item.className = `timeline-item ${log.direction}`;
      
      const statesHtml = log.state_before || log.state_after 
        ? `<div class="timeline-states">
             <span class="state-tag">${log.state_before || 'START'}</span> 
             <span>➜</span> 
             <span class="state-tag" style="background: rgba(139, 92, 246, 0.15); border-color: var(--accent-purple);">${log.state_after || 'START'}</span>
           </div>`
        : '';
        
      item.innerHTML = `
        <div class="timeline-header">
          <span>${log.direction === 'incoming' ? '👤 Usuário' : '🤖 Bot'}</span>
          <span>${dateStr}</span>
        </div>
        <div class="timeline-content-card ${log.direction}">
          <div class="timeline-message">${log.message.replace(/\n/g, '<br>')}</div>
          ${statesHtml}
        </div>
      `;
      timelineBody.appendChild(item);
    });
  } catch (err) {
    console.error('Erro ao carregar histórico de consultas:', err);
    timelineBody.innerHTML = '<div class="timeline-empty" style="color: var(--danger);">Erro ao carregar histórico. Tente novamente.</div>';
  }
}

// Bind CRUD handlers to window for HTML click bindings
window.toggleUserAuthorization = toggleUserAuthorization;
window.deleteUser = deleteUser;
window.openEditUserModal = openEditUserModal;
window.deleteRule = deleteRule;
window.openEditRuleModal = openEditRuleModal;
window.switchTab = switchTab;
window.loadUserQueriesHistory = loadUserQueriesHistory;
window.closeModal = closeModal;
window.saveSettings = saveSettings;
window.fetchSettings = fetchSettings;
