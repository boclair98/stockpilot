import PersonalWorkspace from "@/components/PersonalWorkspace";
export const metadata = {
  title: "개인 기능 운영",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <PersonalWorkspace mode="operations" />;
}
