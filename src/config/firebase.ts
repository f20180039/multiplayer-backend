import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

let app: admin.app.App;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Production (Render) - use environment variable
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log("✅ Firebase Admin initialized (from env variable)");
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Local development - use file path
    app = admin.initializeApp({
      credential: admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log("✅ Firebase Admin initialized (from file)");
  } else {
    // Fallback to application default credentials
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log("✅ Firebase Admin initialized (default credentials)");
  }
} catch (error) {
  console.error("❌ Firebase Admin initialization failed:", error);
  throw error;
}

export const auth = app.auth();

export const verifyIdToken = async (
  token: string
): Promise<{ uid: string; name: string } | null> => {
  try {
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, name: decoded.name || "Player" };
  } catch (err) {
    console.error("Firebase token verification failed:", err);
    return null;
  }
};
