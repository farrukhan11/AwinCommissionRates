import DashboardClient from "./DashboardClient";
import DetailSyncAutoRunner from "./DetailSyncAutoRunner";

export const metadata = {
  title: "Awin Sync Dashboard",
};

export default function DashboardPage() {
  return (
    <>
      <DetailSyncAutoRunner />
      <DashboardClient />
    </>
  );
}
