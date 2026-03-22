import admin from "firebase-admin";

const app = admin.initializeApp({
  credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

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
