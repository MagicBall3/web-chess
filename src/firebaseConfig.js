import { initializeApp } from "firebase/app"
import { getDatabase } from "firebase/database"

const firebaseConfig = {
  apiKey: "AIzaSyDqSN16-ie4vMuK2Y6FWllK4W_6gTiIGwE",
  authDomain: "web-chess-c4c92.firebaseapp.com",
  projectId: "web-chess-c4c92",
  storageBucket: "web-chess-c4c92.firebasestorage.app",
  messagingSenderId: "910243593338",
  appId: "1:910243593338:web:0bf21bf4ae43889dd38fc3",
  databaseURL: "https://web-chess-c4c92-default-rtdb.firebaseio.com"
}

const app = initializeApp(firebaseConfig)
export const db = getDatabase(app)
