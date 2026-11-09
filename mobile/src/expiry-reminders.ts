import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import type { DocumentRecord } from "./api";

const ENABLED_KEY = "secureid.expiry-reminders.enabled.v1";
const IDS_KEY = "secureid.expiry-reminders.ids.v1";
const LEAD_DAYS = [30, 7, 1];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type ScheduledIds = Record<string, string[]>;

async function readIds(): Promise<ScheduledIds> {
  try {
    const raw = await SecureStore.getItemAsync(IDS_KEY);
    return raw ? JSON.parse(raw) as ScheduledIds : {};
  } catch {
    return {};
  }
}

async function writeIds(ids: ScheduledIds) {
  await SecureStore.setItemAsync(IDS_KEY, JSON.stringify(ids));
}

export async function areExpiryRemindersEnabled() {
  return (await SecureStore.getItemAsync(ENABLED_KEY)) === "true";
}

export async function enableExpiryReminders(): Promise<boolean> {
  if (await Notifications.getPermissionsAsync().then((p) => p.status) !== "granted") {
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== "granted") return false;
  }
  await Notifications.setNotificationChannelAsync("document-expiry", {
    name: "Document expiry reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 100, 180],
  });
  await SecureStore.setItemAsync(ENABLED_KEY, "true");
  return true;
}

export async function disableExpiryReminders() {
  await SecureStore.setItemAsync(ENABLED_KEY, "false");
  const ids = await readIds();
  await Promise.all(Object.values(ids).flat().map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  await SecureStore.deleteItemAsync(IDS_KEY);
}

export async function syncDocumentExpiryReminder(document: DocumentRecord) {
  const ids = await readIds();
  await Promise.all((ids[document.id] || []).map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  delete ids[document.id];

  if (!(await areExpiryRemindersEnabled()) || !document.expiryDate) {
    await writeIds(ids);
    return;
  }

  const [year, month, day] = document.expiryDate.split("-").map(Number);
  const expiry = new Date(year, month - 1, day, 9, 0, 0, 0);
  const now = new Date();
  const nextIds: string[] = [];

  for (const leadDays of LEAD_DAYS) {
    const triggerDate = new Date(expiry);
    triggerDate.setDate(triggerDate.getDate() - leadDays);
    if (triggerDate.getTime() <= now.getTime()) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Document expiry reminder",
        body: leadDays === 1
          ? `${document.name} expires tomorrow.`
          : `${document.name} expires in ${leadDays} days.`,
        data: { documentId: document.id, kind: "document-expiry" },
        sound: false,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate, channelId: "document-expiry" },
    });
    nextIds.push(id);
  }

  ids[document.id] = nextIds;
  await writeIds(ids);
}

export async function syncAllDocumentExpiryReminders(documents: DocumentRecord[]) {
  if (!(await areExpiryRemindersEnabled())) return;
  const activeIds = new Set(documents.map((document) => document.id));
  const ids = await readIds();
  for (const staleId of Object.keys(ids)) {
    if (!activeIds.has(staleId)) {
      await Promise.all(ids[staleId].map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
      delete ids[staleId];
    }
  }
  await writeIds(ids);
  for (const document of documents) await syncDocumentExpiryReminder(document);
}
