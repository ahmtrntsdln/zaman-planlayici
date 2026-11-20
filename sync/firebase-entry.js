// Uygulamanın kullandığı Firebase parçaları; esbuild bunları src/vendor/firebase.js'e tek dosya olarak paketler.
export { initializeApp } from "firebase/app";
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged
} from "firebase/auth";
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, onSnapshot, writeBatch, disableNetwork, enableNetwork,
  getDocsFromServer, waitForPendingWrites
} from "firebase/firestore";
