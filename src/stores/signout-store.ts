import { create } from "zustand";

interface SignOutState {
  active: boolean;
  userName: string;
  begin: (firstName: string, lastName: string) => void;
  end: () => void;
}

export const useSignOutStore = create<SignOutState>()((set) => ({
  active: false,
  userName: "",
  begin: (firstName, lastName) =>
    set({
      active: true,
      userName: [firstName, lastName].filter(Boolean).join(" ") || "User",
    }),
  end: () => set({ active: false, userName: "" }),
}));
