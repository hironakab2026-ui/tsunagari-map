import { createContext, useContext } from "react";
import type { Person } from "@tsunagari/shared";

export interface AppCtx {
  me: Person;
  people: Map<string, Person>;
  toast: (msg: string) => void;
  openCard: (personId: string) => void;
  refreshMe: (p: Person) => void;
  dataVersion: number;
  bumpData: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppCtx missing");
  return c;
};
