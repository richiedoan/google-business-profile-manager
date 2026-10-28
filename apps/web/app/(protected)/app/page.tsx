import { AccountsScreen } from "../../../components/accounts-screen";
export default async function ApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ googleConnection?: string }>;
}) {
  const { googleConnection } = await searchParams;
  return (
    <AccountsScreen
      connectionResult={
        googleConnection === "success" || googleConnection === "error"
          ? googleConnection
          : undefined
      }
    />
  );
}
