import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStack = {
  Tabs: undefined;
  Login: undefined;
  Signup: undefined;
  OrchardDetail: { orchardId: string };
  OrchardForm: { orchardId?: string };
  BlockForm: { orchardId: string; blockId?: string };
  BlockDetail: { blockId: string };
  SprayPlan: { blockId: string };
  RecordSpray: { blockId: string; stageId?: string; chemicalIds?: string[]; recommendationIds?: Record<string, string> };
  ScoutingForm: { blockId?: string };
  HarvestForm: { blockId?: string };
  InventoryForm: { id?: string };
  Inventory: undefined;
  TaskForm: { orchardId?: string; blockId?: string };
  Tasks: undefined;
  TankCalc: undefined;
  Safety: undefined;
  Settings: undefined;
  Users: undefined;
  Schedule: undefined;
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
