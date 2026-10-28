import { LocationScreen } from "../../../../../components/location-screen";
export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connectionId?: string }>;
}) {
  const { id } = await params;
  const { connectionId } = await searchParams;
  return (
    <LocationScreen
      id={id}
      connectionId={connectionId}
      updatesDisabled={process.env.LOCATION_UPDATES_DISABLED !== "false"}
    />
  );
}
