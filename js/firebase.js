import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager, 
    memoryLocalCache, 
    setLogLevel,
    doc,
    onSnapshot,
    collection,
    query,
    where,
    getDoc,
    getDocs,
    setDoc // ✅ ADDED: This is required to send the remote control signal
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCWGvKjqytJZHfuSnJGwBrVrFV8koYV7Cw",
    authDomain: "melad-software.firebaseapp.com",
    projectId: "melad-software",
    storageBucket: "melad-software.firebasestorage.app",
    messagingSenderId: "902797740173",
    appId: "1:902797740173:web:f1f19921932708f07afac4",
    measurementId: "G-PJQ84BLY8E"
};

export const app = initializeApp(firebaseConfig);
setLogLevel('error');
export const auth = getAuth(app);

let dbInstance;
try {
    dbInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager()
        }),
        experimentalAutoDetectLongPolling: true
    });
} catch (e) {
    try {
        dbInstance = initializeFirestore(app, {
            localCache: persistentLocalCache(),
            experimentalAutoDetectLongPolling: true
        });
    } catch (e2) {
        dbInstance = initializeFirestore(app, {
            localCache: memoryLocalCache(),
            experimentalAutoDetectLongPolling: true
        });
    }
}

export const db = dbInstance;

// ✅ FIXED: Added getDoc, getDocs, AND setDoc
export { doc, onSnapshot, collection, query, where, getDoc, getDocs, setDoc };
