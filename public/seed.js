// Ejecuta seedData() desde la consola del navegador (F12 -> Console) o inclúyelo temporalmente en index.html
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROJECT_ID.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROJECT_ID.appspot.com",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

async function seedData(){
  await db.collection("admins").doc("admin1").set({ name: "Administrador", code: 9999 });
  await db.collection("clients").doc("c1").set({ name: "Juan Pérez", code: 1001, balance: 500, cc: 200 });
  await db.collection("clients").doc("c2").set({ name: "María López", code: 1002, balance: 300, cc: 150 });
  await db.collection("clients").doc("c3").set({ name: "Carlos García", code: 1003, balance: 800, cc: 400 });
  await db.collection("settings").doc("bank").set({ funds: 5000 });
  alert('Datos de prueba cargados (admin 9999, clientes 1001/1002/1003)');
}
