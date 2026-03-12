import { api } from "@/lib/api";
import { LandingHero } from "@/components/home/landing-hero";

export default async function Home() {
  const config = await api.getConfig();

  return <LandingHero config={config} />;
}
