// ---- CONFIG: reemplaza con tu firebaseConfig desde Firebase Console ----
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROJECT_ID.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROJECT_ID.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};
// ----------------------------------------------------------------------
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// UI refs
const loginScreen = document.getElementById('login-screen');
const mainScreen = document.getElementById('main-screen');
const codeInput = document.getElementById('codeInput');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const welcomeUser = document.getElementById('welcomeUser');
const currentUserTypeEl = document.getElementById('currentUserType');
const bankFundsEl = document.getElementById('bankFunds');
const clientsListEl = document.getElementById('clientsList');
const historyWrap = document.getElementById('historyWrap');

let currentUser = null;
let clientsUnsub = null;

// Helpers
function fmt(n){ return 'Bs. '+(Number(n)||0).toLocaleString() }
function showToast(t){ alert(t) } // simple toast via alert para móvil

// Listeners
loginBtn.onclick = login;
logoutBtn.onclick = logout;
document.getElementById('addClientBtn').onclick = addClient;
document.getElementById('transferBtn').onclick = doTransfer;
document.getElementById('massPay').onclick = massPay;
document.getElementById('massCharge').onclick = massCharge;
document.getElementById('addFundsBtn').onclick = addBankFunds;
document.getElementById('withdrawFundsBtn').onclick = withdrawBankFunds;

// FIRESTORE refs
const clientsCol = db.collection('clients');
const adminsCol = db.collection('admins');
const settingsDoc = db.collection('settings').doc('bank');
const historyCol = db.collection('history');

// --- LOGIN ---
async function login(){
  const code = codeInput.value.trim();
  if(!code) return showToast('Ingresa un código');
  // buscar cliente
  const cQ = await clientsCol.where('code','==',Number(code)).limit(1).get();
  if(!cQ.empty){
    const d = cQ.docs[0].data();
    currentUser = { type:'client', name:d.name, code:d.code, docId:cQ.docs[0].id };
    onLogin();
    return;
  }
  // buscar admin
  const aQ = await adminsCol.where('code','==',Number(code)).limit(1).get();
  if(!aQ.empty){
    const d = aQ.docs[0].data();
    currentUser = { type:'admin', name:d.name, code:d.code, docId:aQ.docs[0].id };
    onLogin();
    return;
  }
  showToast('Código no encontrado');
}

function logout(){
  currentUser = null;
  if(clientsUnsub) { clientsUnsub(); clientsUnsub = null; }
  loginScreen.style.display = 'block';
  mainScreen.style.display = 'none';
  codeInput.value = '';
}

// after login
function onLogin(){
  loginScreen.style.display = 'none';
  mainScreen.style.display = 'block';
  welcomeUser.textContent = `Bienvenido, ${currentUser.name}`;
  currentUserTypeEl.textContent = currentUser.type;
  startListeners();
}

// start realtime listeners for clients & bank
function startListeners(){
  // bank funds
  settingsDoc.onSnapshot(doc=>{
    const d = doc.exists ? doc.data() : { bankFunds:0 };
    bankFundsEl.textContent = 'Fondos: ' + (d.funds !== undefined ? fmt(d.funds) : fmt(d.bankFunds));
  });

  // clients list realtime
  clientsUnsub = clientsCol.onSnapshot(snap=>{
    renderClientsSnapshot(snap);
    populateSelects(snap);
  });

  // history: we will load on demand
  renderHistory();
}

// render clients UI
function renderClientsSnapshot(snap){
  clientsListEl.innerHTML = '';
  if(snap.empty) { clientsListEl.textContent = 'No hay clientes aún.'; return; }
  snap.forEach(doc=>{
    const c = doc.data();
    const div = document.createElement('div');
    div.className = 'small';
    div.innerHTML = `<b>${c.name}</b> — Código: ${c.code} — Saldo: ${fmt(c.balance)} — CC: ${fmt(c.cc||0)}`;
    clientsListEl.appendChild(div);
  });
}

