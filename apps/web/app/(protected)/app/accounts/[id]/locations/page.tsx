import { Suspense } from "react";
import { LocationsScreen } from "../../../../../../components/locations-screen";
import { LoadingState } from "../../../../../../components/data-states";
export default async function LocationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingState />}>
      <LocationsScreen
        accountId={id}
        updatesDisabled={process.env.LOCATION_UPDATES_DISABLED !== "false"}
      />
    </Suspense>
  );
}
