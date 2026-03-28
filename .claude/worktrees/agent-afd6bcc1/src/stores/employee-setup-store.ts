import { create } from "zustand";

export type EmployeeSetupPhase =
  | "profile"
  | "phone"
  | "emergency"
  | "notifications"
  | "complete";

interface EmployeeSetupState {
  phase: EmployeeSetupPhase;
  firstName: string;
  lastName: string;
  profileImageURL: string | null;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  pushEnabled: boolean;
  emailEnabled: boolean;

  setPhase: (phase: EmployeeSetupPhase) => void;
  setProfile: (data: {
    firstName: string;
    lastName: string;
    profileImageURL: string | null;
  }) => void;
  setPhone: (phone: string) => void;
  setEmergencyContact: (data: {
    name: string;
    phone: string;
    relationship: string;
  }) => void;
  setNotifications: (data: { push: boolean; email: boolean }) => void;
  reset: () => void;
}

const initialState = {
  phase: "profile" as EmployeeSetupPhase,
  firstName: "",
  lastName: "",
  profileImageURL: null as string | null,
  phone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  pushEnabled: true,
  emailEnabled: true,
};

export const useEmployeeSetupStore = create<EmployeeSetupState>((set) => ({
  ...initialState,

  setPhase: (phase) => set({ phase }),

  setProfile: (data) =>
    set({
      firstName: data.firstName,
      lastName: data.lastName,
      profileImageURL: data.profileImageURL,
    }),

  setPhone: (phone) => set({ phone }),

  setEmergencyContact: (data) =>
    set({
      emergencyContactName: data.name,
      emergencyContactPhone: data.phone,
      emergencyContactRelationship: data.relationship,
    }),

  setNotifications: (data) =>
    set({
      pushEnabled: data.push,
      emailEnabled: data.email,
    }),

  reset: () => set(initialState),
}));