// fill selects for transfer form
function populateSelects(snap){
  const from = document.getElementById('fromSelect');
  const to = document.getElementById('toSelect');
  from.innerHTML = '<option value="">De</option><option value="bank">Banco</option>';
  to.innerHTML = '<option value="">Para</option><option value="bank">Banco</option>';
  snap.forEach(doc=>{
    const c = doc.data();
    const id = doc.id;
    const optMain = new Option(`${c.name} (Saldo)`, `${id}--main`);
    const optCC   = new Option(`${c.name} (CC)`, `${id}--cc`);
    from.add(optMain.cloneNode(true));
    from.add(optCC.cloneNode(true));
    to.add(optMain.cloneNode(true));
    to.add(optCC.cloneNode(true));
  });
}

// ADD CLIENT
async function addClient(){
  const name = document.getElementById('clientName').value.trim();
  const bal  = Number(document.getElementById('clientInitBal').value) || 0;
  if(!name) return showToast('Nombre requerido');
  const code = Math.floor(10000 + Math.random()*90000);
  await clientsCol.add({ name, code, balance: bal, cc: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  await historyCol.add({ ts: Date.now(), type:'add client', name, code, amount: bal });
  document.getElementById('clientName').value='';
  showToast(`Cliente ${name} añadido (código ${code})`);
}

// TRANSFER (usa selects)
async function doTransfer(){
  const fromVal = document.getElementById('fromSelect').value;
  const toVal = document.getElementById('toSelect').value;
  const amount = Number(document.getElementById('transferAmount').value) || 0;
  if(!fromVal || !toVal || amount <= 0) return showToast('Completa los campos');
  if(fromVal === toVal) return showToast('No puedes transferir a la misma cuenta');

  try{
    await db.runTransaction(async tx => {
      if(fromVal === 'bank'){
        const [toId,toType] = toVal.split('--');
        const toRef = clientsCol.doc(toId);
        const bank = await tx.get(settingsDoc);
        const bankFunds = bank.exists ? (bank.data().funds ?? bank.data().bankFunds ?? 0) : 0;
        if(bankFunds < amount) throw 'Fondos insuficientes en el banco';
        const toDoc = await tx.get(toRef);
        if(!toDoc.exists) throw 'Destino no encontrado';
        const field = toType==='main' ? 'balance' : 'cc';
        const cur = toDoc.data()[field] || 0;
        tx.update(toRef, { [field]: cur + amount });
        tx.set(settingsDoc, { funds: bankFunds - amount }, { merge: true });
        tx.set(historyCol.doc(), { ts: Date.now(), type:'bank transfer', detail:`Banco → ${toDoc.data().name} (${field})`, amount });
      } else if(toVal === 'bank'){
        const [fromId,fromType] = fromVal.split('--');
        const fromRef = clientsCol.doc(fromId);
        const fromDoc = await tx.get(fromRef);
        if(!fromDoc.exists) throw 'Emisor no encontrado';
        const cur = fromDoc.data()[fromType==='main' ? 'balance' : 'cc'] || 0;
        if(cur < amount) throw 'Fondos insuficientes';
        tx.update(fromRef, { [fromType==='main' ? 'balance' : 'cc']: cur - amount });
        const bank = await tx.get(settingsDoc);
        const bankFunds = bank.exists ? (bank.data().funds ?? bank.data().bankFunds ?? 0) : 0;
        tx.set(settingsDoc, { funds: bankFunds + amount }, { merge: true });
        tx.set(historyCol.doc(), { ts: Date.now(), type:'client deposit', detail:`${fromDoc.data().name} → Banco`, amount });
      } else {
        const [fromId, fromType] = fromVal.split('--');
        const [toId, toType] = toVal.split('--');
        const fromRef = clientsCol.doc(fromId);
        const toRef = clientsCol.doc(toId);
        const fromDoc = await tx.get(fromRef);
        const toDoc   = await tx.get(toRef);
        if(!fromDoc.exists || !toDoc.exists) throw 'Cliente no encontrado';
        const curFrom = fromDoc.data()[fromType==='main' ? 'balance' : 'cc'] || 0;
        if(curFrom < amount) throw 'Fondos insuficientes';
        const curTo = toDoc.data()[toType==='main' ? 'balance' : 'cc'] || 0;
        tx.update(fromRef, { [fromType==='main' ? 'balance' : 'cc']: curFrom - amount });
        tx.update(toRef,   { [toType==='main' ? 'balance' : 'cc']: curTo + amount });
        tx.set(historyCol.doc(), { ts: Date.now(), type:'transfer', detail:`${fromDoc.data().name} → ${toDoc.data().name}`, amount });
      }
    });
    document.getElementById('transferAmount').value = '';
    showToast('Transferencia exitosa');
  }catch(e){ console.error(e); showToast(String(e)); }
}

// MASS PAY & CHARGE
async function massPay(){
  const v = Number(document.getElementById('massAmt').value) || 0;
  if(v <= 0) return showToast('Monto inválido');
  try{
    await db.runTransaction(async tx=>{
      const clientsSnap = await clientsCol.get();
      const bank = await tx.get(settingsDoc);
      const bankFunds = bank.exists ? (bank.data().funds ?? bank.data().bankFunds ?? 0) : 0;
      const total = v * clientsSnap.size;
      if(bankFunds < total) throw 'Fondos insuficientes en el banco';
      clientsSnap.forEach(doc => {
        const cur = doc.data().cc || 0;
        tx.update(clientsCol.doc(doc.id), { cc: cur + v });
      });
      tx.set(settingsDoc, { funds: bankFunds - total }, { merge:true });
      tx.set(historyCol.doc(), { ts: Date.now(), type:'mass pay', detail:`Banco → ${clientsSnap.size} clientes`, amount: v });
    });
    showToast('Pago masivo ejecutado');
  }catch(e){ console.error(e); showToast(String(e)); }
}

async function massCharge(){
  const v = Number(document.getElementById('massAmt').value) || 0;
  if(v <= 0) return showToast('Monto inválido');
  try{
    await db.runTransaction(async tx=>{
      const clientsSnap = await clientsCol.get();
      let total = 0;
      clientsSnap.forEach(doc => {
        const bal = doc.data().balance || 0;
        const newBal = Math.max(0, bal - v);
        total += (bal - newBal);
        tx.update(clientsCol.doc(doc.id), { balance: newBal });
      });
      const bank = await tx.get(settingsDoc);
      const bankFunds = bank.exists ? (bank.data().funds ?? bank.data().bankFunds ?? 0) : 0;
      tx.set(settingsDoc, { funds: bankFunds + total }, { merge:true });
      tx.set(historyCol.doc(), { ts: Date.now(), type:'mass charge', detail:`${clientsSnap.size} clientes → Banco`, amount: v });
    });
    showToast('Cobro masivo ejecutado');
  }catch(e){ console.error(e); showToast(String(e)); }
}

// BANK FUNDS management (admin)
async function addBankFunds(){
  const amount = Number(document.getElementById('bankFundAmount').value) || 0;
  if(amount <= 0) return showToast('Monto inválido');
  await db.runTransaction(async tx=>{
    const bank = await tx.get(settingsDoc);
    const cur = bank.exists ? (bank.data().funds ?? bank.data().bankFunds ?? 0) : 0;
    tx.set(settingsDoc, { funds: cur + amount }, { merge:true });
    tx.set(historyCol.doc(), { ts: Date.now(), type:'bank deposit', amount });
  });
  document.getElementById('bankFundAmount').value='';
  showToast('Fondos agregados correctamente');
}

async function withdrawBankFunds(){
  const amount = Number(document.getElementById('bankFundAmount').value) || 0;
  if(amount <= 0) return showToast('Monto inválido');
  try{
    await db.runTransaction(async tx=>{
      const bank = await tx.get(settingsDoc);
      const cur = bank.exists ? (bank.data().funds ?? bank.data().bankFunds ?? 0) : 0;
      if(cur < amount) throw 'Fondos insuficientes';
      tx.set(settingsDoc, { funds: cur - amount }, { merge:true });
      tx.set(historyCol.doc(), { ts: Date.now(), type:'bank withdraw', amount });
    });
    document.getElementById('bankFundAmount').value='';
    showToast('Retiro exitoso');
  }catch(e){ showToast(String(e)); }
}

// history
async function renderHistory(){
  const snap = await historyCol.orderBy('ts','desc').limit(20).get();
  if(snap.empty){ historyWrap.innerHTML = '<div class="small">Sin movimientos aún.</div>'; return; }
  const lines = [];
  snap.forEach(d=> lines.push(`<div>[${new Date(d.data().ts).toLocaleString()}] ${d.data().type} — ${d.data().detail||''} ${d.data().amount?('— '+fmt(d.data().amount)) : ''}</div>`));
  historyWrap.innerHTML = lines.join('');
}
