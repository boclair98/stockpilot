import WorkerStatusPanel from "@/components/WorkerStatusPanel";
import "@/app/worker-status.css";

export const metadata = {
  title: "워커 운영 상태",
  robots: { index: false, follow: false },
};

export default function WorkerOperationsPage() {
  return <WorkerStatusPanel />;
}
