import admin from "firebase-admin";
import { env } from "./env";

let app: admin.app.App;

try {
  if (env.firebaseServiceAccountJson) {
    // Production (Render) - use environment variable
    const serviceAccount = JSON.parse(env.firebaseServiceAccountJson);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: env.firebaseProjectId,
    });
    console.log("Firebase Admin initialized from env variable");
  } else if (env.googleApplicationCredentials) {
    // Local development - use file path
    app = admin.initializeApp({
      credential: admin.credential.cert(env.googleApplicationCredentials),
      projectId: env.firebaseProjectId,
    });
    console.log("Firebase Admin initialized from file");
  } else {
    // Fallback to application default credentials
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: env.firebaseProjectId,
    });
    console.log("Firebase Admin initialized with default credentials");
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error);
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
