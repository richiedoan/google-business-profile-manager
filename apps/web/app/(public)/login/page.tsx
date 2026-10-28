import { LoginScreen } from "../../../components/login-screen";
export default function LoginPage() {
  const allowLocalLogin =
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_DEV_LOGIN_ENABLED === "true";
  return <LoginScreen allowLocalLogin={allowLocalLogin} />;
}
