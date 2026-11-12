import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Ask permission, obtain the Expo push token and register it with the API. */
export async function registerForPush(): Promise<string | undefined> {
  if (!Device.isDevice) return undefined;
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('alerts', { name: 'Orchard alerts', importance: Notifications.AndroidImportance.HIGH });
  const { status: existing } = await Notifications.getPermissionsAsync();
  const status = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return undefined;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  try {
    await api.pushToken({ token: data, platform: Platform.OS });
  } catch {
    /* retried next launch */
  }
  return data;
}
