import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/state/auth';
import { ReferenceProvider } from './src/state/reference';
import { I18nProvider, useT } from './src/i18n';
import { startAutoSync } from './src/sync/sync';
import { registerForPush } from './src/lib/push';
import { colors } from './src/ui/theme';
import type { RootStack } from './src/screens/nav';
import { LoginScreen, SignupScreen } from './src/screens/auth';
import { TodayScreen } from './src/screens/today';
import { BlockDetailScreen, BlockFormScreen, OrchardDetailScreen, OrchardFormScreen, OrchardsScreen } from './src/screens/orchards';
import { RecordSprayScreen, ScheduleScreen, SprayHomeScreen, SprayPlanScreen, TankCalcScreen } from './src/screens/spray';
import { FieldHomeScreen, HarvestFormScreen, ScoutingFormScreen } from './src/screens/field';
import { InventoryFormScreen, InventoryScreen } from './src/screens/inventory';
import { TaskFormScreen, TasksScreen } from './src/screens/tasks';
import { MoreScreen, SafetyScreen, SettingsScreen, UsersScreen } from './src/screens/more';

const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator();

function Tabs() {
  const { t } = useT();
  const { can } = useAuth();
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarLabelStyle: { fontSize: 13 }, tabBarStyle: { height: 60, paddingBottom: 6 } }}>
      <Tab.Screen name="TodayTab" component={TodayScreen as React.ComponentType} options={{ title: t('today') }} />
      {can('manager') && <Tab.Screen name="OrchardsTab" component={OrchardsScreen as React.ComponentType} options={{ title: t('orchards') }} />}
      <Tab.Screen name="SprayTab" component={SprayHomeScreen as React.ComponentType} options={{ title: t('spray') }} />
      <Tab.Screen name="FieldTab" component={FieldHomeScreen as React.ComponentType} options={{ title: t('field') }} />
      {!can('manager') && <Tab.Screen name="TasksTab" component={TasksScreen as React.ComponentType} options={{ title: t('tasks') }} />}
      <Tab.Screen name="MoreTab" component={MoreScreen as React.ComponentType} options={{ title: t('more') }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, signedIn } = useAuth();
  useEffect(() => {
    if (!signedIn) return;
    const stop = startAutoSync();
    void registerForPush();
    return stop;
  }, [signedIn]);
  if (!ready)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  return (
    <Stack.Navigator screenOptions={{ headerTintColor: colors.primary }}>
      {!signedIn ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Signup" component={SignupScreen} options={{ title: 'Create account' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="OrchardDetail" component={OrchardDetailScreen} options={{ title: 'Orchard' }} />
          <Stack.Screen name="OrchardForm" component={OrchardFormScreen} options={{ title: 'Orchard' }} />
          <Stack.Screen name="BlockForm" component={BlockFormScreen} options={{ title: 'Block' }} />
          <Stack.Screen name="BlockDetail" component={BlockDetailScreen} options={{ title: 'Block' }} />
          <Stack.Screen name="SprayPlan" component={SprayPlanScreen} options={{ title: 'Spray plan' }} />
          <Stack.Screen name="RecordSpray" component={RecordSprayScreen} options={{ title: 'Record spray' }} />
          <Stack.Screen name="ScoutingForm" component={ScoutingFormScreen} options={{ title: 'Scouting' }} />
          <Stack.Screen name="HarvestForm" component={HarvestFormScreen} options={{ title: 'Harvest' }} />
          <Stack.Screen name="Inventory" component={InventoryScreen} />
          <Stack.Screen name="InventoryForm" component={InventoryFormScreen} options={{ title: 'Stock' }} />
          <Stack.Screen name="Tasks" component={TasksScreen} />
          <Stack.Screen name="TaskForm" component={TaskFormScreen} options={{ title: 'Task' }} />
          <Stack.Screen name="TankCalc" component={TankCalcScreen} options={{ title: 'Tank calculator' }} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Schedule' }} />
          <Stack.Screen name="Safety" component={SafetyScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Users" component={UsersScreen} options={{ title: 'Team' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <ReferenceProvider>
            <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary } }}>
              <StatusBar style="dark" />
              <Root />
            </NavigationContainer>
          </ReferenceProvider>
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
