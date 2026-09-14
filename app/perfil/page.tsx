import type { Metadata } from "next";
import { ProfileView } from "@/components/citizen/ProfileView";

export const metadata: Metadata = {
  title: "Mi perfil",
  description: "Tus reportes, confirmaciones y seguidos en Falta la Muni.",
};

export default function PerfilPage() {
  return <ProfileView />;
}
